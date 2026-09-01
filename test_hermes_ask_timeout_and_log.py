import subprocess
import sqlite3
from unittest.mock import patch, MagicMock
import hermes as hermes_module


def _fake_curl_result(response_text="ok"):
    result = MagicMock()
    result.returncode = 0
    result.stdout = '{"response": "%s"}' % response_text
    result.stderr = ""
    return result


def test_ask_passes_custom_timeout_to_subprocess(tmp_path, monkeypatch):
    monkeypatch.setattr(hermes_module, "DB_PATH", tmp_path / "test_state.db")
    core = hermes_module.HermesCore()
    try:
        with patch("subprocess.run", return_value=_fake_curl_result()) as mock_run:
            core.ask("hi", model="qwen2.5:3b", context=False, timeout=5, log=False)
            _, kwargs = mock_run.call_args
            assert kwargs["timeout"] == 5
    finally:
        core.close()


def test_ask_default_timeout_is_300(tmp_path, monkeypatch):
    monkeypatch.setattr(hermes_module, "DB_PATH", tmp_path / "test_state.db")
    core = hermes_module.HermesCore()
    try:
        with patch("subprocess.run", return_value=_fake_curl_result()) as mock_run:
            core.ask("hi", model="qwen2.5:3b", context=False, log=False)
            _, kwargs = mock_run.call_args
            assert kwargs["timeout"] == 300
    finally:
        core.close()


def test_ask_log_false_does_not_insert_conversation(tmp_path, monkeypatch):
    monkeypatch.setattr(hermes_module, "DB_PATH", tmp_path / "test_state.db")
    core = hermes_module.HermesCore()
    try:
        before = core.db.execute("SELECT COUNT(*) AS c FROM conversations").fetchone()["c"]
        with patch("subprocess.run", return_value=_fake_curl_result("scaffold output")):
            core.ask("scaffolding prompt", model="qwen2.5:3b", context=False, log=False)
        after = core.db.execute("SELECT COUNT(*) AS c FROM conversations").fetchone()["c"]
        assert after == before
    finally:
        core.close()


def test_ask_log_true_still_inserts_conversation(tmp_path, monkeypatch):
    monkeypatch.setattr(hermes_module, "DB_PATH", tmp_path / "test_state.db")
    core = hermes_module.HermesCore()
    try:
        before = core.db.execute("SELECT COUNT(*) AS c FROM conversations").fetchone()["c"]
        with patch("subprocess.run", return_value=_fake_curl_result("real answer")):
            core.ask("real question", model="qwen2.5:3b", context=False, log=True)
        after = core.db.execute("SELECT COUNT(*) AS c FROM conversations").fetchone()["c"]
        assert after == before + 1
    finally:
        core.close()
