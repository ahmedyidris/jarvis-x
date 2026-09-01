# Jarvis Engineer — File Intelligence (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Jarvis Engineer with a second domain — File Intelligence (package-cache size + home-wide old-backup-file clutter) — and merge it with the existing storage domain into one CLI scan.

**Architecture:** A new evidence module `evidence/file_intel.py` (Observe, independent of `evidence/storage.py` by design) and a new rules module `diagnose_file_intel.py` (imports the shared `Finding` dataclass from `diagnose.py` rather than redefining it). `core/scan.py` is extended to run both domains, merge their findings before one `explain()` call, and merge both domains' observation gaps into one "What I couldn't check" section. `explain.py` and `core/state.py` are unchanged — both were already domain-agnostic.

**Tech Stack:** Same as Phase 1 — Python 3.11 (`~/venv-ai/bin/python3`), pytest, dotted `code.engineer.*` imports with the repo root on `sys.path`.

**Spec:** `docs/superpowers/specs/2026-09-01-jarvis-engineer-file-intelligence-design.md`

## Global Constraints

- Read-only: zero filesystem writes except `state.append_snapshot()` (now called once per domain, same mechanism as Phase 1 — unchanged).
- No Free/Pro tier logic anywhere.
- Every Finding uses the exact schema already defined in `diagnose.py` — `diagnose_file_intel.py` imports `Finding` from `diagnose.py`, it does not redefine it.
- `explain.py` is unchanged and already satisfies "never call hermes.py's HermesCore.ask()" — nothing in this phase adds a new LLM call path.
- Anything unobservable is reported as an explicit `"unavailable"` field, always visible in CLI output — reuses and generalizes Phase 1's `_observation_gaps` mechanism in `scan.py`.
- Platform: Linux / ChromeOS-Crostini only.
- Package-cache and backup-file evidence collection duplicates Phase 1's `dir_size_bytes`/backup-scan logic rather than importing `evidence/storage.py` — domain evidence modules stay independent, per Phase 1's established pattern (evidence modules never import each other).

---

## Task 1: File Intelligence evidence collection (`evidence/file_intel.py`)

**Files:**
- Create: `code/engineer/evidence/file_intel.py`
- Test: `code/engineer/evidence/test_file_intel.py`

**Interfaces:**
- Produces: `collect() -> dict` with shape `{"caches": {label: {"path": str, "size_bytes": int} | {"path": str, "unavailable": str}}, "backup_files": {"count": int, "total_bytes": int, "paths": [str]}}`. Also exposes `dir_size_bytes(path: Path) -> int | None`, `_scan_backup_files(root: Path) -> dict`, and module-level `CACHE_PATHS: list[tuple[str, Path]]`, `HOME_DIR: Path` (both monkeypatchable by tests and by Task 4).

- [ ] **Step 1: Write the failing test**

```python
# code/engineer/evidence/test_file_intel.py
from code.engineer.evidence import file_intel


# --- dir_size_bytes ---------------------------------------------------

def test_dir_size_bytes_sums_files(tmp_path):
    (tmp_path / "a.txt").write_bytes(b"x" * 100)
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "b.txt").write_bytes(b"y" * 50)
    assert file_intel.dir_size_bytes(tmp_path) == 150


def test_dir_size_bytes_returns_none_for_missing_path(tmp_path):
    assert file_intel.dir_size_bytes(tmp_path / "missing") is None


def test_dir_size_bytes_returns_none_for_permission_denied(tmp_path):
    locked_dir = tmp_path / "locked"
    locked_dir.mkdir()
    (locked_dir / "secret.txt").write_bytes(b"x" * 10)
    locked_dir.chmod(0o000)
    try:
        assert file_intel.dir_size_bytes(locked_dir) is None
    finally:
        locked_dir.chmod(0o755)


# --- _scan_backup_files ---------------------------------------------------

def test_scan_backup_files_finds_bak_variants(tmp_path):
    (tmp_path / "app.py.bak").write_bytes(b"a" * 10)
    (tmp_path / "app.py.bak2").write_bytes(b"b" * 20)
    (tmp_path / "app.py").write_bytes(b"c" * 30)  # not a match
    result = file_intel._scan_backup_files(tmp_path)
    assert result["count"] == 2
    assert result["total_bytes"] == 30


def test_scan_backup_files_skips_dependency_dirs(tmp_path):
    for skip_dir in ("venv-ai", ".cache", ".npm", ".pyenv", ".rustup", ".cargo", ".venvs", ".git", "node_modules", "__pycache__"):
        d = tmp_path / skip_dir
        d.mkdir()
        (d / "x.bak").write_bytes(b"a" * 10)
    result = file_intel._scan_backup_files(tmp_path)
    assert result["count"] == 0


# --- collect ---------------------------------------------------------

def test_collect_reports_cache_sizes(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "f.txt").write_bytes(b"x" * 42)
    monkeypatch.setattr(file_intel, "CACHE_PATHS", [("test-cache", cache_dir)])
    monkeypatch.setattr(file_intel, "HOME_DIR", tmp_path)
    evidence = file_intel.collect()
    assert evidence["caches"]["test-cache"]["size_bytes"] == 42
    assert "backup_files" in evidence


def test_collect_marks_missing_cache_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(file_intel, "CACHE_PATHS", [("missing", tmp_path / "nope")])
    monkeypatch.setattr(file_intel, "HOME_DIR", tmp_path)
    evidence = file_intel.collect()
    assert "unavailable" in evidence["caches"]["missing"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/evidence/test_file_intel.py -v`
Expected: FAIL (ModuleNotFoundError — `file_intel.py` doesn't exist yet)

- [ ] **Step 3: Write the implementation**

```python
# code/engineer/evidence/file_intel.py
"""File Intelligence evidence collection (Observe) for the file_intel
domain: package-manager caches and home-wide old backup-file clutter.

Collects raw facts only -- no diagnosis happens here. See
code/engineer/diagnose_file_intel.py for the rules that turn this into
findings. Deliberately does not import evidence/storage.py -- domain
evidence modules stay independent, duplicating the small amount of shared
logic (dir_size_bytes, backup-file scanning) rather than coupling to
another domain's module.
"""
import os
import re
from pathlib import Path

_BACKUP_PATTERN = re.compile(r"\.bak\d*$")
_SKIP_DIRS = {
    ".git", "node_modules", "__pycache__",
    "venv-ai", ".cache", ".npm", ".pyenv", ".rustup", ".cargo", ".venvs",
}

HOME_DIR = Path.home()

CACHE_PATHS: list[tuple[str, Path]] = [
    ("pip cache", Path.home() / ".cache" / "pip"),
    ("npm cache", Path.home() / ".npm"),
    ("apt archive cache", Path("/var/cache/apt/archives")),
]


def dir_size_bytes(path: Path) -> int | None:
    """Total size in bytes of all regular files under `path`, or None if
    `path` doesn't exist or is not readable. Unreadable files/dirs are
    skipped, not raised. (Same defensive logic as evidence/storage.py's
    dir_size_bytes, duplicated deliberately -- see module docstring.)"""
    if not path.exists():
        return None
    if not os.access(path, os.R_OK | os.X_OK):
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


def _scan_backup_files(root: Path) -> dict:
    """Find files matching *.bak / *.bak<N> under `root`, skipping .git,
    node_modules, __pycache__, and large dependency/env directories that
    aren't worth walking into for stray backup files."""
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
    """Observe: gather file-intelligence evidence (package caches +
    home-wide backup-file clutter). Makes no changes."""
    caches: dict[str, dict] = {}
    for label, path in CACHE_PATHS:
        size = dir_size_bytes(path)
        if size is None:
            caches[label] = {"path": str(path), "unavailable": "path does not exist or is unreadable"}
        else:
            caches[label] = {"path": str(path), "size_bytes": size}

    return {
        "caches": caches,
        "backup_files": _scan_backup_files(HOME_DIR),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/evidence/test_file_intel.py -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add code/engineer/evidence/file_intel.py code/engineer/evidence/test_file_intel.py
git commit -m "feat(engineer): file_intel evidence collection (package caches + home-wide backup files)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: File Intelligence diagnosis rules (`diagnose_file_intel.py`)

**Files:**
- Create: `code/engineer/diagnose_file_intel.py`
- Test: `code/engineer/test_diagnose_file_intel.py`

**Interfaces:**
- Consumes: evidence dicts shaped like `evidence/file_intel.py`'s `collect()` output (Task 1) — plain dicts as parameters, no import of `file_intel.py` needed.
- Produces: `run_rules(evidence: dict, previous: dict | None) -> list[diagnose.Finding]` (re-exports `Finding` from `diagnose.py` — `diagnose_file_intel.Finding` is the same class as `diagnose.Finding`). Individual rules `check_cache_size` and `check_home_backup_clutter` are also public.

- [ ] **Step 1: Write the failing test**

```python
# code/engineer/test_diagnose_file_intel.py
from code.engineer import diagnose_file_intel


def _base_evidence():
    return {
        "caches": {},
        "backup_files": {"count": 0, "total_bytes": 0, "paths": []},
    }


# --- check_cache_size ---------------------------------------------------

def test_check_cache_size_no_finding_when_small():
    evidence = _base_evidence()
    evidence["caches"] = {"pip cache": {"path": "/x", "size_bytes": 10 * 1024 * 1024}}
    assert diagnose_file_intel.check_cache_size(evidence, None) == []


def test_check_cache_size_flags_large_cache():
    evidence = _base_evidence()
    evidence["caches"] = {"pip cache": {"path": "/x", "size_bytes": 150 * 1024 * 1024}}
    findings = diagnose_file_intel.check_cache_size(evidence, None)
    assert len(findings) == 1
    assert "pip cache purge" in findings[0].recommended_action


def test_check_cache_size_skips_unavailable():
    evidence = _base_evidence()
    evidence["caches"] = {"pip cache": {"path": "/x", "unavailable": "path does not exist or is unreadable"}}
    assert diagnose_file_intel.check_cache_size(evidence, None) == []


def test_check_cache_size_uses_generic_command_for_unknown_label():
    evidence = _base_evidence()
    evidence["caches"] = {"some other cache": {"path": "/x", "size_bytes": 150 * 1024 * 1024}}
    findings = diagnose_file_intel.check_cache_size(evidence, None)
    assert "manually clear" in findings[0].recommended_action


# --- check_home_backup_clutter ---------------------------------------------------

def test_check_home_backup_clutter_no_finding_when_none():
    assert diagnose_file_intel.check_home_backup_clutter(_base_evidence(), None) == []


def test_check_home_backup_clutter_flags_when_present():
    evidence = _base_evidence()
    evidence["backup_files"] = {"count": 3, "total_bytes": 500, "paths": ["a.bak", "b.bak2", "c.bak"]}
    findings = diagnose_file_intel.check_home_backup_clutter(evidence, None)
    assert len(findings) == 1
    assert findings[0].severity == "low"


# --- run_rules ---------------------------------------------------

def test_run_rules_aggregates_both_rules():
    evidence = _base_evidence()
    evidence["caches"] = {"pip cache": {"path": "/x", "size_bytes": 150 * 1024 * 1024}}
    evidence["backup_files"] = {"count": 1, "total_bytes": 100, "paths": ["a.bak"]}
    findings = diagnose_file_intel.run_rules(evidence, None)
    issues = {f.issue for f in findings}
    assert "pip cache is large and safe to clear" in issues
    assert "Stale backup files found across your home directory" in issues


def test_finding_uses_shared_schema():
    evidence = _base_evidence()
    evidence["caches"] = {"pip cache": {"path": "/x", "size_bytes": 150 * 1024 * 1024}}
    f = diagnose_file_intel.check_cache_size(evidence, None)[0]
    for field in ("issue", "severity", "evidence", "probable_root_cause", "confidence",
                  "affected_components", "recommended_action", "risk",
                  "expected_result", "verification_method"):
        assert getattr(f, field) not in (None, "")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/test_diagnose_file_intel.py -v`
Expected: FAIL (ModuleNotFoundError — `diagnose_file_intel.py` doesn't exist yet)

- [ ] **Step 3: Write the implementation**

```python
# code/engineer/diagnose_file_intel.py
"""Deterministic diagnosis rules for the file_intel domain (package caches
+ home-wide backup-file clutter).

Rules decide the diagnosis -- the LLM (explain.py) never does. Each rule is
a pure function: (evidence, previous_evidence_or_None) -> list[Finding].
Imports Finding from diagnose.py rather than redefining it -- one schema,
shared across domains.
"""
from code.engineer.diagnose import Finding

CACHE_SIZE_THRESHOLD_BYTES = 100 * 1024 * 1024  # 100MB

_CLEAR_COMMANDS = {
    "pip cache": "pip cache purge",
    "npm cache": "npm cache clean --force",
    "apt archive cache": "sudo apt clean",
}


def check_cache_size(evidence: dict, previous: dict | None) -> list[Finding]:
    findings = []
    for label, info in evidence["caches"].items():
        if "unavailable" in info:
            continue
        size = info["size_bytes"]
        if size >= CACHE_SIZE_THRESHOLD_BYTES:
            clear_command = _CLEAR_COMMANDS.get(label, f"manually clear {label}")
            findings.append(Finding(
                issue=f"{label} is large and safe to clear",
                severity="low",
                evidence=f"{label} ({info['path']}) is {size / (1024 ** 2):.0f} MB",
                probable_root_cause=f"{label} has accumulated over normal use and was never cleared",
                confidence=0.85,
                affected_components=[info["path"]],
                recommended_action=f"Run `{clear_command}` to reclaim this space safely",
                risk="none (this is a read-only observation; clearing a package cache is safe and the manager will re-download as needed)",
                expected_result="Reclaimed space with no functional impact",
                verification_method="Re-run the scan after clearing and confirm the size dropped",
            ))
    return findings


def check_home_backup_clutter(evidence: dict, previous: dict | None) -> list[Finding]:
    backup = evidence["backup_files"]
    if backup["count"] == 0:
        return []
    return [Finding(
        issue="Stale backup files found across your home directory",
        severity="low",
        evidence=f"{backup['count']} file(s) matching *.bak/*.bak<N> totalling {backup['total_bytes'] / (1024 ** 2):.0f} MB",
        probable_root_cause="Manual backup copies (e.g. app.py.bak2) left behind after edits, across your home directory",
        confidence=0.85,
        affected_components=backup["paths"][:10],
        recommended_action="Review the listed files and delete any that are no longer needed",
        risk="none (this is a read-only observation, not a deletion)",
        expected_result="Reclaimed space once confirmed-unneeded backups are removed",
        verification_method="Re-run the scan and confirm the backup file count/size dropped",
    )]


ALL_RULES = [check_cache_size, check_home_backup_clutter]


def run_rules(evidence: dict, previous: dict | None) -> list[Finding]:
    findings: list[Finding] = []
    for rule in ALL_RULES:
        findings.extend(rule(evidence, previous))
    return findings
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/test_diagnose_file_intel.py -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add code/engineer/diagnose_file_intel.py code/engineer/test_diagnose_file_intel.py
git commit -m "feat(engineer): file_intel diagnosis rules (cache size, home-wide backup clutter)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Integration test for the file_intel evidence/diagnose seam

**Files:**
- Create: `code/engineer/test_integration_file_intel.py`

**Interfaces:**
- Consumes: the real `evidence.file_intel.collect()` (Task 1) and the real `diagnose_file_intel.run_rules()` (Task 2) — no mocks.

**Why this is its own task:** Phase 1's final whole-branch review found that `test_diagnose.py`'s unavailable-handling tests used a hand-typed fixture string that didn't match `evidence/storage.py`'s real `"unavailable"` reason text, so the real seam between evidence collection and diagnosis went unverified until the final review caught it. This task builds that seam test in from the start for the file_intel domain, rather than waiting for a review to find the gap again.

- [ ] **Step 1: Write the test**

```python
# code/engineer/test_integration_file_intel.py
"""Integration test for the file_intel domain's evidence/diagnose seam --
feeds the REAL evidence/file_intel.collect() output into the REAL
diagnose_file_intel.run_rules(), rather than a hand-typed fixture, so a key
rename in one module can't silently drift from the other.
"""
from code.engineer import diagnose_file_intel
from code.engineer.evidence import file_intel


def test_real_collect_output_is_valid_input_to_run_rules(tmp_path, monkeypatch):
    normal_cache = tmp_path / "normal_cache"
    normal_cache.mkdir()
    (normal_cache / "big.whl").write_bytes(b"x" * (150 * 1024 * 1024))

    locked_cache = tmp_path / "locked_cache"
    locked_cache.mkdir()
    (locked_cache / "secret").write_bytes(b"y" * 10)
    locked_cache.chmod(0o000)

    missing_cache = tmp_path / "does-not-exist"

    home_dir = tmp_path / "home"
    home_dir.mkdir()
    (home_dir / "notes.txt.bak").write_bytes(b"z" * 100)

    monkeypatch.setattr(file_intel, "CACHE_PATHS", [
        ("normal", normal_cache),
        ("locked", locked_cache),
        ("missing", missing_cache),
    ])
    monkeypatch.setattr(file_intel, "HOME_DIR", home_dir)

    try:
        evidence = file_intel.collect()
        findings = diagnose_file_intel.run_rules(evidence, previous=None)

        # unavailable caches never surface as a "safe to clear" finding
        assert evidence["caches"]["locked"]["unavailable"] == "path does not exist or is unreadable"
        assert evidence["caches"]["missing"]["unavailable"] == "path does not exist or is unreadable"
        assert all("locked" not in f.issue and "missing" not in f.issue for f in findings)

        # the real large cache does surface
        assert any("normal" in f.issue for f in findings)

        # the real home-wide backup file surfaces
        assert any("backup" in f.issue.lower() for f in findings)
    finally:
        locked_cache.chmod(0o755)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/test_integration_file_intel.py -v`
Expected: this test PASSES immediately once Tasks 1 and 2 are both merged (it has no new production code of its own to drive) — but run it now to confirm the real seam actually works end-to-end, not just each module's own mocked tests.

- [ ] **Step 3: Commit**

```bash
git add code/engineer/test_integration_file_intel.py
git commit -m "test(engineer): integration test for file_intel evidence/diagnose seam

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Merge both domains into `core/scan.py`

**Files:**
- Modify: `code/engineer/core/scan.py` (Phase 1's version, read it first — full current content is reproduced below for reference, but read the real file too since this task changes nearly all of it)
- Modify: `code/engineer/core/test_scan.py` (full replacement — Phase 1's 4 tests are superseded by the 8 below, since every existing test's mocking shape changes)

**Interfaces:**
- Consumes: `storage_evidence.collect()` / `diagnose.run_rules()` (Phase 1, unchanged), `file_intel_evidence.collect()` / `diagnose_file_intel.run_rules()` (Tasks 1-2), `state.last_snapshot()` / `state.append_snapshot()` (Phase 1, unchanged — already domain-parameterized), `explain.explain()` / `explain.ExplainBackendError` (Phase 1, unchanged).
- Produces: `run() -> str` (same signature as Phase 1), module-level `STORAGE_DOMAIN: str`, `FILE_INTEL_DOMAIN: str` (renamed/added from Phase 1's single `DOMAIN` constant — nothing else in the codebase imports `scan.DOMAIN`, so this rename is safe).

**Phase 1's current `scan.py`, for reference (you will replace this file's content in Step 3):**

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


def _observation_gaps(evidence: dict) -> list[str]:
    return [
        f"- {label}: {info['unavailable']}"
        for label, info in evidence.get("candidates", {}).items()
        if "unavailable" in info
    ]


def run() -> str:
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

    gap_lines = _observation_gaps(evidence)
    if gap_lines:
        report += "\n\nWhat I couldn't check:\n" + "\n".join(gap_lines)

    print(report)
    return report


if __name__ == "__main__":
    run()
```

- [ ] **Step 1: Write the failing test (full replacement of `test_scan.py`)**

```python
# code/engineer/core/test_scan.py
from code.engineer import diagnose, diagnose_file_intel
from code.engineer.core import scan as scan_module


def _storage_finding(issue="Low free disk space", recommended_action="review largest consumers"):
    return diagnose.Finding(
        issue=issue, severity="high", evidence="e", probable_root_cause="p",
        confidence=0.9, affected_components=["/"], recommended_action=recommended_action,
        risk="none", expected_result="er", verification_method="vm",
    )


def _file_intel_finding(issue="pip cache is large and safe to clear", recommended_action="pip cache purge"):
    return diagnose_file_intel.Finding(
        issue=issue, severity="low", evidence="e", probable_root_cause="p",
        confidence=0.85, affected_components=["/x"], recommended_action=recommended_action,
        risk="none", expected_result="er", verification_method="vm",
    )


def _stub_domains(monkeypatch, storage_findings=(), file_intel_findings=(),
                   storage_evidence=None, file_intel_evidence=None):
    monkeypatch.setattr(scan_module.storage_evidence, "collect",
                         lambda: storage_evidence or {"disk_usage": {}, "candidates": {}})
    monkeypatch.setattr(scan_module.file_intel_evidence, "collect",
                         lambda: file_intel_evidence or {"caches": {}})
    monkeypatch.setattr(scan_module.state, "last_snapshot", lambda domain: None)
    monkeypatch.setattr(scan_module.state, "append_snapshot", lambda domain, evidence: None)
    monkeypatch.setattr(scan_module.diagnose, "run_rules", lambda evidence, previous: list(storage_findings))
    monkeypatch.setattr(scan_module.diagnose_file_intel, "run_rules", lambda evidence, previous: list(file_intel_findings))


def test_run_prints_healthy_message_when_no_findings(monkeypatch):
    _stub_domains(monkeypatch)
    result = scan_module.run()
    assert "healthy" in result.lower()


def test_run_calls_explain_with_merged_findings(monkeypatch):
    monkeypatch.setattr(scan_module.explain_module, "explain", lambda findings: "LLM report")
    _stub_domains(monkeypatch, storage_findings=[_storage_finding()], file_intel_findings=[_file_intel_finding()])
    result = scan_module.run()
    assert result == "LLM report"


def test_run_falls_back_to_raw_findings_when_explain_backend_fails(monkeypatch):
    def raise_backend_error(findings):
        raise scan_module.explain_module.ExplainBackendError("offline")
    monkeypatch.setattr(scan_module.explain_module, "explain", raise_backend_error)
    _stub_domains(monkeypatch, storage_findings=[_storage_finding()])
    result = scan_module.run()
    assert "Local model unavailable" in result
    assert "Low free disk space" in result


def test_run_no_observation_gaps_when_no_unavailable_candidates(monkeypatch):
    _stub_domains(monkeypatch)
    result = scan_module.run()
    assert "What I couldn't check" not in result


def test_run_includes_storage_observation_gaps(monkeypatch):
    _stub_domains(monkeypatch, storage_evidence={
        "disk_usage": {},
        "candidates": {"Downloads": {"path": "/x", "unavailable": "path does not exist or is unreadable"}},
    })
    result = scan_module.run()
    assert "What I couldn't check" in result
    assert "Downloads: path does not exist or is unreadable" in result


def test_run_includes_file_intel_observation_gaps(monkeypatch):
    _stub_domains(monkeypatch, file_intel_evidence={
        "caches": {"pip cache": {"path": "/x", "unavailable": "path does not exist or is unreadable"}},
    })
    result = scan_module.run()
    assert "What I couldn't check" in result
    assert "pip cache: path does not exist or is unreadable" in result


def test_run_persists_both_domain_snapshots(monkeypatch):
    saved = []
    monkeypatch.setattr(scan_module.storage_evidence, "collect", lambda: {"disk_usage": {}, "candidates": {}})
    monkeypatch.setattr(scan_module.file_intel_evidence, "collect", lambda: {"caches": {}})
    monkeypatch.setattr(scan_module.state, "last_snapshot", lambda domain: None)
    monkeypatch.setattr(scan_module.state, "append_snapshot", lambda domain, evidence: saved.append(domain))
    monkeypatch.setattr(scan_module.diagnose, "run_rules", lambda evidence, previous: [])
    monkeypatch.setattr(scan_module.diagnose_file_intel, "run_rules", lambda evidence, previous: [])
    scan_module.run()
    assert saved == [scan_module.STORAGE_DOMAIN, scan_module.FILE_INTEL_DOMAIN]


def test_run_passes_each_domains_previous_snapshot_to_its_own_rules(monkeypatch):
    storage_previous = {"candidates": {"x": {"path": "/x", "size_bytes": 1}}}
    file_intel_previous = {"caches": {"y": {"path": "/y", "size_bytes": 1}}}

    def fake_last_snapshot(domain):
        return storage_previous if domain == scan_module.STORAGE_DOMAIN else file_intel_previous

    monkeypatch.setattr(scan_module.storage_evidence, "collect", lambda: {"disk_usage": {}, "candidates": {}})
    monkeypatch.setattr(scan_module.file_intel_evidence, "collect", lambda: {"caches": {}})
    monkeypatch.setattr(scan_module.state, "last_snapshot", fake_last_snapshot)
    monkeypatch.setattr(scan_module.state, "append_snapshot", lambda domain, evidence: None)

    seen = {}
    # Uses `and []`, not `or []` -- `dict.setdefault(k, v)` returns the
    # stored value `v` itself when the key was absent, so `v or []`
    # evaluates to `v` (a truthy dict) instead of `[]` whenever `v` is
    # non-empty. This exact bug was found and fixed during Phase 1.
    monkeypatch.setattr(scan_module.diagnose, "run_rules",
                         lambda evidence, previous: seen.setdefault("storage", previous) and [])
    monkeypatch.setattr(scan_module.diagnose_file_intel, "run_rules",
                         lambda evidence, previous: seen.setdefault("file_intel", previous) and [])

    scan_module.run()
    assert seen["storage"] == storage_previous
    assert seen["file_intel"] == file_intel_previous
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/core/test_scan.py -v`
Expected: FAIL (AttributeError — `scan_module.file_intel_evidence`, `scan_module.diagnose_file_intel`, `scan_module.STORAGE_DOMAIN`, `scan_module.FILE_INTEL_DOMAIN` don't exist yet; `scan_module.DOMAIN` is still Phase 1's old single constant)

- [ ] **Step 3: Replace `scan.py`'s content**

```python
#!/usr/bin/env python3
# code/engineer/core/scan.py
"""CLI entrypoint for the Jarvis Engineer scan -- runs the storage and
file_intel domains and merges their findings into one report.

Run: ~/venv-ai/bin/python3 code/engineer/core/scan.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))  # jarvis-x/ repo root

from code.engineer import diagnose
from code.engineer import diagnose_file_intel
from code.engineer import explain as explain_module
from code.engineer.core import state
from code.engineer.evidence import file_intel as file_intel_evidence
from code.engineer.evidence import storage as storage_evidence

STORAGE_DOMAIN = "storage"
FILE_INTEL_DOMAIN = "file_intel"


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


def _observation_gaps(evidence: dict, key: str) -> list[str]:
    """Lines describing entries under `evidence[key]` the evidence layer
    couldn't observe (marked `{"unavailable": "<reason>"}`), so gaps are
    always visible in the CLI output rather than silently living only in
    the history file."""
    return [
        f"- {label}: {info['unavailable']}"
        for label, info in evidence.get(key, {}).items()
        if "unavailable" in info
    ]


def run() -> str:
    """Run the storage and file_intel domain scans end-to-end: Observe ->
    Diagnose -> Explain, merged into one report. Prints the report and
    returns it."""
    storage_evidence_data = storage_evidence.collect()
    storage_previous = state.last_snapshot(STORAGE_DOMAIN)
    storage_findings = diagnose.run_rules(storage_evidence_data, storage_previous)
    state.append_snapshot(STORAGE_DOMAIN, storage_evidence_data)

    file_intel_evidence_data = file_intel_evidence.collect()
    file_intel_previous = state.last_snapshot(FILE_INTEL_DOMAIN)
    file_intel_findings = diagnose_file_intel.run_rules(file_intel_evidence_data, file_intel_previous)
    state.append_snapshot(FILE_INTEL_DOMAIN, file_intel_evidence_data)

    findings = storage_findings + file_intel_findings

    if not findings:
        report = (
            "What I found:\nNothing concerning. Storage and file cleanliness look healthy.\n\n"
            "What I recommend:\nNo action needed.\n\n"
            "What I can do:\nNothing -- there's nothing to act on."
        )
    else:
        try:
            report = explain_module.explain(findings)
        except explain_module.ExplainBackendError as e:
            report = _fallback_report(findings, e)

    gap_lines = (
        _observation_gaps(storage_evidence_data, "candidates")
        + _observation_gaps(file_intel_evidence_data, "caches")
    )
    if gap_lines:
        report += "\n\nWhat I couldn't check:\n" + "\n".join(gap_lines)

    print(report)
    return report


if __name__ == "__main__":
    run()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/venv-ai/bin/python3 -m pytest code/engineer/core/test_scan.py -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Make the CLI executable (if the mode was lost) and run the full test suite**

```bash
chmod +x code/engineer/core/scan.py
~/venv-ai/bin/python3 -m pytest code/engineer -v
```

Expected: all 66 tests across the nine test files PASS: 7 (`test_state.py`) + 12 (`evidence/test_storage.py`) + 16 (`test_diagnose.py`) + 5 (`test_explain.py`) + 1 (`test_integration.py`) + 8 (`evidence/test_file_intel.py`) + 8 (`test_diagnose_file_intel.py`) + 1 (`test_integration_file_intel.py`) + 8 (`core/test_scan.py`, this task's replacement set) = 66. (Phase 1 finished at 49; this task's net addition is +17: the 8+8+1 new file_intel tests, with `test_scan.py`'s own count unchanged at 8 since its 8 old tests are replaced by 8 new ones reflecting the dual-domain shape.)

- [ ] **Step 6: Manual smoke test against this real machine**

```bash
~/venv-ai/bin/python3 code/engineer/core/scan.py
```

Expected: a real report covering both domains prints. Confirm `~/.jarvis-x/engineer/history/file_intel-scans.jsonl` was created alongside the existing `storage-scans.jsonl`. Confirm the report reads sensibly whether or not any file_intel findings actually fire on this real machine (pip/npm/apt caches may or may not exceed 100MB right now — either outcome is a valid pass, just confirm the output makes sense either way). If Ollama isn't reachable, confirm the merged fallback report still includes both domains' findings.

- [ ] **Step 7: Commit**

```bash
git add code/engineer/core/scan.py code/engineer/core/test_scan.py
git commit -m "feat(engineer): merge file_intel domain into scan.py's CLI orchestrator

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Explicitly not built in this plan

Duplicate-file detection, Act/Verify automation, the Health Index, Security/Network/Hardware domains, any actual deletion/cleanup execution, any UI beyond CLI text — all deferred to future phases/specs per `docs/superpowers/specs/2026-09-01-jarvis-engineer-file-intelligence-design.md` and the original `docs/superpowers/specs/2026-09-01-jarvis-engineer-linux-chromeos-design.md`'s Capability Roadmap.
