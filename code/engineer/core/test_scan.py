from code.engineer import diagnose
from code.engineer.core import scan as scan_module


def _finding(issue="Low free disk space", recommended_action="review largest consumers"):
    return diagnose.Finding(
        issue=issue, severity="high", evidence="e", probable_root_cause="p",
        confidence=0.9, affected_components=["/"], recommended_action=recommended_action,
        risk="none", expected_result="er", verification_method="vm",
    )


def test_run_prints_healthy_message_when_no_findings(monkeypatch):
    monkeypatch.setattr(scan_module.storage_evidence, "collect", lambda: {})
    monkeypatch.setattr(scan_module.state, "last_snapshot", lambda domain: None)
    monkeypatch.setattr(scan_module.state, "append_snapshot", lambda domain, evidence: None)
    monkeypatch.setattr(scan_module.diagnose, "run_rules", lambda evidence, previous: [])
    result = scan_module.run()
    assert "healthy" in result.lower()


def test_run_calls_explain_when_findings_exist(monkeypatch):
    saved = {}
    monkeypatch.setattr(scan_module.storage_evidence, "collect", lambda: {"disk_usage": {}})
    monkeypatch.setattr(scan_module.state, "last_snapshot", lambda domain: None)
    monkeypatch.setattr(scan_module.state, "append_snapshot",
                         lambda domain, evidence: saved.setdefault("called", True))
    monkeypatch.setattr(scan_module.diagnose, "run_rules", lambda evidence, previous: [_finding()])
    monkeypatch.setattr(scan_module.explain_module, "explain", lambda findings: "LLM report")
    result = scan_module.run()
    assert result == "LLM report"
    assert saved.get("called") is True


def test_run_falls_back_to_raw_findings_when_explain_backend_fails(monkeypatch):
    monkeypatch.setattr(scan_module.storage_evidence, "collect", lambda: {"disk_usage": {}})
    monkeypatch.setattr(scan_module.state, "last_snapshot", lambda domain: None)
    monkeypatch.setattr(scan_module.state, "append_snapshot", lambda domain, evidence: None)
    monkeypatch.setattr(scan_module.diagnose, "run_rules",
                         lambda evidence, previous: [_finding()])

    def raise_backend_error(findings):
        raise scan_module.explain_module.ExplainBackendError("offline")

    monkeypatch.setattr(scan_module.explain_module, "explain", raise_backend_error)
    result = scan_module.run()
    assert "Local model unavailable" in result
    assert "Low free disk space" in result
    assert "review largest consumers" in result


def test_run_passes_previous_snapshot_to_rules(monkeypatch):
    previous = {"candidates": {"x": {"path": "/x", "size_bytes": 1}}}
    monkeypatch.setattr(scan_module.storage_evidence, "collect", lambda: {"disk_usage": {}})
    monkeypatch.setattr(scan_module.state, "last_snapshot", lambda domain: previous)
    monkeypatch.setattr(scan_module.state, "append_snapshot", lambda domain, evidence: None)
    seen = {}
    monkeypatch.setattr(
        scan_module.diagnose, "run_rules",
        lambda evidence, prev: seen.setdefault("previous", prev) and [],
    )
    scan_module.run()
    assert seen["previous"] == previous
