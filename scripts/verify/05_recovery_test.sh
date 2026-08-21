#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."

# hermes-api runs from the MAIN checkout (see config/supervisord.conf's
# `directory=/home/ahmedyidris/jarvis-x`), and both app.py's STOP_FILE and
# code/guard.js's STOP_FILE resolve relative to wherever those files
# physically live. This worktree is a separate checkout, so touching
# .jarvis-x-STOP here would create a file the live service never sees.
# Steps that need to engage/disengage/inspect the *live* kill switch run
# node against the main checkout instead of this worktree.
MAIN_CHECKOUT=/home/ahmedyidris/jarvis-x

mkdir -p scripts/verify/output
LOG=scripts/verify/output/05_recovery_test.log
: > "$LOG"

echo "=== Phase 1A / Task 5: kill-switch + supervisord restart + restore ===" | tee -a "$LOG"

echo "--- 5.0 checking prior kill-switch state (against live main checkout) ---" | tee -a "$LOG"
PRIOR=$(cd "$MAIN_CHECKOUT" && node code/stop.js status)   # STOPPED or RUNNING
echo "prior state: $PRIOR" | tee -a "$LOG"
if [ "$PRIOR" = "STOPPED" ]; then
  echo "Kill switch is already engaged (system deliberately halted) -- refusing to run this recovery test." | tee -a "$LOG"
  exit 1
fi

echo "--- 5.1 engage kill switch (against live main checkout: $MAIN_CHECKOUT) ---" | tee -a "$LOG"
(cd "$MAIN_CHECKOUT" && node code/stop.js) | tee -a "$LOG"
(cd "$MAIN_CHECKOUT" && node code/stop.js status) | tee -a "$LOG"   # expect STOPPED

# Safety net: from here on, the live main checkout's kill switch is engaged.
# Guarantee it gets restored to its PRIOR state (checked in 5.0, above -- by
# construction always RUNNING at this point, since a prior STOPPED state
# already caused an early exit before anything was touched) on ANY exit path
# (normal completion, an assertion failure below, or set -euo pipefail
# aborting on an unexpected error), so a bug in this script can never leave
# the live system halted, and so it never un-halts a system Ahmed deliberately
# stopped before running this script. Silenced (both streams) since step 5.4
# already disengages explicitly and logs that on the success path -- this
# trap firing there too is a harmless, idempotent no-op (node code/stop.js off
# uses rmSync force:true) and should not appear as a second, confusing
# "disengage" line in the log.
trap '
  if [ "$PRIOR" = "RUNNING" ]; then
    (cd "$MAIN_CHECKOUT" && node code/stop.js off) >/dev/null 2>&1 || true
  fi
' EXIT

echo "--- 5.2 confirm the API refuses a generate request while stopped ---" | tee -a "$LOG"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8000/api/dashboard/generate/letters)
echo "generate/letters while stopped -> HTTP $CODE" | tee -a "$LOG"
if [ "$CODE" != "503" ]; then
  echo "FAIL: expected 503, got $CODE" | tee -a "$LOG"
  exit 1
fi

echo "--- 5.3 confirm guard.js blocks a guarded JS action while stopped (against live main checkout) ---" | tee -a "$LOG"
(cd "$MAIN_CHECKOUT" && node -e "
const { execute } = require('./code/lib.js');
execute({ type: 'list', path: '.' })
  .then(() => { console.error('FAIL: execute() did not throw while stopped'); process.exit(1); })
  .catch(e => { console.log('blocked as expected:', e.message); });
") | tee -a "$LOG"

echo "--- 5.4 disengage kill switch (against live main checkout) ---" | tee -a "$LOG"
(cd "$MAIN_CHECKOUT" && node code/stop.js off) | tee -a "$LOG"
(cd "$MAIN_CHECKOUT" && node code/stop.js status) | tee -a "$LOG"   # expect RUNNING

echo "--- 5.5 supervisord restart resilience ---" | tee -a "$LOG"
supervisorctl -c config/supervisord.conf restart hermes-api | tee -a "$LOG"
PASS_RESTART=0
for i in $(seq 1 15); do
  if curl -sf http://localhost:8000/api/status | grep -q '"status":"online"'; then
    echo "PASS: hermes-api healthy after restart (attempt $i)" | tee -a "$LOG"
    PASS_RESTART=1
    break
  fi
  sleep 1
done
if [ "$PASS_RESTART" != "1" ]; then
  echo "FAIL: hermes-api did not come back healthy after restart" | tee -a "$LOG"
  exit 1
fi

echo "--- 5.6 restore.sh against a throwaway destination (never touches the live install) ---" | tee -a "$LOG"
LATEST_BACKUP=$(ls -t ~/jarvis-x-backup-*.tar.gz | head -1)
DEST=/tmp/jarvis-restore-verify-$$
echo "using backup: $LATEST_BACKUP -> $DEST" | tee -a "$LOG"
scripts/restore.sh "$LATEST_BACKUP" --dest "$DEST" | tee -a "$LOG"
if [ ! -f "$DEST/jarvis-x/app.py" ] || [ ! -d "$DEST/jarvis-x/.git" ]; then
  echo "FAIL: restored tree at $DEST is incomplete" | tee -a "$LOG"
  exit 1
fi
echo "PASS: restore produced a real, complete tree at $DEST" | tee -a "$LOG"
rm -rf "$DEST"

echo "=== Task 5: ALL PASS ===" | tee -a "$LOG"
