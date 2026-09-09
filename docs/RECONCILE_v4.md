# Reconciling MASTER_BLUEPRINT_v4 and the memory template against the repo

*Written 2026-09-09. Base of comparison: `master` at the merge of PR #22.*

Two documents arrived on 2026-09-09:

- `docs/incoming/JARVIS_X_MASTER_BLUEPRINT_v4.pdf` — a reconciliation of every
  prior plan into one current picture, prepared 2026-09-09, **against base
  commit `8643e6e`**.
- `docs/incoming/SelfRepairing_Memory_Architecture_Template.pdf` — a
  stack-agnostic architecture template for memory that repairs its own stale
  facts. Explicitly not project-specific.

This file is the evidence pass the blueprint's own precedence rule asks for:
*"where two documents disagree, the one with cited evidence wins over the one
with a narrative claim."* Applied to the blueprint itself.

## The one fact that reframes everything below

`8643e6e` is a real commit in this repo. It is **80 commits behind `master`**.

```
$ git log --oneline -1 8643e6e
8643e6e fix: actually disable ollama_DISABLED (real outage, not hypothetical)

$ git log --oneline --since=2026-09-03 | wc -l
80
```

The blueprint is internally consistent and its reasoning is sound. It is
reconciling documents, and the documents it reconciles are older than the
code. Five of its claims were true when written against `8643e6e` and are
false against `master`. Two of its priority tasks are already done.

## Claims that are now false

| Blueprint claim | Section | Measured on `master` |
|---|---|---|
| `test-guard.js`, `test-shell.js` — *"Not real tests — zero assertions, always pass"* | §2.3 | **`test-guard` 37, `test-shell` 22.** Both in CI. |
| Tier 1 task #5: *"Give `test-guard.js` and `test-shell.js` real assertions — 1.5 h"* | §6 | **Done.** Do not spend the 1.5 h. |
| `test-validate.js 23/23` | §2.2 | **36/36** — `OFF_LIMITS` was added, making durable rule 2 a control rather than documentation. |
| `code/paper-trading.js` — *"Exists, wired into nothing, no test"* | §2.3 | **`test-paper-trading.js` 22/22, in CI.** See the decision note below — this changes what you are ruling on. |
| `JX_NET` — *"Declared in package.json, read nowhere — dead flag"* | §2.3 | **Read in `code/test-net.js` and `code/test-agent-data-integration.js`.** Tier 2 task #8 is done. |

Total across the 20 CI suites, measured by running each one:

```
CI JS assertions total: 396 across 20 files
```

## Claims that are still true and still open

| Claim | Verified how |
|---|---|
| `jj status` is a stub | `bin/jj:34-38` prints `✅ Jarvis X ready` unconditionally and checks nothing. |
| No bitemporal memory exists | `grep -rln 'valid_from\|valid_to\|recorded_at\|superseded_by\|last_verified_at' code/ memory/` → no matches. `code/memory.js` is a flat append-only JSONL observer plus a `rules.md` reader. |
| Vision, the three voice paths, Kokoro and the live-data test are unmeasured | Those five files are excluded from CI by name in `.github/workflows/test.yml`; they need hardware this container lacks. Still the highest-value single task, and it needs the Chromebook. |
| `status.sh` measures inventory, not function | 19 of its 47 checks are bare `[ -f ]` / `[ -d ]` existence tests. The blueprint says 17 of 24; the ratio moved, the point stands. |
| Nothing detects a test that stopped asserting | `grep -rln 'zero assertion\|assertion count\|Passed: 0' scripts/ .github/` → no matches. |

That last row is the important one, and §4.2 is right about why: a broken
build turns CI red, but **a stale-but-passing check signals nothing**. This
session hit that failure mode four separate times — `test-data-layer.js`,
`test-shell.js`, `test-guard.js`, and `test-agent-data-integration.js` all
exited 0 while asserting nothing or skipping everything. Each was found by
hand. Nothing would have found the fifth.

## Where the blueprint describes something that now exists

§4.2 item 1 asks for *"a repairs-style audit table for the repo itself — every
automated fix gets one append-only row: what changed, why, evidence,
confidence, who approved it."*

`logs/actions.jsonl` is that table, and PR #22 (merged today) took it most of
the way there. Every gated action writes one append-only row carrying
`timestamp`, `schema`, `pid`, `origin` (`test` vs `app`), `actor` (which of the
eight entry points), `action`, `allowed`, `outcome`, and `error`. `origin` and
`actor` are both derived from `argv[1]`, so they need no cooperation from the
caller and the agent cannot set them.

What the blueprint's version has and this does not: **`confidence` and
`who approved`**. Those are the two fields that turn an audit log into the
gate §4.2 item 3 describes. That is a real gap, and a small one.

## Where the memory template's ideas already hold, and where they do not

| Template principle | State in this repo |
|---|---|
| Clock abstraction — never call the system clock from business logic | **Already the house rule.** `.github/workflows/test.yml` states it as *"a test qualifies when its inputs are arguments rather than the environment"*, and `selfdebug.js` takes `now` as a parameter for exactly this reason. |
| One writer that both paths call | **Partly.** `lib.js`'s `execute()` is the single dispatch point for actions. There is no second (sweep) path yet, so there is nothing for it to converge with. |
| Append-only, nothing ever deleted | **Holds** for `logs/actions.jsonl`. |
| Two thresholds — higher to retire than to add | **Not present.** No confidence values exist anywhere. |
| Bitemporal pair: valid time separate from transaction time | **Not present.** `memory/observed.jsonl` has one timestamp. |
| Volatility class / shelf life per fact type | **Not present.** |
| Human inbox for anything below the bar | **Present in spirit, absent in code.** Approval is a rule in `memory/rules.md` and a habit; there is no queue. |

The template's honest verdict on this repo: the two cheap, load-bearing ideas
(inject the clock, one writer, append-only) are already in force. The
bitemporal schema is genuinely unbuilt and genuinely new.

## Two things the blueprint gets right that are worth preserving verbatim

**1. The scope-discipline flag (§3) stands, and one input to it changed.** The
cut list — no trading/market intelligence, no daily content pipeline, no
multi-agent council, no self-mutating agent — is yours, it is stricter than
`CONSTITUTION.md`, and the blueprint correctly refuses to silently re-adopt
anything from it. Nothing here overrides that.

But it is now ruling on a different object than it thinks. `paper-trading.js`
is no longer unwired and untested: `test-paper-trading.js` is 22 assertions in
CI, and `config/trading.json`, `market-analyst.js`, `market-collect.js`,
`trade-advisor.js`, `market-brief.js` and `stooq-provider.js` all have suites
of their own. "Delete it" is a larger action than the blueprint's five-minute
estimate implies. That is your call, not a technical one — but you should make
it knowing what is actually there.

**2. Nothing gets exposed to the internet.** §5 keeps everything bound to
`127.0.0.1` and uses git as the sync layer. `memory/rules.md` says the same.
Unchanged.

## What has NOT been decided here

This file changes no behaviour and adopts no scope. It records what is true.

The rulings the blueprint asks for are still yours to make, and
`.claude/commands/merge-blueprint.md` walks through them one at a time on the
Chromebook rather than deciding any of them here.
