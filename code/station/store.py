"""Per-agent transcript and task log, as append-only JSONL.

    logs/station/<agent id>/transcript.jsonl   one row per turn
    logs/station/<agent id>/tasks.jsonl        one row per task STATUS CHANGE

Append-only for the same reason as logs/actions.jsonl: a row, once written,
is a record, and nothing here rewrites one. A task's current state is the
fold of its rows (latest status wins), so "what happened to task X" stays
answerable after the fact. logs/ is gitignored: every machine keeps its own.
"""
import json
import threading
import time
from pathlib import Path

from code.station.roster import ID_RE

ROLES = ("user", "agent", "error")


class Store:
    def __init__(self, root, clock=time.time):
        self.root = Path(root)
        self.clock = clock
        # One lock for every write. The API thread appends `queued` rows
        # while an agent's worker appends the rest; two writers must not
        # interleave half-lines in one file.
        self._lock = threading.Lock()

    def _dir(self, agent_id):
        # The roster already refuses such ids; checked again here because
        # this is the line that turns an id into a filesystem path.
        if not isinstance(agent_id, str) or not ID_RE.match(agent_id):
            raise ValueError(f"bad agent id: {agent_id!r}")
        return self.root / agent_id

    def _append(self, agent_id, name, row):
        d = self._dir(agent_id)
        line = json.dumps(row, ensure_ascii=False)
        with self._lock:
            d.mkdir(parents=True, exist_ok=True)
            with open(d / name, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        return row

    def _read(self, agent_id, name):
        p = self._dir(agent_id) / name
        if not p.exists():
            return []
        rows = []
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue  # a torn last line from a crash; the rest still count
            if isinstance(row, dict):
                rows.append(row)
        return rows

    def append_turn(self, agent_id, role, text, **meta):
        if role not in ROLES:
            raise ValueError(f"role must be one of {ROLES}")
        row = {"ts": self.clock(), "role": role, "text": str(text)}
        row.update({k: v for k, v in meta.items() if v is not None})
        return self._append(agent_id, "transcript.jsonl", row)

    def transcript(self, agent_id, limit=50):
        rows = self._read(agent_id, "transcript.jsonl")
        return rows[-limit:] if limit else rows

    def task_event(self, agent_id, task_id, status, **fields):
        row = {"ts": self.clock(), "task_id": task_id, "status": status}
        row.update({k: v for k, v in fields.items() if v is not None})
        return self._append(agent_id, "tasks.jsonl", row)

    def tasks(self, agent_id, limit=50):
        """Latest state per task, oldest task first. Fields from earlier rows
        (the task text, from `queued`) carry forward unless a later row
        replaces them."""
        folded = {}
        for row in self._read(agent_id, "tasks.jsonl"):
            tid = row.get("task_id")
            if not tid:
                continue
            if tid not in folded:
                folded[tid] = {"task_id": tid, "created": row.get("ts")}
            folded[tid].update({k: v for k, v in row.items() if k != "ts"})
            folded[tid]["updated"] = row.get("ts")
        out = list(folded.values())
        return out[-limit:] if limit else out
