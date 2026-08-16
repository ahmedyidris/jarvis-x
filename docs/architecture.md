# Jarvis X — Architecture

*Written 2026-08-16, grounded against the actual filesystem and running system, not transcribed from an earlier plan. See `CONTEXT.md` for narrower "verified as of" operating constraints this doc summarizes into a fuller picture.*

## System overview — three separate systems, one repo

Jarvis X is not one monolithic agent. It's three genuinely separate systems sharing a git repo, a kill-switch file, and (for two of the three) an Ollama instance. Confusing one for another is the single most common mistake when working on this codebase — **`code/router.js` and `code/router.py` are not the same thing**, despite the name.

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. WEB CHAT (what a human actually uses day to day)                │
│                                                                       │
│   Browser (web/, PWA) ──HTTP──> app.py (FastAPI, supervised)         │
│                                    │                                 │
│                                    ├─> hermes.py (HermesCore)        │
│                                    │     └─> code/router.py          │
│                                    │           └─> Ollama (local     │
│                                    │               qwen2.5:3b/7b —   │
│                                    │               100% local, no    │
│                                    │               cloud fallback)   │
│                                    ├─> code/tts_engine.py (voice)    │
│                                    ├─> code/stt_engine.py (mic)      │
│                                    └─> STOP_FILE.exists() check      │
│                                          (own copy, same file path)  │
│                                                                       │
│  2. JS AGENT-AUTONOMY (unattended, self-directed action loop)       │
│                                                                       │
│   code/agent.js  ──┐                                                │
│   code/scheduler.js├──> code/validate.js (structural gate)           │
│                     │        │                                       │
│                     │        v                                       │
│                     └──> code/guard.js (kill switch + audit log)    │
│                              │                                       │
│                              v                                       │
│                          code/lib.js execute()                      │
│                              ├─> code/exec.js (jailed file ops)      │
│                              ├─> code/shell.js (allowlisted spawn)   │
│                              └─> code/router.js ─> gemini.js/local.js│
│                                     (Gemini flash/pro/max tiers,     │
│                                      gated by classify())            │
│                                                                       │
│  3. PHASE B (batch video generation, no agent loop at all)          │
│                                                                       │
│   automation/phase-b/*_generator.py (4 verticals)                    │
│      └─> Ollama (scripts narration ONLY — never sources a fact)     │
│      └─> video_renderer.py ─> code/tts_engine.py ─> MoviePy MP4      │
└─────────────────────────────────────────────────────────────────────┘
```

**Not part of Jarvis X**, despite living in this same git repo: `sentinel/` (a separate portfolio project, an AI incident-response copilot — its own FastAPI app, own LangGraph agent, no kill switch, no `guard.js`), `automation/n8n/` (untracked-from-plans, not evaluated as part of this system), `~/.openjarvis/` (a coincidentally-similar-named unrelated third-party tool, not even in this repo).

**Built but not wired in:** `packages/model-gateway` + `code/gateway-adapter.js` — a fully tested (47/47) standalone package for multi-provider routing/circuit-breaking/budget/telemetry. Deliberately not connected to system 2 above. See `DECISION_RECORD_model-gateway.md` for the full reasoning — short version: it was built against an already-outdated snapshot of `guard.js`, and the real bugs it would have prevented were found and fixed directly and more simply instead.

## Data flow: user prompt → decision → (optionally) video

**Path A — a person asks Jarvis something (system 1, the actual daily-use path):**
1. Browser sends `POST /api/ask` to `app.py`.
2. `app.py` checks `STOP_FILE.exists()` implicitly is not gating `/api/ask` directly today (only `/api/killswitch` reads/writes the flag) — see "Kill switch" below for the gap this leaves.
3. `hermes.py`'s `HermesCore` resolves a tier (`local`/`quality`) via `code/router.py`, calls Ollama, logs the exchange to `~/.hermes/state.db` (SQLite).
4. If `speak: true`, `code/tts_engine.py` synthesizes a reply (Piper/Kokoro/EGTTS depending on `voice_id`) and `app.py` serves it back as a file URL.
5. Response returns to the browser as JSON; no human-approval gate exists on this path — it's a chat interface, not an autonomous-action loop.

**Path B — the JS agent proposes and takes an action (system 2, unattended/self-directed):**
1. `agent.js` (interactive, human present) or `scheduler.js` (unattended, on a timer) builds a prompt asking the model to emit one JSON action (`list`/`read`/`write`/`shell`/`query`/`answer`).
2. `code/validate.js` structurally rejects malformed proposals before anything else runs.
3. `code/router.js`'s `classify()` decides a tier: `quick`/`hard`/`consequential` — the last one is the human-approval gate, and it's decided **by the action type/prompt, never by which model ultimately answered** (a degraded fallback must never silently skip the gate).
4. `agent.js` shows the proposal and waits for a literal `y/n` before executing anything non-`read`-like. `scheduler.js` never has a human present, so it hard-codes the same idea structurally: only `list`/`read`/`git_log`/`git_status`/`answer` may auto-run; `write`/`shell` always go to `logs/queue.jsonl` for a human to review by hand later, never executed unattended.
5. `code/lib.js`'s `execute()` is the actual execution engine — it checks the kill switch (`isStopped()`) before running *any* action type, then dispatches: `read`/`write`/`list` through `code/exec.js`'s jailed `safePath()` (symlink-safe), `shell` through `code/shell.js`'s allowlisted `spawnSync` (no shell string ever reaches `/bin/sh`).
6. Every action — allowed or refused — is appended to `logs/actions.jsonl` via `code/guard.js`.

**Path C — Phase B generates a video (system 3, no live agent loop, offline batch):**
1. A human (or an agent session, once) sources real facts via the `WebSearch` tool and hardcodes them as a vertical's `SOURCED_FACTS` list — the local LLM is **never** the source of a claimed fact for the three factual verticals (`economic_facts`, `commodities_macro`, `geopolitical_risk`); only `letters` (kids' content) lets the LLM invent freely, by design.
2. A `*_generator.py` script prompts Ollama to write narration/caption *around* one given fact, with an explicit instruction not to add any number/claim not already present — validated structurally (non-empty required JSON fields), but **not yet validated for numeric fidelity to the source fact** (see `REMAINING_WORK.md` — a real gap found and manually worked around while building the `geopolitical_risk` vertical).
3. `video_renderer.py`'s one shared `render_video()` function (thin per-vertical wrappers only choose font sizes/voice) synthesizes narration via `code/tts_engine.py`, composites background + headline + caption via MoviePy, and writes an MP4.

## Kill-switch mechanism — where the guarantee actually lives

**The file:** `.jarvis-x-STOP` at the repo root (`code/guard.js`'s `STOP_FILE` constant). *Not* `~/.jarvis-x/STOP` — that path is stale and still appears in `NOTES.md`/`JARVIS_X_STATUS_SNAPSHOT.md`/`knowledge/Guidelines.md` (historical logs, and one Edit-denied file this session couldn't fix directly).

**Two independent enforcement points check the same file:**
- `code/guard.js`'s `isStopped()`/`guard()` — the JS agent-autonomy path (system 2). `guard()` throws before running its wrapped function if the file exists; `code/lib.js`'s `execute()` additionally calls `isStopped()` directly for every action type (fixed this session — previously the `agent.js` path didn't check it at all).
- `app.py`'s own `STOP_FILE.exists()` check, used by `GET`/`POST /api/killswitch` to report/toggle the switch.

**Resolved 2026-08-16:** `app.py`'s `/api/ask` now checks `STOP_FILE.exists()` at the top of the handler and returns `503` if the switch is set — closing what was previously a silent exception (chat kept working while the switch halted the JS agent-autonomy path). Decision: `CONSTITUTION.md`'s kill-switch guarantee ("Jarvis halts... all running processes exit cleanly") carves out no exception for chat, and `/api/killswitch` already checks this exact file in this exact app — a kill switch that quietly excludes one path undermines the "one tap, everything stops" property the whole mechanism exists for. Verified live: baseline `/api/ask` works, setting the switch returns `503`, clearing it restores normal `200` responses.

**`guard()` is convention-only, not a sandbox.** Both enforcement points above are cooperative checks a well-behaved caller makes — a stray raw `fs`/`subprocess` call anywhere in the codebase that bypasses `guard()`/`STOP_FILE.exists()` would not be stopped by anything. This is a documented, accepted limitation (`NOTES.md`: *"A deny rule protects a path through one tool, not the path itself... same shape as guard.js: a convention that holds because the caller cooperates, not a sandbox."*), not something achievable without an actual OS-level sandbox.

## Where the guardrails live (and why some can't be fixed by an AI session)

`~/.claude/settings.json`'s global `permissions.deny` list blocks `Edit`/`Write` on `code/guard.js`, `code/validate.js`, `knowledge/Guidelines.md`, `memory/rules.md` — deliberately, so whatever can edit its own code cannot edit its own constraints. `~/.jarvis-x/.env` is additionally Read-denied (an agent can't even read secrets back out after a human fills them in). This is why several real doc bugs (e.g. `Guidelines.md`'s stale kill-switch path) get *found and flagged* by an AI session rather than fixed directly — the guardrail is working as designed.
