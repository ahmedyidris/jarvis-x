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
