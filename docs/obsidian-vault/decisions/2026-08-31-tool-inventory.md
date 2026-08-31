---
title: tool inventory (Phase 0 of JARVIS_X_INTEGRATION_RUN.md)
date: 2026-08-31
status: audit only -- no integration decisions made here
---

# Tool inventory — everything in ~/repos/, categorized

Verified against the live `ls /home/ahmedyidris/repos` listing at write time (44 entries), not
trusted from memory. Four buckets, one line each with a reason. This is Phase 0's deliverable —
it decides nothing about Phase 1; see the GATE in `../../../JARVIS_X_INTEGRATION_RUN.md`.

## 1. Dev-tooling (for working ON jarvis-x via Claude Code, not a Jarvis-X capability)

- `code-review-graph` — Tree-sitter codebase graph for Claude Code navigation.
- `claude-code-router` — routes Claude Code requests to other LLM providers; a Claude-Code-session tool, not something Jarvis-X's own runtime calls.
- `claude-task-master` — MCP task/spec breakdown for Claude Code sessions.
- `claude-code-templates` — CLAUDE.md/agent/hook scaffolding CLI.
- `SuperClaude_Framework` — slash-command/persona layer on top of Claude Code itself.
- `caveman` — Claude Code output-compression skill + proxy.
- `free-claude-code` — multi-provider router for Claude Code's own CLI traffic.
- `claude-token-optimizer`, `claude-token-efficient`, `token-optimizer` (alexgreensh) — Claude Code output/verbosity templates and a token-usage optimizer, all aimed at *this* tool, not Jarvis-X.
- `claude-context` (Zilliz) — semantic code search MCP server for a coding session.
- `claude-usage` — local Claude Code usage/cost dashboard.
- `superpowers-lab`, `superpowers-developing-for-claude-code` — Claude Code skill-authoring/experimental skills.

## 2. Standalone personal tools (useful to Ahmed directly, not a Jarvis-X capability)

- `Jarvis-Desktop-Voice-Assistant` — a different, unrelated voice-assistant project (name collision only).
- `ai-job-search` — personal job-hunt automation, run on its own.
- `strix` — AI pentesting agent; run only against apps Ahmed owns, in an isolated container.
- `book-to-skill` — converts a book/PDF into a Claude skill; use only the exact `virgiliojr94` org (a malicious lookalike fork exists under a different org).
- `opencut` — standalone video editor.
- `open-seo` — SEO tooling for a website, if Ahmed runs one.
- `postiz-app` — social media scheduler, only relevant if Jarvis-X is later given social-posting scope.
- `hyperframes` (HeyGen) — HTML-to-video renderer, niche.
- `MoneyPrinterTurbo` — AI video-generation pipeline, standalone.
- `FinceptTerminal` — financial terminal; repo is clean, but the commercial `fincept.in` domain was flagged by scam scanners — don't connect real brokerage/payment credentials without checking that separately.
- `Open-Generative-AI` — image/video-gen wrapper around the paid muapi.ai API with no content filtering; ad-tracked homepage link. Real misuse risk (no filters) independent of Jarvis-X.
- `Vibe-Trading` — real HKUDS repo, but has open critical security findings (sandbox isolation, an SSRF-style bug) and an active crypto-token impersonation scam circling the project name. Do not connect real brokerage credentials or trust any associated token/X account.

## 3. Jarvis-X runtime candidates (plausibly a real capability for Jarvis-X itself)

Each flagged `ADDITIVE` (new capability, no existing equivalent) or `OVERLAPS-EXISTING`
(duplicates something `code/agent.js`, `code/router.js`/`.py`, or `hermes.py` already does —
per the model-gateway/deepagents precedent, these default to NO-GO absent an explicit reason).

- `browser-use` — **ADDITIVE**. No existing browser-automation capability in jarvis-x.
- `firecrawl` — **ADDITIVE**. No existing web-scraping/crawling capability.
- `camofox-browser` — **ADDITIVE** capability-wise (anti-fingerprint browsing), but it's a commercial wrapper (jo-inc/"Jo") around the real Camoufox project, with an opt-out telemetry beacon and a cookie-import feature — flag before adopting even if additive.
- `anything-llm` — **OVERLAPS-EXISTING**. Jarvis-X's own `app.py`/`hermes.py` chat path already does local-first LLM chat via Ollama; would need a real gap identified (e.g. multi-document RAG jarvis-x doesn't have) to justify, not just "it exists."
- `open-notebook` — **OVERLAPS-EXISTING** for the same reason as anything-llm, though it's specifically strong at multi-source RAG (PDFs/URLs/YouTube/audio) which jarvis-x's chat path doesn't currently do — closest thing to a real gap in this bucket, still needs an explicit yes.
- `pipecat` — **OVERLAPS-EXISTING**. jarvis-x already has its own voice pipeline (Piper/Kokoro TTS, faster-whisper STT, `code/tts_engine.py`/`stt_engine.py`) wired into a working, tested system. Replacing it with a new framework is exactly the pattern the model-gateway decision rejected.
- `OmniVoice` (k2-fsa) — **OVERLAPS-EXISTING** for the same voice-pipeline reason as pipecat, though its 600+-language claim is a real capability gap (jarvis-x currently only has en_US + ar_JO per `CONTEXT.md`) if multilingual voice ever becomes a real requirement.
- `ai-memory` (akitaonrails) — **OVERLAPS-EXISTING**. jarvis-x already has `knowledge/`, `memory/`, and a Hermes state DB; a second memory system needs a specific gap, not just "it's well-vetted" (it is well-vetted, that's a separate axis from architecture fit).
- `crewai` — **OVERLAPS-EXISTING**. Multi-agent orchestration; jarvis-x's `code/agent.js` already is the agent-autonomy loop. Same category as the already-rejected `deepagents`.
- `cordis` — **OVERLAPS-EXISTING**. Plugin framework; only relevant if jarvis-x adopted a Cordis-based harness wholesale, which is a much bigger decision than "add a plugin system."
- `OmniRoute` — **OVERLAPS-EXISTING** (multi-provider LLM gateway; jarvis-x deliberately stays local-first/no-paid-APIs per `CONTEXT.md`) **and** carries a hardcoded-default-JWT-secret vulnerability — any future case for adopting it must include changing `JWT_SECRET`/setting `STORAGE_ENCRYPTION_KEY` as a precondition, not an afterthought.
- `claude-ads` — **ADDITIVE** only if Jarvis-X is ever given ad-account management as a goal (not a current one). Wants live write-credentials to ad platforms — a real decision, not a default yes.
- `jarvis-dashboard` — **ADDITIVE**. Already deep-dive-reviewed and cleared (real timing-safe auth, sound network topology). Deployment is a separate decision needing Ahmed's phone, Obsidian, and a TLS cert — not blocked on architecture-fit, blocked on "do you want to set this up."

## 4. Not integrating (already decided this session, not pending)

- `deepagents` — NO-GO, documented in `deepagents-not-wired.md`.
- `agency-agents` — already integrated (273 personas at `.claude/agents/`, done).
- `PixelRAG`, `claude-watch`, `token-optimizer-mcp` — already installed as global Claude Code plugins/MCP servers, not Jarvis-X-runtime candidates.
- `skills` (emilkowalski/skills) — already installed as a global Claude Code skill pack.
- `cline` — a separate VS Code coding-assistant product, not a Jarvis-X capability.
- `i-have-adhd`, `no-ai-slop` — already active as global Claude Code skills (installed via `npx skills add --global`); the copies in `~/repos/` are just the source clones used to vet them, not a second pending install.

## Priority suggestion within bucket 3 (a suggestion, not a decision)

Highest-value `ADDITIVE` candidates with no architecture-fit conflict: `browser-use`, `firecrawl`,
`jarvis-dashboard` (deployment-gated, not architecture-gated). Everything else in bucket 3 is
`OVERLAPS-EXISTING` and needs a specific, named gap before it's worth the model-gateway-precedent
risk of adopting a new architectural layer to duplicate something already working and tested.
