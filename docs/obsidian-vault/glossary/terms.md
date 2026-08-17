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
