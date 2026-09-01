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
    """Lines describing candidates the evidence layer couldn't observe
    (marked `{"unavailable": "<reason>"}`), so gaps are always visible in
    the CLI output rather than silently living only in the history file."""
    return [
        f"- {label}: {info['unavailable']}"
        for label, info in evidence.get("candidates", {}).items()
        if "unavailable" in info
    ]


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

    gap_lines = _observation_gaps(evidence)
    if gap_lines:
        report += "\n\nWhat I couldn't check:\n" + "\n".join(gap_lines)

    print(report)
    return report


if __name__ == "__main__":
    run()
