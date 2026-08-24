#!/usr/bin/env python3
"""P4 semantic-fidelity judge: live acceptance check (not mocked).

Run with: ~/venv-ai/bin/python3 scripts/verify/07_semantic_fidelity_live.py

Unit tests in automation/phase-b/test_content_generator_semantic_fidelity.py
prove the plumbing (request building, response parsing, retry/gate logic)
is correct, but they mock _call_gemini_judge -- they cannot prove Gemini's
actual judgment is reliable. This script makes real Gemini calls (needs
GEMINI_API_KEY in ~/.jarvis-x/.env and network access) against the exact
fixture that broke the earlier local-model (qwen2.5:3b/7b) attempt, per
DECISION_RECORD_p4-gemini-judge.md's acceptance criteria:

1. The known-faithful fixture (georisk_us-china-trade-tariffs.json's
   actual committed narration_script/on_screen_text) must NOT be flagged
   unfaithful in a majority of trials. The local-model attempt rejected
   this exact content 5/5 (qwen2.5:3b) and 5/8 (qwen2.5:7b) times --
   this script re-runs that same test against Gemini.
2. Both known historical defects ("125% to 125%" tariff garble,
   "previous fall"/"earlier this year" mismatch) must be flagged
   unfaithful -- confirms Gemini isn't just rubber-stamping everything.

This is a judge-quality question, not a code-correctness question --
report the numbers plainly rather than asserting pass/fail, so whoever
reads the output judges whether the false-positive rate is acceptable
before this gate is trusted in production. Costs real (free-tier) Gemini
API calls; not run in CI, not run automatically.
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "automation" / "phase-b"))

import content_generator as cg  # noqa: E402

FIXTURE_PATH = (
    REPO / "automation" / "phase-b" / "stages" / "01_source_content"
    / "output" / "geopolitical_risk" / "georisk_us-china-trade-tariffs.json"
)

# Reconstructed verbatim from REMAINING_WORK.md's own quotes of the two
# 2026-08-20 historical defects (the source files that produced these have
# since been overwritten by later regenerations -- see REMAINING_WORK.md's
# note on the tariff case specifically no longer reproducing on disk).
HISTORICAL_DEFECTS = [
    {
        "name": "tariff_from_125_to_125",
        "source_fact": (
            "A 90-day pause was placed on increasing tariffs on Chinese goods "
            "rising to 125%."
        ),
        "narration": (
            "a 90-day pause was placed on increasing tariffs on Chinese goods "
            "from 125% to 125%"
        ),
        "caption": "125% tariff pause",
    },
    {
        "name": "previous_fall_vs_earlier_this_year",
        "source_fact": (
            "The six shipping deaths mark the first since the previous fall."
        ),
        "narration": "these are the first shipping deaths since earlier this year",
        "caption": "First shipping deaths since earlier this year",
    },
]

TRIALS_PER_CASE = 5


def run_trials(name, source_fact, narration, caption, expect_faithful, trials):
    print(f"\n=== {name} (expect faithful={expect_faithful}) ===")
    results = []
    for i in range(trials):
        try:
            verdict = cg.check_semantic_fidelity(source_fact, narration, caption)
        except RuntimeError as e:
            print(f"  trial {i + 1}: JUDGE CALL FAILED -- {e}")
            results.append(None)
            continue
        print(f"  trial {i + 1}: faithful={verdict['faithful']!r} issue={verdict['issue']!r}")
        results.append(verdict["faithful"])
    return results


def main():
    if not FIXTURE_PATH.exists():
        print(f"FATAL: known-faithful fixture not found at {FIXTURE_PATH}")
        return 1
    fixture = json.loads(FIXTURE_PATH.read_text())

    report = {}

    faithful_results = run_trials(
        "known_faithful_fixture (georisk_us-china-trade-tariffs.json)",
        fixture["headline_fact"], fixture["narration_script"], fixture["on_screen_text"],
        expect_faithful=True, trials=TRIALS_PER_CASE,
    )
    report["known_faithful_fixture"] = faithful_results
    false_positives = faithful_results.count(False)
    print(
        f"\n-> {false_positives}/{TRIALS_PER_CASE} false-positive rejections of known-faithful "
        f"content (local-model baseline was 5/5 for qwen2.5:3b, 5/8 for qwen2.5:7b across two batches)"
    )

    for case in HISTORICAL_DEFECTS:
        results = run_trials(
            case["name"], case["source_fact"], case["narration"], case["caption"],
            expect_faithful=False, trials=1,
        )
        report[case["name"]] = results

    out_path = Path(__file__).parent / "output" / "07_semantic_fidelity_live.json"
    out_path.parent.mkdir(exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2))
    print(f"\nFull results written to {out_path}")

    print("\n=== Summary ===")
    print(f"Known-faithful fixture false-positive rate: {false_positives}/{TRIALS_PER_CASE}")
    for case in HISTORICAL_DEFECTS:
        caught = report[case["name"]] == [False]
        print(f"{case['name']}: {'caught' if caught else 'NOT CAUGHT'}")
    print(
        "\nThis script does not assert pass/fail -- read DECISION_RECORD_p4-gemini-judge.md's "
        "acceptance criteria and judge whether these numbers clear the bar before treating "
        "enforce_semantic_fidelity() as a trustworthy production gate."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
