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
import re
import sys
from pathlib import Path

import requests

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
MODEL = "qwen2.5:3b"
REQUEST_TIMEOUT = 120  # seconds, generous for a cold-loaded local model

CONTENT_DIR = Path(__file__).parent / "content"

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
    out_path.write_text(json.dumps(content, indent=2))

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
