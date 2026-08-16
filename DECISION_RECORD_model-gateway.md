# Decision Record — packages/model-gateway wiring

**Date:** 2026-08-16
**Question:** Should `packages/model-gateway` + `code/gateway-adapter.js` be wired into `code/agent.js`/`scheduler.js`/`query.js`/`market-brief.js`, replacing their current direct calls to `router.js`/`local.js`/`gemini.js`?

**Decision: NO-GO. Leave unwired.**

## Background

`packages/model-gateway` (routing, circuit breaker, budget enforcement, SQLite-backed telemetry for multi-provider LLM calls) and `code/gateway-adapter.js` (jarvis-x's glue layer for it) were fully built and tested (47/47 package tests) on the `worktree-model-gateway` branch, including a caller migration (`b8d8413`) that switched `agent.js`/`query.js`/`scheduler.js`/`market-brief.js` over to it.

That branch was merged into `master` via `fdc6d98`, but **the caller-migration commits were deliberately excluded**. The merge's own commit message:

> Deliberately excludes Tasks 9-11 (guard.js contract rewrite, gateway-adapter.js, and the agent.js/query.js/scheduler.js/market-brief.js call-site migration): those were built against a stale, long-forked snapshot of code/guard.js that predates real changes already on master. master's actual guard.js/shell.js/memory.js/scheduler.js/gemini.js all work correctly today via a 3-arg guard(action, level, fn) pattern that executes fn and throws on STOP -- none of the bugs the plan assumed existed are present here. Confirmed directly against master before this merge; verified with the user this is the intended, correct current behavior.

## Re-verification this session (2026-08-16)

Rather than trust that reasoning as still valid by default, it was re-checked against the current repo:

1. **`guard.js`'s actual contract today** matches exactly what the merge said was already correct: 3-arg `guard(action, level, fn)`, throws on STOP, already exports `STOP_FILE`. `guard.js` has not been edited since the merge (it's Edit-denied by this project's own guardrail config; every commit this session that touched the kill-switch path worked around it in *callers*, never in `guard.js` itself) — so the merge's assessment has had no opportunity to go stale in the other direction either.

2. **The specific class of bug `gateway-adapter.js`'s architecture was designed to prevent** — a caller that bypasses the human-approval gate, or that never checks the kill switch at all — was independently found and fixed **this session, directly and minimally**, without needing the gateway:
   - `code/agent.js`'s call into `router.js` passed a bare string instead of `{prompt, level}`, silently bypassing the `'consequential'` tier's gate. Fixed in `agent.js` itself (`5079aab`).
   - `code/lib.js`'s `execute()` never checked `isStopped()` at all for the `agent.js` path. Fixed in `lib.js` itself (`5079aab`).

   Both fixes are two-line, single-file changes. Wiring in the gateway would have meant introducing a new multi-file dependency chain (`gateway.js` → `tier-policy.js`/`breaker.js`/`budget.js`/`store.js` with SQLite persistence/`telemetry.js`) into the core agent loop to fix bugs that were already fixed without it.

3. **This session's own operating rule** ("No architectural rewrites — extend existing patterns, don't invent new ones") directly cuts against wiring in a new persistence-backed dependency chain that has never run against real production traffic, to replace working, already-fixed direct calls.

## Net

- `packages/model-gateway` stays a fully-built, fully-tested, standalone package — genuinely useful if this project later wants provider-level circuit breaking / cost budgeting across multiple LLM providers at scale.
- Wiring it in is a real, separable follow-up decision for whenever that need actually materializes (e.g. adding a second remote provider, needing real cost tracking) — not something to force now just because the code exists.
- If revisited later: start from `dccd5e2`'s 12 fixes (still readable via `git show dccd5e2`, even though the branch itself is deleted) rather than re-deriving them.
