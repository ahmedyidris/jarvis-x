# Semantic Fidelity Review CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a human operator a way to run the already-built, already-validated semantic-fidelity judge (`content_generator.py`'s `check_semantic_fidelity()`) against a specific piece of newly generated phase-b content, on demand.

**Architecture:** A single standalone script, `scripts/review_semantic_fidelity.py`, following the exact import/sys.path pattern already used by `scripts/verify/07_semantic_fidelity_live.py`. It loads one content JSON file (vertical + filename), calls the existing judge with the file's own `headline_fact`/`narration_script`/`on_screen_text`, and prints a verdict. No changes to `content_generator.py`, `economic_facts_generator.py`, `commodities_macro_generator.py`, or `geopolitical_risk_generator.py` — this does not wire anything into automatic generation. That is a deliberate, already-made decision (`PLAN.md`, 2026-08-24: *"GO for deliberate review, NOT automatic gating"*), not something this plan revisits.

**Tech Stack:** Python 3.11 (venv at `~/venv-ai/bin/python3`), pytest, the existing `content_generator.py` module (imported, not modified).

**Spec:** No standalone spec document — the requirement is `PLAN.md`'s recorded "deliberate review" decision plus the corrected fidelity-judge status in `docs/archive/STATUS.md` (2026-08-24). Both already exist in the repo; this plan implements the missing piece neither document itself provides: a way to actually trigger that review.

## Global Constraints

- Do not modify `automation/phase-b/content_generator.py`, `economic_facts_generator.py`, `commodities_macro_generator.py`, or `geopolitical_risk_generator.py` — the judge's plumbing is correct and already unit-tested (`automation/phase-b/test_content_generator_semantic_fidelity.py`); this plan only adds a caller.
- The judge is advisory, not a gate: a quota/network failure (`RuntimeError` from `_call_gemini_judge`/`check_semantic_fidelity`) must never look like a fidelity failure. Print "INCONCLUSIVE" and exit 0.
- Gemini's free tier is 20 calls/day/model and `check_semantic_fidelity()` defaults to `votes=3` (3 calls per review) — this script must not loop or retry judge calls itself; one review call per invocation.
- Follow `scripts/verify/07_semantic_fidelity_live.py`'s existing pattern for locating and importing `content_generator` (`sys.path.insert` relative to `Path(__file__).resolve().parents[N]`, then `import content_generator as cg`) rather than inventing a new import mechanism.
- Test file lives beside the script it tests, matching `automation/phase-b/test_content_generator_semantic_fidelity.py`'s placement convention (test file in the same directory as the code under test).
- Run tests with `~/venv-ai/bin/python3 -m pytest <path> -v`, per this repo's existing convention (see any `Run with:` docstring line in `automation/phase-b/test_content_generator_semantic_fidelity.py` or `scripts/verify/07_semantic_fidelity_live.py`).

---

### Task 1: `review()` — load a content file and call the existing judge

**Files:**
- Create: `scripts/review_semantic_fidelity.py`
- Test: `scripts/test_review_semantic_fidelity.py`

**Interfaces:**
- Consumes: `content_generator.check_semantic_fidelity(source_fact: str, narration: str, caption: str, votes: int = 3) -> dict` (already exists, unmodified — returns `{"faithful": bool, "issue": str|None, "votes": int, "flagged": int, "cached": bool}`).
- Produces: `CONTENT_ROOT: Path` (module-level constant, `automation/phase-b/stages/01_source_content/output`), `review(vertical: str, filename: str) -> dict` (returns `{"vertical": str, "filename": str, **check_semantic_fidelity's dict}`) — Task 2 imports both.

- [ ] **Step 1: Write the failing tests**

```python
"""
Tests for scripts/review_semantic_fidelity.py -- the on-demand semantic
fidelity review CLI (PLAN.md 2026-08-24: "GO for deliberate review, NOT
automatic gating" -- this is the missing trigger for that decision).

Run with: ~/venv-ai/bin/python3 -m pytest scripts/test_review_semantic_fidelity.py -v
"""
import json

import pytest

import review_semantic_fidelity as rsf


@pytest.fixture
def fake_content_file(tmp_path, monkeypatch):
    """A minimal valid content JSON under a fake CONTENT_ROOT."""
    vertical_dir = tmp_path / "economic_facts"
    vertical_dir.mkdir()
    content = {
        "topic": "Test topic",
        "headline_fact": "The rate rose from 3% to 5% in July.",
        "narration_script": "The rate rose from 3% to 5% in July.",
        "on_screen_text": "Rate: 3% -> 5%",
    }
    path = vertical_dir / "econ_test.json"
    path.write_text(json.dumps(content))
    monkeypatch.setattr(rsf, "CONTENT_ROOT", tmp_path)
    return content


def test_review_calls_judge_with_content_fields(fake_content_file, monkeypatch):
    captured = {}

    def fake_check(source_fact, narration, caption):
        captured["args"] = (source_fact, narration, caption)
        return {"faithful": True, "issue": None, "votes": 3, "flagged": 0, "cached": False}

    monkeypatch.setattr(rsf.cg, "check_semantic_fidelity", fake_check)

    result = rsf.review("economic_facts", "econ_test.json")

    assert captured["args"] == (
        fake_content_file["headline_fact"],
        fake_content_file["narration_script"],
        fake_content_file["on_screen_text"],
    )
    assert result["vertical"] == "economic_facts"
    assert result["filename"] == "econ_test.json"
    assert result["faithful"] is True


def test_review_raises_filenotfound_for_missing_file(tmp_path, monkeypatch):
    monkeypatch.setattr(rsf, "CONTENT_ROOT", tmp_path)
    with pytest.raises(FileNotFoundError, match="no-such-vertical/nope.json"):
        rsf.review("no-such-vertical", "nope.json")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/ahmedyidris/jarvis-x && ~/venv-ai/bin/python3 -m pytest scripts/test_review_semantic_fidelity.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'review_semantic_fidelity'` (the script doesn't exist yet). If pytest can't resolve the import because `scripts/` isn't on `sys.path`, that's expected too — Step 3 handles it inside the test file's target module, and pytest's `rootdir`-relative import (with no `__init__.py` in `scripts/`) adds the test's own directory to `sys.path` automatically (`rootdir`-based `sys.path` insertion, same reason `automation/phase-b/test_content_generator_semantic_fidelity.py` can `import content_generator as cg` unqualified).

- [ ] **Step 3: Write minimal implementation**

```python
#!/usr/bin/env python3
"""On-demand semantic-fidelity review for one piece of generated phase-b
content (PLAN.md, 2026-08-24: semantic judge is "GO for deliberate review,
NOT automatic gating" -- this is the missing trigger for that decision).

Run with:
  ~/venv-ai/bin/python3 scripts/review_semantic_fidelity.py <vertical> <filename>

Example:
  ~/venv-ai/bin/python3 scripts/review_semantic_fidelity.py economic_facts econ_egypt-inflation.json

Uses content_generator.py's check_semantic_fidelity() unmodified -- one
review call per invocation (votes=3, so 3 Gemini calls against its 20/day
free-tier cap). A quota/network failure prints INCONCLUSIVE and exits 0:
a judge that could not run is not a judge that missed a defect, and this
tool must never look like a hard failure the way an automatic gate would
(see scripts/verify/07_semantic_fidelity_live.py's identical stance).
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "automation" / "phase-b"))

import content_generator as cg  # noqa: E402

CONTENT_ROOT = REPO / "automation" / "phase-b" / "stages" / "01_source_content" / "output"


def review(vertical: str, filename: str) -> dict:
    """Load `<CONTENT_ROOT>/<vertical>/<filename>` and run the semantic
    judge against its own headline_fact/narration_script/on_screen_text.
    Raises FileNotFoundError if the file doesn't exist. Raises RuntimeError
    (propagated from check_semantic_fidelity) if the judge itself could not
    run -- callers distinguish "flagged" from "couldn't check" this way."""
    path = CONTENT_ROOT / vertical / filename
    if not path.exists():
        raise FileNotFoundError(f"no such content file: {vertical}/{filename}")
    data = json.loads(path.read_text())
    verdict = cg.check_semantic_fidelity(
        data["headline_fact"], data["narration_script"], data["on_screen_text"]
    )
    return {"vertical": vertical, "filename": filename, **verdict}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/ahmedyidris/jarvis-x && ~/venv-ai/bin/python3 -m pytest scripts/test_review_semantic_fidelity.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
cd /home/ahmedyidris/jarvis-x
git add scripts/review_semantic_fidelity.py scripts/test_review_semantic_fidelity.py
git commit -m "phase-b: review() loads a content file and calls the existing semantic judge

Task 1 of the semantic-fidelity review CLI plan.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `main()` — CLI entry point with advisory (not gating) exit codes

**Files:**
- Modify: `scripts/review_semantic_fidelity.py`
- Test: `scripts/test_review_semantic_fidelity.py`

**Interfaces:**
- Consumes: `review(vertical: str, filename: str) -> dict` from Task 1 (raises `FileNotFoundError` or `RuntimeError`).
- Produces: `main(argv: list[str]) -> int` — exit code contract: `2` = usage/file error, `0` = faithful OR judge inconclusive (RuntimeError), `1` = judge flagged the content unfaithful. Nothing later in this plan calls `main()` directly (it's the process entry point), but the exit-code contract is the deliverable a human operator relies on.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test_review_semantic_fidelity.py`:

```python
def test_main_exits_0_and_prints_ok_when_faithful(fake_content_file, monkeypatch, capsys):
    monkeypatch.setattr(
        rsf.cg, "check_semantic_fidelity",
        lambda *a: {"faithful": True, "issue": None, "votes": 3, "flagged": 0, "cached": False},
    )
    code = rsf.main(["review_semantic_fidelity.py", "economic_facts", "econ_test.json"])
    assert code == 0
    assert "OK" in capsys.readouterr().out


def test_main_exits_1_and_prints_issue_when_flagged(fake_content_file, monkeypatch, capsys):
    monkeypatch.setattr(
        rsf.cg, "check_semantic_fidelity",
        lambda *a: {"faithful": False, "issue": "restates a decrease as an increase",
                     "votes": 3, "flagged": 1, "cached": False},
    )
    code = rsf.main(["review_semantic_fidelity.py", "economic_facts", "econ_test.json"])
    assert code == 1
    assert "restates a decrease as an increase" in capsys.readouterr().out


def test_main_exits_0_when_judge_could_not_run(fake_content_file, monkeypatch, capsys):
    def raise_runtime(*a):
        raise RuntimeError("GEMINI_API_KEY not found in .env")
    monkeypatch.setattr(rsf.cg, "check_semantic_fidelity", raise_runtime)
    code = rsf.main(["review_semantic_fidelity.py", "economic_facts", "econ_test.json"])
    assert code == 0
    assert "INCONCLUSIVE" in capsys.readouterr().out


def test_main_exits_2_on_missing_file(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(rsf, "CONTENT_ROOT", tmp_path)
    code = rsf.main(["review_semantic_fidelity.py", "economic_facts", "nope.json"])
    assert code == 2
    assert "no such content file" in capsys.readouterr().err


def test_main_exits_2_on_wrong_arg_count(capsys):
    code = rsf.main(["review_semantic_fidelity.py", "only-one-arg"])
    assert code == 2
    assert "Usage:" in capsys.readouterr().err
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/ahmedyidris/jarvis-x && ~/venv-ai/bin/python3 -m pytest scripts/test_review_semantic_fidelity.py -v`
Expected: the 5 new tests FAIL with `AttributeError: module 'review_semantic_fidelity' has no attribute 'main'`. The 2 Task-1 tests still PASS.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/review_semantic_fidelity.py`:

```python
def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(f"Usage: {argv[0]} <vertical> <filename>", file=sys.stderr)
        return 2
    vertical, filename = argv[1], argv[2]

    try:
        result = review(vertical, filename)
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    except RuntimeError as e:
        print(f"INCONCLUSIVE -- judge could not run: {e}")
        return 0

    print(json.dumps(result, indent=2))
    if result["faithful"] is False:
        print(f"\nFLAGGED: {result['issue']}")
        return 1
    print("\nOK -- no fidelity issue flagged (judge is advisory, not proof of correctness)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/ahmedyidris/jarvis-x && ~/venv-ai/bin/python3 -m pytest scripts/test_review_semantic_fidelity.py -v`
Expected: 7 passed.

- [ ] **Step 5: Manual smoke test against real content (optional, costs real Gemini quota)**

Run: `cd /home/ahmedyidris/jarvis-x && ~/venv-ai/bin/python3 scripts/review_semantic_fidelity.py economic_facts econ_egypt-inflation.json`
Expected: either a JSON verdict ending in "OK" (exit 0) or "INCONCLUSIVE" if `GEMINI_API_KEY` isn't set in `~/.jarvis-x/.env` — both are acceptable outcomes for this smoke test; the point is confirming the script runs against a real file without crashing. Skip if quota-conscious; Task 2's automated tests already prove the wiring.

- [ ] **Step 6: Commit**

```bash
cd /home/ahmedyidris/jarvis-x
git add scripts/review_semantic_fidelity.py scripts/test_review_semantic_fidelity.py
git commit -m "phase-b: add main() CLI entry point to the semantic-fidelity review script

Task 2 of the semantic-fidelity review CLI plan. Exit codes: 0 = faithful
or judge inconclusive (quota/network -- advisory, never treated as a
failure), 1 = judge flagged the content, 2 = usage/file error.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:** PLAN.md's requirement is "a way to run deliberate review" — Task 1 loads content and calls the existing judge; Task 2 gives it a runnable CLI with an exit-code contract a human (or a future dashboard button, out of scope here) can act on. Nothing in `PLAN.md`'s decision calls for automatic gating, retries, or generator changes, and this plan makes none. Covered.

**2. Placeholder scan:** No TBD/TODO markers; every step has real, complete code. Checked.

**3. Type consistency:** `review()` returns `dict` with keys `vertical`, `filename`, plus whatever `check_semantic_fidelity()` returns (`faithful`, `issue`, `votes`, `flagged`, `cached`) — used consistently across both tasks' tests. `main(argv: list[str]) -> int` matches its `sys.argv` call site. Consistent.
