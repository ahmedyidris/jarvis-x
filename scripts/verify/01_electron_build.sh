#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p scripts/verify/output
LOG=scripts/verify/output/01_electron_build.log
: > "$LOG"

echo "=== Phase 1A / Task 1: Electron build + launch + restart ===" | tee -a "$LOG"

echo "--- npm install ---" | tee -a "$LOG"
(cd electron && npm install) 2>&1 | tee -a "$LOG"

echo "--- ensuring hermes-api is reachable on :8000 ---" | tee -a "$LOG"
supervisorctl -c config/supervisord.conf start hermes-api >/dev/null 2>&1 || true
for i in $(seq 1 10); do
  if curl -sf http://localhost:8000/api/status >/dev/null; then break; fi
  sleep 1
done
curl -sf http://localhost:8000/api/status >/dev/null || {
  echo "FAIL: hermes-api not reachable on :8000" | tee -a "$LOG"; exit 1;
}

run_once() {
  local label="$1"
  echo "--- launch attempt: $label ---" | tee -a "$LOG"
  local out
  out=$(cd electron && timeout 20 npm start 2>&1) || true
  echo "$out" | tee -a "$LOG"
  if echo "$out" | grep -q "JARVIS_ELECTRON_LOADED"; then
    echo "PASS ($label): dashboard loaded" | tee -a "$LOG"
  else
    echo "FAIL ($label): JARVIS_ELECTRON_LOADED never printed" | tee -a "$LOG"
    exit 1
  fi
}

run_once "initial launch"
pkill -f "$(pwd)/electron/node_modules/electron/dist/electron" 2>/dev/null || true
sleep 1
run_once "relaunch after kill (restart survival)"

echo "=== Task 1: ALL PASS ===" | tee -a "$LOG"
