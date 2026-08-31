---
title: deepagents not wired in
date: 2026-08-31
status: decided (NO-GO)
---

# Decision: leave `langchain-ai/deepagents` unwired

**Question:** should `deepagents` (LangChain's Python agent framework — planning,
filesystem, sub-agents, skills, built on LangGraph) replace or sit alongside
`code/agent.js` (JS agent-autonomy loop) or `hermes.py`/`router.py` (Python
chat backend)?

**Decision: NO-GO.** Cloned to `~/repos/deepagents` (outside this repo) for
reference only — vetted (legit, LangChain org, no security issues), just not
integrated.

**Why:** this is the same shape of decision as
[[model-gateway-not-wired]] (full writeup: `../../../DECISION_RECORD_model-gateway.md`),
and that record's reasoning applies without modification:

1. `code/agent.js` and `hermes.py`/`router.py` are working, tested, minimal,
   already fixed where real bugs were found (gate bypass, kill-switch
   checks) directly in the callers rather than via a new abstraction layer.
2. Wiring in `deepagents` means introducing a new multi-file Python
   dependency chain (LangGraph, its own planning/sub-agent/tool-use loop)
   to replace working direct calls — the exact pattern the model-gateway
   decision rejected, and deepagents is *less* tailored to this project than
   model-gateway was (that one was purpose-built for jarvis-x; this one is a
   generic third-party framework).
3. This project's own operating rule — "No architectural rewrites — extend
   existing patterns, don't invent new ones" — cuts against this the same
   way it did against model-gateway.

**Status:** not built into this repo at all (no caller migration was even
attempted, unlike model-gateway's now-excluded `worktree-model-gateway`
branch). If a real need for LangGraph-style planning/sub-agents ever
materializes here, revisit then — starting from this note and
`model-gateway-not-wired`'s reasoning, not from scratch.
