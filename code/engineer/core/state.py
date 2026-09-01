"""Append-only scan-history snapshots for Jarvis Engineer.

Each domain scan appends one JSON line per run to
~/.jarvis-x/engineer/history/<domain>-scans.jsonl, so diagnosis rules that
need to compare against a previous run (e.g. "has this grown since last
scan?") have something to read.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

HISTORY_DIR = Path.home() / ".jarvis-x" / "engineer" / "history"


def _history_path(domain: str) -> Path:
    return HISTORY_DIR / f"{domain}-scans.jsonl"


def append_snapshot(domain: str, evidence: dict) -> None:
    """Append one evidence snapshot for `domain`, stamped with the current
    UTC time. Creates the history directory on first use."""
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "evidence": evidence,
    }
    with _history_path(domain).open("a") as f:
        f.write(json.dumps(record) + "\n")


def last_snapshot(domain: str) -> dict | None:
    """Return the most recent snapshot's evidence dict for `domain`, or
    None if no history exists yet for that domain."""
    path = _history_path(domain)
    if not path.exists():
        return None
    last_line = None
    with path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                last_line = line
    if last_line is None:
        return None
    return json.loads(last_line)["evidence"]
