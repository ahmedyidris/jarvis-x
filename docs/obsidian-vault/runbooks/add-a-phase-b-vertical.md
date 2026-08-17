---
title: How to add a Phase B vertical
---

# How to add a Phase B vertical

Full version: `docs/DEVELOPMENT.md` (outside this vault). Short version here, wikilinked to the real examples.

1. Decide letters-shaped ([[letters]], LLM may invent) vs. economic-facts-shaped ([[economic-facts]]/[[commodities-macro]]/[[geopolitical-risk]], LLM may only script around a pre-sourced fact) — explicitly, don't default to "invents."
2. Source real facts by hand via `WebSearch` before writing code. Check for overlap with existing verticals first — see [[geopolitical-risk]]'s "deliberately avoids overlap" note for why this matters.
3. Copy an existing generator's structure exactly (`commodities_macro_generator.py` or `geopolitical_risk_generator.py` are the cleanest templates — `economic_facts_generator.py` is the original).
4. Add one thin wrapper to `video_renderer.py`. Never touch `render_video()` itself.
5. **Manually read every generated JSON against its source fact before trusting it** — see [[geopolitical-risk]]'s known-issues note. This is not optional; the shared validation doesn't catch fabricated numbers.
6. Render at least one full video, verify with `ffprobe` (real streams, nonzero duration) — not just "the script exited 0."
7. Update the four docs every prior vertical updated (`automation/phase-b/CONTEXT.md`, both stage `CONTEXT.md` files, `_config/voices.md`) — and this vault: a new page under [[system-overview]]'s vertical list, linked from `index.md`.
