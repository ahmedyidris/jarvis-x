# Tool-Calling Reply Engine — Design

Status: approved (pending final user review)
Date: 2026-09-01
Author: Ahmed, drafted with Claude

## Context

Two external repos were vetted and cloned for feature-porting into jarvis-x:
`isair/jarvis` (1.7k★, mature, offline-first, same values as jarvis-x) and
`vannu07/jarvis` (62★, smaller, face-recognition/voice-automation focused).
This is the first of three planned projects from those repos, in this
order: (1) tool-calling loop + planner (this spec — originally scoped as
two separate projects, "planner + digest passes" and "embedding-based tool
routing", merged after discovering the planner has nothing to sequence
without a tool-calling loop underneath it; embedding-based routing itself
was further descoped to a keyword router for v1, see Non-goals), (2)
knowledge-graph memory, (3) face recognition + voice automations from
vannu07.

jarvis-x's live chat path (`app.py`'s `/api/ask` → `hermes.py`'s
`HermesCore.ask()`) is a single raw-prompt completion against Ollama's
`/api/generate`, with only the last 3 conversation turns stitched in as text.
There is no tool-calling loop, no tool catalogue, and no multi-step planning
— a request either gets one model call or nothing.

isair/jarvis solves small-model (2-3B class) multi-step unreliability with a
task-list planner that runs ahead of the chat model: a router narrows the
tool catalogue, the planner decomposes the query into an ordered step list,
concrete steps get resolved and executed directly (bypassing the chat model
for intermediate turns), and a digest pass compresses tool output before the
final synthesis call. jarvis-x's `qwen2.5:3b` ("local" tier) is exactly the
class of model this was built for, and memory from earlier sessions already
documents multi-step and prompt-bloat struggles on that tier.

jarvis-x also already has a dormant, unrelated JS scaffold
(`code/agent.js`, `code/planner.js`, `code/router.js`) gated behind
`knowledge/Guidelines.md`'s quick/hard/max tiers — placeholder code on a path
that isn't what serves `/api/ask` today. This project does not touch it.

## Scope

**In:** a new `code/reply/` Python package providing a tool-calling loop,
a keyword-based tool router, a text-step planner (isair-style, not native
Ollama function-calling), a tool-result digest pass, and two real tools
(`getWeather`, `getSystemStats`) proxying jarvis-x's own already-running
`jarvis-dashboard` backend at `127.0.0.1:8002`. Wired into `app.py`'s
`/api/ask` in place of the direct `hermes.ask()` call.

**Out:** embedding-based tool routing (only 2 tools exist; keyword routing
is sufficient — see Non-goals), the memory-digest pass (depends on the
knowledge-graph memory project, not yet built), a `webSearch` tool (real
gap, but deliberately deferred to keep this slice provable end-to-end
without new external dependencies or SSRF/prompt-injection fencing), native
Ollama function-calling (isair's own experience says small models don't use
it reliably — not re-litigated here without a reason to), and any change to
the dormant JS agent path.

## Repo layout

```
jarvis-x/
  code/
    reply/
      __init__.py
      engine.py          # orchestrates: fast-path skip -> router -> planner -> resolve/execute -> digest -> synthesis
      tool_router.py      # keyword/regex router: question -> candidate tool names
      planner.py           # plan_query(): one LLM call emitting text steps
      resolver.py          # resolve_next_tool_call(): regex fast-path + LLM fallback
      digest.py            # tool_result_digest(): compress large tool output
      tools/
        __init__.py
        base.py            # Tool interface (name, description, arg schema, execute())
        weather.py         # getWeather -> GET http://127.0.0.1:8002/api/weather
        system_stats.py    # getSystemStats -> GET http://127.0.0.1:8002/api/system
  app.py                  # /api/ask calls reply.engine.handle() instead of hermes.ask() directly
```

Naming note: `code/router.py` (existing — resolves tier to model/voice) and
the new `code/reply/tool_router.py` (which tools apply to this query) are
unrelated despite the similar name. Kept in separate files/packages
deliberately, no rename of the existing module.

## Data flow

1. `app.py`'s `/api/ask`: kill-switch check, busy check, `router.resolve(tier)`
   — all unchanged.
2. `reply.engine.handle(question, model, tier, system_msg)` replaces the
   direct `hermes.ask()` call:
   a. **Fast-path skip**: `tool_router.route(question)` returns no tools
      *and* the question is ≤8 words (whitespace split, language-agnostic)
      → go straight to today's plain `hermes.ask(question, model,
      system=system_msg)`. No added latency for trivial messages.
   b. Otherwise: `tool_router.route(question)` → narrowed tool list
      (possibly empty if nothing matches but the length gate didn't fire).
   c. `planner.plan_query(question, narrowed_tools, model)` → ordered text
      steps, e.g. `getWeather location='Cairo'` or `Reply to the user.`.
      One extra `hermes.ask()` call, short timeout, fails open to `[]`.
   d. `steps == []` (planner failed/disabled) or `["Reply to the user."]`
      (planner's positive no-tools decision) → plain `hermes.ask()`, same
      as today.
   e. Tool steps present → for each, in order:
      `resolver.resolve_next_tool_call(step, tools)` (regex fast-path for
      fully-concrete `key='value'` steps, no LLM call; LLM fallback
      otherwise) → execute the resolved tool → `digest.tool_result_digest()`
      if the raw result is large → append as a `TOOL RESULT: ...` block.
   f. Final `hermes.ask(question, model, system=system_msg + ACTION PLAN
      block + tool-result blocks)` produces the answer, phrased in Jarvis
      X's existing voice/persona (system prompt unchanged otherwise).
3. Return shape to the caller is unchanged: `question/response/tier/model/
   voice/audio`. No API contract break, no change to TTS/audio handling.

Every LLM call in this flow (planner, resolver's LLM fallback, digest,
final synthesis) still goes through `hermes.py`'s `ask()`, so the existing
state-db audit log (`~/.hermes/state.db`'s `conversations` table) captures
all of them exactly as it does today — no parallel logging system.

## Error handling

- Every new LLM call (planner, resolver, digest) is wrapped with a short
  timeout (~5s — these are scaffolding calls, not the user-facing final
  answer) and fails open: exception, timeout, or empty response → `[]` /
  `None`, collapsing to today's exact single-call behavior. This mirrors
  isair's fail-open invariant: the new machinery can never make a request
  worse than the pre-existing baseline.
- Tool execution failures (e.g. the `:8002` backend unreachable or slow)
  are caught and turned into a `TOOL_ERROR: <tool> unavailable` note fed
  into the synthesis call rather than crashing the request — the user
  still gets an answer, just without that tool's data.
- The existing kill-switch (503), busy (503), and LLM-backend-unavailable
  (503) responses in `app.py` are untouched — those are hard failures from
  the final synthesis call, same as pre-existing behavior.

## Testing

pytest, matching the existing root-level `test_*.py` convention (jarvis-x
has no CLAUDE.md dictating a different one). Per-module unit tests:

- `tool_router`: keyword matches route to the right tool name(s); no match
  returns `[]`.
- `resolver`: regex fast-path parses fully-concrete steps without any LLM
  call; placeholder/ambiguous steps fall through to the LLM path; unknown
  tool names and invalid JSON both return `None`.
- `digest`: short results pass through unchanged; long results get
  compressed and stay attributed to their source tool.

One integration test against a stubbed Ollama and a stubbed `:8002`
backend, covering three paths end to end: the fast-path skip (trivial
message, unchanged single-call behavior), a real tool round-trip
(`getWeather`/`getSystemStats` through router → planner → resolver →
digest → synthesis), and the fail-open path (planner LLM call times out →
falls back to plain `hermes.ask()`). All three must produce jarvis-x's
existing `/api/ask` response shape unchanged.

## Non-goals

- Embedding-based tool routing. isair's rationale for it is scaling past
  30+ tools without small-model degradation; with 2 tools a keyword router
  is sufficient. Revisit once the tool catalogue actually grows — tracked
  as its own future slice, not built speculatively here.
- The memory-digest pass. Depends on knowledge-graph memory (project 2),
  which doesn't exist yet. This project ships the tool-result digest only;
  the memory digest is a small follow-on once project 2 lands.
- Native Ollama function-calling for `qwen2.5:3b`. Not tested against this
  specific model in this project — isair's documented experience with
  small models informs the text-step-parsing choice instead. If revisited
  later, it should be an explicit, separately-tested decision, not a
  silent swap.
- Any change to the dormant `code/agent.js` / `code/planner.js` /
  `code/router.js` JS path.
