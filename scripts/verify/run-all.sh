#!/bin/bash
# Runs the verify scripts and reports a real pass/fail for each.
#
# These existed but nothing invoked them -- not npm test, not status.sh, not
# the nightly cron -- so results were whatever someone last ran by hand.
# Worse, piping a verify script to tail/grep reports the PIPE's exit code:
# 03_e2e_flow_test.py called sys.exit(1) on a hard failure and the pipeline
# still reported 0, so any runner built that way logs failures as passes.
set -uo pipefail
cd "$(dirname "$0")/../.."

MODE="${1:-fast}"
OUT=scripts/verify/output
mkdir -p "$OUT"

# Excluded from the default run because they are slow or disruptive:
#   01 launches Electron twice (~40s, opens windows)
#   03 triggers a real content+TTS+video render (~65s on an idle Ollama)
#   05 stops and restarts services
SLOW="01_electron_build.sh 03_e2e_flow_test.py 05_recovery_test.sh"

pass=0; fail=0; skipped=0
for f in scripts/verify/0*.sh scripts/verify/0*.py; do
  name=$(basename "$f")
  [ "$name" = "run-all.sh" ] && continue
  if [ "$MODE" != "--full" ] && echo "$SLOW" | grep -qw "$name"; then
    echo "SKIP  $name (use --full)"; skipped=$((skipped+1)); continue
  fi
  log="$OUT/${name%.*}.runlog"
  case "$f" in
    *.py) timeout 900 python3 "$f" > "$log" 2>&1 ;;
    *)    timeout 900 bash "$f" > "$log" 2>&1 ;;
  esac
  rc=$?
  if [ $rc -eq 0 ]; then echo "PASS  $name"; pass=$((pass+1))
  else echo "FAIL  $name (exit $rc) -- $log"; fail=$((fail+1)); fi
done

echo
echo "verify: $pass passed, $fail failed, $skipped skipped"
[ $fail -eq 0 ]
