---
title: System Overview
---

# System Overview

Full detail lives in `docs/architecture.md` (outside this vault) — this page is the wikilink-navigable summary.

Jarvis X is three separate systems sharing one repo, one kill-switch file, and (for two of the three) one local Ollama instance:

## 1. Web chat
`app.py` (FastAPI) + `web/` (React/Vite PWA). 100% local — Ollama `qwen2.5:3b`/`7b` via `code/router.py`, voice in/out via `code/stt_engine.py`/`code/tts_engine.py`. Served under `supervisord` (`config/supervisord.conf`), which as of 2026-08-31 runs three programs: `hermes-api` (uvicorn `app:app`), `ollama`, and `tts-worker` (Chatterbox Egyptian-Arabic voice clone — see [[chatterbox-egyptian-voice-clone]]).

**Two coexisting frontends**, both served from `app.py`'s existing SPA-fallback route (no backend changes needed for the second one): the React/Vite PWA (`web/`) and a standalone HUD (`dashboard/dashboard.html` + `jarvis_data.js`, symlinked into `web/dist/dashboard/`), which has its own voice-interactive "TALK TO JARVIS" flow (record → `/api/transcribe` → `/api/ask` → play back `/api/audio/*`) and 4 visual states (idle/listening/thinking/speaking). `jarvis_data.js`'s live fields (stats/weather/connectors) are polled from the sibling `jarvis-dashboard` repo's own FastAPI backend (`127.0.0.1:8002`), not invented — see `2026-08-31-tool-inventory.md`.

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
