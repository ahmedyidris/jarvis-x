from code.reply.tool_router import route
from code.reply.tools.weather import WeatherTool
from code.reply.tools.system_stats import SystemStatsTool

TOOLS = [WeatherTool(), SystemStatsTool()]


def test_routes_weather_keyword_english():
    matched = route("what's the weather like today?", TOOLS)
    assert [t.name for t in matched] == ["getWeather"]


def test_routes_weather_keyword_arabic():
    matched = route("الجو عامل ازاي دلوقتي", TOOLS)
    assert [t.name for t in matched] == ["getWeather"]


def test_routes_system_stats_keyword():
    matched = route("how much memory is this machine using", TOOLS)
    assert [t.name for t in matched] == ["getSystemStats"]


def test_no_match_returns_empty():
    matched = route("tell me a joke", TOOLS)
    assert matched == []


def test_routes_system_stats_keyword_arabic():
    matched = route("الرامات والمعالج كويسين؟", TOOLS)
    assert [t.name for t in matched] == ["getSystemStats"]


def test_both_match_preserves_input_order():
    matched = route("check cpu and weather", TOOLS)
    assert [t.name for t in matched] == ["getWeather", "getSystemStats"]
