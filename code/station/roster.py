"""config/agents.yaml -> a validated roster.

Strict on purpose. The roster is hand-edited, and the failure worth
preventing is the quiet one: a misspelled key that drops an agent's persona,
or an id that walks out of logs/station/. Every problem raises RosterError
naming the entry and the field, at startup, before any worker exists.
"""
import re
from dataclasses import dataclass
from pathlib import Path

import yaml

# registry.js's TIERS keys. test_station.py reads registry.js and fails if
# the two ever disagree, so a tier added or renamed there cannot leave the
# station routing to a name the registry no longer knows.
TIERS = ("local", "fast", "smart", "quality")
ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
FIELDS = ("id", "name", "role", "tier", "system")
MAX_LABEL = 80


class RosterError(ValueError):
    pass


@dataclass(frozen=True)
class Agent:
    id: str
    name: str
    role: str
    tier: str
    system: str


def parse_roster(data):
    if not isinstance(data, dict) or not isinstance(data.get("agents"), list):
        raise RosterError("roster must be a mapping with an `agents:` list")
    extra = set(data) - {"agents"}
    if extra:
        raise RosterError(f"unknown top-level key(s): {', '.join(sorted(extra))}")
    if not data["agents"]:
        raise RosterError("`agents:` is empty -- the station needs at least one agent")
    agents, seen = [], set()
    for i, entry in enumerate(data["agents"]):
        where = f"agents[{i}]"
        if not isinstance(entry, dict):
            raise RosterError(f"{where} is not a mapping")
        unknown = set(entry) - set(FIELDS)
        if unknown:
            raise RosterError(f"{where}: unknown key(s) {', '.join(sorted(unknown))} "
                              f"(allowed: {', '.join(FIELDS)})")
        missing = [f for f in FIELDS if f not in entry]
        if missing:
            raise RosterError(f"{where}: missing {', '.join(missing)}")
        for f in FIELDS:
            if not isinstance(entry[f], str) or not entry[f].strip():
                raise RosterError(f"{where}: `{f}` must be a non-empty string")
        aid = entry["id"]
        where = f"agent '{aid}'"
        if not ID_RE.match(aid):
            raise RosterError(f"{where}: id must match {ID_RE.pattern}")
        if aid in seen:
            raise RosterError(f"{where}: duplicate id")
        seen.add(aid)
        if entry["tier"] not in TIERS:
            raise RosterError(f"{where}: tier '{entry['tier']}' is not one of {', '.join(TIERS)}")
        for f in ("name", "role"):
            if len(entry[f]) > MAX_LABEL:
                raise RosterError(f"{where}: `{f}` is over {MAX_LABEL} characters")
        agents.append(Agent(aid, entry["name"].strip(), entry["role"].strip(),
                            entry["tier"], entry["system"].strip()))
    return agents


def load_roster(path):
    path = Path(path)
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        raise RosterError(f"{path}: not valid YAML ({e})") from e
    return parse_roster(data)
