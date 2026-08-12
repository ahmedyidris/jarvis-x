#!/usr/bin/env bash
# One-shot local setup: venv, deps, embedding model, seed vector store.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi

./.venv/bin/pip install --upgrade pip -q
./.venv/bin/pip install -r requirements.txt -q

if command -v ollama >/dev/null && ! ollama list | grep -q nomic-embed-text; then
  echo "pulling nomic-embed-text (~274MB) for local embeddings..."
  ollama pull nomic-embed-text
fi

./.venv/bin/python scripts/seed_store.py

echo "done. Try:  ./.venv/bin/python eval/eval_harness.py"
echo "or serve:   ./.venv/bin/uvicorn app.main:app --reload --port 8420"
