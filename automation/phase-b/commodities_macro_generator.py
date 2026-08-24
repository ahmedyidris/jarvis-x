#!/usr/bin/env python3
"""
Phase B — Commodities + Macro Generator (Week 3)

Same shape as Week 2's economic_facts_generator.py, same hard rule: the
local qwen2.5:3b model is NEVER the source of a fact, only the narrator
around one. See that file's module docstring for the full rationale — not
repeated here verbatim to avoid drift between two copies of the same
explanation; this file reuses its helpers directly.

Pipeline, in order:
  1. Real, current facts on 5 core commodities (oil, natural gas, copper,
     gold, wheat) and 2 US macro data releases (jobs report, CPI inflation)
     were found via the WebSearch tool on 2026-08-16 (see SOURCED_FACTS
     below for the exact source per fact). Each carries a real
     source_name + source_url actually returned by a search.
  2. Hardcoded here as SOURCED_FACTS. This script does not call WebSearch
     itself — same human/agent-in-the-loop split as economic_facts.
  3. qwen2.5:3b scripts narration_script/on_screen_text/image_prompt AROUND
     each given fact, forbidden from adding any claim not already present.
  4. source_name/source_url are kept on every output JSON for traceability.

Deliberately NOT included: a Fed funds rate / FOMC decision fact.
economic_facts_generator.py's SOURCED_FACTS already carries the July 29,
2026 FOMC hold (the most recent decision — there was no August meeting;
the next is September 15-16) under "US Federal Reserve interest rates".
Duplicating the identical fact into a second vertical would produce two
near-identical videos from one underlying event, so this vertical covers
the two OTHER major US macro prints that aren't already covered anywhere
in Phase B: the jobs report and CPI inflation.

Schema produced by generate_commodities_macro_content() per fact — matches
economic_facts_generator.py's shape exactly (same downstream renderer):
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

# Reuse Week 1's Ollama-calling helpers unmodified, same as economic_facts_generator.py.
from content_generator import (
    MODEL,
    OLLAMA_URL,
    _atomic_write_json,
    _call_ollama,
    _detect_json_format_support,
    _extract_json_object,
    enforce_numeric_fidelity,
)

CONTENT_DIR = Path(__file__).parent / "stages" / "01_source_content" / "output" / "commodities_macro"
OUTPUT_DIR = Path(__file__).parent / "stages" / "02_render_video" / "output" / "commodities_macro"

# Same reasoning as economic_facts_generator.py's DURATION_SECONDS: a fact +
# 2-4 sentences of narration comfortably fits 25s without feeling rushed.
DURATION_SECONDS = 25

REQUIRED_LLM_FIELDS = {"narration_script", "on_screen_text", "image_prompt"}
CORE_LLM_FIELDS = {"narration_script", "on_screen_text"}
MAX_ATTEMPTS = 3

# ---------------------------------------------------------------------------
# SOURCED_FACTS — the ONLY facts this pipeline is allowed to turn into
# videos. Each found via the WebSearch tool on 2026-08-16 (today, per this
# session). Queries used: "crude oil price WTI Brent August 2026", "natural
# gas price Henry Hub August 2026", "copper price August 2026 LME", "gold
# price August 2026 record", "wheat price August 2026 futures", "US jobs
# report nonfarm payrolls August 2026", "US CPI inflation rate July 2026".
# ---------------------------------------------------------------------------
SOURCED_FACTS = [
    {
        "topic": "Crude oil (WTI/Brent)",
        "headline_fact": (
            "Brent crude rose to $88.38 a barrel on August 14, 2026 -- up "
            "about 5% for the week -- as the US escalated economic pressure "
            "on Iran over the Strait of Hormuz, including the threat of a "
            "naval blockade of Iranian ports; WTI crude traded near $82.45 "
            "a barrel over the same period."
        ),
        "source_name": "Trading Economics",
        "source_url": "https://tradingeconomics.com/commodity/brent-crude-oil",
    },
    {
        "topic": "Natural gas (Henry Hub)",
        "headline_fact": (
            "The Henry Hub natural gas spot price stood at $2.79 per "
            "million BTU as of August 11, 2026, per U.S. Energy Information "
            "Administration data."
        ),
        "source_name": "Federal Reserve Economic Data (FRED) / EIA",
        "source_url": "https://fred.stlouisfed.org/series/DHHNGSP",
    },
    {
        "topic": "Copper",
        "headline_fact": (
            "Copper fell to $6.59 a pound on August 14, 2026 (down 0.05% on "
            "the day) but remains up about 47% year-over-year, with traders "
            "citing tightening supply from lower expected output at Chile's "
            "state-owned Codelco and US import tariffs diverting metal into "
            "US warehouses."
        ),
        "source_name": "Trading Economics",
        "source_url": "https://tradingeconomics.com/commodity/copper",
    },
    {
        "topic": "Gold",
        "headline_fact": (
            "Gold futures opened at $4,400 per troy ounce on August 10, "
            "2026 -- their highest opening price since early June -- with "
            "spot prices briefly touching $4,500, driven by geopolitical "
            "tensions and continued central bank buying, particularly from "
            "China."
        ),
        "source_name": "Yahoo Finance",
        "source_url": (
            "https://finance.yahoo.com/personal-finance/investing/article/"
            "gold-prices-today-monday-august-10-2026-highest-opening-price-"
            "since-early-june-123242269.html"
        ),
    },
    {
        "topic": "Wheat",
        "headline_fact": (
            "Wheat futures rose to $6.75 a bushel on August 14, 2026 (up "
            "3.37% on the day), close to the two-year high of $7.08 set on "
            "July 22, after Ukrainian drone strikes halted operations at "
            "Russia's Novorossiysk grain export terminal and consultancy "
            "IKAR cut its 2026/27 Russian wheat export forecast."
        ),
        "source_name": "Trading Economics",
        "source_url": "https://tradingeconomics.com/commodity/wheat",
    },
    {
        "topic": "US jobs report",
        "headline_fact": (
            "The US economy unexpectedly shed 23,000 jobs in July 2026 "
            "(nonfarm payrolls), versus forecasts of an 80,000 gain, with "
            "the unemployment rate at 4.1%; May and June figures were also "
            "revised down by a combined 103,000 jobs. Released August 7, "
            "2026 by the Bureau of Labor Statistics."
        ),
        "source_name": "U.S. Bureau of Labor Statistics",
        "source_url": "https://www.bls.gov/news.release/empsit.htm",
    },
    {
        "topic": "US inflation (CPI)",
        "headline_fact": (
            "US annual inflation slowed to 3.4% in July 2026, down from "
            "3.5% in June -- the second straight monthly slowdown -- with "
            "the consumer price index up 0.1% for the month and core CPI "
            "(excluding food and energy) up 0.2%. Released August 12, 2026."
        ),
        "source_name": "CNBC (Bureau of Labor Statistics data)",
        "source_url": "https://www.cnbc.com/2026/08/12/cpi-inflation-report-july-2026.html",
    },
]


def _slugify(topic: str) -> str:
    return topic.strip().lower().replace(" ", "-").replace("--", "-").replace("(", "").replace(")", "").replace("/", "-")


def _build_prompt(fact: dict) -> str:
    return f"""You are scripting a short-form commodities/macro-economics video for a
general adult audience (NOT children). You are given ONE real, sourced fact
below. Your ONLY job is to write narration and on-screen text AROUND this fact.

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
  should visually relate to the topic (e.g. an oil pump, a gold bar, a
  wheat field) without depicting any specific real person.

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
    """Same rationale as economic_facts_generator.py's version: invents no
    fact, just a generic illustration direction from the topic label."""
    return f"A simple, neutral editorial illustration representing the topic: {fact['topic']}."


def generate_commodities_macro_content(fact: dict) -> dict:
    """Turn one already-sourced fact dict into full video content JSON.

    Identical retry/fallback logic to economic_facts_generator.py's
    generate_economic_content() -- see that function's docstring for the
    full rationale (narration_script/on_screen_text must come from the
    model or this raises; image_prompt alone may fall back deterministically).
    """
    for req in ("topic", "headline_fact", "source_name", "source_url"):
        if not fact.get(req):
            raise ValueError(f"fact is missing required sourced field: {req!r}")

    use_json_format = _detect_json_format_support()

    raw = None
    last_core_fields = None
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
            break
        except (json.JSONDecodeError, ValueError) as err:
            last_err = err
            try:
                core = _parse_llm_json(raw, CORE_LLM_FIELDS)
                last_core_fields = core
            except (json.JSONDecodeError, ValueError):
                pass
            llm_fields = None
    else:
        if last_core_fields is not None:
            llm_fields = dict(last_core_fields)
            llm_fields["image_prompt"] = _fallback_image_prompt(fact)
        else:
            raise ValueError(
                f"Failed to parse valid JSON (narration_script/on_screen_text) "
                f"from Ollama for topic '{fact['topic']}' after {MAX_ATTEMPTS} "
                f"attempts. Last error: {last_err}. Last raw output: {raw!r}"
            )

    llm_fields = enforce_numeric_fidelity(
        fact["headline_fact"], llm_fields, _call_ollama, use_json_format,
        REQUIRED_LLM_FIELDS, MAX_ATTEMPTS,
    )
    # enforce_semantic_fidelity() deliberately NOT wired in here -- see
    # REMAINING_WORK.md P4's 2026-08-24 addendum: the Gemini judge
    # reproduced the same 5/5 false-positive rate on known-faithful
    # content that disqualified the earlier local-model (qwen) attempt.
    # Wiring it in would block every generation, not just bad ones.

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
    out_path = CONTENT_DIR / f"commodmacro_{slug}.json"
    _atomic_write_json(out_path, content)

    return content


def generate_and_render_all(voice_id: str = "en_us_kokoro") -> list[dict]:
    """Generate content + render a video for every fact in SOURCED_FACTS.

    Same all-or-continue behavior as economic_facts_generator.py's version:
    one bad fact is reported and doesn't swallow the rest of the batch.
    """
    from video_renderer import render_commodities_macro_video  # lazy: needs moviepy

    results = []
    errors = []
    for fact in SOURCED_FACTS:
        slug = _slugify(fact["topic"])
        try:
            content = generate_commodities_macro_content(fact)
            video_path = str(OUTPUT_DIR / f"commodmacro_{slug}.mp4")
            render_commodities_macro_video(content, video_path, voice_id=voice_id)
            results.append(
                {
                    "topic": fact["topic"],
                    "slug": slug,
                    "content_path": str(CONTENT_DIR / f"commodmacro_{slug}.json"),
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
    print(f"\nRendered {len(outputs)}/{len(SOURCED_FACTS)} commodities/macro videos.")
