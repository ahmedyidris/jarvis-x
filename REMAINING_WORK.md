# Jarvis X — Remaining Work Backlog
*Generated 2026-08-16 via full-codebase audit (TODO/FIXME scan + doc cross-reference against actual filesystem/git state)*

No `TODO`/`FIXME` markers exist anywhere in the codebase (checked `*.js`/`*.py`/`*.md`/`*.ts`/`*.tsx`, excluding `node_modules`/`.git`) — this repo's convention is dated, reasoned code comments instead, consistent with `NOTES.md`'s own stated practice. This backlog is instead built from cross-referencing every doc's claims against what actually exists on disk and in git history.

## P0 — Deliberately deferred, condition not yet met (DO NOT BUILD)

| Item | Why deferred | Current status |
|---|---|---|
| `code/selfdebug.js` (self-debug loop) | `NOTES.md`: *"Do not build while accuracy is 77%. A self-modifying loop plus a model that picks the right action three times in four is how a repo ends up editing its own constraints. Revisit when the accuracy number is boring."* | Still 77% (24/31 graded correct, confirmed via `scripts/status.sh` this session). **Condition not met — do not build**, despite this task category ("incomplete feature") superficially looking like fair game. |

## P1 — Architecture decision needed (resolved this session, see decision record)

| Item | Finding |
|---|---|
| `packages/model-gateway` + `code/gateway-adapter.js` | Fully built (breaker/budget/store/telemetry, 47/47 tests), but **never wired into `code/agent.js`/`scheduler.js`/`query.js`/`market-brief.js`** — confirmed via grep, referenced only within its own package directory. This was a **deliberate exclusion**, not an oversight: `fdc6d98`'s merge commit explicitly states gateway-adapter.js's caller-migration work was built against a stale `guard.js` snapshot, and that exclusion was "verified with the user." Re-checked this session: `guard.js`'s actual contract (3-arg `guard(action, level, fn)`, already exports `STOP_FILE`) matches what that merge said was already fine — and the two real class-of-bug issues this architecture was meant to prevent (gate bypass, kill-switch not checked) were already found and fixed **directly and minimally** in `agent.js`/`lib.js` this session (`5079aab`), without needing the gateway. See `DECISION_RECORD_model-gateway.md` for the full writeup. **Resolution: NO-GO, leave unwired.**

## P2 — Stale documentation (living docs, not historical logs)

| File | Issue | Action |
|---|---|---|
| `README.md` | Describes `code/models.js` (deleted this session, was already dead before that) as the live routing layer; omits `web/`, `sentinel/`, `automation/phase-b/`, `app.py`, `hermes.py`, `tts_engine.py`, `stt_engine.py`, `packages/model-gateway`, `config/supervisord.conf` entirely — reads as a Week-1 snapshot of a system that's since grown a full FastAPI web app, PWA frontend, video pipeline, and voice stack. Also has the stale `~/.jarvis-x/STOP` kill-switch path. | Rewritten in this session (Phase 6). |
| `Design.md` (line 39) | Same stale `~/.jarvis-x/STOP` kill-switch path reference, in an otherwise-current PWA design spec. | Fix in this session. |
| `knowledge/Guidelines.md` | Same stale kill-switch path (line 13: `~/.jarvis-x/STOP`). Everything else in this file is accurate (verified `gemini.js`'s actual tier/model names match exactly). | **Cannot fix — Edit-denied by this project's own guardrail config.** Flagged for Ahmed to correct by hand, one line: `~/.jarvis-x/STOP` → `.jarvis-x-STOP` (repo root). |

**Not touched, and shouldn't be:** `NOTES.md`, `JARVIS_X_STATUS_SNAPSHOT.md`, `MASTER_PLAN_UPDATED.md`, `docs/superpowers/plans/2026-08-13-chromeos-pwa-interface.md` all contain the same stale path — but these are dated, point-in-time session logs/changelogs, not living reference docs. Editing them to retroactively "fix" a historical record would misrepresent what was actually known at the time (some of them, e.g. `JARVIS_X_STATUS_SNAPSHOT.md`, already explicitly flag this exact bug as a known issue as of 2026-08-13 — rewriting them would erase that trail). `CONTEXT.md` already has the *correct* path and explicitly documents `CONSTITUTION.md`'s (now-fixed) staleness as history — also correctly left alone.

## P3 — Missing architecture documentation

| Doc | Status |
|---|---|
| `docs/architecture.md` | Does not exist. Created this session (Phase 6). |
| `docs/DEVELOPMENT.md` | Does not exist. Created this session (Phase 6). |

## P4 — Phase B expansion opportunity

Three verticals existed (`letters`, `economic_facts`, `commodities_macro`), each documented in `automation/phase-b/CONTEXT.md`'s "Adding a new vertical" checklist. No partially-built 4th/5th vertical found (checked `automation/phase-b/stages/01_source_content/output/` for any directory beyond the three, and `automation/phase-b/*.py` for any half-written generator). Built one more this session (Phase 2): **geopolitical_risk**, same economic-facts-shaped pattern (WebSearch-sourced, hardcoded, no live APIs) — 5 facts (Red Sea/Houthi shipping attacks, Taiwan Strait tensions, US-China trade tariffs, Suez Canal traffic, South China Sea tensions).

**Real finding while building it:** 2 of the first 5 LLM-scripted outputs invented a specific number not present in the sourced fact (a fabricated "40%", a fabricated "29.5%"), despite the prompt's explicit anti-invention instruction. The shared retry/validation logic (used by all three economic-facts-shaped generators) checks JSON shape and non-empty fields, but has **no check for numeric fidelity to the source fact** — this class of error passes silently. Caught this time by manually reading every generated JSON against its source before shipping; hand-corrected the 2 bad ones. Retroactively checked `economic_facts`' and `commodities_macro`'s already-shipped content the same way — both clean, no invented numbers found there. **This is a real gap in the shared pattern, not fixed this session** (would need either an automated fact-fidelity checker — a second LLM pass or regex/number-extraction diff against the source — or a standing rule to always manually spot-check before shipping a new batch). Documented in `geopolitical_risk_generator.py`'s docstring and `automation/phase-b/stages/01_source_content/CONTEXT.md` as a standing caution for future verticals.

## P5 — Correctness audit (this session's earlier fixes + new sweep)

- `code/paper-trading.js`'s always-0 P&L — **already fixed** (`397ea77`, prior turn this session).
- Kill switch (`guard.js`'s `isStopped()`) and `scheduler.js`'s respect for it — **already fixed and verified** this session (`5079aab`: `lib.js`'s `execute()` now checks it for every action type; `scheduler.js`'s gate bug fixed same commit). Re-verified working in this session's Phase 4 (see below).
- Broader sweep for other "always returns a constant/0/null regardless of input" bugs: see Phase 4 findings below.

## Explicitly corrected assumption from the original task brief

The originating instructions assumed `code/router.py` might be "genuinely dead" and asked to kill it if so. **It is not dead** — confirmed via `CONTEXT.md` (already-accurate reference doc) and direct read of `app.py`: `router.py` is the actual, live routing file the real web-chat production path (`app.py` → `/api/ask`) imports and uses (100% local Ollama, `local`/`quality` tiers). This is a *different file* from `code/router.js` (the JS agent-autonomy path, Gemini-tiered) — same name pattern, different systems, explicitly called out in `CONTEXT.md` as "do not conflate." Not touched.
