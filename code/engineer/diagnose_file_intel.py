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
    evidence_str = f"{backup['count']} file(s) matching *.bak/*.bak<N> totalling {backup['total_bytes'] / (1024 ** 2):.0f} MB"
    if backup["count"] > 10:
        evidence_str += " (showing first 10 in affected_components)"
    return [Finding(
        issue="Stale backup files found across your home directory",
        severity="low",
        evidence=evidence_str,
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
