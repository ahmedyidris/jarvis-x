# Decision: adopt AVO's supervisor, decline AVO's autonomy

**Date:** 2026-09-04 · **Status:** decided (partial adoption)
**Prompted by:** Ahmed — "check Avo by Nvidia and include and integrate in
Jarvis as well, find the perfect role for it"

---

## What AVO actually is

NVIDIA **AVO — Agentic Variation Operators**. Announced August 2026. It is not
a model. It is a harness that wraps one, and the headline result is exactly
that distinction: **Claude Opus 5 scores 30% on ARC-AGI-3 alone; inside AVO it
scores 100%**, completing all 183 levels across the 25 public environments in
6,624 environment operations — about 12% fewer than VISTA's disclosed 7,542.
Same model, no retraining, no fine-tune. The harness was the difference.

Two mechanisms carry that result:

1. **Persistent memory** — prior implementations, evaluation results, compiler
   and profiler output and accumulated reasoning are carried forward, so the
   agent resumes from the current state instead of reconstructing the search
   every time.
2. **A supervisor** — a separate process watching the *trajectory* rather than
   the step, detecting stagnation and repeated unproductive cycles, and
   redirecting the main agent toward a different strategy.

### Three caveats, stated before the enthusiasm

- **There is nothing to install.** NVIDIA released a paper, not code, weights,
  or an API. Any claim that Jarvis "uses AVO" would be false. What is portable
  is the design.
- **The 100% covers the public set only.** ARC Prize's semi-private and private
  held-out sets are untested. A perfect score on the visible half of a
  benchmark is a weaker claim than it reads as.
- **Its premise is long-horizon autonomy** — days of unsupervised work. That is
  the part of AVO Jarvis cannot take.

## The role: supervisor over the scheduler. Not the rest.

`code/scheduler.js` runs goals on a timer with nobody at the gate. It has been
writing `{goal, model, proposed, outcome}` to `logs/scheduled.jsonl` since it
was built, and **nothing has ever read that file back**. A goal that proposes
the identical action for the identical result every fifteen minutes burns an
LLM call each interval to learn nothing, and no part of this system could
notice. That is precisely the trajectory-level stagnation AVO's supervisor
exists to catch, sitting in a repo that already produces the trace it needs.

`code/supervisor.js` reads that log and returns one of five verdicts per goal —
`insufficient`, `productive`, `stagnant`, `failing`, `queue-flooding` — each
with its reasoning attached. `scheduler.js` consults it before firing, in the
same place and for the same reason as the existing `isStopped()` check: the
cheapest model call is the one not made.

**Why this component and not the others.** A supervisor's only possible output
is subtraction. It can withhold a run; it cannot add one, cannot widen a
permission, cannot execute anything, and does not touch `schedules.json`. Its
test asserts the module contains no `writeFileSync`, `appendFileSync`,
`spawnSync`, `execSync` or `unlinkSync` at all. AVO's persistent memory and its
autonomy would both move Jarvis toward acting more without a human; the
supervisor moves it toward acting less. Under `CONSTITUTION.md` that asymmetry
is the whole argument.

Jarvis already has the memory half in weaker form — `code/memory.js` over
`memory/rules.md` and `logs/observed.jsonl`, plus graded proposals in
`logs/proposals.jsonl` and `scripts/score.sh`. AVO's version is richer, but
richer memory in service of longer unattended runs is the thing being declined,
so it stays as it is.

## Two failure modes found while building it, both fixed

**A verdict that proved itself.** The supervisor's own skip entries land in the
log it reads. Left unclassified they filled the judgement window with identical
rows, so after five skips a goal was judged stagnant *because it had been
skipped* — a self-confirming verdict with no way out. Skip entries are now
classified `supervised` and excluded from judgement entirely.

**A false positive that disabled working goals.** The first fingerprint
compared the outcome's *class* rather than its text, reasoning that outcome
tails are noisy. Backwards: a goal like "summarise today's changes" returns
different text every day and the same class every day, so it was judged
stagnant and silently switched off. Real output is now compared in full; only
errors, rejections and queue entries — which have their own branches anyway —
compare by class. This was the worst mistake the module could make, since its
failure is invisible: the goal simply stops running.

**A skip is never permanent.** After 20 consecutive skips one run is let
through to re-test the verdict. An API key may have appeared, the queue may
have been drained, the environment may have changed. A skip that never lifts is
a deletion nobody agreed to.

## What was NOT done

- No claim anywhere that Jarvis runs AVO. It runs one idea from AVO's paper.
- No fine-tune, no NVIDIA dependency, no GPU requirement. `supervisor.js` is
  120 lines of `fs` and arithmetic.
- No extension of unattended authority. The read-only-unattended rule in
  `scheduler.js` is untouched; the supervisor narrows what runs, never widens it.

## Evidence

- `code/supervisor.js`, `code/test-supervisor.js` — 20 assertions, offline.
- `code/scheduler.js` — the `shouldSkip()` call, next to `isStopped()`.
- Verdicts and reasoning: `node code/supervisor.js`.

## Sources

- [NVIDIA Technical Blog — AVO reaches 100% on ARC-AGI-3](https://developer.nvidia.com/blog/nvidia-avo-reaches-100-on-arc-agi-3-demonstrating-a-frontier-level-general-purpose-architecture-for-long-horizon-autonomous-agents/)
- [The New Stack — Claude Opus 5 scored 30% on ARC-AGI-3. Wrapped in NVIDIA's AVO, it hit 100%](https://thenewstack.io/nvidia-avo-arcagi3-benchmark/)
- [HyperAI — NVIDIA AVO agent tops ARC-AGI-3 with a perfect score](https://hyper.ai/en/stories/e5e7aef0276bd2ce091ea21dbc7a78d1)
- [explainx.ai — NVIDIA AVO: 100% ARC-AGI-3 score, public set only](https://www.explainx.ai/blog/nvidia-avo-arc-agi-3-100-percent-long-horizon-agents-august-2026)
