from unittest.mock import MagicMock
from code.reply.digest import tool_result_digest
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


def test_long_result_fails_open_to_truncation_on_backend_error():
    hermes = MagicMock()
    hermes.ask.side_effect = hermes_module.HermesBackendError("timeout")
    result = {"description": "x" * 1000}
    out = tool_result_digest("getWeather", result, "what's the weather", model="qwen2.5:3b", hermes=hermes)
    assert out.startswith("TOOL RESULT (getWeather):")
    assert "..." in out
