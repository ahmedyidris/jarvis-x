# Decision record — the autonomous trading loop, and why it is not built

*Opened 2026-09-09 by the remote session, on branch
`claude/resume-building-jarvis-97b0mv`.*

***RULED 2026-09-09: Ahmed chose option C — automate only the exits.**
Entries stay gated; a breached stop closes unattended. The ruling is
recorded here; the amendment it calls for is drafted below and **has not been
applied** — `CONSTITUTION.md` is untouched. §VII: Jarvis proposes, Ahmed
reviews, Ahmed commits. See "The amendment, drafted for Ahmed to commit".*

## The one-sentence version

`PLAN_5` §6.1 lists a **bot trader** as part of trading phase 1.
`CONSTITUTION.md` §III gates **proposing a paper trade** on one-tap human
approval. A bot that generates and executes its own proposals cannot satisfy
both, so I stopped and wrote this instead of building it.

## The conflict, in the two files' own words

`CONSTITUTION.md` §III, GATED ACTIONS (One-Tap Approval Required):

> Jarvis must ask for approval before:
> …
> - Proposing a paper trade. Proposing is gated; opening and closing run
>   through `guard()` like any other action.

`docs/PLAN_5.md` §7 item 6, Tier 2:

> **Trading, phase 1** (§6.1): bot trader, TradingView signals, local models on
> analysis, paper execution on the six instruments, and the honest performance
> measurement…

And the codebase already took a side. `code/trade-advisor.js`'s header:

> **WHAT IT DELIBERATELY DOES NOT DO: execute.** It never calls `book.open()`
> or `book.close()`. `CONSTITUTION.md` §III gates "Proposing a paper trade" on
> a human… **An advisor that executed its own advice would make that gate
> decorative.** `code/test-trade-advisor.js` asserts this with a book that
> throws if either method is touched.

That last sentence is the important one: the prohibition is not merely written
down, it is **enforced by a test** that fails if the advisor ever touches the
executor. Building a loop that proposes and opens would mean either working
around that test or deleting it, and deleting a control to make room for a
feature is the exact move this repo has spent its whole history correcting.

## What I built instead, and what I did not

**Built** (shipped in this PR): `code/trading-performance.js`, the measurement
clause of phase 1. It is read-only, imports `fs` and `path` and nothing else,
and its strongest possible verdict is `promising` — never `approved`. It needs
no ruling because measuring is not proposing.

**Not built**: the bot-trader loop, and with it the scheduled paper execution
that would populate `logs/trading-journal.jsonl`. This is the honest reason the
measurement currently reports `insufficient-evidence` on an empty journal: it
works, and there is nothing to measure, and there will be nothing to measure
until this decision is made.

## The options

**A. Leave §III as written. Jarvis proposes, Ahmed taps, Jarvis executes.**
Phase 1 becomes a proposal queue plus a one-tap approval surface, not a bot.
Costs: no unattended trading, so the 30-trade / 30-day evidence bar in
`trading-performance.js` fills at the speed of Ahmed's attention, and phase 2's
measured result is months away rather than weeks. Keeps every existing control
intact and needs no amendment.

**B. Amend §III to exempt paper proposals within the enforced limits.**
The argument for it: `CONSTITUTION.md` §IV already forbids real-money trading
absolutely, `config/trading.json`'s six-instrument limit, per-trade risk and
daily loss limit are enforced in `code/paper-trading.js` and proven by
`code/test-paper-trading.js`, and the module takes prices as arguments and
opens no sockets — so there is no code path to a broker for an autonomous loop
to reach. On that reading the §III gate is protecting against a risk §IV
already eliminates, at the cost of the evidence phase 2 needs.
The argument against: §III's gate is also what stops the *volume* of activity
in the audit log being set by a machine, and "the simulation is harmless" is
precisely the reasoning that would need to hold when someone later proposes
pointing the same loop at something that is not a simulation.
This is a §VII amendment: Jarvis proposes, Ahmed reviews, Ahmed commits.

**C. A narrower amendment: automate only the exits.**
Closing a position whose stop is breached is arguably not "proposing a trade"
at all — the stop was agreed when the position opened, and
`code/trade-advisor.js` already treats a breached stop as outranking every
other signal ("the stop was set when the position opened, not now"). Entries
stay gated; risk management runs unattended. This is the smallest change that
makes the paper book behave like a real one, and it fails safe: the automated
half only ever *reduces* exposure.

**My read, offered as input and not as a decision — and the one Ahmed took:**
C is the one I would take first. It is the only option where the automated behaviour can only shrink the
book, it needs no new signal source (the stops already exist), and it leaves
the contested question — whether a machine may open positions unattended —
untouched for a later, better-informed decision. B is a bigger step than it
looks, and A is honest but slow.


## The amendment, drafted for Ahmed to commit

**Nothing in this section has been applied.** `CONSTITUTION.md` is unmodified
on this branch — `git log -- CONSTITUTION.md` will show no commit from this
session. §VII forbids Jarvis modifying that file, and `HANDOFF.md`'s ownership
table records it as Ahmed-only. A ruling in chat authorises the *direction*;
only Ahmed's commit makes it the constitution. Until that commit lands, the
unattended-exit path below **is not built**, because building it first would
mean shipping behaviour the constitution currently forbids on the strength of
a message rather than the file.

### 1. The §III change

Current text:

```
- Proposing a paper trade. Proposing is gated; opening and closing run
  through guard() like any other action.
```

Proposed replacement:

```
- Proposing a paper trade, and opening a position. Both are gated.
  Closing a position whose pre-agreed stop is breached is NOT gated: the
  limit was set when the position opened, by a human tap, and enforcing it
  is not a new decision. That exemption is narrow on purpose — it covers a
  breached stop and nothing else. A close for any other reason (a signal, a
  target, a rebalance, a judgement call) is gated like an open. Both paths
  still run through guard() and still write an audit row; the exemption is
  from the human tap, never from the audit trail.
```

Why the wording is shaped this way, since the wording is the whole safeguard:

- **It names what is exempt, not what is gated.** An exemption phrased as
  "closing is not gated" would cover every close, including a discretionary
  one, which is not what was ruled. The carve-out has to be the narrow half.
- **It ties the exemption to the prior human tap.** The reason a stop-close
  is not a new decision is that a human already agreed the stop when the
  position opened. If entries ever stop being gated, this justification
  collapses with them — and the sentence says so by construction rather than
  in a comment somewhere else.
- **It keeps `guard()` and the audit row.** The ruling removes the tap, not
  the record. `logs/actions.jsonl` must still show every close, or the
  measurement clause is reading a journal the audit trail cannot corroborate.
- **It fails safe.** The automated half can only reduce exposure. Nothing
  here lets a machine open a position, and §IV's absolute ban on real-money
  trading is untouched and unmentionable in this context — no amendment to
  §III can reach it.

### 2. The test narrowing, in the same commit

`code/test-trade-advisor.js` hands `advise()` a book that throws if `open()`
or `close()` is touched. That test is what makes the gate real rather than
documented, so it must be narrowed **deliberately and in the same commit as
the amendment** — never quietly relaxed, and never before.

The narrowing is: the book still throws on `open()`, and still throws on
`close()` for every reason except a breached stop. Concretely, the throwing
book gains one permitted call — `close()` where the advisor's own
`because[0]` matches `/past the agreed stop/`, the string
`code/trade-advisor.js` already emits — and a new test asserts that a
`close()` for any other reason still throws. That way the test surface after
the change is *larger*, not smaller: it now pins both what the exemption
permits and what it still forbids.

### 3. What gets built once the amendment is committed

In order, each with tests and mutation coverage before the next:

1. A stop-breach executor that consumes `advise()`'s existing `CLOSE`
   recommendations — the detection already exists in `code/trade-advisor.js`
   and needs no new signal source, which is part of why C is the small change.
2. Its wiring into `code/scheduler.js`, behind `guard()` and the kill switch
   (`.jarvis-x-STOP`), so the halt path covers it like every other agent
   action.
3. The scheduled paper execution that would populate
   `logs/trading-journal.jsonl`, insofar as it means UNATTENDED proposals —
   executing proposals Ahmed has already tapped never needed a ruling.

**HOW MUCH THIS ACTUALLY UNBLOCKS, corrected 2026-09-15.** This section
previously said "the remaining three of trading phase 1's five clauses, which
were blocked only by this ruling", and the same overstatement reached the PR
description and several status messages as "four of five". Both are wrong, and
they do not even agree with each other.

Checked against §III's actual words — it gates *proposing a paper trade* — the
four unbuilt clauses divide like this:

| Clause | Blocked by §III? |
|---|---|
| The bot-trader loop | **Yes.** It generates and executes its own proposals. |
| Scheduled paper execution | **Partly.** Unattended *generation* is gated; executing an already-tapped proposal is not. |
| TradingView signals | **No.** A data feed is not a proposal. |
| Local models on analysis | **No.** Analysis is not a proposal. |

So the ruling clears **one clause outright and part of a second**. The other
two were never blocked by anything except nobody having built them. That
matters for deciding: the amendment is worth making on its own merits, but it
is not the thing standing between this repo and a working trading leg.

`code/trading-performance.js` needs no change: it measures whatever reaches
the journal, and its strongest verdict stays `promising`. The 30-trade /
30-day evidence bar is unaffected by this amendment and is not a thing option
C makes easier to clear — exits alone do not open positions, so the journal
still fills at the speed of gated entries. That is worth being plain about,
because "automate the exits" can read as "phase 2 arrives sooner" and it does
not.

## What must not happen

- **No option here permits real-money trading.** `CONSTITUTION.md` §IV forbids
  it absolutely and none of A, B or C touches that. Any future change there is
  a separate amendment against a *measured* phase-1 result, per Ahmed's
  "1 then 2".
- **Neither agent amends `CONSTITUTION.md`.** §VII: Jarvis proposes, Ahmed
  reviews, Ahmed commits. `HANDOFF.md`'s ownership table records the same file
  as Ahmed-only. This document is the proposal step and nothing more — and
  that remains true *after* the ruling: option C being chosen does not convert
  this file into an amendment, it only fills in which amendment to draft.
- **`code/test-trade-advisor.js`'s throwing book stays.** Whatever is decided,
  that test is what makes the answer real rather than documented, and if option
  B or C is taken it should be *narrowed* deliberately, in the same commit as
  the amendment, not quietly relaxed.

## A related correction made while writing this

`code/guard.js`'s schema v5 `APPROVERS` was `['human', 'agent', 'oracle']`,
taken from `docs/incoming/MEMORY_TEMPLATE.txt` §5. `CONSTITUTION.md` §V
specifies the audit row's `"approved_by": "human|jarvis"`. The template is
reference material that `PLAN_5` §0 says explicitly does not set scope; the
constitution is the written law. Corrected to `['human', 'jarvis']` in this PR
— a gate whose vocabulary disagrees with the constitution it enforces is the
quietest way for the two to drift apart, and `guard.js` is itself named in
§III as a file whose modification is gated.
