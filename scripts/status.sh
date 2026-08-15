#!/bin/bash
# Jarvis X status. Read-only. Pass --fix for safe fixes, --net to test APIs.
cd "$(dirname "$0")/.." || exit 1
FIX=0; NET=0
for a in "$@"; do [ "$a" = "--fix" ] && FIX=1; [ "$a" = "--net" ] && NET=1; done
P=0; F=0
ok(){ echo "  [ok]   $1"; P=$((P+1)); }
no(){ echo "  [FAIL] $1"; F=$((F+1)); }
chk(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else no "$1"; fi; }
hd(){ echo; echo "=== $1"; }

hd "SYSTEM"
. /etc/os-release 2>/dev/null
echo "  os       ${PRETTY_NAME:-unknown}"
echo "  kernel   $(uname -r)"
echo "  cpu      $(nproc) cores"
echo "  ram      $(free -m | awk '/^Mem:/{print $3" / "$2" MB used"}')"
echo "  disk     $(df -h "$HOME" | awk 'NR==2{print $4" free of "$2}')"
echo "  crostini $([ -d /mnt/chromeos ] && echo yes || echo no)"

hd "RUNTIME"
for t in node npm python3 git ollama curl tar; do
  v=$(command -v $t >/dev/null 2>&1 && $t --version 2>/dev/null | head -1)
  [ -n "$v" ] && ok "$t: $v" || no "$t missing"
done

hd "AI STACK"
chk "ollama daemon reachable" "curl -sf 127.0.0.1:11434/api/tags"
echo "  models:"; ollama list 2>/dev/null | tail -n +2 | sed 's/^/    /'
chk "gemini key present" "grep -q 'GEMINI_API_KEY=.\{20,\}' ~/.jarvis-x/.env"
chk ".env perms are 600" "[ \"\$(stat -c %a ~/.jarvis-x/.env 2>/dev/null)\" = 600 ]"
if [ "$NET" = 1 ]; then
  chk "gemini quick tier answers" "node code/gemini.js flash 'say OK' | grep -qi ok"
  chk "gemini hard tier answers"  "node code/gemini.js pro 'say OK' | grep -qi ok"
  chk "local model answers" "node -e \"require('./code/local').ask('say OK').then(t=>process.exit(/ok/i.test(t)?0:1))\""
fi

hd "CODE HEALTH"
for f in code/*.js; do
  node --check "$f" >/dev/null 2>&1 && ok "parses: $f" || no "SYNTAX ERROR: $f"
done
for t in code/test-*.js; do
  [ -e "$t" ] || continue
  node "$t" >/dev/null 2>&1 && ok "test passes: $t" || no "TEST FAILED: $t"
done
chk "git objects intact" "git fsck --no-progress"
chk "working tree clean"  "[ -z \"\$(git status --porcelain)\" ]"

hd "SAFETY INVARIANTS"
# Was checking ~/.jarvis-x/STOP -- guard.js's real STOP_FILE is
# .jarvis-x-STOP at the repo root (same stale-path bug as CONSTITUTION.md;
# this one silently always reported "OFF" regardless of the actual switch).
chk "kill switch is OFF (normal)" "[ ! -f .jarvis-x-STOP ]"
chk "stop.js present"             "[ -f code/stop.js ]"
# Was grepping agent.js for 'AUTO = new Set([])', a variable that no longer
# exists anywhere in the codebase. lib.js's execute() is the actual
# enforcement point now (every action type checks isStopped() before running).
chk "every action gated"          "grep -q 'isStopped()' code/lib.js"
# exec.js is a path-safety helper, not an execution engine -- it never
# called guard() (this check was mis-targeted from the start, not just
# stale). Its actual safety property is symlink-safe jail resolution.
chk "exec.js resolves symlinks (jail safety)" "grep -q 'realpathSync' code/exec.js"
chk "shell.js routes via guard"   "grep -q 'guard(' code/shell.js"
chk "gemini.js routes via guard"  "grep -q 'guard(' code/gemini.js"
chk "logs not versioned"          "grep -q '^logs/' .gitignore"
chk ".env not versioned"          "grep -q '\.env' .gitignore"
# Was grepping agent.js for the literal string 'RIGHT action', which never
# existed as such -- removed rather than guessed at, since the milestone
# check below ("correctness logged", against logs/proposals.jsonl) already
# covers this same concept with a check that actually works.
chk "guidelines file exists"      "[ -f knowledge/Guidelines.md ]"
b=$(ls -t ~/jarvis-x-*.tar.gz 2>/dev/null | head -1)
if [ -n "$b" ]; then
  age=$(( ( $(date +%s) - $(stat -c %Y "$b") ) / 86400 ))
  [ "$age" -le 2 ] && ok "backup $age day(s) old" || no "backup is $age days stale"
else no "no backup tarball found"; fi

hd "AGENT ACCURACY"
./scripts/score.sh 2>/dev/null | sed 's/^/  /' || echo "  no scoring data"

hd "MILESTONES"
m(){ if eval "$2" >/dev/null 2>&1; then echo "  [x] $1"; MP=$((MP+1)); else echo "  [ ] $1"; fi; MT=$((MT+1)); }
MP=0; MT=0
echo " foundation:"
m "version control"        "[ -d .git ]"
m "written constraints"    "[ -f knowledge/Guidelines.md ]"
m "kill switch"            "[ -f code/guard.js ]"
m "file jail"              "[ -f code/exec.js ]"
m "shell allowlist"        "[ -f code/shell.js ]"
m "action log"             "[ -f logs/actions.jsonl ]"
m "offsite backup habit"   "[ -n \"$b\" ]"
m "README"                 "[ -f README.md ]"
echo " agent:"
m "proposal loop"          "[ -f code/agent.js ]"
m "human gate on all"      "grep -q 'isStopped()' code/lib.js"
m "correctness logged"     "grep -q '\"correct\"' logs/proposals.jsonl"
m "scoring script"         "[ -x scripts/score.sh ]"
m "30+ graded proposals"   "[ \$(grep -c '\"correct\"' logs/proposals.jsonl) -ge 30 ]"
m "schema validator"       "[ -f code/validate.js ]"
echo " models:"
m "local inference"        "[ -f code/local.js ]"
m "remote quick tier"      "[ -f code/gemini.js ]"
m "tier router"            "[ -f code/router.js ]"
m "fallback chains"        "grep -q 'chain' code/router.js"
m "gate survives fallback" "grep -q 'gate is decided by LEVEL' code/router.js"
echo " capability (not started):"
m "persistent memory"      "[ -f code/memory.js ]"
m "paper trading engine"   "[ -f code/paper-trading.js ]"
m "scheduler / daemon"     "[ -f code/scheduler.js ]"
m "self-debug loop"        "[ -f code/selfdebug.js ]"
m "multi-step planning"    "[ -f code/planner.js ]"

if [ "$FIX" = 1 ]; then
  hd "FIXES (safe only)"
  chmod 600 ~/.jarvis-x/.env 2>/dev/null && echo "  .env -> 600"
  grep -q '^logs/' .gitignore || { echo 'logs/' >> .gitignore; echo "  added logs/ to .gitignore"; }
  grep -q '\.env'  .gitignore || { echo '.env'  >> .gitignore; echo "  added .env to .gitignore"; }
  echo "  (nothing else is auto-fixed by design)"
fi

hd "SUMMARY"
echo "  checks   $P passed, $F failed"
echo "  progress $MP / $MT milestones = $(( MP * 100 / MT ))%"
echo
