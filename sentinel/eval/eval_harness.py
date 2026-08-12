"""Runs every case in data/sample_incidents.json through the graph and
scores it against the rubric in rubric.md. This is the harness a CI gate
would call — see rubric.md for the thresholds it should enforce.

Run: ./.venv/bin/python eval/eval_harness.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.graph import build_graph

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "sample_incidents.json"
REPORT_PATH = Path(__file__).resolve().parent / "eval_report.json"

REQUIRED_SECTIONS = [
    "## Summary", "## Severity & Category", "## Evidence",
    "## Root Cause Hypothesis", "## Confidence", "## Recommended Next Steps",
]


def score_case(case: dict, result: dict) -> dict:
    category_ok = result.get("category", "").lower() == case["expected_category"].lower()

    retrieved_sources = {r["metadata"].get("source", "") for r in result.get("retrieved", [])}
    # crude recall check: did we retrieve the runbook matching this case's category theme
    keyword_hits = sum(
        1 for kw in case["expected_root_cause_keywords"]
        if kw.lower() in result.get("hypothesis", "").lower()
    )
    hypothesis_score = min(5, 1 + 4 * keyword_hits / max(1, len(case["expected_root_cause_keywords"])))

    groundedness = result.get("critique", {}).get("score", 0)

    report = result.get("report", "")
    sections_present = sum(1 for s in REQUIRED_SECTIONS if s in report)
    report_complete = sections_present == len(REQUIRED_SECTIONS)

    return {
        "id": case["id"],
        "category_correct": category_ok,
        "retrieved_sources": list(retrieved_sources),
        "hypothesis_score": round(hypothesis_score, 2),
        "groundedness_score": groundedness,
        "report_complete": report_complete,
        "revisions_used": result.get("revisions", 0),
    }


def main():
    cases = json.loads(DATA_PATH.read_text())
    graph = build_graph()

    scores = []
    for case in cases:
        print(f"running {case['id']}...")
        result = graph.invoke({"raw_input": case["input"], "revisions": 0})
        scores.append(score_case(case, result))

    n = len(scores)
    summary = {
        "triage_accuracy": sum(s["category_correct"] for s in scores) / n,
        "avg_hypothesis_score": sum(s["hypothesis_score"] for s in scores) / n,
        "avg_groundedness_score": sum(s["groundedness_score"] for s in scores) / n,
        "report_completeness_rate": sum(s["report_complete"] for s in scores) / n,
    }

    REPORT_PATH.write_text(json.dumps({"cases": scores, "summary": summary}, indent=2))

    print("\n--- Sentinel Eval Summary ---")
    for k, v in summary.items():
        print(f"{k}: {v:.2f}")
    print(f"\nfull report written to {REPORT_PATH}")


if __name__ == "__main__":
    main()
