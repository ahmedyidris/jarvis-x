#!/usr/bin/env bash
# scripts/starnet.sh -- run StarNet ITSELF, its own unmodified interface, on
# the Chromebook, with Jarvis as its model provider.
#
#   scripts/starnet.sh install     one time: StarNet + its packages, trimmed for Crostini
#   scripts/starnet.sh start       gateway (:8010) + StarNet (:8787), then open the URL
#   scripts/starnet.sh stop        stop StarNet (add --all to stop the gateway too)
#   scripts/starnet.sh status      what is running, kill switch, versions
#   scripts/starnet.sh logs        last lines of both logs
#   scripts/starnet.sh doctor      check the machine before installing
#   scripts/starnet.sh clear-lock  remove a workspace lock left by a dead StarNet
#   scripts/starnet.sh prune       re-trim GPU/Mac/Windows-only binaries (after any npm ci)
#
# WHY RUN STARNET INSTEAD OF CLONING IT. StarNet (androoAGI/starnet, MIT) is
# a Node web app: `node sidecar/index.js` serves the whole product -- the UI
# and the agent engine -- on 127.0.0.1:8787. It ran on this Chromebook before
# (the 2026-09-24 handoff). What broke was its providers: Groq runs killed the
# sidecar (Bug A), and the custom-provider form would not take Jarvis (Bug C).
# This launcher points StarNet at Jarvis's gateway (code/openai-gateway.js),
# so every model call goes through Jarvis's free tiers, and StarNet itself
# stays upstream -- updates keep working, nothing is forked.
#
# WHAT THE INSTALL FIXES, found by installing StarNet on Debian (2026-09-26):
#   * onnxruntime-node's postinstall downloads NVIDIA CUDA libraries on
#     linux/x64 by default. The Chromebook has no GPU; on a slow link the
#     download also failed outright. ONNXRUNTIME_NODE_INSTALL=skip is that
#     package's own switch for it.
#   * kokoro-js ships a second onnxruntime with a 343 MB CUDA library plus Mac
#     and Windows binaries inside the npm package itself. None of it can load
#     here; pruning frees about 475 MB. `npm ci` restores it if ever needed.
#   * node-pty has no Linux prebuild, so it compiles: build-essential + python3.
#   * A fresh clone skips website/, docs/, output/ and qa/ (about 2 GB the app
#     never reads) and git history (1.6 GB). The app itself runs from the rest.
#
# SAFETY. StarNet's agents can run tools on this machine. The handoff's rule
# is "Do not run YOLO-mode agents on this machine", so when StarNet asks,
# choose ASK FOR APPROVAL, not FULL POWER. Jarvis's kill switch
# (.jarvis-x-STOP) reaches StarNet too: the gateway refuses every model call
# while it exists, so StarNet's agents stop thinking.
set -euo pipefail

JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STARNET_DIR="${STARNET_DIR:-$HOME/starnet}"
STARNET_REPO="${STARNET_REPO:-https://github.com/androoAGI/starnet.git}"
STARNET_PORT="${STARNET_PORT:-8787}"
GATEWAY_PORT="${JX_GATEWAY_PORT:-8010}"
LOG_DIR="${JX_STARNET_LOGS:-$JARVIS_DIR/logs/starnet}"
WORKSPACES="${STARNET_WORKSPACES:-$HOME/.local/share/StarNet/workspaces}"
NEED_DISK_GB=4

say()  { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die()  { printf 'starnet.sh: %s\n' "$*" >&2; exit 1; }

usage() {
  # The header's command list, up to the first explanatory section.
  sed -n '2,/^# WHY/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
free_gb()    { df -Pk "$1" 2>/dev/null | awk 'NR==2 {printf "%d", $4/1048576}'; }
avail_gb()   { awk '/MemAvailable/ {printf "%d", $2/1048576}' /proc/meminfo 2>/dev/null || echo 0; }
http_code()  { curl -s -o /dev/null -m 2 -w '%{http_code}' "$1" 2>/dev/null || true; }

# Whole command line, anchored, this user only. An unanchored `pgrep -f
# "node sidecar/index.js"` also matches any shell, editor or grep whose own
# command line merely MENTIONS that string -- `stop` then killed the terminal
# that ran it (found testing this script, 2026-09-26).
starnet_pids() { pgrep -u "$(id -u)" -f '^node sidecar/index\.js$' || true; }
gateway_pids() { pgrep -u "$(id -u)" -f '^node code/openai-gateway\.js$' || true; }

# --- doctor ------------------------------------------------------------------
cmd_doctor() {
  local bad=0
  local major; major="$(node_major)"
  if [ "$major" -ge 18 ]; then say "ok    node $(node -v) (StarNet needs >= 18)"
  else say "FAIL  node >= 18 not found -- install Node 20 (the Chromebook's system node was 20.x)"; bad=1; fi
  if command -v git >/dev/null; then say "ok    git"; else say "FAIL  git -- sudo apt-get install -y git"; bad=1; fi
  if command -v make >/dev/null && command -v g++ >/dev/null && command -v python3 >/dev/null; then
    say "ok    build tools (node-pty compiles from source on Linux)"
  else
    say "FAIL  build tools -- sudo apt-get install -y build-essential python3"; bad=1
  fi
  if [ -d "$STARNET_DIR/.git" ] || [ -d "$STARNET_DIR/sidecar" ]; then
    say "ok    StarNet at $STARNET_DIR ($(git -C "$STARNET_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?') @ $(git -C "$STARNET_DIR" rev-parse --short HEAD 2>/dev/null || echo '?'))"
  else
    local gb; gb="$(free_gb "$HOME")"
    if [ "${gb:-0}" -ge "$NEED_DISK_GB" ]; then say "ok    ${gb} GB free for a fresh install (needs ~${NEED_DISK_GB} GB)"
    else say "FAIL  ${gb:-?} GB free; a fresh install needs ~${NEED_DISK_GB} GB"; bad=1; fi
  fi
  local ram; ram="$(avail_gb)"
  if [ "${ram:-0}" -ge 2 ]; then say "ok    ${ram} GB RAM available"
  else say "warn  only ${ram:-?} GB RAM available -- close Chrome tabs first (handoff gotcha 7)"; fi
  if [ -f "$JARVIS_DIR/code/openai-gateway.js" ]; then say "ok    Jarvis gateway present (port $GATEWAY_PORT)"
  else say "warn  code/openai-gateway.js missing -- StarNet will only have its own providers"; fi
  case "$(http_code "http://127.0.0.1:11434/api/tags")" in
    200) say "ok    ollama answering on 11434" ;;
    *)   say "warn  ollama not answering on 11434 -- Jarvis's local fallback will fail" ;;
  esac
  if [ -e "$JARVIS_DIR/.jarvis-x-STOP" ]; then say "note  Jarvis kill switch is ENGAGED -- model calls through Jarvis are refused"; fi
  return "$bad"
}

# --- install -----------------------------------------------------------------
prune_unloadable_binaries() {
  # Only files that cannot load on linux/x64 without a GPU. `npm ci` restores them.
  local nm="$STARNET_DIR/node_modules" before after
  [ -d "$nm" ] || return 0
  before="$(du -sm "$nm" | cut -f1)"
  find "$nm" -path '*onnxruntime-node/bin/*' -type d \( -name darwin -o -name win32 \) -prune -exec rm -rf {} +
  find "$nm" -path '*onnxruntime-node/bin/*' -type f \
    \( -name 'libonnxruntime_providers_cuda.so' -o -name 'libonnxruntime_providers_tensorrt.so' \) -delete
  after="$(du -sm "$nm" | cut -f1)"
  say "pruned GPU/Mac/Windows-only binaries: node_modules ${before} MB -> ${after} MB"
}

cmd_install() {
  [ "$(node_major)" -ge 18 ] || die "node >= 18 is required (run: scripts/starnet.sh doctor)"
  command -v git >/dev/null || die "git is required: sudo apt-get install -y git"
  if ! { command -v make >/dev/null && command -v g++ >/dev/null && command -v python3 >/dev/null; }; then
    die "build tools are required for node-pty: sudo apt-get install -y build-essential python3"
  fi

  if [ -d "$STARNET_DIR/.git" ]; then
    # An existing checkout is Ahmed's (it carries his own branch and fixes):
    # use it as it is. Never reset, never switch branches.
    say "using the existing StarNet at $STARNET_DIR ($(git -C "$STARNET_DIR" rev-parse --abbrev-ref HEAD) @ $(git -C "$STARNET_DIR" rev-parse --short HEAD)) -- not changing its branch"
  elif [ -e "$STARNET_DIR" ]; then
    die "$STARNET_DIR exists but is not a git checkout -- move it aside or set STARNET_DIR"
  else
    local gb; gb="$(free_gb "$(dirname "$STARNET_DIR")")"
    [ "${gb:-0}" -ge "$NEED_DISK_GB" ] || die "only ${gb:-?} GB free; a fresh install needs ~${NEED_DISK_GB} GB"
    say "cloning StarNet (latest only, without website/ docs/ output/ qa/) into $STARNET_DIR"
    git clone --depth 1 --filter=blob:none --no-checkout "$STARNET_REPO" "$STARNET_DIR"
    git -C "$STARNET_DIR" sparse-checkout set --no-cone '/*' '!/website/' '!/docs/' '!/output/' '!/qa/'
    git -C "$STARNET_DIR" checkout
  fi

  say "installing StarNet's packages (runtime only, no CUDA download)"
  (cd "$STARNET_DIR" && ONNXRUNTIME_NODE_INSTALL=skip npm ci --omit=dev --no-audit --no-fund)
  if [ "${JX_STARNET_NO_PRUNE:-0}" != "1" ]; then prune_unloadable_binaries; fi
  say ""
  say "installed. next: scripts/starnet.sh start"
}

# --- lock --------------------------------------------------------------------
cmd_clear_lock() {
  # Older StarNet builds leave .starnet-workspace-owner.json behind after a
  # crash and then refuse to start (WORKSPACE_BUSY, handoff gotcha). Current
  # builds reclaim a dead owner themselves. Removed ONLY when its PID is
  # provably gone: `ps -p`, not `kill -0`, because kill -0 also fails on a
  # live process owned by someone else.
  local f="$WORKSPACES/.starnet-workspace-owner.json" pid
  [ -f "$f" ] || { say "no legacy workspace lock"; return 0; }
  pid="$(node -e 'try{const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(Number.isInteger(v.pid)?v.pid:""))}catch(_){}' "$f")"
  if [ -z "$pid" ]; then warn "workspace lock has no readable pid -- left in place: $f"; return 0; fi
  if ps -p "$pid" >/dev/null 2>&1; then say "workspace lock belongs to running pid $pid -- left in place"; return 0; fi
  rm -f "$f"
  say "removed a stale workspace lock (pid $pid is gone)"
}

# --- start / stop ------------------------------------------------------------
wait_for() { # url seconds label
  local i=0
  while [ "$i" -lt "$2" ]; do
    case "$(http_code "$1")" in 200|503) return 0 ;; esac
    sleep 1; i=$((i + 1))
  done
  return 1
}

cmd_stop() {
  local pids; pids="$(starnet_pids)"
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do [ -z "$(starnet_pids)" ] && break; sleep 1; done
    pids="$(starnet_pids)"; [ -z "$pids" ] || kill -9 $pids 2>/dev/null || true
    say "StarNet stopped"
  else
    say "StarNet was not running"
  fi
  if [ "${1:-}" = "--all" ]; then
    pids="$(gateway_pids)"
    if [ -n "$pids" ]; then kill $pids 2>/dev/null || true; say "gateway stopped"; else say "gateway was not running"; fi
  fi
}

cmd_start() {
  [ -f "$STARNET_DIR/sidecar/index.js" ] || die "StarNet is not installed at $STARNET_DIR -- run: scripts/starnet.sh install"
  [ -d "$STARNET_DIR/node_modules" ] || die "StarNet's packages are missing -- run: scripts/starnet.sh install"
  mkdir -p "$LOG_DIR"
  if [ -n "$(starnet_pids)" ]; then cmd_stop; fi
  cmd_clear_lock

  if wait_for "http://127.0.0.1:$GATEWAY_PORT/health" 1; then
    say "Jarvis gateway already running on :$GATEWAY_PORT"
  elif [ -f "$JARVIS_DIR/code/openai-gateway.js" ]; then
    (cd "$JARVIS_DIR" && NODE_OPTIONS="--dns-result-order=ipv4first" JX_GATEWAY_PORT="$GATEWAY_PORT" \
      nohup node code/openai-gateway.js >> "$LOG_DIR/gateway.log" 2>&1 &)
    wait_for "http://127.0.0.1:$GATEWAY_PORT/health" 10 || die "gateway did not start -- see $LOG_DIR/gateway.log"
    say "Jarvis gateway started on :$GATEWAY_PORT"
  else
    warn "no Jarvis gateway in this checkout -- StarNet starts with only its own providers"
  fi

  # Provider keys are dropped from StarNet's environment on purpose: its own
  # Groq path is Bug A (the sidecar dies). With them gone, every cloud call
  # goes through Jarvis. `start --direct-keys` passes them through anyway.
  local keep=()
  if [ "${1:-}" != "--direct-keys" ]; then keep=(-u GROQ_API_KEY -u GEMINI_API_KEY -u OPENROUTER_API_KEY); fi
  local custom_key=()
  if [ -n "${JX_GATEWAY_KEY:-}" ]; then custom_key=(CUSTOM_OPENAI_KEY="$JX_GATEWAY_KEY"); fi
  (cd "$STARNET_DIR" && env ${keep[@]+"${keep[@]}"} ${custom_key[@]+"${custom_key[@]}"} \
    NODE_OPTIONS="--dns-result-order=ipv4first" \
    PORT="$STARNET_PORT" \
    CUSTOM_OPENAI_BASE_URL="http://127.0.0.1:$GATEWAY_PORT/v1" \
    nohup node sidecar/index.js >> "$LOG_DIR/starnet.log" 2>&1 &)
  wait_for "http://127.0.0.1:$STARNET_PORT/api/health" 60 || die "StarNet did not answer within 60s -- see $LOG_DIR/starnet.log"

  [ -e "$JARVIS_DIR/.jarvis-x-STOP" ] && warn "Jarvis kill switch is engaged -- StarNet's agents cannot reach a model until .jarvis-x-STOP is removed"
  say ""
  say "StarNet is running:  http://127.0.0.1:$STARNET_PORT"
  say "  first run: create your Overseer, choose ASK FOR APPROVAL (not FULL POWER),"
  say "  then Connect a brain -> CUSTOM -> http://127.0.0.1:$GATEWAY_PORT/v1 (type the http://),"
  say "  leave the key empty, model: fast"
  say "  as an app window: in Chrome, menu -> Cast, save and share -> Install page as app"
}

# --- status / logs -----------------------------------------------------------
cmd_status() {
  local s g
  s="$(http_code "http://127.0.0.1:$STARNET_PORT/api/health")"
  g="$(http_code "http://127.0.0.1:$GATEWAY_PORT/health")"
  say "StarNet  :$STARNET_PORT  http ${s:-000}  pid(s) $(starnet_pids | tr '\n' ' ')"
  say "gateway  :$GATEWAY_PORT  http ${g:-000}  pid(s) $(gateway_pids | tr '\n' ' ')"
  if [ -e "$JARVIS_DIR/.jarvis-x-STOP" ]; then say "kill switch: ENGAGED"; else say "kill switch: off"; fi
  if [ -d "$STARNET_DIR/.git" ]; then
    say "StarNet checkout: $(git -C "$STARNET_DIR" rev-parse --abbrev-ref HEAD) @ $(git -C "$STARNET_DIR" rev-parse --short HEAD)"
  fi
}

cmd_logs() {
  for f in "$LOG_DIR/gateway.log" "$LOG_DIR/starnet.log"; do
    say "== $f"
    if [ -f "$f" ]; then tail -n "${1:-40}" "$f"; else say "(none yet)"; fi
  done
}

case "${1:-help}" in
  install)    cmd_install ;;
  start)      shift; cmd_start "${1:-}" ;;
  stop)       shift; cmd_stop "${1:-}" ;;
  status)     cmd_status ;;
  logs)       shift; cmd_logs "${1:-40}" ;;
  doctor)     cmd_doctor ;;
  clear-lock) cmd_clear_lock ;;
  prune)      prune_unloadable_binaries ;;
  help|-h|--help) usage ;;
  *) usage >&2; exit 2 ;;
esac
