from unittest.mock import MagicMock, patch
from code.reply import engine
import hermes as hermes_module


def test_fast_path_skip_for_trivial_message():
    hermes = MagicMock()
    hermes.ask.return_value = "hi there"
    result = engine.handle("hi", model="qwen2.5:3b", system_msg="SYS", hermes=hermes)
    assert result == "hi there"
    # Exactly one call: no planner/resolver/digest calls for a trivial,
    # tool-free message.
    hermes.ask.assert_called_once_with("hi", "qwen2.5:3b", system="SYS")


def test_planner_says_reply_only_falls_through_to_plain_ask():
    hermes = MagicMock()
    hermes.ask.side_effect = ["Reply to the user.", "a normal chat answer"]
    # Contains "weather", so tool_router.route() returns a non-empty list --
    # the fast-path skip requires *no* matched tools, so this is routed to
    # the planner instead of being skipped; the planner then decides no
    # tool call is actually needed.
    result = engine.handle(
        "what do you think about the weather philosophically speaking",
        model="qwen2.5:3b", system_msg="SYS", hermes=hermes,
    )
    assert result == "a normal chat answer"


def test_full_tool_round_trip():
    hermes = MagicMock()
    # 1: planner call -> plan; 2: final synthesis call -> answer.
    # getWeather resolves via the resolver's regex fast-path (no extra
    # hermes.ask call), and the result is short enough to skip the digest
    # LLM call too, so exactly 2 hermes.ask calls happen in total.
    hermes.ask.side_effect = ["getWeather", "It's 28C and sunny in Cairo."]
    fake_tool = MagicMock()
    fake_tool.name = "getWeather"
    fake_tool.property_keys = ()
    fake_tool.execute.return_value = {"temp_c": "28", "condition": "Sunny"}
    with patch("code.reply.tool_router.route", return_value=[fake_tool]):
        result = engine.handle(
            "what's the weather like today", model="qwen2.5:3b",
            system_msg="SYS", hermes=hermes,
        )
    assert result == "It's 28C and sunny in Cairo."
    assert hermes.ask.call_count == 2
    final_call_kwargs = hermes.ask.call_args
    assert "TOOL RESULT (getWeather)" in final_call_kwargs.kwargs["system"]
    assert "ACTION PLAN" in final_call_kwargs.kwargs["system"]


def test_tool_execution_error_becomes_note_not_crash():
    hermes = MagicMock()
    hermes.ask.side_effect = ["getWeather", "sorry, I couldn't check the weather"]
    fake_tool = MagicMock()
    fake_tool.name = "getWeather"
    fake_tool.property_keys = ()
    fake_tool.execute.return_value = {"error": "weather backend unavailable: timeout"}
    with patch("code.reply.tool_router.route", return_value=[fake_tool]):
        result = engine.handle(
            "what's the weather like today", model="qwen2.5:3b",
            system_msg="SYS", hermes=hermes,
        )
    assert result == "sorry, I couldn't check the weather"
    final_call_kwargs = hermes.ask.call_args
    assert "TOOL_ERROR" in final_call_kwargs.kwargs["system"]


def test_planner_failure_falls_open_to_plain_ask():
    hermes = MagicMock()
    hermes.ask.side_effect = [
        hermes_module.HermesBackendError("planner timed out"),
        "a normal chat answer",
    ]
    fake_tool = MagicMock()
    fake_tool.name = "getWeather"
    with patch("code.reply.tool_router.route", return_value=[fake_tool]):
        result = engine.handle(
            "what's the weather like today", model="qwen2.5:3b",
            system_msg="SYS", hermes=hermes,
        )
    assert result == "a normal chat answer"
    assert hermes.ask.call_count == 2


def test_tool_execute_raising_unexpected_exception_becomes_note_not_crash():
    # Guards the recurring "unguarded operation near a tool boundary can
    # raise instead of failing open" bug pattern (see Tasks 2, 5, 6): a
    # tool.execute() that raises something other than a handled exception
    # type must not crash handle() -- it should degrade to a TOOL_ERROR note.
    hermes = MagicMock()
    hermes.ask.side_effect = ["getWeather", "sorry, something went wrong"]
    fake_tool = MagicMock()
    fake_tool.name = "getWeather"
    fake_tool.property_keys = ()
    fake_tool.execute.side_effect = RuntimeError("unexpected boom")
    with patch("code.reply.tool_router.route", return_value=[fake_tool]):
        result = engine.handle(
            "what's the weather like today", model="qwen2.5:3b",
            system_msg="SYS", hermes=hermes,
        )
    assert result == "sorry, something went wrong"
    final_call_kwargs = hermes.ask.call_args
    assert "TOOL_ERROR" in final_call_kwargs.kwargs["system"]


def test_tool_returns_non_dict_result_becomes_note_not_crash():
    # Another instance of the same fail-open pattern: a tool that returns an
    # unexpected (non-dict) shape must not raise a TypeError from the
    # `"error" in raw_result` check -- it should degrade to a TOOL_ERROR note.
    hermes = MagicMock()
    hermes.ask.side_effect = ["getWeather", "sorry, something went wrong"]
    fake_tool = MagicMock()
    fake_tool.name = "getWeather"
    fake_tool.property_keys = ()
    fake_tool.execute.return_value = None
    with patch("code.reply.tool_router.route", return_value=[fake_tool]):
        result = engine.handle(
            "what's the weather like today", model="qwen2.5:3b",
            system_msg="SYS", hermes=hermes,
        )
    assert result == "sorry, something went wrong"
    final_call_kwargs = hermes.ask.call_args
    assert "TOOL_ERROR" in final_call_kwargs.kwargs["system"]
