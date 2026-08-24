"""
Tests for content_generator.py's Gemini-based semantic-fidelity judge
(REMAINING_WORK.md P4's semantic half, DECISION_RECORD_p4-gemini-judge.md).

Run with: ~/venv-ai/bin/python3 -m pytest automation/phase-b/test_content_generator_semantic_fidelity.py -v

What these unit tests prove: the plumbing around the Gemini judge --
request building, response parsing, error handling, and the
enforce_semantic_fidelity() retry/gate loop -- is correct. They do NOT
prove Gemini's actual judgment is reliable on real content (that's a
live-call question, deliberately not answerable by mocking the thing
being judged). See scripts/verify/07_semantic_fidelity_live.py for that
acceptance check, run against real Gemini calls before this gate is
trusted in production, per DECISION_RECORD_p4-gemini-judge.md.
"""
import json

import pytest
import requests

import content_generator as cg


# ---------------------------------------------------------------------------
# _call_gemini_judge -- the raw HTTP/parsing boundary
# ---------------------------------------------------------------------------

def test_call_gemini_judge_raises_when_env_file_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(cg, "GEMINI_ENV_PATH", tmp_path / "does-not-exist" / ".env")
    with pytest.raises(RuntimeError, match="no .env"):
        cg._call_gemini_judge("irrelevant prompt")


def test_call_gemini_judge_raises_when_key_not_in_env(monkeypatch, tmp_path):
    env = tmp_path / ".env"
    env.write_text("SOME_OTHER_KEY=foo\n")
    monkeypatch.setattr(cg, "GEMINI_ENV_PATH", env)
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY not found"):
        cg._call_gemini_judge("irrelevant prompt")


def test_call_gemini_judge_raises_on_network_error(monkeypatch, tmp_path):
    env = tmp_path / ".env"
    env.write_text("GEMINI_API_KEY=real-key\n")
    monkeypatch.setattr(cg, "GEMINI_ENV_PATH", env)

    def fake_post(*a, **k):
        raise requests.exceptions.ConnectionError("no route to host")

    monkeypatch.setattr(cg.requests, "post", fake_post)
    with pytest.raises(RuntimeError, match="Gemini judge call failed"):
        cg._call_gemini_judge("irrelevant prompt")


def test_call_gemini_judge_raises_on_http_error_status(monkeypatch, tmp_path):
    env = tmp_path / ".env"
    env.write_text("GEMINI_API_KEY=real-key\n")
    monkeypatch.setattr(cg, "GEMINI_ENV_PATH", env)

    class FakeResp:
        ok = False
        status_code = 429
        text = "quota exceeded"

    monkeypatch.setattr(cg.requests, "post", lambda *a, **k: FakeResp())
    with pytest.raises(RuntimeError, match="429"):
        cg._call_gemini_judge("irrelevant prompt")


def _fake_gemini_response(verdict_text: str):
    class FakeResp:
        ok = True
        status_code = 200

        def json(self):
            return {"candidates": [{"content": {"parts": [{"text": verdict_text}]}}]}

    return FakeResp()


def test_call_gemini_judge_raises_on_unparseable_verdict(monkeypatch, tmp_path):
    env = tmp_path / ".env"
    env.write_text("GEMINI_API_KEY=real-key\n")
    monkeypatch.setattr(cg, "GEMINI_ENV_PATH", env)
    monkeypatch.setattr(cg.requests, "post", lambda *a, **k: _fake_gemini_response("not json at all"))
    with pytest.raises(RuntimeError, match="unparseable verdict"):
        cg._call_gemini_judge("irrelevant prompt")


def test_call_gemini_judge_raises_when_faithful_field_missing(monkeypatch, tmp_path):
    env = tmp_path / ".env"
    env.write_text("GEMINI_API_KEY=real-key\n")
    monkeypatch.setattr(cg, "GEMINI_ENV_PATH", env)
    monkeypatch.setattr(cg.requests, "post", lambda *a, **k: _fake_gemini_response('{"something": "else"}'))
    with pytest.raises(RuntimeError, match="missing 'faithful'"):
        cg._call_gemini_judge("irrelevant prompt")


def test_call_gemini_judge_parses_valid_faithful_verdict(monkeypatch, tmp_path):
    env = tmp_path / ".env"
    env.write_text("GEMINI_API_KEY=real-key\n")
    monkeypatch.setattr(cg, "GEMINI_ENV_PATH", env)
    monkeypatch.setattr(
        cg.requests, "post",
        lambda *a, **k: _fake_gemini_response('{"faithful": true, "issue": null}'),
    )
    assert cg._call_gemini_judge("irrelevant prompt") == {"faithful": True, "issue": None}


def test_call_gemini_judge_parses_valid_unfaithful_verdict(monkeypatch, tmp_path):
    env = tmp_path / ".env"
    env.write_text("GEMINI_API_KEY=real-key\n")
    monkeypatch.setattr(cg, "GEMINI_ENV_PATH", env)
    monkeypatch.setattr(
        cg.requests, "post",
        lambda *a, **k: _fake_gemini_response(
            '```json\n{"faithful": false, "issue": "states no change happened"}\n```'
        ),
    )
    assert cg._call_gemini_judge("irrelevant prompt") == {
        "faithful": False, "issue": "states no change happened",
    }


# ---------------------------------------------------------------------------
# check_semantic_fidelity -- wiring from (source, narration, caption) to a verdict
# ---------------------------------------------------------------------------

def test_check_semantic_fidelity_flags_tariff_garble(monkeypatch):
    """REMAINING_WORK.md's first 2026-08-20 historical defect: narration
    states 'from 125% to 125%' -- logically incoherent, no actual change --
    when the source says the pause prevents the tariff from *rising to* 125%.
    """
    captured = {}

    def fake_judge(prompt):
        captured["prompt"] = prompt
        return {"faithful": False, "issue": "restates the tariff change as no change (125% to 125%)"}

    monkeypatch.setattr(cg, "_call_gemini_judge", fake_judge)
    source = "A 90-day pause was placed on tariffs on Chinese goods rising to 125%."
    narration = "a 90-day pause was placed on increasing tariffs on Chinese goods from 125% to 125%"
    verdict = cg.check_semantic_fidelity(source, narration, "125% tariff pause")

    assert verdict["faithful"] is False
    assert "125" in verdict["issue"]
    assert source in captured["prompt"]
    assert narration in captured["prompt"]


def test_check_semantic_fidelity_flags_previous_fall_garble(monkeypatch):
    """REMAINING_WORK.md's second 2026-08-20 historical defect: headline_fact
    says 'since the previous fall' (fall 2025) but narration_script restates
    it as 'since earlier this year' (2026) -- a different, wrong timeframe.
    """
    def fake_judge(prompt):
        return {"faithful": False, "issue": "narration says 'earlier this year' but source says 'the previous fall'"}

    monkeypatch.setattr(cg, "_call_gemini_judge", fake_judge)
    source = "The six shipping deaths mark the first since the previous fall."
    narration = "these are the first shipping deaths since earlier this year"
    verdict = cg.check_semantic_fidelity(source, narration, "first deaths since earlier this year")

    assert verdict["faithful"] is False
    assert "fall" in verdict["issue"] or "this year" in verdict["issue"]


def test_check_semantic_fidelity_passes_faithful_content(monkeypatch):
    monkeypatch.setattr(cg, "_call_gemini_judge", lambda prompt: {"faithful": True, "issue": None})
    verdict = cg.check_semantic_fidelity("source fact", "faithful narration", "faithful caption")
    # Was an exact dict comparison; the verdict now carries vote metadata.
    assert verdict["faithful"] is True
    assert verdict["issue"] is None
    assert verdict["flagged"] == 0


def test_check_semantic_fidelity_any_flag_wins_over_majority(monkeypatch):
    """One dissenting trial out of three flags the content.

    Gemini's observed failure is missed detections (3/5 recall on a real
    defect), not false positives (0/5 on verified-clean content), so a
    majority rule would discard exactly the minority reports that carry
    the signal.
    """
    calls = iter([
        {"faithful": True, "issue": None},
        {"faithful": False, "issue": "tariff timeline inverted"},
        {"faithful": True, "issue": None},
    ])
    monkeypatch.setattr(cg, "_call_gemini_judge", lambda prompt: next(calls))
    verdict = cg.check_semantic_fidelity("fact", "narration", "caption", votes=3)
    assert verdict["faithful"] is False
    assert verdict["flagged"] == 1
    assert "tariff timeline inverted" in verdict["issue"]


def test_check_semantic_fidelity_dedupes_repeated_issue_text(monkeypatch):
    monkeypatch.setattr(cg, "_call_gemini_judge",
                        lambda prompt: {"faithful": False, "issue": "same complaint"})
    verdict = cg.check_semantic_fidelity("fact", "narration", "caption", votes=3)
    assert verdict["issue"] == "same complaint"
    assert verdict["flagged"] == 3


def test_check_semantic_fidelity_votes_one_makes_one_call(monkeypatch):
    """votes=1 stays cheap for bulk scanning -- quota is the binding limit."""
    n = {"count": 0}
    def counting(prompt):
        n["count"] += 1
        return {"faithful": True, "issue": None}
    monkeypatch.setattr(cg, "_call_gemini_judge", counting)
    cg.check_semantic_fidelity("fact", "narration", "caption", votes=1)
    assert n["count"] == 1


# ---------------------------------------------------------------------------
# enforce_semantic_fidelity -- the hard-gate-with-retry loop
# ---------------------------------------------------------------------------

REQUIRED_FIELDS = {"narration_script", "on_screen_text", "image_prompt"}


@pytest.fixture(autouse=True)
def _isolated_judge_cache(monkeypatch, tmp_path):
    """Point the verdict cache at a per-test tmp file.

    Without this, tests write to the real logs/.judge-cache.json AND read
    each other's entries -- two tests sharing fixture strings hash to the
    same key, so the second got the first's cached verdict instead of
    exercising its own mock.
    """
    monkeypatch.setattr(cg, "JUDGE_CACHE_PATH", tmp_path / "judge-cache.json")


def test_enforce_semantic_fidelity_returns_unchanged_when_already_faithful(monkeypatch):
    monkeypatch.setattr(cg, "check_semantic_fidelity", lambda *a: {"faithful": True, "issue": None})

    def call_ollama_should_not_be_called(*a, **k):
        raise AssertionError("call_ollama should not be called when already faithful")

    fields = {"narration_script": "n", "on_screen_text": "c", "image_prompt": "p"}
    result = cg.enforce_semantic_fidelity(
        "fact", fields, call_ollama_should_not_be_called, False, REQUIRED_FIELDS, max_retries=3,
    )
    assert result == fields


def test_enforce_semantic_fidelity_retries_and_succeeds(monkeypatch):
    verdicts = iter([
        {"faithful": False, "issue": "garbled the tariff figure"},
        {"faithful": True, "issue": None},
    ])
    monkeypatch.setattr(cg, "check_semantic_fidelity", lambda *a: next(verdicts))
    monkeypatch.setattr(cg, "check_numeric_fidelity", lambda *a: [])  # no invented numbers on retry

    captured_prompts = []

    def fake_call_ollama(prompt, use_json_format):
        captured_prompts.append(prompt)
        return json.dumps({
            "narration_script": "corrected narration",
            "on_screen_text": "corrected caption",
            "image_prompt": "p",
        })

    fields = {"narration_script": "bad narration", "on_screen_text": "bad caption", "image_prompt": "p"}
    result = cg.enforce_semantic_fidelity(
        "the sourced fact", fields, fake_call_ollama, False, REQUIRED_FIELDS, max_retries=3,
    )

    assert result["narration_script"] == "corrected narration"
    assert len(captured_prompts) == 1
    assert "garbled the tariff figure" in captured_prompts[0]
    assert "the sourced fact" in captured_prompts[0]


def test_enforce_semantic_fidelity_raises_after_max_retries(monkeypatch):
    monkeypatch.setattr(cg, "check_semantic_fidelity", lambda *a: {"faithful": False, "issue": "still wrong"})
    monkeypatch.setattr(cg, "check_numeric_fidelity", lambda *a: [])

    def fake_call_ollama(prompt, use_json_format):
        return json.dumps({"narration_script": "still bad", "on_screen_text": "still bad", "image_prompt": "p"})

    fields = {"narration_script": "bad", "on_screen_text": "bad", "image_prompt": "p"}
    with pytest.raises(ValueError, match="Semantic fidelity check failed"):
        cg.enforce_semantic_fidelity("fact", fields, fake_call_ollama, False, REQUIRED_FIELDS, max_retries=2)


def test_enforce_semantic_fidelity_propagates_judge_failure_without_retry(monkeypatch):
    """A broken judge call (network/429/key issue) is not the content's
    fault -- retrying the content generator wouldn't fix it. Fail closed:
    propagate immediately, don't spend retries or write anything."""
    def broken_judge(*a):
        raise RuntimeError("Gemini judge call failed: no route to host")

    monkeypatch.setattr(cg, "check_semantic_fidelity", broken_judge)

    def call_ollama_should_not_be_called(*a, **k):
        raise AssertionError("call_ollama should not be called when the judge itself is broken")

    fields = {"narration_script": "n", "on_screen_text": "c", "image_prompt": "p"}
    with pytest.raises(RuntimeError, match="Gemini judge call failed"):
        cg.enforce_semantic_fidelity(
            "fact", fields, call_ollama_should_not_be_called, False, REQUIRED_FIELDS, max_retries=3,
        )
