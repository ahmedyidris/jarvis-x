# Sentinel Eval Rubric

Every scored run produces these dimensions (1-5 unless noted). This is the
gate that would run in CI before shipping a prompt/agent change.

| Dimension | What it measures | Scoring |
|---|---|---|
| **Triage accuracy** | Predicted `category` matches expected label | pass/fail |
| **Retrieval relevance** | Correct runbook appears in top-3 retrieved | recall@3 |
| **Hypothesis correctness** | Root cause hits the expected keywords/concepts | keyword overlap + LLM-judge 1-5 |
| **Groundedness** | Critic's own `grounded`/`score` output, sanity-checked against evidence | 1-5, from `critic_node` |
| **Report completeness** | All 6 required sections present, under 200 words | pass/fail |

## CI gate (recommended thresholds)
- Triage accuracy ≥ 90%
- Retrieval recall@3 ≥ 80%
- Hypothesis LLM-judge score ≥ 3.5 avg
- Groundedness score ≥ 4.0 avg
- Zero reports missing a required section

A prompt/agent change that drops any threshold should fail CI rather than
merge — this is what "eval-gated" means in the LLMOps story, not just
running eval.py manually once.

## Scaling this rubric
The 3 toy incidents in `data/sample_incidents.json` exist to prove the
harness runs end-to-end. For a portfolio-strength eval, replace/extend
with a sample from [VOID](https://www.thevoid.community/) (public
postmortem dataset) — pull 30-50 postmortems, hand-label expected
category + root-cause keywords once, and rerun this same harness.
