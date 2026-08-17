---
title: System Overview
---

# System Overview

Full detail lives in `docs/architecture.md` (outside this vault) — this page is the wikilink-navigable summary.

Jarvis X is three separate systems sharing one repo, one kill-switch file, and (for two of the three) one local Ollama instance:

## 1. Web chat
`app.py` (FastAPI) + `web/` (React/Vite PWA). 100% local — Ollama `qwen2.5:3b`/`7b` via `code/router.py`, voice in/out via `code/stt_engine.py`/`code/tts_engine.py`. Served under `supervisord` (`config/supervisord.conf`).

Kill-switch: see [[api-ask-kill-switch-gating]].

## 2. JS agent-autonomy loop
`code/agent.js` (human present) + `code/scheduler.js` (unattended, read-only only). Every action passes through `code/validate.js` (structural gate) → `code/guard.js` (kill switch + audit log) → `code/lib.js`'s `execute()` (jailed via `code/exec.js`, allowlisted shell via `code/shell.js`). Tier-routed to Gemini via `code/router.js`/`code/gemini.js`, gated on `'consequential'` actions.

Related decision: [[model-gateway-not-wired]] — a fully-built, better-architected version of this routing layer exists (`packages/model-gateway`) but isn't connected.

## 3. Phase B — video pipeline
`automation/phase-b/`. Batch content generation, no live agent loop. Four verticals: [[letters]], [[economic-facts]], [[commodities-macro]], [[geopolitical-risk]].

## Not part of Jarvis X
`sentinel/` (separate incident-response portfolio project, verified this session to genuinely work end-to-end against live Ollama) and `automation/n8n/`, despite sharing this git repo.

## Deployment
See [[docker-single-container]] for why the Docker image runs Ollama + `hermes-api` in one container rather than two separate compose services.
