"""Hermes' market integration is a guard against its own worst failure mode.

A 7B model on CPU asked "should I buy bitcoin?" will answer with a confident
invented price, and hermes.py's own comments record that a wrong answer, once
written to `conversations`, becomes self-reinforcing evidence on every retry.
So these tests check three things: that market questions get the recorded
numbers injected, that a failure to read them says so rather than leaving a
silence for the model to fill, and that the injected text forbids claiming a
trade was placed.
"""
import subprocess
from unittest.mock import patch, MagicMock
import hermes as hermes_module


def _core(tmp_path, monkeypatch):
    monkeypatch.setattr(hermes_module, "DB_PATH", tmp_path / "test_state.db")
    return hermes_module.HermesCore()


def _brief_result(stdout="btc  insufficient", returncode=0):
    r = MagicMock()
    r.returncode = returncode
    r.stdout = stdout
    r.stderr = ""
    return r


def test_market_question_is_recognised():
    for q in ["should I buy bitcoin?", "what's the price of gold",
              "any trade recommendations?", "how is the s&p doing"]:
        assert hermes_module.HermesCore._is_market_question(q), q


def test_unrelated_question_is_not_a_market_question():
    for q in ["what is 2+2?", "which file handles the kill switch?",
              "translate this to Arabic"]:
        assert not hermes_module.HermesCore._is_market_question(q), q


def test_market_context_is_injected_for_a_market_question(tmp_path, monkeypatch):
    core = _core(tmp_path, monkeypatch)
    try:
        with patch("subprocess.run", return_value=_brief_result("btc 60000 near-low")):
            ctx = core.build_context("should I buy bitcoin?")
        assert "MARKET (authoritative" in ctx
        assert "btc 60000 near-low" in ctx
    finally:
        core.close()


def test_market_context_is_absent_for_an_unrelated_question(tmp_path, monkeypatch):
    core = _core(tmp_path, monkeypatch)
    try:
        with patch("subprocess.run", return_value=_brief_result()) as run:
            ctx = core.build_context("what is 2+2?")
        assert "MARKET (authoritative" not in ctx
        assert run.call_count == 0, "no subprocess should run for a non-market question"
    finally:
        core.close()


def test_the_injected_block_forbids_estimating_and_forbids_claiming_a_trade(tmp_path, monkeypatch):
    core = _core(tmp_path, monkeypatch)
    try:
        with patch("subprocess.run", return_value=_brief_result()):
            ctx = core.build_context("should I buy gold?")
        assert "Never estimate a price" in ctx
        assert "never predict one" in ctx
        assert "never say a trade has been placed" in ctx
        assert "Ahmed's approval" in ctx
    finally:
        core.close()


def test_market_context_precedes_conversation_history(tmp_path, monkeypatch):
    """History is labelled untrusted; the market block is not. Order matters
    because the history label tells the model to follow whatever came above it."""
    core = _core(tmp_path, monkeypatch)
    try:
        core.db.execute(
            "INSERT INTO conversations (timestamp, user_input, response, model, latency_ms)"
            " VALUES ('2026-09-04T00:00:00', 'btc?', 'Bitcoin is $99,999', 'test', 1)")
        core.db.commit()
        with patch("subprocess.run", return_value=_brief_result()):
            ctx = core.build_context("should I buy bitcoin?")
        assert ctx.index("MARKET (authoritative") < ctx.index("EARLIER IN THIS CONVERSATION")
    finally:
        core.close()


def test_a_timeout_reports_unavailable_rather_than_leaving_a_silence():
    with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("node", 20)):
        out = hermes_module.HermesCore._market_brief()
    assert "unavailable" in out
    assert "do not" in out.lower()


def test_a_missing_node_binary_reports_unavailable():
    with patch("subprocess.run", side_effect=FileNotFoundError()):
        out = hermes_module.HermesCore._market_brief()
    assert "unavailable" in out


def test_a_nonzero_exit_reports_unavailable_rather_than_empty_output():
    with patch("subprocess.run", return_value=_brief_result(stdout="", returncode=1)):
        out = hermes_module.HermesCore._market_brief()
    assert "unavailable" in out
    assert "do not estimate" in out


def test_the_brief_is_read_only_and_never_collects():
    """--collect is the only networked path. A chat message must not trigger
    it: it would spend a rate-limited API call to answer small talk."""
    with patch("subprocess.run", return_value=_brief_result()) as run:
        hermes_module.HermesCore._market_brief()
    cmd = run.call_args[0][0]
    assert "--collect" not in cmd


def test_the_real_brief_runs_and_never_claims_to_have_traded():
    """End-to-end against the actual JS, no mock. Offline by construction."""
    out = hermes_module.HermesCore._market_brief()
    assert out, "the brief must produce something"
    assert "WHERE PRICES SIT" in out
    for forbidden in ["position opened", "trade placed", "I bought", "I sold"]:
        assert forbidden not in out
