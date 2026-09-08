from code.reply.planner import plan_query
from code.reply.tools.weather import WeatherTool
from unittest.mock import MagicMock

import hermes as hermes_module

TOOLS = [WeatherTool()]


def test_plan_query_no_tools_returns_empty_without_calling_llm():
    hermes = MagicMock()
    result = plan_query("what is 2+2", [], model="qwen2.5:3b", hermes=hermes)
    assert result == []
    hermes.ask.assert_not_called()


def test_plan_query_parses_tool_step():
    hermes = MagicMock()
    hermes.ask.return_value = "1. getWeather"
    result = plan_query("what's the weather", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == ["getWeather"]
    hermes.ask.assert_called_once()
    _, kwargs = hermes.ask.call_args
    assert kwargs["context"] is False
    assert kwargs["log"] is False
    assert kwargs["timeout"] <= 10


def test_plan_query_reply_only_step():
    hermes = MagicMock()
    hermes.ask.return_value = "Reply to the user."
    result = plan_query("tell me a joke", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == ["Reply to the user."]


def test_plan_query_strips_bullets_numbering_and_quotes():
    hermes = MagicMock()
    hermes.ask.return_value = '- "getWeather"\n2) Reply to the user.'
    result = plan_query("weather then reply", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == ["getWeather", "Reply to the user."]


def test_plan_query_caps_at_five_steps():
    hermes = MagicMock()
    hermes.ask.return_value = "\n".join(f"step {i}" for i in range(10))
    result = plan_query("many steps", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert len(result) == 5


def test_plan_query_all_stop_returns_empty():
    hermes = MagicMock()
    hermes.ask.return_value = "stop"
    result = plan_query("weather", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == []


def test_plan_query_fails_open_on_backend_error():
    hermes = MagicMock()
    hermes.ask.side_effect = hermes_module.HermesBackendError("timeout")
    result = plan_query("weather", TOOLS, model="qwen2.5:3b", hermes=hermes)
    assert result == []
