#!/usr/bin/env python3
"""
Phase B — Content Generator (Week 1)

Generates structured JSON content for a given alphabet letter using the
local Ollama qwen2.5:3b model via its HTTP API. No cloud API, no hardcoded
content. Follows the same request/response shape used elsewhere in this
repo (see jarvis-x/hermes.py's HermesCore.ask()), but calls the HTTP API
directly via `requests` instead of shelling out to curl.

Schema produced by generate_letter_content():
{
  "letter": "A",
  "example_word": "Apple",
  "narration_script": "...",
  "on_screen_text": "...",
  "image_prompt": "...",
  "duration_seconds": 15
}
"""

import hashlib
import json
import os
import re
import sys
from pathlib import Path

import requests

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
MODEL = "qwen2.5:3b"
REQUEST_TIMEOUT = 120  # seconds, generous for a cold-loaded local model

CONTENT_DIR = Path(__file__).parent / "stages" / "01_source_content" / "output" / "letters"


def _atomic_write_json(out_path: Path, content: dict) -> None:
    """Write `content` to `out_path` atomically.

    Found via REMAINING_WORK.md P8's real-disk-full test: the previous
    direct `out_path.write_text(...)` opens in 'w' mode, which truncates
    the destination *before* writing the new content -- so a write failure
    mid-way (disk full was the case tested, but any interrupted write
    qualifies) doesn't leave the old file intact, it leaves a zero-byte
    file where a real one used to be. Anything that only checks
    `.exists()` (e.g. this file's own `_next_letter_to_generate()`-style
    "already generated" callers in app.py) would then treat that as done.

    Writing to a sibling temp file on the same filesystem and renaming over
    the destination avoids that: `os.rename` is atomic, so `out_path`
    either still holds its old content or holds the complete new content --
    never a partial write. If the temp write itself fails (e.g. disk full),
    the temp file is removed and the original `out_path` is left untouched.
    """
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    try:
        tmp_path.write_text(json.dumps(content, indent=2))
        os.rename(tmp_path, out_path)
    except OSError:
        tmp_path.unlink(missing_ok=True)
        raise

REQUIRED_FIELDS = {
    "letter",
    "example_word",
    "narration_script",
    "on_screen_text",
    "image_prompt",
    "duration_seconds",
}


def _build_prompt(letter: str) -> str:
    return f"""You are generating content for a children's educational short-form video
teaching the letter "{letter}".

Return ONLY a single JSON object (no markdown code fences, no commentary,
no extra text before or after it) with EXACTLY these 5 fields:

- "letter": the single uppercase letter "{letter}"
- "example_word": one simple, common English word that starts with "{letter}"
  (use the letter itself as "letter", e.g. if letter is "A" use a word like "Apple")
- "narration_script": 1-2 short, kid-friendly sentences a narrator would
  speak aloud introducing the letter and the example word
- "on_screen_text": a short line of text to display on screen (can be
  shorter/simpler than the narration, e.g. "A is for Apple!")
- "image_prompt": one line describing an accompanying illustration for a
  future image-generation step (not generated now, just described)
- "duration_seconds": an integer target video duration in seconds (use 15)

Output strictly valid JSON, matching exactly this shape:
{{"letter": "{letter}", "example_word": "...", "narration_script": "...", "on_screen_text": "...", "image_prompt": "...", "duration_seconds": 15}}
"""


def _build_strict_retry_prompt(letter: str, bad_output: str) -> str:
    return f"""Your previous response could not be parsed as JSON. Here is what you sent:

---
{bad_output}
---

Respond again for letter "{letter}". This time output ONLY raw JSON — a single
JSON object, starting with {{ and ending with }}. Do NOT wrap it in markdown
code fences (no ```). Do NOT add any explanation, prefix, or suffix text.
The object must have exactly these keys: letter, example_word,
narration_script, on_screen_text, image_prompt, duration_seconds.
"""


def _strip_markdown_fences(text: str) -> str:
    text = text.strip()
    # Strip ```json ... ``` or ``` ... ``` fences if present.
    fence_match = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
    if fence_match:
        return fence_match.group(1).strip()
    return text


def _extract_json_object(text: str) -> str:
    """Best-effort extraction of the first {...} block in text."""
    text = _strip_markdown_fences(text)
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start : end + 1]
    return text


def _call_ollama(prompt: str, use_json_format: bool) -> str:
    """Call the local Ollama HTTP API and return the raw 'response' string."""
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
    }
    if use_json_format:
        payload["format"] = "json"

    resp = requests.post(OLLAMA_URL, json=payload, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    return data.get("response", "")


def _parse_content_json(raw_text: str) -> dict:
    candidate = _extract_json_object(raw_text)
    parsed = json.loads(candidate)  # may raise json.JSONDecodeError
    if not isinstance(parsed, dict):
        raise ValueError("Parsed JSON is not an object")
    missing = REQUIRED_FIELDS - set(parsed.keys())
    if missing:
        raise ValueError(f"Missing required fields: {missing}")
    for field in REQUIRED_FIELDS - {"duration_seconds"}:
        if not isinstance(parsed[field], str) or not parsed[field].strip():
            raise ValueError(f"Field '{field}' must be a non-empty string")
    if not isinstance(parsed["duration_seconds"], (int, float)) or parsed["duration_seconds"] <= 0:
        raise ValueError("Field 'duration_seconds' must be a positive number")
    parsed["duration_seconds"] = int(parsed["duration_seconds"])
    return parsed


def _detect_json_format_support() -> bool:
    """Check whether this Ollama install supports the `format: "json"` field.

    Older Ollama versions ignore unknown fields silently, which is harmless,
    but some very old versions reject the request outright. We test with a
    minimal request and fall back to plain-prompt parsing if it errors.
    """
    try:
        resp = requests.post(
            OLLAMA_URL,
            json={
                "model": MODEL,
                "prompt": "Reply with {\"ok\": true}",
                "stream": False,
                "format": "json",
            },
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            return False
        data = resp.json()
        json.loads(data.get("response", ""))
        return True
    except Exception:
        return False


# --- Numeric-fidelity guard, shared by the sourced-fact generators --------
# (economic_facts_generator.py, commodities_macro_generator.py,
# geopolitical_risk_generator.py -- NOT used by generate_letter_content()
# above, which has no external sourced fact to check numbers against.)
#
# REMAINING_WORK.md P4: qwen2.5:3b has fabricated numbers not present in the
# sourced fact it was given, twice confirmed at build time ("40%", "29.5%")
# and twice more in a single re-run batch (2026-08-20). The shared
# retry/validation logic checked JSON shape and non-empty fields, but had no
# check for fidelity to the source fact -- this closes the numeric half of
# that gap.
_NUMBER_WORDS = {
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
    "eleven": "11", "twelve": "12", "thirteen": "13", "fourteen": "14",
    "fifteen": "15", "sixteen": "16", "seventeen": "17", "eighteen": "18",
    "nineteen": "19", "twenty": "20",
}


def _normalize_number(raw: str) -> str:
    r"""'24.00.' -> '24', '1,200' -> '1200', '22.25' -> '22.25', '40%' -> '40%'.

    The old regex (r"\d[\d,.]*%?") swallowed trailing sentence punctuation,
    so a faithful restatement ending a sentence ("costs EGP 24.00.") produced
    the token '24.00.' -- absent from the source's '24.00' and therefore
    reported as an invented number. It also compared as strings, so writing
    'EGP 24' for a source saying 'EGP 24.00' was flagged. Both are false
    positives that make enforce_numeric_fidelity() burn its retries and then
    REFUSE TO SHIP correct content. Compare numeric value instead, keeping
    '%' significant (40 and 40% are not interchangeable in a rate claim).
    """
    pct = raw.endswith('%')
    body = raw[:-1] if pct else raw
    body = body.replace(',', '').rstrip('.')
    if not body:
        return raw
    try:
        val = float(body)
    except ValueError:
        return raw
    out = str(int(val)) if val == int(val) else str(val)
    return out + '%' if pct else out


def _numeric_tokens(text: str) -> set:
    """Number-like tokens in `text`, normalized so trailing punctuation and
    insignificant trailing zeros do not create spurious mismatches."""
    # In a range the unit is written once and governs both endpoints:
    # "3.5% to 3.75%" but also "3.5-3.75%" and "3.5 to 3.75 percent".
    # Without this, the leading number tokenizes bare ('3.5') and fails to
    # match a source that wrote '3.5%', flagging a faithful restatement.
    # Keeps the strict case intact: a standalone 24% still will not match a
    # source containing only bare 24.
    # The token regex below only recognizes '%', so spelled-out "percent"
    # tokenizes bare and cannot match a source that wrote '%'. Normalize the
    # word to the symbol first, before range expansion.
    text = re.sub(r"(\d)\s*(?:percentage points?|percent|pct)\b", r"\1%", text, flags=re.IGNORECASE)
    ranged = re.sub(
        r"(\d[\d,]*(?:\.\d+)?)(\s*(?:-|--|to|and)\s*)(\d[\d,]*(?:\.\d+)?)(\s*(?:%|percent))",
        r"\1\4\2\3\4", text, flags=re.IGNORECASE)
    raw = re.findall(r"\d[\d,]*(?:\.\d+)?%?", ranged)
    tokens = {_normalize_number(t) for t in raw}
    lower = text.lower()
    for word, digit in _NUMBER_WORDS.items():
        if re.search(rf"\b{word}\b", lower):
            tokens.add(digit)
    return tokens


def check_numeric_fidelity(source_fact: str, *generated_texts: str) -> list:
    """Numbers present in `generated_texts` but absent from `source_fact`.

    Cheap and deterministic (no extra LLM call, so no added flakiness):
    catches a genuinely new number appearing out of nowhere. Deliberately
    narrow -- it does NOT catch a semantic/logical garbling of a number
    that WAS already in the source (e.g. "a 90-day pause... from 125% to
    125%": 125 is real, the bug is stating no change happened at all --
    REMAINING_WORK.md P4's 2026-08-20 addendum). That class needs real
    semantic judgment, not a token diff; left as an open follow-up there.
    """
    source_tokens = _numeric_tokens(source_fact)
    suspects = []
    for text in generated_texts:
        for tok in _numeric_tokens(text):
            if tok not in source_tokens and tok not in suspects:
                suspects.append(tok)
    return suspects


def build_fidelity_retry_prompt(fact_text: str, bad_narration: str, bad_caption: str, suspect_numbers: list) -> str:
    numbers = ", ".join(suspect_numbers)
    return f"""Your previous narration/caption used number(s) {numbers} that do NOT
appear anywhere in the sourced fact below. You must not invent numbers.

SOURCED FACT: {fact_text}

YOUR PREVIOUS (REJECTED) OUTPUT:
narration_script: {bad_narration}
on_screen_text: {bad_caption}

Rewrite both fields using ONLY numbers, dates, and figures that literally
appear in the sourced fact above. If you don't need a number, don't use one.
Respond again with ONLY a single JSON object, same shape as before:
{{"narration_script": "...", "on_screen_text": "...", "image_prompt": "..."}}
"""


def enforce_numeric_fidelity(fact_text: str, llm_fields: dict, call_ollama, use_json_format: bool,
                              required_fields: set, max_retries: int) -> dict:
    """Re-prompt up to `max_retries` times if narration_script/on_screen_text
    contain a number not present in `fact_text`. Returns corrected
    llm_fields, or raises ValueError if still unfaithful after retrying --
    shipping content known to contain an invented number is worse than a
    loud failure (same "real controls only, no silent success" stance the
    rest of this codebase takes elsewhere, e.g. the kill switch)."""
    suspects = check_numeric_fidelity(fact_text, llm_fields["narration_script"], llm_fields["on_screen_text"])
    attempts = 0
    while suspects and attempts < max_retries:
        attempts += 1
        retry_prompt = build_fidelity_retry_prompt(
            fact_text, llm_fields["narration_script"], llm_fields["on_screen_text"], suspects
        )
        raw = call_ollama(retry_prompt, use_json_format)
        try:
            candidate = _parse_content_json_generic(raw, required_fields)
        except (json.JSONDecodeError, ValueError):
            continue  # bad shape on the retry -- try again, same suspects
        llm_fields = candidate
        suspects = check_numeric_fidelity(fact_text, llm_fields["narration_script"], llm_fields["on_screen_text"])

    if suspects:
        raise ValueError(
            f"Numeric fidelity check failed after {attempts} retries -- generated "
            f"content still contains number(s) {suspects} not present in the sourced "
            f"fact. Refusing to write content with invented numbers. "
            f"Last narration_script: {llm_fields['narration_script']!r}"
        )
    return llm_fields


GEMINI_JUDGE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent"
GEMINI_ENV_PATH = Path(os.environ.get("HOME", "")) / ".jarvis-x" / ".env"
GEMINI_JUDGE_TIMEOUT = 60  # seconds

# Verdicts are cached on disk, not in memory: each verify run is a fresh
# process, which is precisely the pattern that burned the quota.
JUDGE_CACHE_PATH = Path(__file__).resolve().parents[2] / "logs" / ".judge-cache.json"


def _judge_cache_get(key):
    try:
        return json.loads(JUDGE_CACHE_PATH.read_text()).get(key)
    except (OSError, json.JSONDecodeError):
        return None


def _judge_cache_put(key, value):
    try:
        JUDGE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        try:
            cache = json.loads(JUDGE_CACHE_PATH.read_text())
        except (OSError, json.JSONDecodeError):
            cache = {}
        cache[key] = value
        JUDGE_CACHE_PATH.write_text(json.dumps(cache))
    except OSError:
        pass  # caching is an optimization; never fail a check over it


def _load_gemini_api_key() -> str:
    """Load GEMINI_API_KEY from ~/.jarvis-x/.env -- same file/format code/gemini.js uses."""
    if not GEMINI_ENV_PATH.exists():
        raise RuntimeError(f"no .env at {GEMINI_ENV_PATH}")
    line = next(
        (ln for ln in GEMINI_ENV_PATH.read_text().splitlines() if ln.startswith("GEMINI_API_KEY=")),
        None,
    )
    if line is None:
        raise RuntimeError("GEMINI_API_KEY not found in .env")
    key = line[len("GEMINI_API_KEY="):].strip()
    if not key or key == "paste_new_key_here":
        raise RuntimeError("key placeholder not replaced")
    return key


GROQ_JUDGE_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_JUDGE_MODEL = "openai/gpt-oss-120b"


def _call_groq_judge(prompt: str) -> "requests.Response":
    """Second judge, used only when Gemini is unreachable or out of quota.

    Gemini's free tier is 20 requests/day/model (measured, not documented),
    and votes=3 means one content check costs 3 -- roughly 6 checks a day
    before the judge simply stops working. Groq's limit is far higher, so
    it keeps the gate alive on days Gemini is spent.

    Deliberately NO local fallback below this. qwen2.5:3b/7b were both
    evaluated as judges and rejected; degrading to one silently would turn
    "the check could not run" into "the check ran badly", which is worse
    than failing closed. Below Groq, this still raises.
    """
    key = _load_key("GROQ_API_KEY")
    return requests.post(
        GROQ_JUDGE_URL,
        headers={"content-type": "application/json", "authorization": f"Bearer {key}"},
        json={"model": GROQ_JUDGE_MODEL,
              "messages": [{"role": "user", "content": prompt}]},
        timeout=GEMINI_JUDGE_TIMEOUT,
    )


def _load_key(name: str) -> str:
    """Read a key from ~/.jarvis-x/.env, same source the rest of the repo uses."""
    env = Path.home() / ".jarvis-x" / ".env"
    for line in env.read_text().splitlines():
        if line.startswith(name + "="):
            v = line.split("=", 1)[1].strip()
            if v and not v.lower().startswith(("your", "xxx", "placeholder")):
                return v
    raise RuntimeError(f"{name} not found in {env}")


def _call_gemini_judge(prompt: str) -> dict:
    """Call the semantic-fidelity judge: Gemini first, Groq as fallback.

    Fails closed: if BOTH judges are unreachable, out of quota, or return
    something unparseable, this raises RuntimeError. Per
    DECISION_RECORD_p4-gemini-judge.md, a check that can't run is treated
    the same as "can't confirm faithful", never as a pass.
    """
    resp = None
    try:
        key = _load_gemini_api_key()
        resp = requests.post(
            GEMINI_JUDGE_URL,
            headers={"content-type": "application/json", "x-goog-api-key": key},
            json={"contents": [{"parts": [{"text": prompt}]}]},
            timeout=GEMINI_JUDGE_TIMEOUT,
        )
        if not resp.ok:
            raise RuntimeError(f"gemini {resp.status_code}")
    except Exception as gemini_err:
        try:
            resp = _call_groq_judge(prompt)
            if not resp.ok:
                raise RuntimeError(f"groq {resp.status_code}: {resp.text[:200]}")
            data = resp.json()
            text = data["choices"][0]["message"]["content"]
            verdict = json.loads(_extract_json_object(text))
            if not isinstance(verdict, dict) or "faithful" not in verdict:
                raise RuntimeError(f"groq verdict missing 'faithful': {verdict!r}")
            return {"faithful": bool(verdict["faithful"]),
                    "issue": verdict.get("issue"), "judge": "groq"}
        except Exception as groq_err:
            raise RuntimeError(
                f"both judges failed -- gemini: {gemini_err}; groq: {groq_err}"
            ) from groq_err
    if not resp.ok:
        raise RuntimeError(f"Gemini judge returned {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"Gemini judge response had no text: {data!r}") from e

    try:
        verdict = json.loads(_extract_json_object(text))
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Gemini judge returned unparseable verdict: {text!r}") from e
    if not isinstance(verdict, dict) or "faithful" not in verdict:
        raise RuntimeError(f"Gemini judge verdict missing 'faithful' field: {verdict!r}")
    return {"faithful": bool(verdict["faithful"]), "issue": verdict.get("issue"),
            "judge": "gemini"}


def build_semantic_judge_prompt(source_fact: str, narration: str, caption: str) -> str:
    return f"""You are checking whether generated video narration/caption changes the
MEANING of a sourced fact -- not just checking numbers, but whether dates,
timeframes, and relationships between figures are restated correctly.

SOURCED FACT: {source_fact}

GENERATED NARRATION: {narration}
GENERATED CAPTION: {caption}

Does the narration or caption change, contradict, or garble the meaning of
the sourced fact -- for example, restating a change as "no change" (like
saying a value moved "from X to X"), restating a date or timeframe
incorrectly, or reversing a relationship between two figures?

Respond with ONLY a single JSON object, no other text:
{{"faithful": true or false, "issue": "specific description of the problem, or null if faithful"}}
"""


def check_semantic_fidelity(source_fact: str, narration: str, caption: str, votes: int = 3) -> dict:
    """Ask the Gemini judge whether `narration`/`caption` are semantically
    faithful to `source_fact`. Returns {"faithful": bool, "issue": str|None}.

    Runs `votes` independent trials and flags the content if ANY trial
    finds a defect -- not majority.

    The original single-call design cited the 2026-08-23 postmortem: voting
    a weak local judge did not fix its FALSE-POSITIVE rate. That holds --
    voting cannot rescue a judge biased toward rejecting good content.
    But Gemini's observed failure is the opposite and voting does address
    it: 0/5 false positives on verified-clean content, yet only 3/5 recall
    on a real temporal-inversion defect (2026-08-24 live run). It is right
    when it speaks and silent too often.

    Hence any-flag, not majority. The costs are asymmetric: a miss ships a
    fabrication to an audience, a spurious flag costs a human one reading
    of one caption. With 3 votes at the observed 0.6 per-trial recall, miss
    probability drops from 40% to about 6%.

    Cost: `votes`x the quota. The free tier already exhausts mid-suite at
    1x (HTTP 429, 2026-08-24), so votes>1 makes quota handling mandatory
    rather than optional before this gates anything.
    """
    prompt = build_semantic_judge_prompt(source_fact, narration, caption)

    # A verdict is a pure function of the prompt text, so an unchanged
    # source/narration/caption never needs re-judging. The verify suite
    # re-runs the same fixtures repeatedly and each 1x pass already
    # exhausted the free tier (HTTP 429, 2026-08-24); at votes=3 that is
    # three times worse. Cache on the prompt hash, keyed by vote count so a
    # cheap votes=1 scan cannot satisfy a later votes=3 gate check.
    cache_key = f"{hashlib.sha256(prompt.encode()).hexdigest()[:32]}:{votes}"
    cached = _judge_cache_get(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    verdicts = [_call_gemini_judge(prompt) for _ in range(max(1, votes))]
    issues = [v["issue"] for v in verdicts if not v["faithful"] and v["issue"]]
    if issues:
        result = {"faithful": False, "issue": " | ".join(dict.fromkeys(issues)),
                  "votes": len(verdicts), "flagged": len(issues)}
    else:
        result = {"faithful": True, "issue": None, "votes": len(verdicts), "flagged": 0}
    _judge_cache_put(cache_key, result)
    return {**result, "cached": False}


def build_semantic_fidelity_retry_prompt(fact_text: str, bad_narration: str, bad_caption: str, issue: str) -> str:
    return f"""Your previous narration/caption was flagged as changing the meaning of
the sourced fact below. The specific problem: {issue}

SOURCED FACT: {fact_text}

YOUR PREVIOUS (REJECTED) OUTPUT:
narration_script: {bad_narration}
on_screen_text: {bad_caption}

Rewrite both fields so they accurately restate the sourced fact above --
do not change what happened, when it happened, or the relationship
between any numbers or events.
Respond again with ONLY a single JSON object, same shape as before:
{{"narration_script": "...", "on_screen_text": "...", "image_prompt": "..."}}
"""


def enforce_semantic_fidelity(fact_text: str, llm_fields: dict, call_ollama, use_json_format: bool,
                               required_fields: set, max_retries: int) -> dict:
    """Re-prompt up to `max_retries` times if the Gemini judge flags
    narration_script/on_screen_text as changing the meaning of fact_text.
    Returns corrected llm_fields, or raises ValueError if still unfaithful
    after retrying -- same fail-loud, no-silent-success contract as
    enforce_numeric_fidelity().

    Each retry candidate is also re-run through enforce_numeric_fidelity(),
    since a semantic retry is a fresh generation that could reintroduce an
    invented number even if the original candidate didn't have one.

    A judge-call failure (RuntimeError, e.g. Gemini unreachable or rate
    limited) is NOT retried here -- the judge itself is broken, not the
    content, so re-prompting the content generator wouldn't help. It
    propagates immediately and blocks the write (fail closed, per
    DECISION_RECORD_p4-gemini-judge.md).
    """
    verdict = check_semantic_fidelity(
        fact_text, llm_fields["narration_script"], llm_fields["on_screen_text"]
    )
    attempts = 0
    while not verdict["faithful"] and attempts < max_retries:
        attempts += 1
        retry_prompt = build_semantic_fidelity_retry_prompt(
            fact_text, llm_fields["narration_script"], llm_fields["on_screen_text"], verdict["issue"]
        )
        raw = call_ollama(retry_prompt, use_json_format)
        try:
            candidate = _parse_content_json_generic(raw, required_fields)
        except (json.JSONDecodeError, ValueError):
            continue  # bad shape on the retry -- try again, same verdict
        candidate = enforce_numeric_fidelity(
            fact_text, candidate, call_ollama, use_json_format, required_fields, max_retries
        )
        llm_fields = candidate
        verdict = check_semantic_fidelity(
            fact_text, llm_fields["narration_script"], llm_fields["on_screen_text"]
        )

    if not verdict["faithful"]:
        raise ValueError(
            f"Semantic fidelity check failed after {attempts} retries -- Gemini judge "
            f"still flags this content as changing the meaning of the sourced fact: "
            f"{verdict['issue']}. Refusing to write content with a semantic-fidelity "
            f"defect. Last narration_script: {llm_fields['narration_script']!r}"
        )
    return llm_fields


def _parse_content_json_generic(raw_text: str, required_fields: set) -> dict:
    """Same shape check as _parse_content_json()/_parse_llm_json() in the
    per-vertical generators, parameterized on the field set so this shared
    fidelity-retry path doesn't need to import each vertical's local copy."""
    candidate = _extract_json_object(raw_text)
    parsed = json.loads(candidate)
    if not isinstance(parsed, dict):
        raise ValueError("Parsed JSON is not an object")
    missing = required_fields - set(parsed.keys())
    if missing:
        raise ValueError(f"Missing required fields: {missing}")
    for field in required_fields:
        if not isinstance(parsed[field], str) or not parsed[field].strip():
            raise ValueError(f"Field '{field}' must be a non-empty string")
    return parsed


def generate_letter_content(letter: str) -> dict:
    """Generate structured content for `letter` using local Ollama qwen2.5:3b.

    Raises RuntimeError if Ollama is unreachable, and ValueError if the
    model's output cannot be parsed into the expected schema even after
    one stricter retry.
    """
    letter = letter.strip().upper()
    if len(letter) != 1 or not letter.isalpha():
        raise ValueError(f"letter must be a single alphabetic character, got: {letter!r}")

    use_json_format = _detect_json_format_support()

    prompt = _build_prompt(letter)
    try:
        raw = _call_ollama(prompt, use_json_format)
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"Could not reach Ollama at {OLLAMA_URL}: {e}") from e

    try:
        content = _parse_content_json(raw)
    except (json.JSONDecodeError, ValueError) as first_err:
        # Retry once with a stricter follow-up prompt before giving up.
        retry_prompt = _build_strict_retry_prompt(letter, raw)
        try:
            raw_retry = _call_ollama(retry_prompt, use_json_format)
        except requests.exceptions.RequestException as e:
            raise RuntimeError(f"Could not reach Ollama at {OLLAMA_URL} on retry: {e}") from e
        try:
            content = _parse_content_json(raw_retry)
        except (json.JSONDecodeError, ValueError) as second_err:
            raise ValueError(
                f"Failed to parse valid JSON from Ollama for letter '{letter}' "
                f"after 1 retry. First error: {first_err}. Retry error: {second_err}. "
                f"Last raw output: {raw_retry!r}"
            ) from second_err

    # Force letter to match what was requested (models sometimes echo it
    # lowercase or pick a different one).
    content["letter"] = letter

    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = CONTENT_DIR / f"letter_{letter}.json"
    _atomic_write_json(out_path, content)

    return content


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 content_generator.py <LETTER>", file=sys.stderr)
        sys.exit(1)

    letter_arg = sys.argv[1]
    try:
        result = generate_letter_content(letter_arg)
    except RuntimeError as e:
        print(f"BLOCKER: {e}", file=sys.stderr)
        sys.exit(2)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result, indent=2))
