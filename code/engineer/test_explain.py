import pytest

from code.engineer import diagnose, explain as explain_module


def _finding():
    return diagnose.Finding(
        issue="Low free disk space", severity="high", evidence="91% used",
        probable_root_cause="disk usage grew", confidence=0.95,
        affected_components=["/"], recommended_action="review largest consumers",
        risk="none", expected_result="more free space", verification_method="rescan",
    )


class _FakeResponse:
    def __init__(self, json_data, status_code=200):
        self._json_data = json_data
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise explain_module.requests.HTTPError(f"status {self.status_code}")

    def json(self):
        return self._json_data


def test_findings_to_prompt_handles_empty_list():
    assert explain_module._findings_to_prompt([]) == "No findings."


def test_findings_to_prompt_includes_issue_and_evidence():
    prompt = explain_module._findings_to_prompt([_finding()])
    assert "Low free disk space" in prompt
    assert "91% used" in prompt


def test_explain_returns_model_response(monkeypatch):
    def fake_post(url, json, timeout):
        assert url == explain_module.OLLAMA_URL
        assert "Low free disk space" in json["prompt"]
        return _FakeResponse({"response": "What I found: ..."})
    monkeypatch.setattr(explain_module.requests, "post", fake_post)
    assert explain_module.explain([_finding()]) == "What I found: ..."


def test_explain_raises_on_request_failure(monkeypatch):
    def fake_post(url, json, timeout):
        raise explain_module.requests.RequestException("connection refused")
    monkeypatch.setattr(explain_module.requests, "post", fake_post)
    with pytest.raises(explain_module.ExplainBackendError):
        explain_module.explain([_finding()])


def test_explain_raises_on_empty_response(monkeypatch):
    monkeypatch.setattr(
        explain_module.requests, "post",
        lambda url, json, timeout: _FakeResponse({"response": "   "}),
    )
    with pytest.raises(explain_module.ExplainBackendError):
        explain_module.explain([_finding()])
