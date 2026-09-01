from unittest.mock import MagicMock
from code.reply.resolver import resolve_next_tool_call
from code.reply.tools.weather import WeatherTool
import hermes as hermes_module

TOOLS = [WeatherTool()]


def test_fast_path_resolves_bare_tool_call_without_llm():
    hermes = MagicMock()
    result = resolve_next_tool_call("getWeather", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == {"name": "getWeather", "arguments": {}}
    hermes.ask.assert_not_called()


def test_synthesis_step_returns_none_without_llm():
    hermes = MagicMock()
    result = resolve_next_tool_call("Reply to the user.", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result is None
    hermes.ask.assert_not_called()


def test_unknown_tool_name_falls_back_to_llm_and_llm_says_null():
    hermes = MagicMock()
    hermes.ask.return_value = "null"
    result = resolve_next_tool_call("frobnicate", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result is None
    hermes.ask.assert_called_once()


def test_llm_fallback_resolves_valid_json():
    hermes = MagicMock()
    hermes.ask.return_value = '{"name": "getWeather", "arguments": {}}'
    result = resolve_next_tool_call("get the weather please", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == {"name": "getWeather", "arguments": {}}


def test_llm_fallback_invalid_json_returns_none():
    hermes = MagicMock()
    hermes.ask.return_value = "not json at all"
    result = resolve_next_tool_call("get the weather please", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result is None


def test_resolver_fails_open_on_backend_error():
    hermes = MagicMock()
    hermes.ask.side_effect = hermes_module.HermesBackendError("timeout")
    result = resolve_next_tool_call("get the weather please", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result is None


def test_unknown_arg_keys_filtered_out():
    hermes = MagicMock()
    hermes.ask.return_value = '{"name": "getWeather", "arguments": {"bogus_key": "x"}}'
    result = resolve_next_tool_call("get weather with bogus arg", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == {"name": "getWeather", "arguments": {}}
