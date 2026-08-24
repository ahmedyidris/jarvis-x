# Decision Record — Gemini-based semantic-fidelity judge for P4

**Date:** 2026-08-24
**Question:** `REMAINING_WORK.md`'s P4 has an open semantic-fidelity gap (LLM garbling the *meaning* of a sourced claim — e.g. "from 125% to 125%" — not just inventing a number, which `check_numeric_fidelity()`/`enforce_numeric_fidelity()` already catch as of 2026-08-23). Build a judge to close it?

**Decision: GO. Build it now, using Gemini (remote) as the judge model — not a local model.**

## Why not a local model (already tried, already failed)

A 2026-08-23 follow-up session built exactly this — an LLM-judge second pass ("does this change the meaning of the source fact?") — using models already available locally, and tested it directly against the two known real defects before wiring anything in:

- It *did* correctly catch both real historical defects (`qwen2.5:3b` flagged both with a coherent explanation).
- But it had a **severe false-positive rate on genuinely faithful content**: `qwen2.5:3b` rejected the real, verified-correct `georisk_us-china-trade-tariffs.json` narration as "unfaithful" in **5/5** trials (once self-contradictory). `qwen2.5:7b` did better but still **5/8**, no better than a coin flip, and majority-voting across 3–5 votes did not stabilize it.
- Documented conclusion in `REMAINING_WORK.md`: *"neither locally-available model is a reliable judge for this... What would actually be needed: either a genuinely stronger model (a real frontier-tier API call, not a local 3B/7B) as the judge, or a fundamentally different check shape."*

That prior attempt was never wired in and no code was committed from it — this is a fresh build, not a revival of dead code.

## Why Gemini specifically satisfies "genuinely stronger model"

- Already integrated: `code/gemini.js` has a working `ask()`/`askFallback()` against `gemini-3.6-flash` (quick, free tier) and `gemini-3.5-flash` (hard tier, free tier) with API key loaded from `~/.jarvis-x/.env`, gated through `guard()`.
- Using a remote frontier-tier model for this does **not** conflict with `CONSTITUTION.md`'s "no cloud dependency" — that constraint is already understood (per `knowledge/Guidelines.md`'s quick/hard/max tiers, and `[[jarvis-x-project]]` memory's 2026-08-13 finding) to apply to the core local-first web-chat path (`app.py` → `code/router.py`, 100% local Ollama), not to the separate agent-autonomy path, which already calls Gemini remotely by design. A P4 eval-time judge is architecturally the same category as the agent-autonomy path, not the core chat path.
- Scope is explicitly **eval-time only** — it gates whether generated content ships, it is not part of the always-on runtime chat loop.

## What "build it" concretely requires (design work, not yet done — see follow-up)

The prior attempt's own postmortem names two viable shapes:
1. Open-ended "is this faithful?" judgment call — same shape as before, just handed to Gemini instead of qwen. Simplest, but inherits the same *risk class* (an LLM judge, just presumably more reliable) — needs its own false-positive testing against the same known-faithful fixture before it's trusted as a hard gate.
2. Structured extraction (pull numbers/dates/relationships from both source and generated text into a comparable form) + deterministic diff on that — more engineering, but removes open-ended judgment from the loop entirely for the parts that can be structured.

Not deciding between these here — that's implementation design, tracked as the immediate next step (brainstorming/build session), not a blocking decision.

## Net

- Local-model judge path stays confirmed closed (evidence preserved in `REMAINING_WORK.md`, not re-litigated).
- Gemini judge was built (`check_semantic_fidelity()`/`enforce_semantic_fidelity()`/`_call_gemini_judge()` in `content_generator.py`, 15/15 unit tests passing) and run against the acceptance test this record specified.

**AMENDED 2026-08-24, same day, after running the acceptance test: the GO is retracted for production use.** `scripts/verify/07_semantic_fidelity_live.py`'s live (unmocked) run against the known-faithful fixture reproduced the exact disqualifying failure mode this record required ruling out: **5/5 false-positive rejections**, identical to qwen2.5:3b's original rate. Full detail and raw output in `REMAINING_WORK.md` P4's 2026-08-24 addendum and `scripts/verify/output/07_semantic_fidelity_live.json`.

- **Not wired into any generator.** The code is left in place, tested, and available (same treatment `DECISION_RECORD_model-gateway.md` gave a fully-built-but-unwired package) — it is not deleted, because the failure traced to the judge *prompt's* strictness (an unqualified "does this change the meaning," which flags any narrative compression), not to broken code, and a future retry with a compression-tolerant prompt or a structured-extraction-diff approach can reuse it directly.
- P4's semantic-fidelity gap is **still open**. Two consecutive attempts (local model, then Gemini) have now failed the same acceptance bar for different underlying reasons — see `REMAINING_WORK.md` for what's recommended before a third attempt.


## SECOND AMENDMENT — 2026-08-24, later same day: the retraction was wrong, GO reinstated for review use

The retraction above rests on "5/5 false-positive rejections of the known-faithful
fixture." **That fixture was not known-faithful.** It was assumed clean and never
verified. It contained two real factual errors, both of which had shipped:

1. **Caption:** `New Tariff Halted; Forced Labor Ban Violation Raises US Rate`.
   The NEW 12.5% Section 301 tariff *took effect* 2026-07-24; what was paused was
   the reciprocal tariff's rise to 125%. The caption reverses which tariff was
   stopped. "Forced Labor Ban Violation" also misattributes — the source says
   China failed to *enforce* its forced-labor import ban.
2. **Narration:** `In the meantime, a new 12.5% tariff went into effect`.
   "In the meantime" places the July 24 tariff *inside* the 90-day pause
   announced August 11 — inverting the sequence. Same temporal-inversion class
   as the `previous_fall` / `earlier_this_year` defect this judge catches cleanly.

With both corrected, the same judge, same prompt, same model returns **0/5**
rejections (`scripts/verify/output/07_semantic_fidelity_live.json`).

The retraction's causal diagnosis — that the prompt is too strict and "flags any
narrative compression" — does not survive the evidence. Gemini never cited
compression. Every objection named a specific factual error, and the objections
changed as each error was fixed: the caption complaint disappeared after fix 1,
the temporal complaint after fix 2.

**qwen2.5:3b's original 5/5 was likely also correct on this content.** The
local-model path is not being reopened (7b's 5/8 remains genuinely unstable),
but that evidence was misread the same way.

### Status: GO for deliberate review use. NOT for automatic gating.

Two real limits, both observed directly:

- **Nondeterministic recall.** A mid-fix run detected the remaining temporal
  defect in only 3/5 trials. Majority-voting across trials would be needed
  before this could gate anything.
- **Free-tier quota.** The final run exhausted quota mid-suite (HTTP 429).
  Fail-closed treated that as a failure, which is correct — but it means an
  exhausted quota would block every generation. The summary line also renders
  "judge could not run" identically to "judge did not detect"; worth separating.

`enforce_semantic_fidelity()` remains unwired in all three generators. That is
still the right call — for the reasons above, not for the reason originally given.

### What this cost

Two judge evaluations and three sessions were spent diagnosing a judge failure
that was a content failure. The generalizable lesson: **an acceptance fixture is
itself an assumption and needs verifying before it can disqualify anything.**
