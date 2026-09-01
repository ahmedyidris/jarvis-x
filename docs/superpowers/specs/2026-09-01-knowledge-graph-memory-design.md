# Knowledge-Graph Memory (v1) — Design

Status: approved (pending final user review)
Date: 2026-09-01
Author: Ahmed, drafted with Claude

## Context

This is the second of three planned ports from the two vetted repos
(`isair/jarvis`, `vannu07/jarvis`) into jarvis-x — see
`docs/superpowers/specs/2026-09-01-tool-calling-reply-engine-design.md`
(project 1, merged to master as of commit `eee9fbc`). Project 1 built a
tool-calling reply engine (`code/reply/`: router, planner, resolver,
digest, engine) that replaced jarvis-x's single-shot `/api/ask` completion.
Its Non-goals section explicitly deferred a "memory-digest pass" to this
project.

jarvis-x currently has no structured, persistent memory beyond a rolling
3-turn window (`hermes.py`'s `build_context()`, reading the last N rows of
the `conversations` table) and a completely separate, unrelated system —
`code/memory.js` + `memory/rules.md` + `memory/observed.jsonl` — used only
by the dormant JS agent-autonomy path (`code/agent.js`), not the live chat
path this project extends.

`isair/jarvis`'s knowledge-graph memory (`src/jarvis/memory/graph.py` +
`graph_ops.py` + `db.py`, ~102KB, plus `conversation.py`, 80KB) is a
sophisticated self-organizing node graph: auto-split/auto-merge via LLM,
decay-scored access ranking, a three-panel Memory Viewer UI with its own
API endpoints, mutation-listener cache invalidation, and Unicode-NFKC-fold
deduplication. Its automatic writes piggyback on an existing diary/
conversation-summarizer subsystem (`conversation.py`) that jarvis-x has no
equivalent of. Porting all of it as one project would mean building that
diary subsystem as a prerequisite — a substantially larger undertaking
than "add memory."

This project ports a deliberately scoped-down v1: the core data model,
CRUD, keyword search, a per-turn (not per-daily-summary) automatic write
path, and an automatic read path (always-on warm profile + query-driven
search). Auto-split/merge, the UI, decay ranking, Unicode-fold dedup,
mutation listeners, and the diary port are explicit non-goals, deferred to
a future slice if ever needed.

## Scope

**In:** a new `code/memory/` package (`store.py`, `warm_profile.py`,
`extractor.py`) providing a flat (non-tree) three-branch (`user`/
`directives`/`world`) knowledge store backed by jarvis-x's existing
`~/.hermes/state.db`; a warm profile injected into every reply
unconditionally (pure SQLite read, no LLM call, applies even on the
fast-path-skip); a `searchMemory topic='...'` step type added to
`code/reply/planner.py`'s vocabulary, resolved by `code/reply/engine.py`
into a trusted "STORED KNOWLEDGE ABOUT THE USER" context block; and a
per-turn extraction pass (`extractor.py`, one LLM call) that writes new
facts after a non-fast-path synthesis call succeeds.

**Out:** auto-split/auto-merge (LLM-driven node reorganization), the
Memory Viewer UI and its API endpoints, decay-scored access ranking
(v1's flat branches have no ranking need), Unicode-NFKC-fold
deduplication (v1 uses simple case-insensitive exact-line dedup),
branch-pinned tree traversal (moot — v1 has no subtree structure below
the 3 fixed branches), mutation-listener cache invalidation (v1 never
caches the warm profile across requests — it's read fresh every time),
and any port of `conversation.py`'s diary/summarizer system.

## Repo layout

```
jarvis-x/
  code/
    memory/
      __init__.py
      store.py           # MemoryNode CRUD, root + 3 fixed branches, search_nodes()
      warm_profile.py     # build_warm_profile() (pure SQLite), format_warm_profile_block()
      extractor.py         # extract_and_store(): one LLM call, JSON-shape-validated, fail-open
    reply/
      planner.py          # MODIFIED: searchMemory step type, runs even when tools=[]
      engine.py            # MODIFIED: warm profile always injected; searchMemory handling;
                            #           extraction fired after non-fast-path synthesis
```

## Data model

`MemoryNode` fields (trimmed from isair's model — no `data_token_count`,
since nothing reads it without auto-split): `id` (UUID string, root is
`"root"`), `name`, `description`, `data` (newline-separated fact lines),
`parent_id`, `access_count`, `last_accessed`, `created_at`, `updated_at`.

Storage: new `memory_nodes` table in the existing `~/.hermes/state.db`
file. `code/memory/store.py` owns its own `DB_PATH` module constant
(`Path.home() / ".hermes" / "state.db"` — same value as `hermes.py`'s,
same physical file) and its own `sqlite3.connect()`, independent of
`HermesCore` — `store.py` has no dependency on `hermes.py`'s class at
all, matching project 1's pattern of small modules with one clear
responsibility each. Schema initialized on first access, same pattern as
the existing `conversations` table's `init_db()`. Root node plus the
three fixed branches (`user`/`Directives`/`world`) are seeded idempotently
(`INSERT OR IGNORE` on stable IDs) on first `MemoryStore` construction.

v1 branches are flat: each fixed branch node's `data` field directly
holds all its facts as newline-separated lines. There is no subtree
structure below the three fixed branches — auto-split (which is what
would create one) is out of scope.

## Data flow

1. `app.py`'s `/api/ask` — unchanged, still calls `reply_engine.handle()`.
2. `engine.handle()`:
   a. Build the warm profile (`warm_profile.build_warm_profile()` — pure
      SQLite read of the User + Directives branches' `data`, no LLM call)
      and append `format_warm_profile_block()`'s output to `system_msg`.
      This happens **unconditionally, before the fast-path check** — even
      a trivial "hi" gets personalization, since the read costs nothing
      beyond a SQLite query.
   b. `candidate_tools = tool_router.route(question, ALL_TOOLS)` —
      unchanged from project 1.
   c. Fast-path check — unchanged condition (no tools matched AND
      question ≤8 words): `hermes.ask(question, model,
      system=<warm-profile-augmented system_msg>)`, return immediately.
      No memory search, no extraction fires on this path.
   d. Otherwise: `planner.plan_query(question, candidate_tools, model,
      hermes)`. **Behavior change from project 1**: this now always
      issues an LLM call at this point, even when `candidate_tools` is
      empty — the planner's prompt always offers `searchMemory
      topic='<topic>'` as a first-step option (emitted only when the
      question needs information the user shared in a prior conversation
      beyond what the warm profile already covers), and includes the
      tool catalog section only when `candidate_tools` is non-empty.
   e. If the first returned step matches `searchMemory topic='...'`: pop
      it from the step list, call `store.search_nodes(topic, limit=5)`,
      and — if any results — append a "STORED KNOWLEDGE ABOUT THE USER"
      block to `system_msg` (trusted framing, distinct from project 1's
      "external, reference only" TOOL DATA framing, since this is
      first-party data the assistant itself wrote, not data fetched from
      an external source).
   f. Remaining steps (if any) flow through the unchanged Task 5/6/7
      resolve → execute → digest loop from project 1.
   g. Final `hermes.ask(question, model, system=<fully augmented
      system_msg>)` produces the response.
   h. `extractor.extract_and_store(question, response, model, hermes)`
      fires as a side effect — **only on this path** (never after a
      fast-path-skip return), wrapped so any failure inside it can never
      surface as a request error. The response computed in step (g) is
      already final; extraction cannot change or delay it from the
      caller's perspective beyond its own (short-timeout, fail-open) cost.
   i. Return the response — contract unchanged from project 1
      (`handle()` remains a drop-in replacement for a direct
      `hermes.ask()` call).

## Extraction prompt contract

`extractor.extract_and_store()` sends the `(question, response)` pair to
the model (`context=False, log=False, timeout=5`, matching project 1's
established scaffolding-call pattern) with a system prompt asking for a
JSON list of `{"branch": "user"|"directives"|"world", "fact": "..."}`
objects, or `[]` if nothing in this turn is worth remembering. Routing
heuristic in the prompt (matching isair's): the user describing
themselves → `user`; the user issuing a standing instruction about how to
behave → `directives`; the assistant learning something about the world
→ `world`. Facts are reframed as knowledge, not questions ("user is
vegetarian", not "user asked about vegetarian restaurants").

Applying project 1's hard-learned lesson directly (small models return
syntactically-valid-but-wrong-shaped JSON): validate `isinstance(parsed,
list)` before iterating; for each item, validate `isinstance(item, dict)`
and that `"fact"` is a non-empty string; an unrecognized or missing
`"branch"` value defaults to `"user"` rather than being dropped or
raising. Any validation failure on an individual item skips just that
item, not the whole batch.

For each valid fact: a case-insensitive exact-line dedup check against
the target branch's existing `data` (simple string comparison — not
isair's Unicode-NFKC folding, out of scope for v1) skips exact repeats;
otherwise `store.append_to_node()` adds the fact as a new line and bumps
`updated_at`.

## Error handling

- Warm profile build: wrapped in try/except. Any error (missing table on
  first-ever run before seeding, a locked db, anything) returns an empty
  profile — no personalization block is added, but the reply proceeds
  normally. This must never be the reason a reply fails.
- `searchMemory` resolution: wrapped the same way. A failed search
  returns no results (no block injected); any other planned steps still
  proceed.
- `extract_and_store`: every exception anywhere in its pipeline (LLM
  call, JSON parsing, shape validation, the store write) is caught at
  the top level and logged (matching `hermes.py`'s existing `logging`
  conventions — no `debug_log`-style helper exists in jarvis-x, unlike
  isair's convention), never raised. It runs after the user-facing
  response is already determined, so its only possible negative effect
  is a missed extraction, never a broken reply.
- `store.py`'s write operations (`create_node`, `append_to_node`,
  `touch_node`) are synchronous SQLite calls on the same connection
  pattern `hermes.py` already uses — no new failure surface beyond what
  `hermes.py`'s existing `conversations` table writes already have.

## Testing

pytest, matching project 1's convention (root-level and `code/reply/`-style
co-located test files).

- `store.py`: node CRUD, root + fixed-branch idempotent seeding (calling
  it twice doesn't duplicate), `append_to_node`'s dedup (an exact-line
  repeat is skipped, a new fact is appended), `search_nodes` keyword
  matching across name/description/data.
- `warm_profile.py`: formatting with real branch data; empty-profile
  fallback when branches have no data yet or the read fails.
- `extractor.py`: JSON-shape validation against the same class of
  malformed LLM output project 1's resolver had to guard against (a bare
  scalar, a list of non-dicts, a dict-shaped item missing `"fact"`, an
  unrecognized `"branch"` value) — each must degrade gracefully, never
  raise. Dedup-skips-exact-repeat behavior. Fail-open on
  `HermesBackendError`.
- `planner.py`'s modified `plan_query`: now issues an LLM call even with
  `tools=[]` (a real behavior change from project 1 — needs a test
  proving this, since project 1's own tests asserted the opposite via
  `hermes.ask.assert_not_called()` for the empty-tools case); the tool
  catalog section is omitted from the prompt when `tools` is empty;
  `searchMemory topic='...'` parses correctly as a step.
- `engine.py`'s modified `handle`: warm profile block present in the
  system prompt on the fast-path-skip return, not just the full-loop
  path; a `searchMemory` step triggers `store.search_nodes` and injects
  the trusted block (distinct wording from the TOOL DATA block); a
  fast-path-skip return never fires `extract_and_store`; a full-loop
  turn does fire it, and its failure doesn't propagate to the caller.
- Integration test extending project 1's
  `test_api_ask_reply_engine_integration.py` pattern: both
  `hermes_module.DB_PATH` and `code.memory.store.DB_PATH` isolated via
  the now-established `monkeypatch` fixture (two separate constants,
  same physical file in production, both redirected to the same
  `tmp_path` file per test so a real end-to-end turn's write and the
  next turn's warm-profile read see each other), proving a real
  end-to-end turn writes a fact and a subsequent turn's warm profile
  reflects it.

## Non-goals

- Auto-split/auto-merge. v1's flat branches have no size-triggered
  reorganization; if a branch's `data` grows large, that's a known,
  accepted limitation of this v1, not silently worked around.
- The Memory Viewer UI and its API endpoints (isair's three-panel
  layout, graph visualization, "Import from Diary" / "Consolidate All"
  actions). No UI surface is built in this project.
- Decay-scored access ranking. `access_count`/`last_accessed` are
  tracked (for potential future use) but nothing in v1 orders or filters
  by them — there's nothing to rank yet with only 3 flat branches.
- Unicode-NFKC-fold deduplication. v1's dedup is a simpler
  case-insensitive exact-line comparison; locale-specific folding
  (Turkish İ/ı, German ß/ss) is not handled.
- Branch-pinned tree traversal, `find_best_node`, LLM-driven best-child
  picking. Moot without a tree structure below the fixed branches.
- Mutation-listener cache invalidation. The warm profile is read fresh
  on every request; there is no cache to invalidate.
- Any port of `conversation.py`'s diary/summarizer subsystem, or making
  extraction depend on one. This project's extraction is per-turn,
  triggered directly from `code/reply/engine.py`, not piggybacked on a
  daily-summary flow that doesn't exist in jarvis-x.
