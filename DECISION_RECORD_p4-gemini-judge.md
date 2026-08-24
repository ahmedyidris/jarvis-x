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
