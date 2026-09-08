#!/usr/bin/env python3
# code/engineer/core/scan.py
"""CLI entrypoint for the Jarvis Engineer scan -- runs the storage and
file_intel domains and merges their findings into one report.

Run: ~/venv-ai/bin/python3 code/engineer/core/scan.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))  # jarvis-x/ repo root

from code.engineer import diagnose, diagnose_file_intel
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
