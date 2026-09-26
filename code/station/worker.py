"""One worker thread per agent, and the only path from an agent to a model.

Chats and tasks both go through the agent's own queue, so an agent does one
thing at a time and its transcript reads in the order things happened. A
chat waits for its answer; a task returns at once and lands in the
transcript when it is done. Different agents run in parallel.

TEXT ONLY. A worker builds a prompt, calls the model and stores the reply.
It has no tool, shell or file path -- the handoff's "Do not run YOLO-mode
agents on this machine" -- and every prompt says so, so a persona that sounds
like it browses cannot claim it did.

THE KILL SWITCH is read immediately before every model call, not only at
submit time. A task queued before the switch was pulled is marked `stopped`
and never runs, including after the switch is released: releasing the
switch must not replay work it was pulled to prevent.
"""
import json
import queue
import subprocess
import threading
import time
import uuid
from concurrent.futures import Future
from pathlib import Path

from code.station.roster import load_roster
from code.station.store import Store

HISTORY_TURNS = 12
# The whole prompt rides as one argv element to code/providers/cli.js, and
# CPU-only inference re-reads every character on every call. 12k characters
# of history keeps both far from their limits (Linux caps one argument at
# 128 KiB).
HISTORY_CHARS = 12000
CHAT_TIMEOUT_S = 300
MODEL_TIMEOUT_S = 240

RULES = (
    "You are one agent in Ahmed's station inside Jarvis X. You can only write "
    "text: you cannot run tools, browse, read files or send anything. If a "
    "request needs one of those, say exactly what you would need and stop. "
    "Never claim to have done something you cannot do."
)

_STOP = object()


class StationStopped(RuntimeError):
    """The kill switch (.jarvis-x-STOP) is engaged."""


class ModelError(RuntimeError):
    """Every provider in the agent's tier chain failed."""


class UnknownAgent(KeyError):
    pass


def registry_call(tier, system, prompt, *, repo_root, timeout=MODEL_TIMEOUT_S, run=subprocess.run):
    """The default model call: registry.js's CLI, the same bridge hermes.py
    uses for every registry:<tier> model. One chain, one fallback order and
    one on-disk quota for the whole of Jarvis -- the station adds no second
    way to reach a provider."""
    cli = Path(repo_root) / "code" / "providers" / "cli.js"
    try:
        r = run(["node", str(cli), tier, system + "\n\n" + prompt],
                capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise ModelError(f"no answer within {timeout}s") from e
    if r.returncode != 0:
        raise ModelError((r.stderr or "").strip() or f"cli.js exited {r.returncode}")
    try:
        d = json.loads(r.stdout)
    except ValueError as e:
        raise ModelError("cli.js printed something that is not JSON") from e
    text = str(d.get("response") or "").strip()
    if not text:
        raise ModelError("empty response")
    return text, {"provider": d.get("_provider"), "model": d.get("_model")}


def build_prompt(agent, history, message, kind="chat", turns=HISTORY_TURNS, chars=HISTORY_CHARS):
    """Persona goes in `system`; this is everything after it.

    Error turns are left out of the history on purpose -- the same lesson as
    hermes.py's build_context(): replaying "[BACKEND FAILURE]" as dialogue
    teaches the model to imitate it. Oldest turns are dropped first once
    the character budget is spent."""
    lines = []
    used = 0
    for row in reversed([r for r in history if r.get("role") in ("user", "agent")][-turns:]):
        who = "Ahmed" if row["role"] == "user" else agent.name
        line = f"{who}: {row.get('text', '')}"
        if used + len(line) > chars:
            break
        lines.append(line)
        used += len(line)
    lines.reverse()
    ask = "Task from Ahmed" if kind == "task" else "Ahmed"
    parts = [RULES, f"Your name is {agent.name}. Your role: {agent.role}."]
    if lines:
        parts.append("Conversation so far, oldest first:\n" + "\n".join(lines))
    parts.append(f"{ask}: {message}\n{agent.name}:")
    return "\n\n".join(parts)


class _Job:
    __slots__ = ("kind", "text", "task_id", "future")

    def __init__(self, kind, text, task_id=None, future=None):
        self.kind, self.text, self.task_id, self.future = kind, text, task_id, future


class Station:
    def __init__(self, agents, store, model_call, is_stopped, clock=time.time,
                 new_id=lambda: uuid.uuid4().hex[:12]):
        self.agents = {a.id: a for a in agents}
        self.order = [a.id for a in agents]
        self.store = store
        self.model_call = model_call
        self.is_stopped = is_stopped
        self.clock = clock
        self.new_id = new_id
        self._queues = {aid: queue.Queue() for aid in self.order}
        self._threads = {}
        self._state = {aid: {"busy": False, "current": None, "last_active": None} for aid in self.order}
        self._state_lock = threading.Lock()

    @classmethod
    def from_repo(cls, repo_root):
        root = Path(repo_root)
        return cls(
            agents=load_roster(root / "config" / "agents.yaml"),
            store=Store(root / "logs" / "station"),
            model_call=lambda tier, system, prompt: registry_call(tier, system, prompt, repo_root=root),
            # The same file app.py's /api/killswitch writes and guard.js reads.
            is_stopped=lambda: (root / ".jarvis-x-STOP").exists(),
        )

    # --- lifecycle -------------------------------------------------------

    def start(self):
        for aid in self.order:
            if aid in self._threads and self._threads[aid].is_alive():
                continue
            t = threading.Thread(target=self._run, args=(aid,), name=f"station-{aid}", daemon=True)
            self._threads[aid] = t
            t.start()

    def stop(self, timeout=5):
        for aid in list(self._threads):
            self._queues[aid].put(_STOP)
        for t in list(self._threads.values()):
            t.join(timeout)

    # --- public ----------------------------------------------------------

    def agent(self, agent_id):
        if agent_id not in self.agents:
            raise UnknownAgent(agent_id)
        return self.agents[agent_id]

    def status(self):
        out = []
        with self._state_lock:
            for aid in self.order:
                a, s = self.agents[aid], self._state[aid]
                out.append({
                    "id": a.id, "name": a.name, "role": a.role, "tier": a.tier,
                    "busy": s["busy"], "current": s["current"],
                    "queued": self._queues[aid].qsize(), "last_active": s["last_active"],
                })
        return out

    def chat(self, agent_id, message, timeout=CHAT_TIMEOUT_S):
        self.agent(agent_id)
        if self.is_stopped():
            raise StationStopped("kill switch engaged")
        fut = Future()
        self._queues[agent_id].put(_Job("chat", message, future=fut))
        # A timeout here abandons the WAIT, not the job: the answer still
        # lands in the transcript when the model returns.
        return fut.result(timeout=timeout)

    def submit_task(self, agent_id, text):
        self.agent(agent_id)
        if self.is_stopped():
            raise StationStopped("kill switch engaged")
        tid = self.new_id()
        row = self.store.task_event(agent_id, tid, "queued", text=text)
        self._queues[agent_id].put(_Job("task", text, task_id=tid))
        return {"task_id": tid, "status": "queued", "created": row["ts"]}

    # --- the worker ------------------------------------------------------

    def _run(self, aid):
        q = self._queues[aid]
        while True:
            job = q.get()
            if job is _STOP:
                return
            try:
                self._handle(self.agents[aid], job)
            except Exception as e:  # never let one job kill the agent's thread
                if job.future and not job.future.done():
                    job.future.set_exception(e)
            finally:
                with self._state_lock:
                    self._state[aid].update(busy=False, current=None, last_active=self.clock())

    def _handle(self, agent, job):
        if self.is_stopped():
            if job.kind == "task":
                self.store.task_event(agent.id, job.task_id, "stopped",
                                      error="kill switch engaged before it ran")
            else:
                job.future.set_exception(StationStopped("kill switch engaged"))
            return

        with self._state_lock:
            self._state[agent.id].update(busy=True, current=job.task_id or "chat")
        history = self.store.transcript(agent.id, limit=HISTORY_TURNS * 2)
        self.store.append_turn(agent.id, "user", job.text, kind=job.kind, task_id=job.task_id)
        if job.kind == "task":
            self.store.task_event(agent.id, job.task_id, "running")

        prompt = build_prompt(agent, history, job.text, kind=job.kind)
        try:
            text, meta = self.model_call(agent.tier, agent.system, prompt)
        except Exception as e:
            msg = str(e) or type(e).__name__
            self.store.append_turn(agent.id, "error", msg, kind=job.kind, task_id=job.task_id)
            if job.kind == "task":
                self.store.task_event(agent.id, job.task_id, "failed", error=msg)
            else:
                job.future.set_exception(e if isinstance(e, ModelError) else ModelError(msg))
            return

        meta = meta or {}
        row = self.store.append_turn(agent.id, "agent", text, kind=job.kind, task_id=job.task_id,
                                     provider=meta.get("provider"), model=meta.get("model"))
        if job.kind == "task":
            self.store.task_event(agent.id, job.task_id, "done",
                                  provider=meta.get("provider"), model=meta.get("model"))
        else:
            job.future.set_result(row)
