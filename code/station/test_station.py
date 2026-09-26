"""The Station (code/station/): roster, store, workers, HTTP routes, mount.

OFFLINE. The model call, the kill switch, the clock and the storage root are
all arguments: no test starts node, reaches a provider or touches the real
logs/. The tests that read REAL repo files (config/agents.yaml, registry.js)
only parse them -- they pin wiring, never reachability.

The assertions that matter most are the ones about what an agent must NOT
do: run while the kill switch is pulled, replay work after it is released,
or leak a failed call into its own next prompt as if it were dialogue.
"""
import json
import re
import threading
import time
from pathlib import Path

import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

from code.station import mount_station
from code.station.api import make_router
from code.station.roster import TIERS, Agent, RosterError, load_roster, parse_roster
from code.station.store import Store
from code.station.worker import (
    RULES, ModelError, Station, StationStopped, UnknownAgent, build_prompt, registry_call,
)

ROOT = Path(__file__).resolve().parents[2]
A = Agent("alpha", "Alpha", "First", "fast", "You are Alpha.")
B = Agent("beta", "Beta", "Second", "local", "You are Beta.")


def wait_for(pred, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.01)
    return False


class FakeModel:
    """Records every call; answers from a script or echoes."""

    def __init__(self, reply=None, fail=None, gate=None):
        self.calls = []
        self.reply = reply
        self.fail = fail
        self.gate = gate  # threading.Event the call waits on, to hold a worker busy
        self.lock = threading.Lock()

    def __call__(self, tier, system, prompt):
        with self.lock:
            self.calls.append({"tier": tier, "system": system, "prompt": prompt})
        if self.gate is not None:
            assert self.gate.wait(5), "test gate never opened"
        if self.fail:
            raise self.fail
        text = self.reply if self.reply is not None else f"reply {len(self.calls)}"
        return text, {"provider": "groq", "model": "g-20b"}


@pytest.fixture
def make_station(tmp_path):
    made = []

    def _make(agents=(A, B), model=None, stopped=None):
        flag = stopped if stopped is not None else {"on": False}
        st = Station(list(agents), Store(tmp_path / "station"), model or FakeModel(),
                     is_stopped=lambda: flag["on"])
        st.flag = flag
        st.start()
        made.append(st)
        return st

    yield _make
    for st in made:
        st.stop(timeout=2)


# --- roster ------------------------------------------------------------------

def test_REAL_roster_loads_and_carries_raqib_as_overseer():
    agents = load_roster(ROOT / "config" / "agents.yaml")
    by_id = {a.id: a for a in agents}
    assert "raqib" in by_id and by_id["raqib"].role == "Overseer"
    assert all(a.tier in TIERS for a in agents)
    assert len(by_id) == len(agents)


def test_REAL_roster_credits_starnet_under_its_license():
    # The roles are adapted from StarNet (MIT). The license's one condition is
    # the notice; if the header loses it, this fails.
    head = (ROOT / "config" / "agents.yaml").read_text(encoding="utf-8")
    assert "MIT License" in head and "Andrew Sims" in head and "androoAGI/starnet" in head


def test_REAL_tiers_match_registry_js():
    src = (ROOT / "code" / "providers" / "registry.js").read_text(encoding="utf-8")
    block = re.search(r"const TIERS = \{(.*?)\n\};", src, re.S)
    assert block, "registry.js has no TIERS table"
    keys = re.findall(r"^\s*(\w+):", block.group(1), re.M)
    assert tuple(keys) == TIERS


def roster(**over):
    entry = {"id": "x", "name": "X", "role": "r", "tier": "fast", "system": "s"}
    entry.update(over)
    return {"agents": [entry]}


@pytest.mark.parametrize("data, msg", [
    (roster(model="fast"), "unknown key"),
    ({"agents": [dict(roster()["agents"][0])] * 2}, "duplicate id"),
    (roster(tier="frontier"), "not one of"),
    (roster(id="../etc"), "id must match"),
    (roster(id="Raqib"), "id must match"),
    (roster(system="   "), "non-empty string"),
    (roster(name="x" * 81), "over 80"),
    ({"agents": []}, "empty"),
    ({"agents": [{"id": "x"}]}, "missing"),
    ({"agent": []}, "mapping with an `agents:` list"),
    ({"agents": [], "extra": 1}, "unknown top-level"),
    (["not", "a", "mapping"], "mapping"),
    ({"agents": ["raqib"]}, "not a mapping"),
])
def test_roster_refuses_bad_entries_by_name(data, msg):
    with pytest.raises(RosterError, match=msg):
        parse_roster(data)


def test_roster_bad_yaml_names_the_file(tmp_path):
    p = tmp_path / "agents.yaml"
    p.write_text("agents: [\n", encoding="utf-8")
    with pytest.raises(RosterError, match="not valid YAML"):
        load_roster(p)


# --- store -------------------------------------------------------------------

def test_store_transcript_appends_in_order_and_limits(tmp_path):
    s = Store(tmp_path, clock=iter(range(100)).__next__)
    for i in range(5):
        s.append_turn("alpha", "user", f"m{i}")
    assert [r["text"] for r in s.transcript("alpha", limit=3)] == ["m2", "m3", "m4"]
    assert s.transcript("beta") == []


def test_store_folds_task_rows_latest_status_wins_text_carries(tmp_path):
    s = Store(tmp_path, clock=iter(range(100)).__next__)
    s.task_event("alpha", "t1", "queued", text="do x")
    s.task_event("alpha", "t2", "queued", text="do y")
    s.task_event("alpha", "t1", "running")
    s.task_event("alpha", "t1", "done", provider="groq")
    t1, t2 = s.tasks("alpha")
    assert (t1["task_id"], t1["status"], t1["text"], t1["provider"]) == ("t1", "done", "do x", "groq")
    assert t1["created"] == 0 and t1["updated"] == 3
    assert (t2["status"], t2["text"]) == ("queued", "do y")


def test_store_rows_are_append_only_on_disk(tmp_path):
    s = Store(tmp_path)
    s.task_event("alpha", "t1", "queued", text="x")
    s.task_event("alpha", "t1", "done")
    lines = (tmp_path / "alpha" / "tasks.jsonl").read_text(encoding="utf-8").splitlines()
    assert [json.loads(line)["status"] for line in lines] == ["queued", "done"]


def test_store_skips_a_torn_line_and_keeps_the_rest(tmp_path):
    s = Store(tmp_path)
    s.append_turn("alpha", "user", "one")
    with open(tmp_path / "alpha" / "transcript.jsonl", "a", encoding="utf-8") as f:
        f.write('{"role": "agent", "te')
    assert [r["text"] for r in s.transcript("alpha")] == ["one"]


def test_store_refuses_ids_that_would_leave_its_root(tmp_path):
    s = Store(tmp_path)
    for bad in ("../x", "a/b", "", None, "UPPER"):
        with pytest.raises(ValueError):
            s.append_turn(bad, "user", "x")
    with pytest.raises(ValueError):
        s.append_turn("alpha", "system", "x")


def test_store_keeps_arabic_readable_on_disk(tmp_path):
    Store(tmp_path).append_turn("alpha", "user", "مرحبا")
    assert "مرحبا" in (tmp_path / "alpha" / "transcript.jsonl").read_text(encoding="utf-8")


# --- prompts -----------------------------------------------------------------

def test_prompt_carries_the_text_only_rule_name_role_and_message():
    p = build_prompt(A, [], "hello")
    assert p.startswith(RULES)
    assert "Your name is Alpha. Your role: First." in p
    assert p.endswith("Ahmed: hello\nAlpha:")


def test_prompt_history_is_oldest_first_and_skips_error_turns():
    hist = [
        {"role": "user", "text": "q1"}, {"role": "agent", "text": "a1"},
        {"role": "error", "text": "All providers failed"},
        {"role": "user", "text": "q2"}, {"role": "agent", "text": "a2"},
    ]
    p = build_prompt(A, hist, "q3")
    assert "Ahmed: q1\nAlpha: a1\nAhmed: q2\nAlpha: a2" in p
    assert "All providers failed" not in p


def test_prompt_drops_oldest_turns_first_when_over_budget():
    hist = [{"role": "user", "text": f"turn{i} " + "x" * 50} for i in range(10)]
    p = build_prompt(A, hist, "now", chars=200)
    assert "turn9" in p and "turn0" not in p


def test_task_prompt_is_labelled_as_a_task():
    assert "Task from Ahmed: write it" in build_prompt(A, [], "write it", kind="task")


# --- the default model call ----------------------------------------------------

class Ran:
    def __init__(self, code=0, out="", err=""):
        self.returncode, self.stdout, self.stderr = code, out, err


def test_registry_call_uses_cli_js_with_the_tier_and_system_first(tmp_path):
    seen = {}

    def run(cmd, **kw):
        seen["cmd"], seen["kw"] = cmd, kw
        return Ran(out=json.dumps({"response": " hi ", "_provider": "groq", "_model": "m"}))

    text, meta = registry_call("smart", "SYS", "PROMPT", repo_root=tmp_path, run=run)
    assert (text, meta) == ("hi", {"provider": "groq", "model": "m"})
    assert seen["cmd"][:3] == ["node", str(tmp_path / "code" / "providers" / "cli.js"), "smart"]
    assert seen["cmd"][3] == "SYS\n\nPROMPT"
    assert seen["kw"]["timeout"] > 0


@pytest.mark.parametrize("ran, msg", [
    (Ran(code=1, err="All providers failed for tier"), "All providers failed"),
    (Ran(code=1, err=""), "exited 1"),
    (Ran(out="not json"), "not JSON"),
    (Ran(out=json.dumps({"response": "  "})), "empty response"),
])
def test_registry_call_failures_are_ModelErrors_never_empty_answers(tmp_path, ran, msg):
    with pytest.raises(ModelError, match=msg):
        registry_call("fast", "s", "p", repo_root=tmp_path, run=lambda *a, **k: ran)


def test_registry_call_timeout_is_a_ModelError(tmp_path):
    import subprocess

    def run(*a, **k):
        raise subprocess.TimeoutExpired("node", 1)

    with pytest.raises(ModelError, match="no answer within"):
        registry_call("fast", "s", "p", repo_root=tmp_path, run=run, timeout=1)


# --- workers -----------------------------------------------------------------

def test_chat_answers_and_records_both_turns_in_order(make_station):
    model = FakeModel(reply="hello Ahmed")
    st = make_station(model=model)
    row = st.chat("alpha", "hi")
    assert row["text"] == "hello Ahmed" and row["provider"] == "groq"
    turns = st.store.transcript("alpha")
    assert [(t["role"], t["text"]) for t in turns] == [("user", "hi"), ("agent", "hello Ahmed")]
    assert model.calls[0]["tier"] == "fast" and model.calls[0]["system"] == "You are Alpha."


def test_second_chat_sees_the_first_in_its_prompt(make_station):
    model = FakeModel()
    st = make_station(model=model)
    st.chat("alpha", "my name is Ahmed")
    st.chat("alpha", "what is my name?")
    assert "Ahmed: my name is Ahmed\nAlpha: reply 1" in model.calls[1]["prompt"]


def test_agents_do_not_share_a_transcript(make_station):
    st = make_station()
    st.chat("alpha", "for alpha")
    assert st.store.transcript("beta") == []


def test_task_runs_in_the_background_queued_running_done(make_station):
    gate = threading.Event()
    st = make_station(model=FakeModel(reply="done it", gate=gate))
    t = st.submit_task("alpha", "write a hook")
    assert t["status"] == "queued"
    assert wait_for(lambda: st.store.tasks("alpha")[0]["status"] == "running")
    assert st.status()[0]["busy"] is True
    gate.set()
    assert wait_for(lambda: st.store.tasks("alpha")[0]["status"] == "done")
    task = st.store.tasks("alpha")[0]
    assert task["text"] == "write a hook" and task["provider"] == "groq"
    assert st.store.transcript("alpha")[-1]["text"] == "done it"
    assert wait_for(lambda: st.status()[0]["busy"] is False)


def test_a_failed_task_is_failed_with_the_reason_never_done(make_station):
    st = make_station(model=FakeModel(fail=ModelError("All providers failed for tier fast")))
    st.submit_task("alpha", "x")
    assert wait_for(lambda: st.store.tasks("alpha")[0]["status"] == "failed")
    assert "All providers failed" in st.store.tasks("alpha")[0]["error"]
    assert st.store.transcript("alpha")[-1]["role"] == "error"


def test_a_failed_chat_raises_ModelError_and_is_recorded(make_station):
    st = make_station(model=FakeModel(fail=RuntimeError("boom")))
    with pytest.raises(ModelError, match="boom"):
        st.chat("alpha", "hi")
    assert [t["role"] for t in st.store.transcript("alpha")] == ["user", "error"]


def test_a_worker_survives_a_failure_and_takes_the_next_job(make_station):
    model = FakeModel(fail=RuntimeError("once"))
    st = make_station(model=model)
    with pytest.raises(ModelError):
        st.chat("alpha", "first")
    model.fail = None
    assert st.chat("alpha", "second")["role"] == "agent"


def test_one_agent_does_one_thing_at_a_time(make_station):
    gate = threading.Event()
    model = FakeModel(gate=gate)
    st = make_station(model=model)
    st.submit_task("alpha", "one")
    st.submit_task("alpha", "two")
    assert wait_for(lambda: len(model.calls) == 1)
    time.sleep(0.05)
    assert len(model.calls) == 1, "the second job started before the first finished"
    assert st.status()[0]["queued"] == 1
    gate.set()
    assert wait_for(lambda: [t["status"] for t in st.store.tasks("alpha")] == ["done", "done"])


def test_different_agents_run_in_parallel(make_station):
    gate = threading.Event()
    model = FakeModel(gate=gate)
    st = make_station(model=model)
    st.submit_task("alpha", "a")
    st.submit_task("beta", "b")
    assert wait_for(lambda: len(model.calls) == 2), "beta waited for alpha"
    gate.set()


def test_unknown_agent_is_refused(make_station):
    st = make_station()
    with pytest.raises(UnknownAgent):
        st.chat("ghost", "hi")
    with pytest.raises(UnknownAgent):
        st.submit_task("ghost", "hi")


def test_KILL_SWITCH_refuses_chat_and_tasks_without_a_model_call(make_station):
    model = FakeModel()
    st = make_station(model=model, stopped={"on": True})
    with pytest.raises(StationStopped):
        st.chat("alpha", "hi")
    with pytest.raises(StationStopped):
        st.submit_task("alpha", "x")
    assert model.calls == []
    assert st.store.tasks("alpha") == []


def test_KILL_SWITCH_pulled_after_queueing_stops_the_task_and_release_does_not_replay_it(make_station):
    gate = threading.Event()
    model = FakeModel(gate=gate)
    st = make_station(model=model)
    st.submit_task("alpha", "first")    # holds the worker at the gate
    st.submit_task("alpha", "second")   # waits in the queue
    assert wait_for(lambda: len(model.calls) == 1)
    st.flag["on"] = True                # switch pulled while "second" is queued
    gate.set()
    assert wait_for(lambda: [t["status"] for t in st.store.tasks("alpha")] == ["done", "stopped"])
    st.flag["on"] = False               # released
    time.sleep(0.1)
    assert len(model.calls) == 1, "the stopped task ran after the switch was released"
    assert "kill switch" in st.store.tasks("alpha")[1]["error"]


def test_KILL_SWITCH_is_read_again_by_the_worker_for_a_queued_chat(make_station):
    gate = threading.Event()
    model = FakeModel(gate=gate)
    st = make_station(model=model)
    st.submit_task("alpha", "busy")
    assert wait_for(lambda: len(model.calls) == 1)
    result = {}

    def talk():
        try:
            st.chat("alpha", "queued chat")
        except StationStopped as e:
            result["err"] = e

    t = threading.Thread(target=talk)
    t.start()
    assert wait_for(lambda: st.status()[0]["queued"] == 1)
    st.flag["on"] = True
    gate.set()
    t.join(5)
    assert isinstance(result.get("err"), StationStopped)
    assert len(model.calls) == 1


def test_KILL_SWITCH_refuses_a_chat_at_once_even_while_the_agent_is_busy(make_station):
    # The worker's own check would refuse it too -- but only after the busy
    # job finished, which on a CPU model can be minutes of a hung request.
    gate = threading.Event()
    st = make_station(model=FakeModel(gate=gate))
    st.submit_task("alpha", "long job")
    assert wait_for(lambda: st.status()[0]["busy"])
    st.flag["on"] = True
    started = time.time()
    with pytest.raises(StationStopped):
        st.chat("alpha", "hi", timeout=2)
    assert time.time() - started < 1, "the refusal waited behind the busy job"
    gate.set()


class FlakyStore(Store):
    """A store whose first transcript write fails, as a full disk would."""

    def __init__(self, root):
        super().__init__(root)
        self.failed = False

    def append_turn(self, *a, **k):
        if not self.failed:
            self.failed = True
            raise OSError("No space left on device")
        return super().append_turn(*a, **k)


def test_a_failure_outside_the_model_call_reaches_the_caller_and_the_worker_lives(tmp_path):
    st = Station([A], FlakyStore(tmp_path), FakeModel(reply="fine"), is_stopped=lambda: False)
    st.start()
    try:
        with pytest.raises(OSError, match="No space left"):
            st.chat("alpha", "first", timeout=2)
        assert st.chat("alpha", "second", timeout=2)["text"] == "fine", "the worker thread died"
        assert wait_for(lambda: st.status()[0]["busy"] is False)
    finally:
        st.stop(timeout=2)


def test_stop_ends_every_worker_thread(tmp_path):
    st = Station([A, B], Store(tmp_path), FakeModel(), is_stopped=lambda: False)
    st.start()
    st.stop(timeout=2)
    assert not any(t.is_alive() for t in st._threads.values())


def test_from_repo_reads_the_real_roster_and_the_kill_switch_path(tmp_path):
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "agents.yaml").write_text(
        (ROOT / "config" / "agents.yaml").read_text(encoding="utf-8"), encoding="utf-8")
    st = Station.from_repo(tmp_path)
    assert "raqib" in st.agents
    assert st.is_stopped() is False
    (tmp_path / ".jarvis-x-STOP").write_text("", encoding="utf-8")
    assert st.is_stopped() is True
    assert st.store.root == tmp_path / "logs" / "station"


# --- HTTP --------------------------------------------------------------------

TOKEN = "t0ken"


def require_token(x_jarvis_token: str = Header(default=None)):
    # Same shape as app.py's: a dependency that raises 401.
    if x_jarvis_token != TOKEN:
        raise HTTPException(status_code=401, detail="missing or invalid X-Jarvis-Token header")


H = {"X-Jarvis-Token": TOKEN}


@pytest.fixture
def client(make_station):
    def _client(**kw):
        st = make_station(**kw)
        app = FastAPI()
        app.include_router(make_router(st, require_token))
        c = TestClient(app)
        c.station = st
        return c
    return _client


def test_http_every_route_requires_the_token(client):
    c = client()
    for method, url, body in [
        ("get", "/api/station/agents", None),
        ("post", "/api/station/agents/alpha/chat", {"message": "hi"}),
        ("get", "/api/station/agents/alpha/transcript", None),
        ("post", "/api/station/agents/alpha/task", {"task": "x"}),
        ("get", "/api/station/agents/alpha/tasks", None),
    ]:
        r = getattr(c, method)(url, json=body) if body else getattr(c, method)(url)
        assert r.status_code == 401, f"{method} {url} answered without a token"
    assert c.station.store.transcript("alpha") == []


def test_http_list_shows_the_roster_and_the_switch(client):
    j = client().get("/api/station/agents", headers=H).json()
    assert [a["id"] for a in j["agents"]] == ["alpha", "beta"]
    assert j["stopped"] is False
    assert set(j["agents"][0]) >= {"id", "name", "role", "tier", "busy", "queued", "current"}


def test_http_chat_then_transcript(client):
    c = client(model=FakeModel(reply="hey"))
    r = c.post("/api/station/agents/alpha/chat", json={"message": "  hi  "}, headers=H)
    assert r.status_code == 200 and r.json()["text"] == "hey"
    turns = c.get("/api/station/agents/alpha/transcript?limit=10", headers=H).json()["turns"]
    assert [(t["role"], t["text"]) for t in turns] == [("user", "hi"), ("agent", "hey")]


def test_http_task_is_202_and_shows_up_done(client):
    c = client(model=FakeModel(reply="ok"))
    r = c.post("/api/station/agents/beta/task", json={"task": "draft"}, headers=H)
    assert r.status_code == 202 and r.json()["status"] == "queued"
    assert wait_for(lambda: c.get("/api/station/agents/beta/tasks", headers=H).json()["tasks"][0]["status"] == "done")


def test_http_unknown_agent_is_404_naming_the_roster(client):
    r = client().post("/api/station/agents/ghost/chat", json={"message": "hi"}, headers=H)
    assert r.status_code == 404 and "config/agents.yaml" in r.json()["detail"]


def test_http_kill_switch_is_503_on_chat_and_task(client):
    c = client(stopped={"on": True})
    assert c.post("/api/station/agents/alpha/chat", json={"message": "hi"}, headers=H).status_code == 503
    assert c.post("/api/station/agents/alpha/task", json={"task": "x"}, headers=H).status_code == 503
    assert c.get("/api/station/agents", headers=H).json()["stopped"] is True


def test_http_model_failure_is_502_with_the_reason(client):
    c = client(model=FakeModel(fail=ModelError("All providers failed for tier fast")))
    r = c.post("/api/station/agents/alpha/chat", json={"message": "hi"}, headers=H)
    assert r.status_code == 502 and "All providers failed" in r.json()["detail"]


def test_http_chat_wait_timeout_is_504_and_the_answer_still_lands(client, monkeypatch):
    import code.station.worker as W
    gate = threading.Event()
    c = client(model=FakeModel(reply="late", gate=gate))
    real = c.station.chat
    monkeypatch.setattr(c.station, "chat", lambda aid, msg: real(aid, msg, timeout=0.05))
    r = c.post("/api/station/agents/alpha/chat", json={"message": "hi"}, headers=H)
    assert r.status_code == 504
    gate.set()
    assert wait_for(lambda: c.station.store.transcript("alpha")[-1]["text"] == "late")
    assert W.CHAT_TIMEOUT_S >= 60


@pytest.mark.parametrize("body", [{"message": ""}, {"message": "x" * 8001}, {}, {"text": "hi"}])
def test_http_bad_chat_bodies_are_422_and_reach_no_model(client, body):
    c = client()
    assert c.post("/api/station/agents/alpha/chat", json=body, headers=H).status_code == 422
    assert c.station.model_call.calls == []


def test_http_transcript_limit_is_bounded(client):
    c = client()
    assert c.get("/api/station/agents/alpha/transcript?limit=0", headers=H).status_code == 422
    assert c.get("/api/station/agents/alpha/transcript?limit=501", headers=H).status_code == 422


# --- mounting into app.py ------------------------------------------------------

def test_mount_puts_station_routes_ahead_of_a_catch_all_defined_first(tmp_path, monkeypatch):
    # app.py's SPA fallback is a catch-all GET registered before anything
    # local would add. A plain include_router after it would never be reached.
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "agents.yaml").write_text(
        (ROOT / "config" / "agents.yaml").read_text(encoding="utf-8"), encoding="utf-8")
    app = FastAPI()

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        raise HTTPException(status_code=404, detail="Not found")

    st = mount_station(app, require_token, tmp_path)
    try:
        r = TestClient(app).get("/api/station/agents", headers=H)
        assert r.status_code == 200
        assert "raqib" in [a["id"] for a in r.json()["agents"]]
        assert TestClient(app).get("/some/client/route").status_code == 404, "the fallback must still work"
        assert len(st._threads) == len(st.agents), "workers were not started"
        assert all(t.is_alive() for t in st._threads.values())
    finally:
        st.stop(timeout=2)
