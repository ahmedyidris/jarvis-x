"""
Tests for content_generator.py's numeric-fidelity guard
(REMAINING_WORK.md P4's numeric half -- the deterministic one).

Run with: ~/venv-ai/bin/python3 -m pytest automation/phase-b/test_content_generator_numeric_fidelity.py -v

WHY THIS FILE EXISTS. memory/rules.md describes fidelity checking as
"numeric (deterministic, always on) and semantic (Gemini judge, run
deliberately)". The semantic half had 19 tests. The numeric half had none --
its only two appearances in any test file were lines that STUB IT OUT
(`monkeypatch.setattr(cg, "check_numeric_fidelity", lambda *a: [])` in the
semantic tests). So the always-on guard, the cheap deterministic one, the one
standing between qwen2.5:3b and a fabricated figure reaching a rendered video,
was the untested one.

That inversion matters because this guard has two failure directions and both
are costly:

  MISSING an invented number ships a fabricated figure into a video. Four
  confirmed incidents are on record -- "40%" and "29.5%" at build time, two
  more in a single re-run batch on 2026-08-20.

  FLAGGING a faithful one is not harmless either: enforce_numeric_fidelity()
  burns its retries and then RAISES, so a false positive means correct content
  refuses to ship. The '24.00.' and 'EGP 24' cases below are exactly that bug,
  found and fixed once already; nothing stopped them coming back.

The historical failures are used as fixtures rather than invented cases, so
these tests fail if the specific regressions this guard was written for ever
return.

Fully offline: every function under test is pure except
enforce_numeric_fidelity(), whose LLM call is an injected argument.
"""
import json

import content_generator as cg
import pytest

# ---------------------------------------------------------------------------
# _normalize_number -- where the false positives came from
# ---------------------------------------------------------------------------

def test_trailing_sentence_punctuation_is_stripped():
    """'costs EGP 24.00.' at the end of a sentence produced the token
    '24.00.', absent from a source saying '24.00'. A faithful restatement was
    reported as an invented number."""
    assert cg._normalize_number("24.00.") == "24"


def test_thousands_separators_are_removed():
    assert cg._normalize_number("1,200") == "1200"
    assert cg._normalize_number("1,234,567") == "1234567"


def test_insignificant_trailing_zeros_collapse_but_real_decimals_survive():
    assert cg._normalize_number("24.00") == "24"
    assert cg._normalize_number("22.25") == "22.25"
    assert cg._normalize_number("3.50") == "3.5"


def test_percent_is_significant_and_is_kept():
    """40 and 40% are not interchangeable in a rate claim."""
    assert cg._normalize_number("40%") == "40%"
    assert cg._normalize_number("40") == "40"
    assert cg._normalize_number("40%") != cg._normalize_number("40")


def test_an_unparseable_token_is_returned_unchanged_rather_than_crashing():
    for junk in ["", ".", "..", "-"]:
        assert cg._normalize_number(junk) == junk


# ---------------------------------------------------------------------------
# _numeric_tokens -- extraction
# ---------------------------------------------------------------------------

def test_a_bare_number_and_a_percentage_are_different_tokens():
    assert cg._numeric_tokens("inflation of 24%") == {"24%"}
    assert cg._numeric_tokens("24 eggs") == {"24"}


def test_spelled_out_percent_normalizes_to_the_symbol():
    """Without this the word form tokenizes bare and cannot match a source
    that wrote '%'."""
    assert "3.5%" in cg._numeric_tokens("3.5 percent")
    assert "3.5%" in cg._numeric_tokens("3.5 pct")
    assert "2%" in cg._numeric_tokens("2 percentage points")


def test_a_range_carries_its_unit_to_both_endpoints():
    """The unit is written once and governs both ends. Without expansion the
    leading number tokenizes bare and fails to match a source saying '3.5%'."""
    for phrasing in ["3.5% to 3.75%", "3.5-3.75%", "3.5 to 3.75 percent",
                     "3.5 and 3.75 percent"]:
        tokens = cg._numeric_tokens(phrasing)
        assert "3.5%" in tokens, phrasing
        assert "3.75%" in tokens, phrasing


def test_range_expansion_does_not_loosen_the_strict_case():
    """A standalone 24% must still not match a source containing only bare 24."""
    assert cg.check_numeric_fidelity("24 eggs per tray", "a 24% rise") == ["24%"]


def test_spelled_out_number_words_are_recognized():
    assert "3" in cg._numeric_tokens("three ships were struck")
    assert "20" in cg._numeric_tokens("twenty vessels")


def test_a_number_word_inside_another_word_is_not_matched():
    """'oneself' contains 'one'; a substring match would invent a token."""
    assert "1" not in cg._numeric_tokens("the country found itself alone")


def test_text_with_no_numbers_yields_no_tokens():
    assert cg._numeric_tokens("Prices rose sharply last quarter.") == set()


# ---------------------------------------------------------------------------
# check_numeric_fidelity -- the four recorded incidents
# ---------------------------------------------------------------------------

FACT = ("Egypt's annual urban inflation eased to 24.00% in July 2026, "
        "down from 25.7% in June.")


def test_the_fabricated_40_percent_is_caught():
    """One of the two numbers qwen2.5:3b invented at build time."""
    assert "40%" in cg.check_numeric_fidelity(
        FACT, "Egyptian prices dropped a full 40% this summer.", "Inflation eases")


def test_the_fabricated_29_5_percent_is_caught():
    """The other one."""
    assert "29.5%" in cg.check_numeric_fidelity(
        FACT, "Inflation stood at 29.5% in July.", "29.5% and falling")


def test_a_faithful_restatement_is_not_flagged():
    assert cg.check_numeric_fidelity(
        FACT,
        "Annual urban inflation eased to 24.00% in July 2026.",
        "Down from 25.7% in June") == []


def test_a_faithful_number_ending_a_sentence_is_not_flagged():
    """The regression that made correct content refuse to ship."""
    assert cg.check_numeric_fidelity(
        "A tray of eggs costs EGP 24.00", "A tray of eggs costs EGP 24.00.") == []


def test_dropping_insignificant_zeros_is_not_an_invented_number():
    """'EGP 24' against a source saying 'EGP 24.00' was flagged once."""
    assert cg.check_numeric_fidelity("A tray costs EGP 24.00", "A tray costs EGP 24") == []


def test_every_generated_field_is_checked_not_just_the_first():
    """narration_script and on_screen_text are both passed; a caption is just
    as publishable as a voiceover."""
    assert cg.check_numeric_fidelity(FACT, "Faithful narration at 24.00%.",
                                     "But the caption says 88%") == ["88%"]


def test_a_repeated_invention_is_reported_once():
    suspects = cg.check_numeric_fidelity(FACT, "40% here and 40% there", "40% again")
    assert suspects == ["40%"]


def test_multiple_distinct_inventions_are_all_reported():
    suspects = cg.check_numeric_fidelity(FACT, "It fell 40% to 12.5%", "")
    assert set(suspects) == {"40%", "12.5%"}


def test_no_generated_text_at_all_is_vacuously_clean():
    assert cg.check_numeric_fidelity(FACT) == []


# ---------------------------------------------------------------------------
# The documented limitation. Asserted so it is not mistaken for coverage.
# ---------------------------------------------------------------------------

def test_a_garbled_but_real_number_is_deliberately_NOT_caught():
    """From P4's 2026-08-20 addendum: "a 90-day pause... from 125% to 125%".
    125 IS in the source; the bug is asserting no change happened at all.
    That needs semantic judgment, not a token diff -- it is the semantic
    judge's job (enforce_semantic_fidelity), and this test exists so nobody
    reads the numeric guard as covering it."""
    fact = "The pause cut the tariff from 125% to 10% for 90 days."
    assert cg.check_numeric_fidelity(
        fact, "A 90-day pause moved the tariff from 125% to 125%.") == []


# ---------------------------------------------------------------------------
# enforce_numeric_fidelity -- the retry/refuse loop
# ---------------------------------------------------------------------------

FIELDS = {"narration_script", "on_screen_text", "image_prompt"}


def fields(narration, caption="Caption", image="An image"):
    return {"narration_script": narration, "on_screen_text": caption,
            "image_prompt": image}


def payload(narration, caption="Caption"):
    return json.dumps(fields(narration, caption))


def test_clean_content_returns_unchanged_and_calls_no_model():
    calls = []
    out = cg.enforce_numeric_fidelity(
        FACT, fields("Inflation eased to 24.00% in July 2026."),
        lambda p, j: calls.append(p) or "", True, FIELDS, max_retries=3)
    assert out["narration_script"] == "Inflation eased to 24.00% in July 2026."
    assert calls == [], "a clean pass must not spend an LLM call"


def test_an_invention_is_retried_and_the_corrected_version_returned():
    def call(prompt, use_json):
        return payload("Inflation eased to 24.00% in July 2026.")
    out = cg.enforce_numeric_fidelity(
        FACT, fields("Prices dropped 40%."), call, True, FIELDS, max_retries=3)
    assert cg.check_numeric_fidelity(
        FACT, out["narration_script"], out["on_screen_text"]) == []


def test_the_retry_prompt_names_the_offending_numbers():
    seen = []
    def call(prompt, use_json):
        seen.append(prompt)
        return payload("Inflation eased to 24.00%.")
    cg.enforce_numeric_fidelity(FACT, fields("Prices dropped 40%."), call,
                                True, FIELDS, max_retries=3)
    assert "40%" in seen[0]
    assert "do NOT" in seen[0] or "not invent" in seen[0]


def test_it_refuses_to_ship_rather_than_returning_unfaithful_content():
    """The whole point. Shipping a known-invented number is worse than a loud
    failure -- the same stance the kill switch takes elsewhere."""
    def always_bad(prompt, use_json):
        return payload("Still claiming 40% here.")
    with pytest.raises(ValueError) as e:
        cg.enforce_numeric_fidelity(FACT, fields("Prices dropped 40%."),
                                    always_bad, True, FIELDS, max_retries=2)
    assert "40%" in str(e.value)
    assert "Refusing" in str(e.value)


def test_max_retries_is_respected_exactly():
    calls = []
    def always_bad(prompt, use_json):
        calls.append(prompt)
        return payload("Still 40%.")
    with pytest.raises(ValueError):
        cg.enforce_numeric_fidelity(FACT, fields("Prices dropped 40%."),
                                    always_bad, True, FIELDS, max_retries=2)
    assert len(calls) == 2


def test_zero_retries_raises_without_calling_the_model():
    calls = []
    with pytest.raises(ValueError):
        cg.enforce_numeric_fidelity(
            FACT, fields("Prices dropped 40%."),
            lambda p, j: calls.append(p) or "", True, FIELDS, max_retries=0)
    assert calls == []


def test_a_malformed_retry_response_is_retried_not_accepted():
    """Bad JSON on a retry must not become the shipped content, and must not
    be mistaken for a fix."""
    responses = ["not json at all", payload("Inflation eased to 24.00%.")]
    def call(prompt, use_json):
        return responses.pop(0)
    out = cg.enforce_numeric_fidelity(FACT, fields("Prices dropped 40%."),
                                      call, True, FIELDS, max_retries=3)
    assert "24.00%" in out["narration_script"]
    assert responses == [], "both responses should have been consumed"


def test_a_retry_that_invents_a_different_number_still_fails():
    """Fixing one invention by making another is not a fix."""
    def call(prompt, use_json):
        return payload("Actually it was 88%.")
    with pytest.raises(ValueError) as e:
        cg.enforce_numeric_fidelity(FACT, fields("Prices dropped 40%."),
                                    call, True, FIELDS, max_retries=1)
    assert "88%" in str(e.value)


def test_the_error_carries_the_offending_narration_for_diagnosis():
    def always_bad(prompt, use_json):
        return payload("Still claiming 40% here.")
    with pytest.raises(ValueError) as e:
        cg.enforce_numeric_fidelity(FACT, fields("Prices dropped 40%."),
                                    always_bad, True, FIELDS, max_retries=1)
    assert "Still claiming 40% here." in str(e.value)


# ---------------------------------------------------------------------------
# The boundary
# ---------------------------------------------------------------------------

def test_the_guard_makes_no_network_call_of_its_own():
    """call_ollama is injected precisely so this stays true. If the guard ever
    reaches for requests directly, these tests would silently start needing a
    live model."""
    import inspect
    for fn in (cg._normalize_number, cg._numeric_tokens,
               cg.check_numeric_fidelity, cg.build_fidelity_retry_prompt):
        src = inspect.getsource(fn)
        assert "requests" not in src, f"{fn.__name__} must stay pure"
    enforce_src = inspect.getsource(cg.enforce_numeric_fidelity)
    assert "requests" not in enforce_src
    assert "call_ollama" in enforce_src


# --- the shared fixture: this implementation and the JS port must agree -----
#
# code/content-fidelity.js is a port of check_numeric_fidelity(). Two copies of
# one rule in two languages will drift — the same failure as two staleness
# thresholds for one word. fixtures/numeric-fidelity-cases.json is generated
# FROM this module by scripts/gen-fidelity-fixture.py and is read by BOTH
# suites, so a disagreement fails both rather than quietly favouring one.
#
# This side asserts the fixture still describes THIS module. If a change here
# alters a case, this fails and the fixture wants regenerating deliberately —
# which is the moment to check the JS port still agrees, rather than finding
# out weeks later.

def _fixture_cases():
    import os
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    with open(os.path.join(repo, 'fixtures', 'numeric-fidelity-cases.json')) as f:
        return json.load(f)['cases']


def test_shared_fixture_still_describes_this_module():
    cases = _fixture_cases()
    assert len(cases) >= 10, f"only {len(cases)} shared cases — the pin is too thin"
    for c in cases:
        got = cg.check_numeric_fidelity(c['source'], *c['generated'])
        assert got == c['suspects'], (
            f"{c['name']}: this module now returns {got}, but "
            f"fixtures/numeric-fidelity-cases.json records {c['suspects']}. "
            "If the change is intended, regenerate with "
            "scripts/gen-fidelity-fixture.py AND re-run code/test-content-fidelity.js "
            "so the JS port is held to the new behaviour too."
        )


def test_shared_fixture_is_not_vacuous():
    # A fixture where nothing expects a suspect would pass against a checker
    # that always returns [], and vice versa.
    cases = _fixture_cases()
    assert any(c['suspects'] for c in cases), "no case expects a suspect"
    assert any(not c['suspects'] for c in cases), "no case expects a clean result"
