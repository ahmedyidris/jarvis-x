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


def _numeric_tokens(text: str) -> set:
    """Number-like tokens in `text`: digit runs (with %, decimals, commas)
    plus small English number words one-twenty, normalized to digits so
    "six" and "6" compare equal."""
    tokens = set(re.findall(r"\d[\d,.]*%?", text))
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
