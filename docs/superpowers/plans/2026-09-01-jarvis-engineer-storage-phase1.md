# Jarvis Engineer — Storage Domain (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working slice of Jarvis Engineer — a read-only CLI that scans this machine's storage/space, deterministically diagnoses findings, and explains them in plain language using the local model.

**Architecture:** Four small Python modules under `code/engineer/`: `evidence/storage.py` collects raw disk/directory facts (Observe), `diagnose.py` runs pure deterministic rules over those facts to produce ranked findings (Diagnose — the LLM never decides this), `explain.py` turns findings into a three-section plain-language report via a direct local-Ollama call, and `core/scan.py` orchestrates all three and is the CLI entrypoint. `core/state.py` persists an append-only history snapshot per scan so the growth-detection rule has something to compare against.

**Tech Stack:** Python 3.11 (`~/venv-ai/bin/python3`), `requests` (already installed, 2.34.2), pytest (already installed, 9.1.1). Follows the existing `app.py` convention of `code.<module>` dotted imports with the repo root inserted onto `sys.path` (not `hermes.py`'s older bare-import convention) — `code/__init__.py` already exists and makes this the established pattern.

**Spec:** `docs/superpowers/specs/2026-09-01-jarvis-engineer-linux-chromeos-design.md`

## Global Constraints

- Read-only: this build makes zero filesystem writes except appending to its own history file (`~/.jarvis-x/engineer/history/*.jsonl`). No deletions, no repairs.
- No Free/Pro tier logic anywhere — this build has exactly one (free) tier.
- Every diagnostic rule produces a `Finding` with exactly these fields: `issue, severity, evidence, probable_root_cause, confidence, affected_components, recommended_action, risk, expected_result, verification_method` (spec's schema, verbatim).
- Never call `hermes.py`'s `HermesCore.ask()` for the explain step — it unconditionally logs every call into `~/.hermes/state.db`'s real chat history. Use `code/router.py`'s `Router().resolve(tier)` to get the model name, then POST directly to Ollama's `http://localhost:11434/api/generate`.
- Anything the evidence layer can't observe (path doesn't exist, permission denied) is reported as an explicit `"unavailable"` field — never silently dropped.
- Platform: Linux / ChromeOS-Crostini only. No Windows/macOS/Android/iOS code paths.

---

## Task 1: Package scaffolding + scan history (`core/state.py`)

**Files:**
- Create: `code/engineer/__init__.py`
- Create: `code/engineer/core/__init__.py`
- Create: `code/engineer/evidence/__init__.py`
- Create: `code/engineer/actions/__init__.py`
- Create: `code/engineer/core/state.py`
- Test: `code/engineer/core/test_state.py`

**Interfaces:**
- Produces: `append_snapshot(domain: str, evidence: dict) -> None`, `last_snapshot(domain: str) -> dict | None`, module-level `HISTORY_DIR: Path` (constant, monkeypatchable by tests).

- [ ] **Step 1: Write the failing test**

```python
# code/engineer/core/test_state.py
import pytest

from code.engineer.core import state


@pytest.fixture
def isolated_history(tmp_path, monkeypatch):
    history_dir = tmp_path / "history"
    monkeypatch.setattr(state, "HISTORY_DIR", history_dir)
    return history_dir


def test_last_snapshot_returns_none_when_no_history(isolated_history):
    assert state.last_snapshot("storage") is None


def test_append_then_last_snapshot_roundtrips(isolated_history):
    state.append_snapshot("storage", {"a": 1})
    assert state.last_snapshot("storage") == {"a": 1}


def test_last_snapshot_returns_most_recent_of_multiple(isolated_history):
    state.append_snapshot("storage", {"a": 1})
    state.append_snapshot("storage", {"a": 2})
    assert state.last_snapshot("storage") == {"a": 2}


def test_domains_are_independent(isolated_history):
    state.append_snapshot("storage", {"a": 1})
    assert state.last_snapshot("network") is None


def test_append_creates_history_dir_on_first_use(isolated_history):
    assert not isolated_history.exists()
    state.append_snapshot("storage", {"a": 1})
    assert isolated_history.exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/core/test_state.py -v`
Expected: FAIL (ModuleNotFoundError — `code.engineer.core.state` doesn't exist yet, and `code/engineer/`, `code/engineer/core/` aren't packages yet).

- [ ] **Step 3: Write the package scaffolding and implementation**

```python
# code/engineer/__init__.py
"""Jarvis Engineer -- local-first Linux/ChromeOS device diagnostics.

Retargeted from Jarvis_Master_Blueprint_v0.1.pdf: Linux + ChromeOS(Crostini)
only, no Free/Pro split (everything here ships free). See
docs/superpowers/specs/2026-09-01-jarvis-engineer-linux-chromeos-design.md.
"""
```

```python
# code/engineer/core/__init__.py
"""Orchestration, CLI entrypoint, and local scan-history storage."""
```

```python
# code/engineer/evidence/__init__.py
"""One module per diagnostic domain. Each exposes a `collect()` function
returning a plain evidence dict. Anything unobservable in this environment
must be reported as an explicit {"unavailable": "<reason>"} value -- never
silently omitted (see the spec's Section 8 platform-limitations rule).
"""
```

```python
# code/engineer/actions/__init__.py
"""Placeholder package for Phase 7 (Act). Empty until diagnostic
reliability is proven across shipped domains -- see the spec's Capability
Roadmap. Do not add code here as part of any earlier phase.
"""
```

```python
# code/engineer/core/state.py
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/core/test_state.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add code/engineer/__init__.py code/engineer/core/__init__.py \
        code/engineer/evidence/__init__.py code/engineer/actions/__init__.py \
        code/engineer/core/state.py code/engineer/core/test_state.py
git commit -m "feat(engineer): scaffold code/engineer package + scan-history store

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Storage evidence collection (`evidence/storage.py`)

**Files:**
- Create: `code/engineer/evidence/storage.py`
- Test: `code/engineer/evidence/test_storage.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `collect() -> dict` with shape `{"disk_usage": {"total_bytes": int, "used_bytes": int, "free_bytes": int, "percent_used": float}, "candidates": {label: {"path": str, "size_bytes": int} | {"path": str, "unavailable": str}}, "backup_files": {"count": int, "total_bytes": int, "paths": [str]}}`. Also exposes `dir_size_bytes(path: Path) -> int | None`, `_downloads_path(chromeos_marker: Path | None = None) -> Path`, `_scan_backup_files(root: Path) -> dict`, and module-level `CANDIDATE_PATHS: list[tuple[str, Path]]`, `JARVIS_X_ROOT: Path` (both monkeypatchable by tests and by Task 5).

- [ ] **Step 1: Write the failing test**

```python
# code/engineer/evidence/test_storage.py
from pathlib import Path

import pytest

from code.engineer.evidence import storage


# --- dir_size_bytes ---------------------------------------------------

def test_dir_size_bytes_sums_files(tmp_path):
    (tmp_path / "a.txt").write_bytes(b"x" * 100)
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "b.txt").write_bytes(b"y" * 50)
    assert storage.dir_size_bytes(tmp_path) == 150


def test_dir_size_bytes_returns_none_for_missing_path(tmp_path):
    assert storage.dir_size_bytes(tmp_path / "missing") is None


def test_dir_size_bytes_does_not_double_count_symlinks(tmp_path):
    real = tmp_path / "real.txt"
    real.write_bytes(b"z" * 10)
    (tmp_path / "link.txt").symlink_to(real)
    assert storage.dir_size_bytes(tmp_path) == 10


# --- _downloads_path ----------------------------------------------------

def test_downloads_path_prefers_chromeos_mount_when_present(tmp_path):
    marker = tmp_path / "Downloads"
    marker.mkdir()
    assert storage._downloads_path(marker) == marker


def test_downloads_path_falls_back_to_home_when_chromeos_mount_absent(tmp_path):
    marker = tmp_path / "does-not-exist"
    assert storage._downloads_path(marker) == Path.home() / "Downloads"


# --- _scan_backup_files ---------------------------------------------------

def test_scan_backup_files_finds_bak_variants(tmp_path):
    (tmp_path / "app.py.bak").write_bytes(b"a" * 10)
    (tmp_path / "app.py.bak2").write_bytes(b"b" * 20)
    (tmp_path / "app.py").write_bytes(b"c" * 30)  # not a match
    result = storage._scan_backup_files(tmp_path)
    assert result["count"] == 2
    assert result["total_bytes"] == 30


def test_scan_backup_files_skips_git_and_node_modules(tmp_path):
    git_dir = tmp_path / ".git"
    git_dir.mkdir()
    (git_dir / "x.bak").write_bytes(b"a" * 10)
    result = storage._scan_backup_files(tmp_path)
    assert result["count"] == 0


# --- collect ---------------------------------------------------------

def test_collect_reports_candidate_sizes(tmp_path, monkeypatch):
    candidate_dir = tmp_path / "candidate"
    candidate_dir.mkdir()
    (candidate_dir / "f.txt").write_bytes(b"x" * 42)
    monkeypatch.setattr(storage, "CANDIDATE_PATHS", [("test-candidate", candidate_dir)])
    monkeypatch.setattr(storage, "JARVIS_X_ROOT", tmp_path)
    evidence = storage.collect()
    assert evidence["disk_usage"]["total_bytes"] > 0
    assert evidence["candidates"]["test-candidate"]["size_bytes"] == 42
    assert "backup_files" in evidence


def test_collect_marks_missing_candidate_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "CANDIDATE_PATHS", [("missing", tmp_path / "nope")])
    monkeypatch.setattr(storage, "JARVIS_X_ROOT", tmp_path)
    evidence = storage.collect()
    assert "unavailable" in evidence["candidates"]["missing"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/evidence/test_storage.py -v`
Expected: FAIL (ModuleNotFoundError — `storage.py` doesn't exist yet)

- [ ] **Step 3: Write the implementation**

```python
# code/engineer/evidence/storage.py
"""Storage/space evidence collection (Observe) for the storage domain.

Collects raw facts only -- no diagnosis happens here. See
code/engineer/diagnose.py for the rules that turn this into findings.
"""
import os
import re
import shutil
from pathlib import Path

JARVIS_X_ROOT = Path(__file__).resolve().parents[3]  # .../jarvis-x/

_BACKUP_PATTERN = re.compile(r"\.bak\d*$")
_SKIP_DIRS = {".git", "node_modules", "__pycache__"}


def dir_size_bytes(path: Path) -> int | None:
    """Total size in bytes of all regular files under `path`, or None if
    `path` doesn't exist. Unreadable files/dirs are skipped, not raised."""
    if not path.exists():
        return None
    total = 0
    for root, _dirs, files in os.walk(path, onerror=lambda e: None):
        for name in files:
            fp = Path(root) / name
            try:
                if fp.is_file() and not fp.is_symlink():
                    total += fp.stat().st_size
            except OSError:
                continue
    return total


def _downloads_path(chromeos_marker: Path | None = None) -> Path:
    """ChromeOS Crostini mounts the host Downloads folder at a fixed path;
    native Linux uses ~/Downloads. Prefer whichever exists."""
    marker = chromeos_marker if chromeos_marker is not None else Path("/mnt/chromeos/MyFiles/Downloads")
    if marker.exists():
        return marker
    return Path.home() / "Downloads"


CANDIDATE_PATHS: list[tuple[str, Path]] = [
    ("jarvis-x repo", JARVIS_X_ROOT),
    ("venv-ai", Path.home() / "venv-ai"),
    ("Ollama models", Path("/usr/share/ollama/.ollama/models")),
    ("~/.cache", Path.home() / ".cache"),
    ("~/.npm", Path.home() / ".npm"),
    ("apt archive cache", Path("/var/cache/apt/archives")),
    ("Downloads", _downloads_path()),
]


def _scan_backup_files(root: Path) -> dict:
    """Find files matching *.bak / *.bak<N> under `root`, skipping .git,
    node_modules, and __pycache__ for speed."""
    matches: list[str] = []
    total = 0
    for dirpath, dirnames, filenames in os.walk(root, onerror=lambda e: None):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
        for name in filenames:
            if _BACKUP_PATTERN.search(name):
                fp = Path(dirpath) / name
                try:
                    if fp.is_file() and not fp.is_symlink():
                        matches.append(str(fp))
                        total += fp.stat().st_size
                except OSError:
                    continue
    return {"count": len(matches), "total_bytes": total, "paths": matches}


def collect() -> dict:
    """Observe: gather storage/space evidence. Makes no changes."""
    usage = shutil.disk_usage("/")
    disk_usage = {
        "total_bytes": usage.total,
        "used_bytes": usage.used,
        "free_bytes": usage.free,
        "percent_used": round(usage.used / usage.total * 100, 1),
    }

    candidates: dict[str, dict] = {}
    for label, path in CANDIDATE_PATHS:
        size = dir_size_bytes(path)
        if size is None:
            candidates[label] = {"path": str(path), "unavailable": "path does not exist or is unreadable"}
        else:
            candidates[label] = {"path": str(path), "size_bytes": size}

    return {
        "disk_usage": disk_usage,
        "candidates": candidates,
        "backup_files": _scan_backup_files(JARVIS_X_ROOT),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/evidence/test_storage.py -v`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add code/engineer/evidence/storage.py code/engineer/evidence/test_storage.py
git commit -m "feat(engineer): storage evidence collection

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Diagnosis rules (`diagnose.py`)

**Files:**
- Create: `code/engineer/diagnose.py`
- Test: `code/engineer/test_diagnose.py`

**Interfaces:**
- Consumes: evidence dicts shaped exactly like `evidence/storage.py`'s `collect()` output (Task 2) — but takes plain dicts as parameters, no import of `storage.py` needed, so this module stays independently testable.
- Produces: `Finding` dataclass (fields: `issue: str, severity: str, evidence: str, probable_root_cause: str, confidence: float, affected_components: list[str], recommended_action: str, risk: str, expected_result: str, verification_method: str`), `run_rules(evidence: dict, previous: dict | None) -> list[Finding]`. Individual rules (`check_low_free_space`, `check_space_hogs`, `check_rapid_growth`, `check_backup_file_clutter`) are also public — Task 4/5 only need `Finding` and `run_rules`.

- [ ] **Step 1: Write the failing test**

```python
# code/engineer/test_diagnose.py
from code.engineer import diagnose


def _base_evidence(percent_used=50.0, total_bytes=1000, free_bytes=500):
    return {
        "disk_usage": {
            "total_bytes": total_bytes,
            "used_bytes": total_bytes - free_bytes,
            "free_bytes": free_bytes,
            "percent_used": percent_used,
        },
        "candidates": {},
        "backup_files": {"count": 0, "total_bytes": 0, "paths": []},
    }


# --- check_low_free_space ---------------------------------------------------

def test_low_free_space_no_finding_when_healthy():
    assert diagnose.check_low_free_space(_base_evidence(percent_used=50.0), None) == []


def test_low_free_space_critical_at_95_percent():
    findings = diagnose.check_low_free_space(_base_evidence(percent_used=96.0), None)
    assert len(findings) == 1
    assert findings[0].severity == "critical"


def test_low_free_space_high_at_90_percent():
    findings = diagnose.check_low_free_space(_base_evidence(percent_used=91.0), None)
    assert findings[0].severity == "high"


def test_low_free_space_medium_at_85_percent():
    findings = diagnose.check_low_free_space(_base_evidence(percent_used=86.0), None)
    assert findings[0].severity == "medium"


# --- check_space_hogs ---------------------------------------------------

def test_space_hogs_flags_large_candidate():
    evidence = _base_evidence(total_bytes=1000)
    evidence["candidates"] = {"big": {"path": "/big", "size_bytes": 200}}  # 20% of total
    findings = diagnose.check_space_hogs(evidence, None)
    assert len(findings) == 1
    assert "big" in findings[0].issue


def test_space_hogs_ignores_small_candidate():
    evidence = _base_evidence(total_bytes=1000)
    evidence["candidates"] = {"small": {"path": "/small", "size_bytes": 5}}
    assert diagnose.check_space_hogs(evidence, None) == []


def test_space_hogs_skips_unavailable_candidates():
    evidence = _base_evidence(total_bytes=1000)
    evidence["candidates"] = {"missing": {"path": "/x", "unavailable": "path does not exist"}}
    assert diagnose.check_space_hogs(evidence, None) == []


# --- check_rapid_growth ---------------------------------------------------

def test_rapid_growth_no_finding_without_history():
    evidence = _base_evidence()
    evidence["candidates"] = {"x": {"path": "/x", "size_bytes": 1000}}
    assert diagnose.check_rapid_growth(evidence, None) == []


def test_rapid_growth_flags_significant_growth():
    mb = 1024 * 1024
    previous = {"candidates": {"x": {"path": "/x", "size_bytes": 1000 * mb}}}
    evidence = _base_evidence()
    evidence["candidates"] = {"x": {"path": "/x", "size_bytes": 1600 * mb}}  # +600MB, +60%
    findings = diagnose.check_rapid_growth(evidence, previous)
    assert len(findings) == 1


def test_rapid_growth_ignores_small_growth():
    mb = 1024 * 1024
    previous = {"candidates": {"x": {"path": "/x", "size_bytes": 1000 * mb}}}
    evidence = _base_evidence()
    evidence["candidates"] = {"x": {"path": "/x", "size_bytes": 1010 * mb}}  # +10MB only
    assert diagnose.check_rapid_growth(evidence, previous) == []


def test_rapid_growth_skips_candidates_missing_from_previous():
    evidence = _base_evidence()
    evidence["candidates"] = {"new": {"path": "/new", "size_bytes": 999999999}}
    previous = {"candidates": {}}
    assert diagnose.check_rapid_growth(evidence, previous) == []


# --- check_backup_file_clutter ---------------------------------------------------

def test_backup_clutter_no_finding_when_none():
    assert diagnose.check_backup_file_clutter(_base_evidence(), None) == []


def test_backup_clutter_flags_when_present():
    evidence = _base_evidence()
    evidence["backup_files"] = {"count": 2, "total_bytes": 300, "paths": ["a.bak", "b.bak2"]}
    findings = diagnose.check_backup_file_clutter(evidence, None)
    assert len(findings) == 1
    assert findings[0].severity == "low"


# --- run_rules ---------------------------------------------------

def test_run_rules_aggregates_all_rule_findings():
    evidence = _base_evidence(percent_used=96.0)
    evidence["backup_files"] = {"count": 1, "total_bytes": 100, "paths": ["a.bak"]}
    findings = diagnose.run_rules(evidence, None)
    issues = {f.issue for f in findings}
    assert "Low free disk space" in issues
    assert "Stale backup files found" in issues


def test_finding_has_full_schema():
    findings = diagnose.check_low_free_space(_base_evidence(percent_used=96.0), None)
    f = findings[0]
    for field in ("issue", "severity", "evidence", "probable_root_cause", "confidence",
                  "affected_components", "recommended_action", "risk",
                  "expected_result", "verification_method"):
        assert getattr(f, field) not in (None, "")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/test_diagnose.py -v`
Expected: FAIL (ModuleNotFoundError — `diagnose.py` doesn't exist yet)

- [ ] **Step 3: Write the implementation**

```python
# code/engineer/diagnose.py
"""Deterministic diagnosis rules for the storage/space domain.

Rules decide the diagnosis -- the LLM (explain.py) never does; it only
turns these ranked Findings into plain language. Each rule is a pure
function: (evidence, previous_evidence_or_None) -> list[Finding].
"""
from dataclasses import dataclass


@dataclass
class Finding:
    issue: str
    severity: str  # "critical" | "high" | "medium" | "low"
    evidence: str
    probable_root_cause: str
    confidence: float  # 0.0-1.0
    affected_components: list[str]
    recommended_action: str
    risk: str
    expected_result: str
    verification_method: str


FREE_SPACE_THRESHOLDS = [
    (95.0, "critical"),
    (90.0, "high"),
    (85.0, "medium"),
]


def check_low_free_space(evidence: dict, previous: dict | None) -> list[Finding]:
    percent_used = evidence["disk_usage"]["percent_used"]
    for threshold, severity in FREE_SPACE_THRESHOLDS:
        if percent_used >= threshold:
            free_gb = evidence["disk_usage"]["free_bytes"] / (1024 ** 3)
            return [Finding(
                issue="Low free disk space",
                severity=severity,
                evidence=f"{percent_used}% of disk used, {free_gb:.1f} GB free",
                probable_root_cause="Disk usage has grown to a level that risks running out of space",
                confidence=0.95,
                affected_components=["/"],
                recommended_action="Review the largest space consumers below and remove what's safe to remove",
                risk="none (this is a read-only observation)",
                expected_result="More free space once safe items are removed",
                verification_method="Re-run the scan and confirm percent_used has dropped",
            )]
    return []


HOG_THRESHOLD_PERCENT = 15.0


def check_space_hogs(evidence: dict, previous: dict | None) -> list[Finding]:
    total = evidence["disk_usage"]["total_bytes"]
    findings = []
    for label, info in evidence["candidates"].items():
        if "unavailable" in info:
            continue
        size = info["size_bytes"]
        share = size / total * 100
        if share >= HOG_THRESHOLD_PERCENT:
            findings.append(Finding(
                issue=f"{label} is a major space consumer",
                severity="medium",
                evidence=f"{label} ({info['path']}) is {size / (1024 ** 3):.1f} GB, {share:.1f}% of total disk capacity",
                probable_root_cause=f"{label} has accumulated significant data over time",
                confidence=0.7,
                affected_components=[info["path"]],
                recommended_action=f"Review {label} manually to decide what, if anything, is safe to remove",
                risk="none (this is a read-only observation, not a deletion)",
                expected_result="Informed decision about whether to reduce this path's size",
                verification_method="Re-run the scan after any manual cleanup and confirm the size dropped",
            ))
    return findings


GROWTH_ABS_BYTES = 500 * 1024 * 1024  # 500MB
GROWTH_REL_PERCENT = 20.0


def check_rapid_growth(evidence: dict, previous: dict | None) -> list[Finding]:
    if previous is None:
        return []
    findings = []
    for label, info in evidence["candidates"].items():
        if "unavailable" in info:
            continue
        prev_info = previous.get("candidates", {}).get(label)
        if not prev_info or "unavailable" in prev_info or prev_info.get("size_bytes", 0) == 0:
            continue
        prev_size = prev_info["size_bytes"]
        size = info["size_bytes"]
        growth = size - prev_size
        growth_percent = growth / prev_size * 100
        if growth >= GROWTH_ABS_BYTES and growth_percent >= GROWTH_REL_PERCENT:
            findings.append(Finding(
                issue=f"{label} has grown rapidly since the last scan",
                severity="medium",
                evidence=f"{label} grew by {growth / (1024 ** 2):.0f} MB ({growth_percent:.0f}%) since the last scan",
                probable_root_cause=f"{label} is accumulating data faster than usual",
                confidence=0.65,
                affected_components=[info["path"]],
                recommended_action=f"Check what's being written to {label} recently",
                risk="none (this is a read-only observation)",
                expected_result="Understanding of what's driving the growth",
                verification_method="Re-run the scan periodically and watch the growth rate",
            ))
    return findings


def check_backup_file_clutter(evidence: dict, previous: dict | None) -> list[Finding]:
    backup = evidence["backup_files"]
    if backup["count"] == 0:
        return []
    return [Finding(
        issue="Stale backup files found",
        severity="low",
        evidence=f"{backup['count']} file(s) matching *.bak/*.bak<N> totalling {backup['total_bytes'] / (1024 ** 2):.0f} MB",
        probable_root_cause="Manual backup copies (e.g. app.py.bak2) left behind after edits",
        confidence=0.9,
        affected_components=backup["paths"][:10],
        recommended_action="Review the listed files and delete any that are no longer needed",
        risk="none (this is a read-only observation, not a deletion)",
        expected_result="Reclaimed space once confirmed-unneeded backups are removed",
        verification_method="Re-run the scan and confirm the backup file count/size dropped",
    )]


ALL_RULES = [check_low_free_space, check_space_hogs, check_rapid_growth, check_backup_file_clutter]


def run_rules(evidence: dict, previous: dict | None) -> list[Finding]:
    findings: list[Finding] = []
    for rule in ALL_RULES:
        findings.extend(rule(evidence, previous))
    return findings
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/test_diagnose.py -v`
Expected: PASS (15 tests)

- [ ] **Step 5: Commit**

```bash
git add code/engineer/diagnose.py code/engineer/test_diagnose.py
git commit -m "feat(engineer): deterministic storage diagnosis rules

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Plain-language explanation (`explain.py`)

**Files:**
- Create: `code/engineer/explain.py`
- Test: `code/engineer/test_explain.py`

**Interfaces:**
- Consumes: `list[diagnose.Finding]` (Task 3), `code.router.Router` (existing, `Router().resolve(tier: str) -> tuple[str, str]`).
- Produces: `explain(findings: list, tier: str = "local", timeout: int = 120) -> str`, `ExplainBackendError` exception, module-level `OLLAMA_URL: str` and `requests` (the imported module — Task 5/tests monkeypatch `explain_module.requests.post`).

- [ ] **Step 1: Write the failing test**

```python
# code/engineer/test_explain.py
import pytest

from code.engineer import diagnose, explain as explain_module


def _finding():
    return diagnose.Finding(
        issue="Low free disk space", severity="high", evidence="91% used",
        probable_root_cause="disk usage grew", confidence=0.95,
        affected_components=["/"], recommended_action="review largest consumers",
        risk="none", expected_result="more free space", verification_method="rescan",
    )


class _FakeResponse:
    def __init__(self, json_data, status_code=200):
        self._json_data = json_data
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise explain_module.requests.HTTPError(f"status {self.status_code}")

    def json(self):
        return self._json_data


def test_findings_to_prompt_handles_empty_list():
    assert explain_module._findings_to_prompt([]) == "No findings."


def test_findings_to_prompt_includes_issue_and_evidence():
    prompt = explain_module._findings_to_prompt([_finding()])
    assert "Low free disk space" in prompt
    assert "91% used" in prompt


def test_explain_returns_model_response(monkeypatch):
    def fake_post(url, json, timeout):
        assert url == explain_module.OLLAMA_URL
        assert "Low free disk space" in json["prompt"]
        return _FakeResponse({"response": "What I found: ..."})
    monkeypatch.setattr(explain_module.requests, "post", fake_post)
    assert explain_module.explain([_finding()]) == "What I found: ..."


def test_explain_raises_on_request_failure(monkeypatch):
    def fake_post(url, json, timeout):
        raise explain_module.requests.RequestException("connection refused")
    monkeypatch.setattr(explain_module.requests, "post", fake_post)
    with pytest.raises(explain_module.ExplainBackendError):
        explain_module.explain([_finding()])


def test_explain_raises_on_empty_response(monkeypatch):
    monkeypatch.setattr(
        explain_module.requests, "post",
        lambda url, json, timeout: _FakeResponse({"response": "   "}),
    )
    with pytest.raises(explain_module.ExplainBackendError):
        explain_module.explain([_finding()])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/test_explain.py -v`
Expected: FAIL (ModuleNotFoundError — `explain.py` doesn't exist yet)

- [ ] **Step 3: Write the implementation**

```python
# code/engineer/explain.py
"""Turns ranked storage findings into the three-section plain-language
report (What I found / What I recommend / What I can do) using the local
model.

Calls Ollama directly -- never via hermes.py's HermesCore.ask(), which
unconditionally logs every call into real chat history (see the wiki
finding recorded 2026-09-01, anchored to hermes.py and code/router.py).
"""
import requests

from code.router import Router

OLLAMA_URL = "http://localhost:11434/api/generate"

SYSTEM_PROMPT = (
    "You are Jarvis, a local systems diagnostic assistant. You are given a "
    "list of findings from a read-only storage scan. Using ONLY the given "
    "findings -- never inventing details -- write a plain-language report "
    "with exactly these three sections: 'What I found', 'What I recommend', "
    "'What I can do'. This build performs no automatic actions, so 'What I "
    "can do' should describe what the user can do manually, not promise "
    "automated fixes. If there are no findings, say the storage looks "
    "healthy."
)


class ExplainBackendError(Exception):
    """The local model backend failed or was unreachable."""


def _findings_to_prompt(findings: list) -> str:
    if not findings:
        return "No findings."
    lines = []
    for f in findings:
        lines.append(
            f"- issue: {f.issue}\n"
            f"  severity: {f.severity}\n"
            f"  evidence: {f.evidence}\n"
            f"  probable_root_cause: {f.probable_root_cause}\n"
            f"  confidence: {f.confidence}\n"
            f"  recommended_action: {f.recommended_action}"
        )
    return "\n".join(lines)


def explain(findings: list, tier: str = "local", timeout: int = 120) -> str:
    """Return the plain-language report for `findings`, or raise
    ExplainBackendError if the local model is unreachable or fails."""
    model, _voice = Router().resolve(tier)
    prompt = SYSTEM_PROMPT + "\n\nFindings:\n" + _findings_to_prompt(findings)
    try:
        resp = requests.post(
            OLLAMA_URL,
            json={"model": model, "prompt": prompt, "stream": False},
            timeout=timeout,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        raise ExplainBackendError(str(e)) from e
    except ValueError as e:  # json decode error
        raise ExplainBackendError(f"unparseable response: {e}") from e
    response = data.get("response", "").strip()
    if not response:
        raise ExplainBackendError("empty response from model")
    return response
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/test_explain.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add code/engineer/explain.py code/engineer/test_explain.py
git commit -m "feat(engineer): plain-language explanation via local Ollama

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Orchestrator + CLI (`core/scan.py`)

**Files:**
- Create: `code/engineer/core/scan.py`
- Test: `code/engineer/core/test_scan.py`

**Interfaces:**
- Consumes: `storage.collect()` (Task 2), `diagnose.run_rules()` / `diagnose.Finding` (Task 3), `explain.explain()` / `explain.ExplainBackendError` (Task 4), `state.last_snapshot()` / `state.append_snapshot()` (Task 1).
- Produces: `run() -> str` (also prints the report), executable as `python3 code/engineer/core/scan.py`.

- [ ] **Step 1: Write the failing test**

```python
# code/engineer/core/test_scan.py
from code.engineer import diagnose
from code.engineer.core import scan as scan_module


def _finding(issue="Low free disk space", recommended_action="review largest consumers"):
    return diagnose.Finding(
        issue=issue, severity="high", evidence="e", probable_root_cause="p",
        confidence=0.9, affected_components=["/"], recommended_action=recommended_action,
        risk="none", expected_result="er", verification_method="vm",
    )


def test_run_prints_healthy_message_when_no_findings(monkeypatch):
    monkeypatch.setattr(scan_module.storage_evidence, "collect", lambda: {})
    monkeypatch.setattr(scan_module.state, "last_snapshot", lambda domain: None)
    monkeypatch.setattr(scan_module.state, "append_snapshot", lambda domain, evidence: None)
    monkeypatch.setattr(scan_module.diagnose, "run_rules", lambda evidence, previous: [])
    result = scan_module.run()
    assert "healthy" in result.lower()


def test_run_calls_explain_when_findings_exist(monkeypatch):
    saved = {}
    monkeypatch.setattr(scan_module.storage_evidence, "collect", lambda: {"disk_usage": {}})
    monkeypatch.setattr(scan_module.state, "last_snapshot", lambda domain: None)
    monkeypatch.setattr(scan_module.state, "append_snapshot",
                         lambda domain, evidence: saved.setdefault("called", True))
    monkeypatch.setattr(scan_module.diagnose, "run_rules", lambda evidence, previous: [_finding()])
    monkeypatch.setattr(scan_module.explain_module, "explain", lambda findings: "LLM report")
    result = scan_module.run()
    assert result == "LLM report"
    assert saved.get("called") is True


def test_run_falls_back_to_raw_findings_when_explain_backend_fails(monkeypatch):
    monkeypatch.setattr(scan_module.storage_evidence, "collect", lambda: {"disk_usage": {}})
    monkeypatch.setattr(scan_module.state, "last_snapshot", lambda domain: None)
    monkeypatch.setattr(scan_module.state, "append_snapshot", lambda domain, evidence: None)
    monkeypatch.setattr(scan_module.diagnose, "run_rules",
                         lambda evidence, previous: [_finding()])

    def raise_backend_error(findings):
        raise scan_module.explain_module.ExplainBackendError("offline")

    monkeypatch.setattr(scan_module.explain_module, "explain", raise_backend_error)
    result = scan_module.run()
    assert "Local model unavailable" in result
    assert "Low free disk space" in result
    assert "review largest consumers" in result


def test_run_passes_previous_snapshot_to_rules(monkeypatch):
    previous = {"candidates": {"x": {"path": "/x", "size_bytes": 1}}}
    monkeypatch.setattr(scan_module.storage_evidence, "collect", lambda: {"disk_usage": {}})
    monkeypatch.setattr(scan_module.state, "last_snapshot", lambda domain: previous)
    monkeypatch.setattr(scan_module.state, "append_snapshot", lambda domain, evidence: None)
    seen = {}
    monkeypatch.setattr(
        scan_module.diagnose, "run_rules",
        lambda evidence, prev: seen.setdefault("previous", prev) or [],
    )
    scan_module.run()
    assert seen["previous"] == previous
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/core/test_scan.py -v`
Expected: FAIL (ModuleNotFoundError — `scan.py` doesn't exist yet)

- [ ] **Step 3: Write the implementation**

```python
#!/usr/bin/env python3
# code/engineer/core/scan.py
"""CLI entrypoint for the Jarvis Engineer storage-domain scan.

Run: ~/venv-ai/bin/python3 code/engineer/core/scan.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))  # jarvis-x/ repo root

from code.engineer import diagnose
from code.engineer import explain as explain_module
from code.engineer.core import state
from code.engineer.evidence import storage as storage_evidence

DOMAIN = "storage"


def _fallback_report(findings: list, error: Exception) -> str:
    lines = [f"(Local model unavailable: {error} -- showing raw findings instead)\n"]
    lines.append("What I found:")
    for f in findings:
        lines.append(f"- [{f.severity}] {f.issue}: {f.evidence}")
    lines.append("\nWhat I recommend:")
    for f in findings:
        lines.append(f"- {f.recommended_action}")
    lines.append("\nWhat I can do:")
    lines.append("- Nothing automatically -- this build is read-only. Review the recommendations above manually.")
    return "\n".join(lines)


def run() -> str:
    """Run one storage-domain scan end-to-end: Observe -> Diagnose ->
    Explain. Prints the report and returns it."""
    evidence = storage_evidence.collect()
    previous = state.last_snapshot(DOMAIN)
    findings = diagnose.run_rules(evidence, previous)
    state.append_snapshot(DOMAIN, evidence)

    if not findings:
        report = (
            "What I found:\nNothing concerning. Storage looks healthy.\n\n"
            "What I recommend:\nNo action needed.\n\n"
            "What I can do:\nNothing -- there's nothing to act on."
        )
    else:
        try:
            report = explain_module.explain(findings)
        except explain_module.ExplainBackendError as e:
            report = _fallback_report(findings, e)

    print(report)
    return report


if __name__ == "__main__":
    run()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/core/test_scan.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Make the CLI executable and run the full test suite**

```bash
chmod +x code/engineer/core/scan.py
~/venv-ai/bin/python3 -m pytest code/engineer -v
```

Expected: all 38 tests across the five test files PASS (5 + 9 + 15 + 5 + 4).

- [ ] **Step 6: Manual smoke test against this real machine**

```bash
~/venv-ai/bin/python3 code/engineer/core/scan.py
```

Expected: a real three-section report prints. At last check this box was at 93% disk used, so `check_low_free_space` should fire at "high" severity (>=90%, <95%) — confirm severity and free-space figures look right. Confirm `~/.jarvis-x/engineer/history/storage-scans.jsonl` was created and has one line. Run it a second time and confirm it still works with a `previous` snapshot present (growth-rule path exercised, even if it finds no growth). If Ollama isn't reachable, confirm the fallback report path fires instead of a crash.

- [ ] **Step 7: Commit**

```bash
git add code/engineer/core/scan.py code/engineer/core/test_scan.py
git commit -m "feat(engineer): storage-scan CLI orchestrator (Observe -> Diagnose -> Explain)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Explicitly not built in this plan

Act/Verify, Health Index, File Intelligence duplicates, Security/Network/Hardware domains, any UI beyond CLI text, Windows/macOS/Android/iOS — all deferred to future phases/specs per `docs/superpowers/specs/2026-09-01-jarvis-engineer-linux-chromeos-design.md`'s Capability Roadmap.
