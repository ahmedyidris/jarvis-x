# Phase B — Automated Short-Form Video Pipeline

Layer 1 (workspace routing) contract. This is an Interpretable Context
Methodology (ICM) workspace: numbered `stages/` folders, each with its own
`CONTEXT.md` contract, separating persistent reference material
(`_config/`) from per-run working artifacts (each stage's `output/`).

## What this pipeline is

Generates short-form (9:16 vertical, ~15-25s) MP4 videos end to end —
content scripting, then rendering — entirely with local tools (Ollama
`qwen2.5:3b`, the local TTS engine, MoviePy). Four verticals exist today:

- **letters** — Week 1. Kids' educational "letter of the day" videos
  (e.g. "A is for Apple!"). LLM-invented content, no factual constraint.
- **economic_facts** — Week 2. Short economic-news-style videos for a
  general adult audience, built around real, WebSearch-sourced facts. The
  local LLM is never allowed to invent the fact itself — see stage 01's
  contract for the exact rule and why it exists.
- **commodities_macro** — Week 3. Same economic-facts-shaped rule as
  above, covering 5 core commodities (oil, natural gas, copper, gold,
  wheat) and 2 US macro data releases (jobs report, CPI inflation).
  Deliberately excludes a Fed-rate/FOMC fact since economic_facts already
  carries the most recent one — see commodities_macro_generator.py's
  module docstring.
- **geopolitical_risk** — Week 4. Same economic-facts-shaped rule, 5
  flashpoints (Red Sea/Houthi shipping attacks, Taiwan Strait tensions,
  US-China trade tariffs, Suez Canal traffic, South China Sea tensions).
  **2 of the first 5 LLM-scripted outputs invented a specific number not
  present in the sourced fact** (a fabricated "40%" and a fabricated
  "29.5%") despite the explicit anti-invention instruction — caught by
  manual review, not by the automated JSON-shape validation (which checks
  structure, not numeric fidelity), and hand-corrected before shipping. See
  `geopolitical_risk_generator.py`'s module docstring and
  `REMAINING_WORK.md` for the full note — this is a real, general gap in
  the pattern all economic-facts-shaped verticals share, not unique to this
  one; every vertical's LLM output should be spot-checked against its
  source fact before shipping until an automated check exists.

## Pipeline stages

| Stage | Folder | Contract |
|---|---|---|
| 1. Source content | `stages/01_source_content/` | `stages/01_source_content/CONTEXT.md` |
| 2. Render video | `stages/02_render_video/` | `stages/02_render_video/CONTEXT.md` |

Data flows one direction: stage 01's `output/<vertical>/*.json` is the only
input stage 02 reads; stage 02's `output/<vertical>/*.mp4` is the pipeline's
final artifact.

## Where the code lives

The three Python scripts stay at this top level (`automation/phase-b/`),
not inside the stage folders — only their *data* (inputs/outputs) is
organized by stage:

- `content_generator.py` — letters vertical, stage 01.
- `economic_facts_generator.py` — economic_facts vertical, stage 01 (also
  calls into stage 02's `video_renderer.py` for its `generate_and_render_all()`
  convenience entrypoint).
- `commodities_macro_generator.py` — commodities_macro vertical, stage 01,
  same shape as economic_facts_generator.py (also calls into stage 02 the
  same way).
- `geopolitical_risk_generator.py` — geopolitical_risk vertical, stage 01,
  same shape as the other economic-facts-shaped verticals.
- `video_renderer.py` — stage 02, shared by all four verticals via one
  generic `render_video()` function (see `stages/02_render_video/CONTEXT.md`).

## Persistent reference material

- `_config/voices.md` — the voice-per-vertical mapping, referenced by
  stage 02's contract. This is "configured once, reused every run" data,
  not a per-run artifact, hence its own top-level `_config/` rather than
  living inside a stage's `output/`.

## Adding a new vertical

1. Decide letters-shaped (LLM may invent) vs. economic_facts-shaped (LLM
   may only script around a pre-sourced, traceable fact) — see stage 01's
   "New vertical checklist".
2. Add a `generate_<vertical>_content()`-style function (new small
   generator script, or extend an existing one) that writes to
   `stages/01_source_content/output/<vertical>/*.json`.
3. Add a thin `render_<vertical>_video()` wrapper around stage 02's
   `render_video()`, choosing `headline_field`/font sizes/voice — do not
   fork the composition logic itself.
4. Point a future subagent dispatch at this file plus
   `stages/01_source_content/CONTEXT.md` and
   `stages/02_render_video/CONTEXT.md` instead of re-explaining the
   constraints from scratch.

## Running

All Python here runs via `/home/ahmedyidris/venv-ai/bin/python3`, e.g.:
```
/home/ahmedyidris/venv-ai/bin/python3 content_generator.py A
/home/ahmedyidris/venv-ai/bin/python3 video_renderer.py A
/home/ahmedyidris/venv-ai/bin/python3 economic_facts_generator.py
```

## Out of scope for this workspace

This is entirely within `automation/phase-b/` — it does not touch the
live, systemd-supervised backend (`app.py`, `config/supervisord.conf`, the
`jarvis-supervisord.service` unit) or the frontend (`web/`). See the repo
root's `/home/ahmedyidris/jarvis-x/CONTEXT.md` for those operating
constraints.
