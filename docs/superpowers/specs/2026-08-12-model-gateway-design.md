# Model Gateway — Design

Status: approved (pending final user review)
Date: 2026-08-12
Author: Ahmed, drafted with Claude

## Context

jarvis-x currently has three overlapping, inconsistently-wired routing
implementations (`models.js` — a dead Week-1 stub, `universal-router.js` — a
byte-for-byte duplicate of `local.js`, and `router.js` — the real one, with tier
classification, ordered fallback chains, and a `gate` flag that forces human
approval for consequential actions). Only `router.js`'s logic is live, and only
when `JX_BACKEND` is set to something other than `local`. Separately, `guard.js`
has a signature mismatch: `gemini.js` and `test-guard.js` call it as
`guard(action, level, fn)` expecting `fn` to be executed and its result returned,
but the shipped `guard.js` only accepts `(action, level)` and never calls `fn` —
so the Gemini fallback path is silently broken today.

This project builds a standalone, portfolio-grade **Model Gateway** package that
becomes the single place routing, circuit breaking, budgets, and telemetry live,
and retires the dead/duplicate code around it.

## Scope

**In:** routing (fallback chains per tier), circuit breaking per provider,
budget/rate enforcement per caller tag, telemetry (live state + audit trail).

**Out:** tier *classification* (deciding what a given prompt/action counts as),
agent logic, task/action execution, human-approval UX, and any jarvis-x-specific
concept (kill switch, trading, voice). The package only decides how an
already-classified call gets placed and recorded — never what to ask or whether
a given input is consequential. Everything jarvis-x-specific lives in
`code/gateway-adapter.js`, which is the only file that imports both the package
and the rest of `code/`.

## Repo layout

```
jarvis-x/
├── packages/
│   └── model-gateway/           ← standalone-designed package (own repo, eventually)
│       ├── package.json         ← one runtime dep (better-sqlite3), node:test for tests
│       ├── README.md            ← the public portfolio artifact
│       ├── src/
│       │   ├── gateway.js       ← orchestrator (see Data Flow)
│       │   ├── tier-policy.js   ← tier name -> {chain, gate} config + lookup
│       │   ├── breaker.js       ← per-provider circuit breaker state machine
│       │   ├── budget.js        ← per-tag rate caps + daily cost ceiling
│       │   ├── store.js         ← SQLite: live breaker + budget state
│       │   ├── telemetry.js     ← JSONL: append-only audit trail
│       │   └── report.js        ← CLI summary + static HTML dashboard generator
│       ├── demo/                ← two mock providers + synthetic traffic + induced failure
│       └── test-*.js
└── code/
    └── gateway-adapter.js       ← jarvis-x glue: classify tier (from router.js),
                                    guard-check hook, Ollama + Gemini Provider wrappers,
                                    per-call-site tagging
```

`packages/model-gateway` never imports from `code/`. When it's stable, extraction
to its own repo is `git subtree split -P packages/model-gateway`, preserving
history — not a rewrite, and not scheduled to a specific day.

## Key decisions

1. **Tier semantics vs. classification are split.** `tier-policy.js` inside the
   package holds tier *behavior* (what fallback chain and gate flag a tier name
   maps to) via a config object supplied at construction. It does not decide
   which tier a given prompt belongs to — that heuristic (the `CONSEQUENTIAL`
   action set, the `HARD_HINTS` regex, currently in `router.js`) is jarvis-x
   business logic and stays in `gateway-adapter.js`. `gateway.route()` takes an
   already-resolved `tier` string as an argument.

2. **A guard-check runs first, before anything else — including budget and tier
   lookup.** The package exposes an optional `guardCheck` hook (sync or async,
   supplied at `Gateway` construction) that `route()` calls as its very first
   step. If it returns `{blocked: true, reason}`, `route()` returns immediately —
   no budget check, no breaker lookup, no provider is touched. This is a
   correction from an earlier draft that ran the check after tier/provider
   logic: a post-hoc check would let a blocked or consequential call actually
   fire (cost spent, side effects triggered) before being marked blocked, which
   defeats both the kill switch and the gate invariant. jarvis-x's adapter wires
   this hook to `guard.js`'s STOP-file check.

   As part of this, `guard.js`'s contract is **simplified, not restored**: it
   becomes a pure preflight check, `guard(action, level) -> {blocked, reason?}`,
   with no callback-execution responsibility. The 3-arg
   `guard(action, level, fn)` pattern that `gemini.js` and `test-guard.js`
   currently assume (and that doesn't match the shipped 2-arg `guard.js`) is
   retired rather than fixed-in-place, since the gateway package now owns call
   execution end-to-end — `guard.js` only needs to answer "may this proceed."
   Both call sites get updated to the simplified contract.

3. **SQLite for live/mutable state, JSONL for the immutable log.** `store.js`
   (via `better-sqlite3`, which ships prebuilt binaries for most platforms) holds
   exactly two things: current breaker status per provider, and budget counters
   per tag/window — both are read-and-mutate-in-place, not append-only.
   `telemetry.js` writes one JSONL line per `route()` call (tag, tier, provider,
   degraded, gated, blocked, latency, cost, timestamp) — matches the existing
   `guard.js`/`audit.js` append-only convention and is what `report.js` reads to
   build the dashboard.

4. **Budget = per-tag sliding-window rate cap + a daily cost ceiling.** The rate
   cap exists to catch a runaway loop (stuck retry, scheduler misfire) hammering
   Ollama (pegs the Chromebook) or Gemini (burns quota); the cost ceiling is a
   shared daily pool across tags, since Gemini quota/cost is shared regardless of
   which feature spent it.

5. **`models.js` and `universal-router.js` are deleted** (confirmed dead — nothing
   requires them). `local.js`, `router.js`, and `gemini.js` are not deleted; they
   become the implementation wrapped by two `Provider` objects and the adapter's
   classify function, no longer called directly by `agent.js`/`query.js`/
   `scheduler.js`/`voice.js`.

6. **Tests default to two deterministic mock providers** (fast-reliable,
   slow-flaky, with a forced-failure toggle) shipped in `demo/`, so the package
   can be cloned and tested with zero API keys or a running Ollama instance.
   Real Ollama/Gemini integration tests are added once `gateway-adapter.js`
   exists (Phase 2, not this package).

## API surface

```js
const gateway = new Gateway({ tierPolicy, guardCheck, budget, store, telemetry });

gateway.route(input, tier, options) -> Promise<{
  text, provider, tier, degraded, gated, blocked, reason?, cost, latencyMs
}>
```
`options` = `{ tag }` at minimum — caller identity (voice/trading/scheduler/repl)
used for budget accounting and dashboard breakdown.

`blocked` and `gated` are terminal signals the caller must handle explicitly —
`blocked` means no provider was touched at all; `gated` means a result exists but
requires human approval before acting on it (unchanged from today's behavior in
`agent.js`).

## Data flow

1. `gateway-adapter.js` classifies the input into a tier name (ported from
   `router.js`) and calls `gateway.route(input, tier, { tag })`.
2. `route()` calls the `guardCheck` hook first. Blocked → return immediately,
   nothing else runs.
3. `budget.js` checks the rate/cost cap for `(tag, tier)`. Over cap → return
   `{blocked: true, reason: 'budget'}`, no provider touched.
4. `tier-policy.js` resolves `{chain, gate}` for the tier name (pure config
   lookup, no I/O).
5. `breaker.js` filters any provider currently `OPEN` out of the chain.
6. `route()` walks the remaining chain in order, calling each provider's
   `call(input)` until one succeeds; each attempt's outcome is recorded into
   `breaker.js` (success closes/holds; failure counts toward a trip).
7. The result's `gated` field is set from the tier's static config — never from
   which provider answered, and never cleared because the call degraded.
8. `store.js` persists updated breaker/budget state; `telemetry.js` appends one
   JSONL line for the call, regardless of outcome (blocked/degraded/success/
   exhausted).
9. `report.js` reads `telemetry.js`'s history plus `store.js`'s current state on
   demand to render a CLI summary and a static HTML dashboard — no background
   service.

## Error handling

- Only exhausting the entire fallback chain throws to the caller; individual
  provider failures are caught and recorded, not propagated.
- Breaker: N consecutive failures or an error rate over a rolling window trips
  to `OPEN`; after a cooldown, a single `HALF_OPEN` probe call either closes it
  or re-opens with backoff.
- A budget block is a normal return value, not an exception, so callers
  (`voice.js`, `scheduler.js`) can degrade gracefully instead of crashing.
- `store.js`/`telemetry.js` write failures are best-effort: wrapped in
  try/catch, logged to stderr, and never allowed to block the actual model call
  — persistence failing must not mean the call didn't happen.

## Testing

- **Package** (`node:test`): tier-policy resolution, breaker state machine,
  budget accounting, restart-safety (write state, reload `store.js` fresh,
  assert continuity), and a dedicated test for the gate invariant (force a
  degrade to the last chain entry, assert `gated` matches the tier's static
  config, not the responding provider). A dedicated test also asserts the
  guard-first ordering: simulate a blocked `guardCheck`, assert zero provider
  calls occurred.
- **Adapter** (`code/test-gateway-adapter.js`, existing jarvis-x convention):
  guard/kill-switch precedence, and that the real Ollama/Gemini `Provider`
  wrappers conform to the interface the package expects.
- **Demo**: mock providers + synthetic traffic + an induced mid-run failure,
  generating the dashboard — this is the README/case-study/Loom artifact.

## Non-goals for v1

No multi-tenant auth, no HTTP server (see the earlier "in-process module"
decision), no automatic budget tuning, no cost estimation beyond a static
per-provider $/token config table.

## Open items for the implementation plan (not this doc)

- Exact SQLite schema for `breaker_state` / `budget_counters`.
- Exact JSONL line schema for `telemetry.js`.
- Default tier-policy config shape and defaults shipped with the package vs.
  jarvis-x's actual config.
- Day-by-day sequencing (package core → adapter → dead-code removal →
  demo/report → extraction).
