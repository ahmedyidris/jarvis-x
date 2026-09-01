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
    findings = diagnose.check_low_free_space(_base_evidence(percent_used=95.0), None)
    assert len(findings) == 1
    assert findings[0].severity == "critical"


def test_low_free_space_high_at_90_percent():
    findings = diagnose.check_low_free_space(_base_evidence(percent_used=90.0), None)
    assert findings[0].severity == "high"


def test_low_free_space_medium_at_85_percent():
    findings = diagnose.check_low_free_space(_base_evidence(percent_used=85.0), None)
    assert findings[0].severity == "medium"


# --- check_space_hogs ---------------------------------------------------

def test_space_hogs_flags_large_candidate():
    evidence = _base_evidence(total_bytes=1000)
    evidence["candidates"] = {
        "big": {"path": "/big", "size_bytes": 200, "on_root_filesystem": True},  # 20% of total
    }
    findings = diagnose.check_space_hogs(evidence, None)
    assert len(findings) == 1
    assert "big" in findings[0].issue


def test_space_hogs_ignores_small_candidate():
    evidence = _base_evidence(total_bytes=1000)
    evidence["candidates"] = {"small": {"path": "/small", "size_bytes": 5, "on_root_filesystem": True}}
    assert diagnose.check_space_hogs(evidence, None) == []


def test_space_hogs_skips_unavailable_candidates():
    evidence = _base_evidence(total_bytes=1000)
    evidence["candidates"] = {"missing": {"path": "/x", "unavailable": "path does not exist"}}
    assert diagnose.check_space_hogs(evidence, None) == []


def test_space_hogs_skips_candidate_not_on_root_filesystem():
    """A large candidate on a different mounted filesystem (e.g. a ChromeOS
    Crostini bind mount) must not be scored as a share of /'s capacity."""
    evidence = _base_evidence(total_bytes=1000)
    evidence["candidates"] = {
        "Downloads": {"path": "/mnt/chromeos/MyFiles/Downloads", "size_bytes": 200, "on_root_filesystem": False},
    }
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
