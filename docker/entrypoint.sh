#!/usr/bin/env bash
# Container entrypoint: pull Ollama models on first start (skipped if
# already present in the volume-backed model store -- so a container
# recreate doesn't re-download 8.6GB every time), then hand off to
# supervisord as PID 1.
set -euo pipefail

export HOME=/root
export OLLAMA_MODELS=/root/.ollama/models
mkdir -p "$OLLAMA_MODELS"

echo "==> Starting Ollama daemon (background, for model pulls)..."
/usr/local/bin/ollama serve &
OLLAMA_PID=$!

echo "==> Waiting for Ollama to be reachable..."
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
  sleep 1
done

echo "==> Ensuring models are present (skips any already pulled)..."
for m in qwen2.5:3b qwen2.5:7b moondream nomic-embed-text; do
  if ! ollama list 2>/dev/null | grep -q "^$m"; then
    echo "  pulling $m..."
    ollama pull "$m" || echo "  (skipped $m — pull failed, retry manually: docker exec <container> ollama pull $m)"
  else
    echo "  $m already present"
  fi
done

echo "==> Stopping the temporary Ollama process; supervisord will manage the real one."
kill "$OLLAMA_PID" 2>/dev/null || true
wait "$OLLAMA_PID" 2>/dev/null || true

echo "==> Handing off to supervisord (manages ollama + hermes-api)..."
exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/jarvis-x.conf
