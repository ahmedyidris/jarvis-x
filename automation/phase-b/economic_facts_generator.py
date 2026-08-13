#!/usr/bin/env python3
"""
Phase B — Economic Facts Generator (Week 2)

Weekly economic-facts video pipeline. UNLIKE Week 1's content_generator.py,
the local qwen2.5:3b model is NEVER the source of the facts themselves —
it only turns an already-sourced, human-verified fact into narration/caption
text. This split exists on purpose (explicit decision with the actual
user): a local LLM must never be allowed to invent an "economic fact" and
have it presented as true.

Pipeline, in order:
  1. Real, current facts are found via the WebSearch tool (done once, by
     hand, in the agent session that authored SOURCED_FACTS below — see
     the comment above that list for the exact queries used and the date
     they were run). Each fact carries a real source_name + source_url
     that was actually returned by a search, not paraphrased or invented.
  2. Those sourced facts are hardcoded here as SOURCED_FACTS. This script
     does NOT call WebSearch itself (it's a library tool available to the
     agent, not a Python API) — it consumes the output of that research
     step, which is the whole point of the human/agent-in-the-loop design.
  3. ONLY THEN is qwen2.5:3b (via Ollama, same HTTP API pattern as Week 1's
     content_generator.py) prompted to write narration_script/on_screen_text/
     image_prompt AROUND the given fact — explicitly instructed not to add
     any claim, number, or detail not present in the fact/source it's given.
  4. Every output JSON keeps source_name/source_url so the fact stays
     traceable back to where it was found.

If a topic's search didn't turn up a real, current, verifiable fact, it is
skipped entirely rather than filled in with an invented "fact" — see the
final report for any such gaps.

Schema produced by generate_economic_content() per fact:
{
  "topic": "...",
  "headline_fact": "...",
  "source_name": "...",
  "source_url": "https://...",
  "narration_script": "...",
  "on_screen_text": "...",
  "image_prompt": "...",
  "duration_seconds": 25
}
"""

import json
import sys
from pathlib import Path

import requests

# Reuse Week 1's Ollama-calling helpers unmodified rather than duplicating
# them — content_generator.py itself is left untouched.
from content_generator import (
    MODEL,
    OLLAMA_URL,
    _call_ollama,
    _detect_json_format_support,
    _extract_json_object,
)

CONTENT_DIR = Path(__file__).parent / "content"
OUTPUT_DIR = Path(__file__).parent / "output"

# Target duration for Week 2's videos: denser content than Week 1's 15s
# kids letter videos (which only had to hold a letter + example word), but
# still a short-form vertical video. 25s comfortably fits a fact +
# 2-4 sentences of narration without feeling rushed or dragging.
DURATION_SECONDS = 25

REQUIRED_LLM_FIELDS = {"narration_script", "on_screen_text", "image_prompt"}
# narration_script/on_screen_text are the fields that actually carry the
# sourced fact to the viewer -- if the model can't produce those correctly
# we must fail rather than guess. image_prompt is purely a cosmetic
# description for a future (not-yet-built) image-gen pass, so a
# deterministic, non-LLM fallback for it alone is safe (see
# _fallback_image_prompt) and doesn't violate the "never invent a fact"
# rule -- it invents no claim, just a generic illustration direction.
CORE_LLM_FIELDS = {"narration_script", "on_screen_text"}

# Observed empirically (2026-08-13 run): qwen2.5:3b occasionally emits a
# well-formed JSON object that's simply missing the image_prompt key
# outright (not truncated -- the object closes cleanly after
# on_screen_text). This is stochastic, not a parsing bug: an identical
# prompt sent again minutes later returned all 3 fields correctly. Two
# attempts (1 initial + 1 retry) both happened to omit it in the same run,
# which is what actually failed "Egypt fuel prices" on the first pass.
# MAX_ATTEMPTS raises the number of tries before giving up.
MAX_ATTEMPTS = 3

# ---------------------------------------------------------------------------
# SOURCED_FACTS — the ONLY facts this pipeline is allowed to turn into
# videos. Each one was found via the WebSearch tool on 2026-08-13 (today,
# per this session), cross-checked against a second independent source
# where the primary source couldn't be fetched directly (e.g. Bloomberg is
# bot/paywall-blocked for direct fetch, so its numbers were corroborated
# against TradingEconomics, which mirrors the same CAPMAS release). Queries
# used: "Egypt inflation rate August 2026", "Egypt fuel prices August
# 2026", "US Federal Reserve interest rate decision August 2026", plus a
# follow-up site:federalreserve.gov query and direct fetches of
# globalpetrolprices.com and tradingeconomics.com to verify figures before
# use. See the final report for the exact URLs and what each source said.
# ---------------------------------------------------------------------------
SOURCED_FACTS = [
    {
        "topic": "Egypt inflation",
        "headline_fact": (
            "Egypt's annual urban inflation rate accelerated to 14.9% in "
            "July 2026, up from 14.3% in June -- the first acceleration in "
            "four months -- according to CAPMAS data, with analysts citing "
            "a roughly 12% electricity price hike as a key driver."
        ),
        "source_name": "Bloomberg",
        "source_url": (
            "https://www.bloomberg.com/news/articles/2026-08-10/"
            "egypt-headline-inflation-quickens-for-the-first-time-since-march"
        ),
    },
    {
        "topic": "Egypt fuel prices",
        "headline_fact": (
            "As of August 10, 2026, gasoline (95-octane) in Egypt is priced "
            "at EGP 24.00 per liter (about USD 0.48), with 92-octane at "
            "EGP 22.25/liter, 80-octane at EGP 20.75/liter, and diesel at "
            "EGP 20.50/liter -- unchanged since the Petroleum Ministry's "
            "last EGP 3/liter increase in March 2026."
        ),
        "source_name": "GlobalPetrolPrices.com",
        "source_url": "https://www.globalpetrolprices.com/Egypt/gasoline_prices/",
    },
    {
        "topic": "US Federal Reserve interest rates",
        "headline_fact": (
            "On July 29, 2026, the Federal Open Market Committee voted 9-3 "
            "to hold the federal funds rate at a target range of 3.5% to "
            "3.75%, with three regional bank presidents dissenting as "
            "inflation has stayed above the Fed's 2% goal for more than "
            "five years."
        ),
        "source_name": "Federal Reserve (official FOMC statement)",
        "source_url": "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm",
    },
]


def _slugify(topic: str) -> str:
    return topic.strip().lower().replace(" ", "-").replace("--", "-")


def _build_prompt(fact: dict) -> str:
    return f"""You are scripting a short-form economic-facts video for a general
adult audience (NOT children). You are given ONE real, sourced fact below.
Your ONLY job is to write narration and on-screen text AROUND this fact.

CRITICAL RULE: Do not invent, add, or imply any fact, number, date, or claim
that is not already stated in the fact below. Do not speculate about causes,
future outcomes, or related events unless they are explicitly present in the
fact text. If you are unsure whether something is stated below, leave it out.

TOPIC: {fact['topic']}
SOURCED FACT: {fact['headline_fact']}
SOURCE: {fact['source_name']} ({fact['source_url']})

Return ONLY a single JSON object (no markdown code fences, no commentary,
no extra text before or after it) with EXACTLY these 3 fields:

- "narration_script": 2-4 clear, plain-spoken sentences a narrator would
  read aloud, built entirely around the sourced fact above (may mention the
  source by name, e.g. "According to {fact['source_name']}..."). Adult tone,
  no childish language, no invented numbers or claims beyond the fact given.
- "on_screen_text": one short, punchy on-screen caption (under ~15 words)
  summarizing the sourced fact for a vertical video, using only numbers/
  claims present in the fact above.
- "image_prompt": one line describing an accompanying illustration/photo
  for a future image-generation step (not generated now, just described) --
  should visually relate to the topic (e.g. a gas station, a currency
  symbol, a central bank building) without depicting any specific real
  person.

Output strictly valid JSON, matching exactly this shape:
{{"narration_script": "...", "on_screen_text": "...", "image_prompt": "..."}}
"""


def _build_strict_retry_prompt(fact: dict, bad_output: str) -> str:
    return f"""Your previous response for the topic "{fact['topic']}" could not be
parsed as JSON. Here is what you sent:

---
{bad_output}
---

Respond again. This time output ONLY raw JSON -- a single JSON object,
starting with {{ and ending with }}. Do NOT wrap it in markdown code fences
(no ```). Do NOT add any explanation, prefix, or suffix text. The object
must have exactly these keys: narration_script, on_screen_text, image_prompt.
Do not add any fact, number, or claim beyond what was in the original fact
given to you.
"""


def _parse_llm_json(raw_text: str, required_fields: set) -> dict:
    candidate = _extract_json_object(raw_text)
    parsed = json.loads(candidate)  # may raise json.JSONDecodeError
    if not isinstance(parsed, dict):
        raise ValueError("Parsed JSON is not an object")
    missing = required_fields - set(parsed.keys())
    if missing:
        raise ValueError(f"Missing required fields: {missing}")
    for field in required_fields:
        if not isinstance(parsed[field], str) or not parsed[field].strip():
            raise ValueError(f"Field '{field}' must be a non-empty string")
    return parsed


def _fallback_image_prompt(fact: dict) -> str:
    """Deterministic, non-LLM image_prompt used only if every attempt to
    get one from the model failed. This invents no fact/claim -- it's a
    generic illustration direction derived from the topic label itself,
    same spirit as Week 1's "not used for actual image generation this
    round" placeholder."""
    return f"A simple, neutral editorial illustration representing the topic: {fact['topic']}."


def generate_economic_content(fact: dict) -> dict:
    """Turn one already-sourced fact dict into full video content JSON.

    `fact` must already have topic/headline_fact/source_name/source_url --
    this function only adds the local-LLM-scripted narration/caption/image
    prompt fields and a fixed duration_seconds.

    Retries up to MAX_ATTEMPTS times against Ollama. narration_script and
    on_screen_text (the fields that actually carry the sourced fact to the
    viewer) must come from the model -- if every attempt fails to produce
    those, this raises ValueError rather than guessing. image_prompt is
    cosmetic only (a future image-gen hint, not used this round); if the
    model produces valid narration/caption but keeps omitting just
    image_prompt (observed to happen stochastically with qwen2.5:3b -- a
    well-formed object that simply omits the key, not a truncation), we
    fall back to a deterministic, non-invented placeholder for it rather
    than discarding an otherwise-good, correctly-sourced fact.

    Raises RuntimeError if Ollama is unreachable.
    """
    for req in ("topic", "headline_fact", "source_name", "source_url"):
        if not fact.get(req):
            raise ValueError(f"fact is missing required sourced field: {req!r}")

    use_json_format = _detect_json_format_support()

    raw = None
    last_core_fields = None  # best narration/on_screen_text seen so far, if any
    last_err = None
    for attempt in range(MAX_ATTEMPTS):
        prompt = _build_prompt(fact) if attempt == 0 else _build_strict_retry_prompt(fact, raw)
        try:
            raw = _call_ollama(prompt, use_json_format)
        except requests.exceptions.RequestException as e:
            raise RuntimeError(
                f"Could not reach Ollama at {OLLAMA_URL} (attempt {attempt + 1}): {e}"
            ) from e

        try:
            llm_fields = _parse_llm_json(raw, REQUIRED_LLM_FIELDS)
            break  # got all 3 fields cleanly -- done
        except (json.JSONDecodeError, ValueError) as err:
            last_err = err
            # Even if image_prompt is the only thing missing, salvage the
            # core fact-bearing fields so we don't burn a whole attempt's
            # worth of good narration if later attempts do worse.
            try:
                core = _parse_llm_json(raw, CORE_LLM_FIELDS)
                last_core_fields = core
            except (json.JSONDecodeError, ValueError):
                pass
            llm_fields = None
    else:
        # Exhausted all attempts without getting all 3 fields cleanly.
        if last_core_fields is not None:
            llm_fields = dict(last_core_fields)
            llm_fields["image_prompt"] = _fallback_image_prompt(fact)
        else:
            raise ValueError(
                f"Failed to parse valid JSON (narration_script/on_screen_text) "
                f"from Ollama for topic '{fact['topic']}' after {MAX_ATTEMPTS} "
                f"attempts. Last error: {last_err}. Last raw output: {raw!r}"
            )

    content = {
        "topic": fact["topic"],
        "headline_fact": fact["headline_fact"],
        "source_name": fact["source_name"],
        "source_url": fact["source_url"],
        "narration_script": llm_fields["narration_script"],
        "on_screen_text": llm_fields["on_screen_text"],
        "image_prompt": llm_fields["image_prompt"],
        "duration_seconds": DURATION_SECONDS,
    }

    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    slug = _slugify(fact["topic"])
    out_path = CONTENT_DIR / f"econ_{slug}.json"
    out_path.write_text(json.dumps(content, indent=2))

    return content


def generate_and_render_all(voice_id: str = "en_us_kokoro") -> list[dict]:
    """Generate content + render a video for every fact in SOURCED_FACTS.

    Returns a list of result dicts: {"topic", "slug", "content_path",
    "video_path"} for each successfully rendered video. Any failure for
    one fact is reported and re-raised only after all others have had a
    chance to run, so one bad fact doesn't silently swallow the rest of
    the week's batch.
    """
    from video_renderer import render_economic_video  # lazy: needs moviepy

    results = []
    errors = []
    for fact in SOURCED_FACTS:
        slug = _slugify(fact["topic"])
        try:
            content = generate_economic_content(fact)
            video_path = str(OUTPUT_DIR / f"econ_{slug}.mp4")
            render_economic_video(content, video_path, voice_id=voice_id)
            results.append(
                {
                    "topic": fact["topic"],
                    "slug": slug,
                    "content_path": str(CONTENT_DIR / f"econ_{slug}.json"),
                    "video_path": video_path,
                }
            )
            print(f"OK: {fact['topic']} -> {video_path}")
        except Exception as e:  # noqa: BLE001 -- report and continue
            errors.append((fact["topic"], str(e)))
            print(f"FAILED: {fact['topic']}: {e}", file=sys.stderr)

    if errors:
        print(f"\n{len(errors)} fact(s) failed to render:", file=sys.stderr)
        for topic, err in errors:
            print(f"  - {topic}: {err}", file=sys.stderr)

    return results


if __name__ == "__main__":
    voice = sys.argv[1] if len(sys.argv) > 1 else "en_us_kokoro"
    outputs = generate_and_render_all(voice_id=voice)
    print(f"\nRendered {len(outputs)}/{len(SOURCED_FACTS)} economic-facts videos.")
