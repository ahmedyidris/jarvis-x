# Sentinel — Autonomous Incident Response Copilot

A portfolio project living inside the jarvis-x repo, **separate from the
jarvis-x autonomous agent itself** — it doesn't go through `guard.js`, the
kill switch, or `CONSTITUTION.md`; it just borrows the same local Ollama
runtime (`qwen2.5:3b`) that Hermes Core uses.

Given an incident description (alert payload, log excerpt, on-call
message), a 5-agent graph triages severity/category, retrieves similar
past incidents/runbooks, proposes a grounded root-cause hypothesis, has a
critic agent check that hypothesis against the evidence before accepting
it, and writes a markdown incident report.

## Status: MVP scaffold (Week 1-2 of the 12-week plan)
This is a working vertical slice, not the finished portfolio piece. See
`eval/rubric.md` for what "finished" means, and the published project
spec doc (linked from the top-level chat, or ask for the link again) for
the full 12-week roadmap — VOID dataset ingestion, Langfuse tracing,
CI-gated eval, dashboard UI.

## Architecture

```
triage → retriever → hypothesis → critic ─(ungrounded, <2 revisions)─→ hypothesis
                                      └─(grounded, or revisions used)─→ report_writer
```

| Agent | HuggingFace task it stands in for | Implementation here |
|---|---|---|
| `triage` | Token Classification + Zero-Shot Classification | prompted `qwen2.5:3b` |
| `retriever` | Sentence Similarity / Feature Extraction | `nomic-embed-text` via Ollama + SQLite cosine scan |
| `hypothesis` | Text Generation (grounded) | prompted `qwen2.5:3b` |
| `critic` | LLM-as-judge groundedness check | prompted `qwen2.5:3b` |
| `report_writer` | Summarization | prompted `qwen2.5:3b` |

### HF-task mapping note
The original pitch called for dedicated HF pipelines (e.g.
`dslim/bert-base-NER`, `facebook/bart-large-cnn`). This Chromebook has
~3.6GB free disk, so this scaffold uses one local LLM prompted to do each
task instead of pulling in `transformers`/`torch`. The seams are already
in place (`agents/triage.py`, `agents/report_writer.py`) to swap in real
HF pipelines — either local, or via the HF Inference API to avoid the
torch install entirely — without touching the graph wiring in
`app/graph.py`.

## First real eval run (n=3, 2026-08-12)
```
triage_accuracy:         0.67   (target ≥ 0.90 — inc-3 misclassified)
avg_hypothesis_score:    3.89   (target ≥ 3.5  — pass)
avg_groundedness_score:  2.00   (target ≥ 4.0  — critic rejected 3/3, hit revision cap)
report_completeness_rate:1.00   (target 1.0    — pass)
```
Retrieval recall@3 isn't scoreable yet — the seed corpus has exactly 3
runbooks, so top-3 trivially returns all of them. 2 of 5 gates failed,
which is the harness doing its job on a first real run, not a bug to
paper over. See `eval/eval_report.json` for the per-case breakdown and
`eval/rubric.md` for what each threshold means.

## Quickstart

```bash
cd sentinel
./scripts/setup.sh                 # venv, deps, embedding model, seed vector store
./.venv/bin/python eval/eval_harness.py   # run the 3 sample incidents end-to-end
./.venv/bin/uvicorn app.main:app --reload --port 8420   # or serve it
```

```bash
curl -s localhost:8420/incident -X POST \
  -H 'content-type: application/json' \
  -d '{"text": "Checkout latency spike, 5xx errors, connection pool exhausted after order-service v2.14 deploy"}' | jq
```

## Layout

```
sentinel/
  app/          FastAPI entrypoint + LangGraph wiring + shared state schema
  agents/       one file per node (triage, retriever, hypothesis, critic, report_writer)
  store/        SQLite-backed vector store + Ollama embeddings client
  eval/         rubric.md (scoring dimensions + CI thresholds) + eval_harness.py
  data/         sample incidents, seed runbooks, generated vector_store.db (gitignored)
  scripts/      setup.sh, seed_store.py
  tests/        import-only smoke tests (no model call, safe for CI)
```

## Roadmap (see eval/rubric.md and the project spec artifact for detail)
- Swap `sample_incidents.json` for a labeled sample of the public
  [VOID](https://www.thevoid.community/) postmortem dataset
- Add Langfuse tracing + a $/incident and p95 latency dashboard
- Gate merges on eval/rubric.md thresholds in CI
- Optional cloud fallback (Anthropic/OpenAI) behind the same `agents/llm.py` seam
