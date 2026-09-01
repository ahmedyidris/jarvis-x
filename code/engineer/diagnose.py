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
        if info.get("on_root_filesystem") is not True:
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


# check_backup_file_clutter is deliberately excluded from ALL_RULES: it is
# superseded by diagnose_file_intel.check_home_backup_clutter, which scans
# the same *.bak files across the whole home directory (a superset of this
# repo-scoped check), so including both here would produce duplicate
# near-identical findings in one merged scan report. The function itself
# stays defined and tested -- only its aggregation into run_rules() is removed.
ALL_RULES = [check_low_free_space, check_space_hogs, check_rapid_growth]


def run_rules(evidence: dict, previous: dict | None) -> list[Finding]:
    findings: list[Finding] = []
    for rule in ALL_RULES:
        findings.extend(rule(evidence, previous))
    return findings
