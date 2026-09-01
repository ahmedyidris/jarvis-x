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
    assert "showing first 10" not in findings[0].evidence


def test_check_home_backup_clutter_notes_truncation_when_over_ten():
    evidence = _base_evidence()
    paths = [f"file{i}.bak" for i in range(17)]
    evidence["backup_files"] = {"count": 17, "total_bytes": 1700, "paths": paths}
    findings = diagnose_file_intel.check_home_backup_clutter(evidence, None)
    assert len(findings) == 1
    assert len(findings[0].affected_components) == 10
    assert "17 file(s)" in findings[0].evidence
    assert "showing first 10 in affected_components" in findings[0].evidence


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
