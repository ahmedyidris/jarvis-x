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

**2026-08-20 — two more confirmed occurrences in one batch (Phase 1A verification, Task 2):** re-running `geopolitical_risk`'s generator regenerated all 5 facts fresh, and manual review caught **2 of 5** live fidelity defects in this single batch — neither a fabricated digit, but *garbled restatements* of a real claim (broadening this defect class from purely numeric to semantic — meaning-changing restatement of a sourced claim):
1. `georisk_us-china-trade-tariffs.json`'s `narration_script` reads "a 90-day pause was placed on increasing tariffs on Chinese goods **from 125% to 125%**" — logically incoherent (states no change happened) and misstates the source, which says the pause prevents the tariff from *rising to* 125%.
2. `georisk_red-sea-shipping-attacks.json`'s `headline_fact` says the six shipping deaths mark the first since "**the previous fall**" (fall 2025), but its own `narration_script` restates the same claim as "since **earlier this year**" (2026) — a different, wrong time frame for the same sourced fact.

Same root cause as above (shared retry/validation logic checks JSON shape only, no numeric/logical/semantic-fidelity check), still open, still un-fixed. Verbatim evidence for both preserved in `scripts/verify/output/02_verticals_output.json`'s `georisk_us-china-trade-tariffs.json` and `georisk_red-sea-shipping-attacks.json` entries. See "Task 2" in `docs/VERIFICATION_2026-08.md` for full detail. This brings the running total to (at least) 4 confirmed occurrences across this vertical's history (2 fabricated digits at original build time, plus these 2 garbled-restatement occurrences in this single re-run batch) — raises confidence this is a systemic gap in the shared generator pattern, not a one-off LLM fluke, and should be prioritized accordingly. Also worth noting P4's original framing ("no check for numeric fidelity") is too narrow: the fix needed is a fidelity check for *sourced claims generally* (numbers, dates, and logical restatements alike), not numbers specifically.

## P5 — Correctness audit (this session's earlier fixes + new sweep)

- `code/paper-trading.js`'s always-0 P&L — **already fixed** (`397ea77`, prior turn this session).
- Kill switch (`guard.js`'s `isStopped()`) and `scheduler.js`'s respect for it — **already fixed and verified** this session (`5079aab`: `lib.js`'s `execute()` now checks it for every action type; `scheduler.js`'s gate bug fixed same commit). Re-verified working in this session's Phase 4 (see below).
- Broader sweep for other "always returns a constant/0/null regardless of input" bugs: see Phase 4 findings below.

## P6 — Ollama-down failure is invisible to status-code-only clients (2026-08-20) — RESOLVED 2026-08-23

Found while running `docs/superpowers/plans/2026-08-20-phase1a-verification.md`
Task 4. See the "Task 4" section of `docs/VERIFICATION_2026-08.md` for full
output.

**Resolved 2026-08-23.** An earlier, incomplete attempt (`7fa7475`, 2026-08-21)
changed `curl -s` to bare `curl -S` — this made `stderr` non-empty again, but
`-S` alone doesn't suppress curl's own progress-meter table, so the "error"
text callers saw was the meter's blank columns glued in front of the real
message, still returned as ordinary 200 answer text, and still never reaching
the audit log (the addendum below). Actually fixed this session:
- `hermes.py`: `curl -sS` (silent meter, but still show errors — the
  combination that actually isolates just the error text); `ask()` now
  raises a new `HermesBackendError` on curl failure/timeout/malformed JSON
  instead of returning an `"Error: ..."` string; a new `_record_failure()`
  helper inserts a `[BACKEND FAILURE] ...` row into `conversations` so the
  audit log gets a trace either way (resolves the addendum below too).
- `app.py`'s `/api/ask` catches `HermesBackendError` and raises
  `HTTPException(503)` instead of returning 200 — and a new
  `except HTTPException: raise` guard was needed above the route's existing
  broad `except Exception → 500` handler, which would otherwise have
  recaught and downgraded that 503 to a misleading 500.
- `hermes.py`'s CLI (`main()`) catches the same exception and prints a clean
  stderr message + `sys.exit(1)`, instead of an unhandled traceback.

Re-verified live with the same probe as the original finding (`supervisorctl
stop ollama` → `POST /api/ask {"question":"ping"}` → `start ollama`): now
returns `503` with body
`{"detail":"LLM backend unavailable: curl: (7) Failed to connect to localhost port 11434 after 0 ms: Couldn't connect to server"}`
(clean, no meter noise), and `scripts/verify/04_failure_modes.py`'s
`ollama_down()` reports `"graceful": true`. Original finding below preserved
as history.

A real `supervisorctl stop ollama`, then `POST /api/ask`, returned **HTTP
200** — not a 5xx — with the body `{"question":"ping","response":"Error: ","tier":"local","model":"qwen2.5:3b","voice":null,"audio":null}`. `hermes.py`'s
`ask()` catches the failed `curl` subprocess (`returncode != 0`) and returns
`f"Error: {result.stderr}"` as ordinary answer text over a 200 status;
`stderr` was empty here because the underlying `curl` call uses `-s`
(silent), which also suppresses curl's own connection-refused message. Net
effect: a caller checking only the HTTP status code cannot tell a hard
backend outage from a normal (if oddly blank) answer. The other 3/4 failure
modes tested in the same task (malformed input → 422, Ollama timeout →
handled, disk full → clean `ENOSPC`) all degrade gracefully; this one does
not. Fix would be either surfacing curl's stderr without `-s`/with `-S`, or
having `hermes.py` return a distinct error signal (a status field, or a
raised exception the route layer turns into a 5xx) instead of folding
backend failures into the answer text. Not fixed as part of verification —
Ollama and hermes-api were both confirmed healthy again immediately after
the test; no live system was left degraded.

**Addendum (2026-08-20 whole-branch review):** this failure is also invisible
to the *conversation audit log*, not just to HTTP status codes. Checked
`~/.hermes/state.db` directly: no `ping` row exists from the probe above,
because `hermes.py`'s error path (`return f"Error: {result.stderr}"`, the
`curl` failure branch) returns before reaching the `INSERT INTO
conversations` call further down `ask()`. Confirmed again live during this
review's own re-run of the fixed `ollama_down()` (a fresh `supervisorctl
stop ollama` → `POST /api/ask {"question":"ping"}` → `start ollama` cycle):
`conversations` count stayed at 41 both before and after, and no row with
`user_input='ping'` exists at all. So a hard backend failure leaves neither
an HTTP-level nor an audit-log-level trace — a direct input to the future
Phase 1D audit-trail work the overall completion plan calls for.

**Also resolved 2026-08-23** by the same `_record_failure()` change above —
re-verified: the row for the `ping` probe now exists (`id=45`,
`response='[BACKEND FAILURE] curl: (7) Failed to connect...'`,
`model='qwen2.5:3b'`, `latency_ms=8`).

## P7 — Decision-latency baseline shows unexplained intra-tier variance, a `model="--tier"` recording bug, and a stale/mixed sample (2026-08-20, corrected)

Found while running `docs/superpowers/plans/2026-08-20-phase1a-verification.md`
Task 6. See the "Task 6" section of `docs/VERIFICATION_2026-08.md` for full
output. Does not block Phase 1A exit criteria (Task 6's own check passed —
this is an observability gap, not a functional failure) but worth tracking.

**Correction (2026-08-20 whole-branch review):** the original write-up of this
item guessed the 5ms-97.6s spread might be explained by "quality tier + voice
synthesis" being slow. A direct read of `~/.hermes/state.db`'s `conversations`
table (the same ~41 most-recent rows Task 6 sampled) rules that out and
surfaces three separate, more concrete findings instead:

1. **TTS was never exercised in this sample.** `voice_id` is `NULL` in all 41
   rows — the "quality tier + voice synthesis is slow" half of the original
   hypothesis doesn't apply to any row in this sample; it can't be the
   explanation.
2. **The variance is intra-tier, on the fast model, on trivial prompts —
   not explained by tier choice.** The model mix is mostly `qwen2.5:3b` (the
   local tier, 35/41 rows) with a handful of `qwen2.5:7b` (quality tier,
   4/41 rows). Both the max latency (97,603ms) and the p95 latency
   (51,398ms) belong to **`qwen2.5:3b`** rows, on trivial prompts ("Hello.
   Hello. Hello. Hello." and "hello, who are you" respectively) — the
   opposite of what "quality tier is slower" would predict. Something is
   occasionally causing multi-second-to-two-minute delays within the fast,
   local-tier model on simple inputs, and this baseline doesn't explain what.
3. **A `model="--tier"` recording bug, unrelated to anything Task 6 tested.**
   2 of the 41 rows have the literal string `--tier` recorded in the `model`
   column (an argv-parsing bug in whatever invoked `hermes.py` for those two
   calls — the flag name leaked into the column meant to hold the model
   name). Both are degenerate `"No response"` rows at single-digit-ms
   latency. Worth its own fix, independent of the latency-variance question.
4. **The sample mixes old/new and real/degenerate rows.** 4 of the 41 rows
   (including the 2 `--tier` rows above) are degenerate `"No response"`
   results at single-digit-millisecond latencies — averaging these in with
   real answers understates what a real answer actually costs. And the
   sample is mostly stale: 38 of the 41 rows predate this verification
   session by up to 8 days (2026-08-12 through 2026-08-16); only 3 rows are
   from this session (2026-08-20). A latency baseline drawn from "whatever
   happens to be the last 41 rows in the table" is not a clean, contemporary
   measurement.

A follow-up would need: (a) investigation into why simple local-tier prompts
occasionally take 10-100x longer than others (resource contention? cold model
load? something else?), (b) a fix to whatever call site produces
`model="--tier"` rows, and (c) either excluding degenerate/stale rows from
future baselines or tagging rows so they can be filtered — not a change to
the verification script's query itself, which faithfully reports what's in
the table.

## P8 — Disk-full failure mode untested for Jarvis-X's own output paths (2026-08-20)

Found during the 2026-08-20 whole-branch review of
`docs/superpowers/plans/2026-08-20-phase1a-verification.md` Task 4. See the
"Task 4" section of `docs/VERIFICATION_2026-08.md` for the relabeled row.
Does not block Phase 1A exit criteria on its own (Task 4's overall ❌ is
already filed as P6) but is a real, separate coverage gap worth tracking.

`scripts/verify/04_failure_modes.py`'s `disk_full()` check mounts a
throwaway 1MB tmpfs and writes 5MB directly in *the verification script's
own Python process*. This proves Python's `OSError(ENOSPC)` behavior (which
it does — `errno=28`, no half-written file), but it says nothing about how
`hermes-api`, `content_generator.py`, or `video_renderer.py` actually behave
when the real output directory they write into (`automation/phase-b/
stages/.../output/`) fills up mid-job: does a partial content JSON or a
truncated video file get left behind? Does the job's status correctly
report `failed` rather than silently reporting `done`? None of that is
tested today. A proper test would need to bind-mount or symlink one
vertical's actual output directory (e.g. `letters`) onto a small tmpfs and
trigger a real `POST /api/dashboard/generate/<vertical>` call against it,
then inspect the job status and any partial files left behind — not
achievable by writing into the test script's own process.

## Resolved after this doc was written

- `app.py`'s `/api/ask` not checking the kill switch (was flagged above and in `SESSION_FINAL_REPORT.md`'s "what remains" #1) — **resolved 2026-08-16**: `/api/ask` now returns `503` when `.jarvis-x-STOP` exists. Decision: `CONSTITUTION.md`'s kill-switch guarantee carves out no exception for chat, and a silently-excluded path undermines the whole point of a "one tap, everything stops" kill switch. Verified live (baseline works, switch blocks, clearing restores it). See `docs/architecture.md`'s kill-switch section.

## Explicitly corrected assumption from the original task brief

The originating instructions assumed `code/router.py` might be "genuinely dead" and asked to kill it if so. **It is not dead** — confirmed via `CONTEXT.md` (already-accurate reference doc) and direct read of `app.py`: `router.py` is the actual, live routing file the real web-chat production path (`app.py` → `/api/ask`) imports and uses (100% local Ollama, `local`/`quality` tiers). This is a *different file* from `code/router.js` (the JS agent-autonomy path, Gemini-tiered) — same name pattern, different systems, explicitly called out in `CONTEXT.md` as "do not conflate." Not touched.
