from code.reply.tool_router import route
from code.reply.tools.system_stats import SystemStatsTool
from code.reply.tools.weather import WeatherTool

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


def test_program_does_not_false_positive_on_ram_substring():
    # "program" contains "ram" as a substring -- must not route.
    matched = route("can you write a program for me", TOOLS)
    assert matched == []


def test_grammar_does_not_false_positive_on_ram_substring():
    # "grammar" contains "ram" as a substring -- must not route.
    matched = route("explain grammar rules", TOOLS)
    assert matched == []


def test_genuine_short_keyword_still_routes():
    matched = route("what's my cpu usage", TOOLS)
    assert [t.name for t in matched] == ["getSystemStats"]
