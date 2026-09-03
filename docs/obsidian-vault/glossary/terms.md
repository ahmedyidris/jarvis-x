---
title: Glossary
---

# Glossary

**Kill switch** — `.jarvis-x-STOP` at the repo root. Its presence halts the JS agent-autonomy path and (since [[api-ask-kill-switch-gating]]) web chat too. See [[debug-the-kill-switch]].

**Guard-convention, not a sandbox** — `code/guard.js`'s enforcement is cooperative: a caller must actually call it. A raw `fs`/`subprocess` call bypassing it entirely wouldn't be stopped by anything. This is documented, accepted, not a bug to "fix" without an actual OS-level sandbox.

**Consequential tier** — `code/router.js`'s `classify()` result for actions requiring human approval (`write`, `shell`, `trade`). Decided by action *level*, never by which model ultimately answered — a degraded fallback must never silently skip the gate.

**P&L (paper trading)** — `code/paper-trading.js`'s mark-to-market calculation. Fixed 2026-08 to actually use live prices when supplied, rather than always computing `0`.

**SOURCED_FACTS** — the hardcoded list of real, WebSearch-found facts in each fact-constrained Phase B generator (`economic_facts_generator.py`, `commodities_macro_generator.py`, `geopolitical_risk_generator.py`). The LLM never invents these — only narrates around them. See [[geopolitical-risk]] for what happens when the narration itself still invents a number.

**Numeric-fidelity gap** — the known, unfixed gap where Phase B's shared validation checks JSON shape but not whether the LLM's narration stayed faithful to its source fact's actual numbers. See [[geopolitical-risk]].

**Two routers** — `code/router.js` (JS agent-autonomy path, Gemini-tiered) and `code/router.py` (the actual web-chat path, 100% local Ollama). Same name, different systems — don't conflate them.

**tts-worker / Chatterbox** — the third `supervisord` program (port 8001), a voice-clone Egyptian Arabic TTS service (`code/tts_worker.py`, `chatterbox-tts` package, checkpoint `voices/chatterbox-eg`). Not the same model as `EGTTS_RESEARCH.md`'s subject (EGTTS-V0.1). See [[chatterbox-egyptian-voice-clone]].

**HUD dashboard** — the standalone `dashboard/dashboard.html` frontend, distinct from the React/Vite PWA in `web/`. Both are served by `app.py`; see [[system-overview]].

**hermes-agent** — a separate third-party CLI tool being integrated as an alt LLM backend/MCP server, unrelated to this repo's own `hermes.py`/`HermesCore` despite the name collision. See [[hermes-agent-integration]].
