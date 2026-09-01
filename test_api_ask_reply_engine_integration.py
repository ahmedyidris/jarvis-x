from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
import app as app_module
import hermes as hermes_module

client = TestClient(app_module.app)


def _fake_curl(response_text):
    result = MagicMock()
    result.returncode = 0
    result.stdout = '{"response": "%s"}' % response_text
    result.stderr = ""
    return result


def test_ask_trivial_message_fast_path(tmp_path, monkeypatch):
    monkeypatch.setattr(hermes_module, "DB_PATH", tmp_path / "test_state.db")
    with patch.object(app_module, "STOP_FILE") as stop_file, \
         patch("subprocess.run", return_value=_fake_curl("hi there")):
        stop_file.exists.return_value = False
        resp = client.post("/api/ask", json={"question": "hi", "tier": "local"})
    assert resp.status_code == 200
    assert resp.json()["response"] == "hi there"


def test_ask_real_tool_round_trip(tmp_path, monkeypatch):
    monkeypatch.setattr(hermes_module, "DB_PATH", tmp_path / "test_state.db")
    responses = iter(["getWeather", "It's sunny and 28C in Cairo."])

    def fake_run(cmd, **kwargs):
        return _fake_curl(next(responses))

    fake_weather_resp = MagicMock()
    fake_weather_resp.json.return_value = {"temp_c": "28", "condition": "Sunny"}
    fake_weather_resp.raise_for_status.return_value = None

    with patch.object(app_module, "STOP_FILE") as stop_file, \
         patch("subprocess.run", side_effect=fake_run), \
         patch("requests.get", return_value=fake_weather_resp):
        stop_file.exists.return_value = False
        resp = client.post("/api/ask", json={"question": "what's the weather today", "tier": "local"})
    assert resp.status_code == 200
    assert "28" in resp.json()["response"] or "sunny" in resp.json()["response"].lower()


def test_ask_planner_timeout_falls_back_to_plain_answer(tmp_path, monkeypatch):
    monkeypatch.setattr(hermes_module, "DB_PATH", tmp_path / "test_state.db")
    import subprocess

    call_count = {"n": 0}

    def fake_run(cmd, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise subprocess.TimeoutExpired(cmd, kwargs.get("timeout", 5))
        return _fake_curl("a normal chat answer")

    with patch.object(app_module, "STOP_FILE") as stop_file, \
         patch("subprocess.run", side_effect=fake_run):
        stop_file.exists.return_value = False
        resp = client.post("/api/ask", json={"question": "what's the weather today", "tier": "local"})
    assert resp.status_code == 200
    assert resp.json()["response"] == "a normal chat answer"
