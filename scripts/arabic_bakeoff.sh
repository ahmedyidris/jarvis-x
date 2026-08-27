#!/usr/bin/env bash
# Usage: bash scripts/arabic_bakeoff.sh <ollama-model-tag>
M="$1"
export OLLAMA_MODELS="/usr/share/ollama/.ollama/models"
PROMPTS=(
  "اتكلم معايا بالمصري بس. انت مين؟"
  "قوللي نكتة مصرية قصيرة."
  "إيه أحسن أكلة مصرية ولييه؟"
  "اشرحلي بالمصري يعني إيه ذكاء اصطناعي، جملتين."
)
echo "######## $M ########"
for p in "${PROMPTS[@]}"; do
  echo "--- Q: $p"
  timeout 180 ollama run "$M" "$p" 2>/dev/null
  echo
done
