#!/usr/bin/env python3
"""
Phase B — Geopolitical Risk Generator (Week 4)

Same shape as Week 2/3 (economic_facts_generator.py / commodities_macro_generator.py),
same hard rule: the local qwen2.5:3b model is NEVER the source of a fact, only
the narrator around one. See economic_facts_generator.py's module docstring
for the full rationale -- not repeated here verbatim; this file reuses its
helpers directly.

Pipeline, in order:
  1. Real, current facts on 5 geopolitical flashpoints (Red Sea/Houthi
     shipping attacks, Taiwan Strait tensions, US-China trade tariffs, Suez
     Canal traffic, South China Sea/Philippines tensions) were found via the
     WebSearch tool on 2026-08-16 (see SOURCED_FACTS below for the exact
     source per fact). Each carries a real source_name + source_url actually
     returned by a search.
  2. Hardcoded here as SOURCED_FACTS. This script does not call WebSearch
     itself -- same human/agent-in-the-loop split as the other verticals.
  3. qwen2.5:3b scripts narration_script/on_screen_text/image_prompt AROUND
     each given fact, forbidden from adding any claim not already present.
  4. source_name/source_url are kept on every output JSON for traceability.

Deliberately avoids overlap with existing verticals: commodities_macro's oil
fact already covers the Iran/Strait-of-Hormuz angle and its wheat fact
already covers the Black Sea/Ukraine grain-export angle -- this vertical's
Red Sea fact is a distinct event (a direct Houthi attack on a commercial
vessel in the Bab el-Mandeb Strait, not the Hormuz/Iran story), and no
Ukraine/Russia fact was added here for the same reason.

Schema produced by generate_geopolitical_risk_content() per fact -- matches
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

# Reuse Week 1's Ollama-calling helpers unmodified, same as the other verticals.
from content_generator import (
    MODEL,
    OLLAMA_URL,
    _atomic_write_json,
    _call_ollama,
    _detect_json_format_support,
    _extract_json_object,
    enforce_numeric_fidelity,
)

CONTENT_DIR = Path(__file__).parent / "stages" / "01_source_content" / "output" / "geopolitical_risk"
OUTPUT_DIR = Path(__file__).parent / "stages" / "02_render_video" / "output" / "geopolitical_risk"

# Same reasoning as the other two economic-facts-shaped verticals: a fact +
# 2-4 sentences of narration comfortably fits 25s without feeling rushed.
DURATION_SECONDS = 25

REQUIRED_LLM_FIELDS = {"narration_script", "on_screen_text", "image_prompt"}
CORE_LLM_FIELDS = {"narration_script", "on_screen_text"}
MAX_ATTEMPTS = 3

# ---------------------------------------------------------------------------
# SOURCED_FACTS -- the ONLY facts this pipeline is allowed to turn into
# videos. Each found via the WebSearch tool on 2026-08-16 (today, per this
# session). Queries used: "Red Sea shipping Houthi attacks August 2026",
# "Taiwan China tensions August 2026", "US China trade tariffs August 2026",
# "Suez Canal shipping traffic 2026", "South China Sea Philippines tensions
# 2026".
# ---------------------------------------------------------------------------
SOURCED_FACTS = [
    {
        "topic": "Red Sea shipping attacks",
        "headline_fact": (
            "In August 2026, Houthi rebels struck the Egyptian-owned, "
            "Tanzania-flagged cargo ship Tihamah in the Bab el-Mandeb "
            "Strait, killing six people -- four crew members and two "
            "rescuers -- marking the first commercial shipping deaths from "
            "Houthi strikes since the previous fall, just as carriers "
            "including CMA CGM and Maersk had cautiously begun returning to "
            "the Red Sea."
        ),
        "source_name": "WWD / Sourcing Journal",
        "source_url": (
            "https://wwd.com/sourcing-journal/logistics/"
            "red-sea-deadly-houthi-attack-shipping-risks-return-"
            "strait-of-hormuz-oman-1239122428/"
        ),
    },
    {
        "topic": "Taiwan Strait tensions",
        "headline_fact": (
            "Japan's newly released defense white paper states China has "
            "intensified military activity around Taiwan and that the "
            "military balance between China and Taiwan is 'rapidly tilting "
            "in China's favor'; separately, Taiwan launched its annual "
            "ten-day military exercises in 2026 mobilizing its largest-ever "
            "call-up of reservists to prepare for a potential Chinese "
            "invasion."
        ),
        "source_name": "American Enterprise Institute (China & Taiwan Update)",
        "source_url": "https://www.aei.org/commentary/china-taiwan-update-august-7-2026/",
    },
    {
        "topic": "US-China trade tariffs",
        "headline_fact": (
            "On August 11, 2026, President Trump announced a further "
            "90-day pause on raising the reciprocal tariff on Chinese goods "
            "to 125%; separately, a new 12.5% Section 301 tariff took "
            "effect July 24, 2026 over China's failure to enforce a forced-"
            "labor import ban, pushing the effective US tariff rate on many "
            "Chinese goods to close to 30% -- the highest of any country."
        ),
        "source_name": "China Briefing / Tax Foundation (Tariff Tracker)",
        "source_url": "https://www.china-briefing.com/news/us-china-relations-in-the-trump-2-0-implications/",
    },
    {
        "topic": "Suez Canal traffic",
        "headline_fact": (
            "In the first week of 2026, Suez Canal container ship transits "
            "were still about 60% below the same week in 2023, with "
            "January 2026 registering the weakest January traffic in a "
            "decade (150 transits, down 16.7% year-over-year); CMA CGM and "
            "Maersk began cautiously returning services to the canal in "
            "late 2025/early 2026 after more than two years of Red Sea "
            "diversions around the Cape of Good Hope."
        ),
        "source_name": "Splash247 / BIMCO (Shipping Number of the Week)",
        "source_url": "https://www.bimco.org/news-insights/market-analysis/shipping-number-of-the-week/2026/0107-snow/",
    },
    {
        "topic": "South China Sea tensions",
        "headline_fact": (
            "China and the Philippines clashed three times in a single "
            "week in July 2026 at Scarborough Shoal and Second Thomas "
            "Shoal, prompting joint US-Philippines-Japan maritime drills; "
            "diplomatically, the two sides met in Cebu in January 2026 "
            "after nearly a year of frozen dialogue, reporting progress on "
            "a coast guard memorandum of understanding across three rounds "
            "of talks since."
        ),
        "source_name": "Fulcrum (Asialink)",
        "source_url": "https://fulcrum.sg/between-talks-and-tensions-why-the-south-china-sea-wont-stabilise-in-2026/",
    },
]


def _slugify(topic: str) -> str:
    return topic.strip().lower().replace(" ", "-").replace("--", "-").replace("(", "").replace(")", "").replace("/", "-")


def _build_prompt(fact: dict) -> str:
    return f"""You are scripting a short-form geopolitical-risk news video for a
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
  source by name, e.g. "According to {fact['source_name']}..."). Adult,
  measured news tone -- no sensationalism, no invented numbers or claims
  beyond the fact given.
- "on_screen_text": one short, punchy on-screen caption (under ~15 words)
  summarizing the sourced fact for a vertical video, using only numbers/
  claims present in the fact above.
- "image_prompt": one line describing an accompanying illustration/photo
  for a future image-generation step (not generated now, just described) --
  should visually relate to the topic (e.g. a container ship, a strait on a
  map, a coast guard vessel) without depicting any specific real person or
  a real military unit/flag in an inflammatory way.

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
    """Same rationale as the other verticals: invents no fact, just a
    generic illustration direction from the topic label."""
    return f"A simple, neutral editorial illustration representing the topic: {fact['topic']}."


def generate_geopolitical_risk_content(fact: dict) -> dict:
    """Turn one already-sourced fact dict into full video content JSON.

    Identical retry/fallback logic to economic_facts_generator.py's
    generate_economic_content() / commodities_macro_generator.py's
    generate_commodities_macro_content() -- see either's docstring for the
    full rationale.
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
    out_path = CONTENT_DIR / f"georisk_{slug}.json"
    _atomic_write_json(out_path, content)

    return content


def generate_and_render_all(voice_id: str = "en_us_kokoro") -> list[dict]:
    """Generate content + render a video for every fact in SOURCED_FACTS.

    Same all-or-continue behavior as the other verticals: one bad fact is
    reported and doesn't swallow the rest of the batch.
    """
    from video_renderer import render_geopolitical_risk_video  # lazy: needs moviepy

    results = []
    errors = []
    for fact in SOURCED_FACTS:
        slug = _slugify(fact["topic"])
        try:
            content = generate_geopolitical_risk_content(fact)
            video_path = str(OUTPUT_DIR / f"georisk_{slug}.mp4")
            render_geopolitical_risk_video(content, video_path, voice_id=voice_id)
            results.append(
                {
                    "topic": fact["topic"],
                    "slug": slug,
                    "content_path": str(CONTENT_DIR / f"georisk_{slug}.json"),
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
    print(f"\nRendered {len(outputs)}/{len(SOURCED_FACTS)} geopolitical-risk videos.")
