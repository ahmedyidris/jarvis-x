# Decision: what Hermes is, and whether it should be the backbone

**Date:** 2026-09-04 · **Status:** OPEN — options and costs only, nothing decided
**Prompted by:** Ahmed — "is Hermes acting as Hermes in whole Jarvis not just
market data" · and earlier, "fully integrated with Jarvis if not the backbone
architect"

---

## 1. What is actually true today

Jarvis has **two independent brains that share exactly one file.**

### Goes through Hermes

| Path | Detail |
|---|---|
| `app.py` `/api/ask` → `code/reply/engine.py` | 6 `hermes.ask()` call sites — `engine.py:25,29,67`, `planner.py:33`, `resolver.py:56`, `digest.py:28` |
| `app.py` `/api/status`, `/api/history` | `HermesCore.status()`, `.recall()` |
| `hermes.py` CLI | `hermes "question"`, `--speak`, `--recall`, `--status`, and now `--market` |

That covers the dashboard, the Electron app and voice chat. **This half is
genuinely Hermes** — memory in `~/.hermes/state.db`, routing via
`code/router.py` (tiers `local/quality/fast/smart/frontier`).

### Never touches Hermes

| Path | Routes through instead |
|---|---|
| `code/agent.js` | `code/router.js` — its `ROUTE` table: `quick/hard/consequential` |
| `code/scheduler.js` | same |
| `code/planner.js` | same |
| `bin/jj ask` | `code/universal-router.js` |
| `code/guard.js` — kill switch, `logs/actions.jsonl` | nothing; it *is* the gate |
| Everything built 2026-09-04: analyst, collector, advisor, supervisor | `code/router.js` or nothing at all |

Memory on this side is `code/memory.js` over `memory/rules.md` +
`logs/observed.jsonl`.

### Deliberately routed *around* Hermes, in Python

- `code/engineer/explain.py` — calls Ollama's HTTP API directly. Its docstring
  gives the reason: *"never via hermes.py's HermesCore.ask(), which
  unconditionally logs every call into real chat history."*
- `automation/phase-b/content_generator.py`, `video_renderer.py` — same, via
  `requests`.

### The only bridge

`memory/rules.md`. Both `hermes.py`'s `build_context()` and `code/memory.js`
read it. That is the entire shared surface — which is why one wrong sentence in
it (line 6, corrected 2026-09-04) was wrong on both sides at once.

**So the answer to the question as asked: no.** Hermes is the front door for
conversation. It is not the backbone, and nothing built on 2026-09-04 runs
through it. The market integration in fact runs the *other* way — `hermes
--market` shells out to `node code/market-brief.js`. Hermes is the consumer
there, not the architect.

---

## 2. A blocker that has already been removed, and nobody noticed

`explain.py` says `HermesCore.ask()` "unconditionally logs every call into real
chat history". **That is no longer true.** Commit `6b7e73a` ("feat(hermes): add
optional timeout/log params to ask()") added a `log=True` parameter, honoured at
four separate sites in `ask()` (`hermes.py:354, 363, 369, 373`). `ask(...,
log=False)` runs without touching `conversations`.

This matters more than it looks. The one *documented, principled* reason
anything routes around Hermes has been fixed and the comment went stale. Whoever
evaluates the options below should start by re-testing that assumption rather
than inheriting it — and `explain.py`'s docstring should be corrected either
way, since it currently misinforms.

---

## 3. The options

### A — Leave it. Hermes is the front door, not the backbone.

Zero work. The split is not arbitrary: Python is the conversational and UI
half, JS is the agentic and gated half, and the gate (`guard.js`, the kill
switch, the append-only audit log) lives in JS with the things it gates.

**Cost.** Two routers with different tier vocabularies — `router.py`'s `TIERS`
(`local/quality/fast/smart/frontier`) against `router.js`'s `ROUTE`
(`quick/hard/consequential`). A routing-policy change has to be made twice, in two languages, and
the drift is invisible until something answers oddly. Two conversation memories
that never see each other: ask Hermes something in the dashboard, then run the
same goal through the scheduler, and neither knows about the other. "Hermes is
the core" stays true only of half the system.

### B — Hermes becomes the single LLM entry point; the JS side calls it

Every `route()` in JS shells out to Python.

**Cost, and it is the highest here.** The kill switch and audit log are in
`guard.js`, in JS, and every gated action checks `isStopped()` locally. Routing
agent calls through Python means either duplicating that gate in Python — two
kill switches, which is worse than one — or crossing the language boundary
twice per action while the authoritative gate stays behind. On CPU-only
hardware a `python3` process spawn per model call is real latency on a path
that already takes seconds. And it inverts the direction the only working
bridge already runs in.

### C — The reverse: one router in JS, Hermes calls it

Precedent exists and is tested: `hermes --market` already shells out to `node
code/market-brief.js`, and `_market_brief()` handles the timeout, missing-binary
and non-zero-exit cases.

**Cost.** It moves the wrong half. `hermes.py`'s `build_context()` is the most
valuable thing in the file — rules injection, the auto-generated module index,
history labelled untrusted, each decision annotated with the failure that
motivated it. That is Python, it is 200 lines of hard-won behaviour, and this
option leaves it stranded on the far side of the boundary from the router it
would need to inform.

### D — Unify memory and routing policy only; leave execution split

The narrowest change that addresses the actual observed problem. One
conversation store both sides read and write. One routing-policy file (tier
names, chains, fallbacks) that `router.py` and `router.js` both load, rather
than two hardcoded tables.

**Cost.** A schema decision and one migration. `~/.hermes/state.db` is SQLite
and `logs/*.jsonl` is append-only text; picking one means the other side gains
a dependency. Roughly a day, not a rewrite.

**What it buys.** The two symptoms that are real today — divergent tier
vocabularies, and two memories that cannot see each other — both go away.
Neither language has to swallow the other, and `guard.js` stays where the things
it gates are.

### E — Do nothing structural; fix the three stale facts first

`explain.py`'s docstring, and any other comment asserting the pre-`6b7e73a`
logging behaviour. Then measure whether routing `explain.py` through
`ask(log=False)` actually costs anything.

**Cost.** An hour. **What it buys.** The evidence needed to choose between A and
D honestly, instead of choosing from a comment that has been wrong since
`6b7e73a`.

---

## 4. Recommendation

**E, then D.** Not B or C.

E first because the case for consolidating currently rests on a documented
reason that is already stale, and this project's whole method is to not build on
unverified claims.

D over B and C because the observed problems are *two memories and two tier
vocabularies* — not two runtimes. B and C both answer a question nobody asked
(which language wins) at the price of moving the kill switch away from what it
gates, or the context builder away from the router. D answers the question that
was actually asked and leaves `guard.js` alone.

A remains defensible if the answer to E is "the split costs nothing measurable."
That would be a real finding, not a failure.

## 5. What must not happen either way

`code/guard.js` is the kill switch and the audit log, and every gated action
checks it locally. No consolidation may end with two of it, or with the gate on
the far side of a process boundary from the action it gates. If an option
requires that, the option is wrong.

## 6. Evidence

- Hermes call sites: `grep -rn "hermes\.ask(" code/reply/ app.py` — 6, all in `code/reply/`
- Tier tables: `code/router.py:20` (`TIERS`) and `code/router.js:17` (`ROUTE`)
- `isStopped()` is checked in 8 files under `code/` — the gate is genuinely local to the JS side
- JS routing: `code/agent.js:6,24`, `code/scheduler.js:15,54`, `bin/jj:3`
- The `log` flag: `hermes.py:302` (signature), `354, 363, 369, 373` (honoured)
- The stale docstring: `code/engineer/explain.py:5`
- The one bridge: `memory/rules.md`, read by `hermes.py`'s `build_context()`
  and `code/memory.js`
- The working cross-language call: `hermes.py`'s `_market_brief()`, tested in
  `test_hermes_market_context.py`
