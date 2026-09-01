from unittest.mock import MagicMock
from datetime import datetime
from code.reply.digest import tool_result_digest, DIGEST_TIMEOUT_SEC
import hermes as hermes_module


def test_short_result_passes_through_without_llm_call():
    hermes = MagicMock()
    result = {"temp_c": "28", "condition": "Sunny"}
    out = tool_result_digest("getWeather", result, "what's the weather", model="qwen2.5:3b", hermes=hermes)
    assert out.startswith("TOOL RESULT (getWeather):")
    assert "28" in out
    hermes.ask.assert_not_called()


def test_long_result_triggers_llm_compression():
    hermes = MagicMock()
    hermes.ask.return_value = "It's sunny and 28C."
    result = {"description": "x" * 1000}
    out = tool_result_digest("getWeather", result, "what's the weather", model="qwen2.5:3b", hermes=hermes)
    assert out == "TOOL RESULT (getWeather): It's sunny and 28C."
    hermes.ask.assert_called_once()
    _, kwargs = hermes.ask.call_args
    assert kwargs["log"] is False
    assert kwargs["context"] is False
    assert kwargs["timeout"] == DIGEST_TIMEOUT_SEC


def test_long_result_fails_open_to_truncation_on_backend_error():
    hermes = MagicMock()
    hermes.ask.side_effect = hermes_module.HermesBackendError("timeout")
    result = {"description": "x" * 1000}
    out = tool_result_digest("getWeather", result, "what's the weather", model="qwen2.5:3b", hermes=hermes)
    assert out.startswith("TOOL RESULT (getWeather):")
    assert "..." in out


def test_empty_llm_response_falls_back_to_truncation():
    hermes = MagicMock()
    hermes.ask.return_value = ""
    result = {"description": "x" * 1000}
    out = tool_result_digest("getWeather", result, "what's the weather", model="qwen2.5:3b", hermes=hermes)
    assert out.startswith("TOOL RESULT (getWeather):")
    assert "x" * 50 in out  # real truncated raw data present, not discarded
    assert out != "TOOL RESULT (getWeather): "


def test_whitespace_only_llm_response_falls_back_to_truncation():
    hermes = MagicMock()
    hermes.ask.return_value = "   \n  "
    result = {"description": "y" * 1000}
    out = tool_result_digest("getWeather", result, "what's the weather", model="qwen2.5:3b", hermes=hermes)
    assert "y" * 50 in out


def test_non_json_serializable_result_does_not_raise():
    hermes = MagicMock()
    # datetime is not JSON-serializable
    result = {"when": datetime.now(), "status": "ok"}
    out = tool_result_digest("getWeather", result, "what's the weather", model="qwen2.5:3b", hermes=hermes)
    assert out.startswith("TOOL RESULT (getWeather):")
    # Should use repr() fallback and never raise
    assert isinstance(out, str)
