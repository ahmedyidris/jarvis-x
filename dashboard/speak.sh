#!/usr/bin/env bash
# speak.sh "<text>" <output.mp3>
#
# Three-tier TTS, falls through instead of ever going silent:
#   1. Fish Audio (POST https://api.fish.audio/v1/tts, Bearer auth)
#   2. edge-tts (en-GB-RyanNeural, --rate=-4%)
#   3. Local system voice — `say -v Daniel` on macOS, or espeak-ng on Linux
#      (this box has no `say`; espeak-ng is the real fallback here)
#
# After each attempt: check the exit code, check the file exists and is
# non-empty, and check its actual bytes with `file` (not just "curl said
# 200") before trusting it as audio. On any failure, fall through.
#
# Requires FISH_API_KEY and FISH_REFERENCE_ID in one of:
#   ~/.jarvis-x/.env   ~/jarvis-x/.env
# (sourced if present; neither is created or modified by this script)

set -u

TEXT="${1:?usage: speak.sh \"<text>\" <output.mp3>}"
OUT="${2:?usage: speak.sh \"<text>\" <output.mp3>}"

for envfile in "$HOME/.jarvis-x/.env" "$HOME/jarvis-x/.env"; do
  if [ -f "$envfile" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$envfile"
    set +a
  fi
done

is_audio_file() {
  [ -s "$1" ] || return 1
  file --mime-type -b "$1" 2>/dev/null | grep -q '^audio/'
}

tmpdir="$(mktemp -d)"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

# ---------- Tier 1: Fish Audio ----------
try_fish_audio() {
  [ -n "${FISH_API_KEY:-}" ] || { echo "  fish-audio: FISH_API_KEY not set, skipping" >&2; return 1; }
  [ -n "${FISH_REFERENCE_ID:-}" ] || { echo "  fish-audio: FISH_REFERENCE_ID not set, skipping" >&2; return 1; }

  local candidate="$tmpdir/fish.mp3"
  local payload
  payload=$(python3 - "$TEXT" "$FISH_REFERENCE_ID" <<'PY'
import json, sys
print(json.dumps({"text": sys.argv[1], "reference_id": sys.argv[2], "format": "mp3"}))
PY
  )

  local http_code
  http_code=$(curl -sS -o "$candidate" -w '%{http_code}' \
    -X POST "https://api.fish.audio/v1/tts" \
    -H "Authorization: Bearer ${FISH_API_KEY}" \
    -H "model: s2.1-pro-free" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>"$tmpdir/fish.err")
  local status=$?

  if [ "$status" -ne 0 ] || [ "$http_code" != "200" ]; then
    echo "  fish-audio: request failed (exit $status, http $http_code)" >&2
    [ -s "$tmpdir/fish.err" ] && sed 's/^/  fish-audio: /' "$tmpdir/fish.err" >&2
    return 1
  fi
  if ! is_audio_file "$candidate"; then
    echo "  fish-audio: response was not audio (probably an error body)" >&2
    head -c 300 "$candidate" | sed 's/^/  fish-audio: response: /' >&2
    return 1
  fi
  cp "$candidate" "$OUT"
  return 0
}

# ---------- Tier 2: edge-tts ----------
try_edge_tts() {
  command -v edge-tts >/dev/null 2>&1 || { echo "  edge-tts: not installed, skipping" >&2; return 1; }
  local candidate="$tmpdir/edge.mp3"
  edge-tts --voice en-GB-RyanNeural --rate=-4% --text "$TEXT" --write-media "$candidate" \
    >"$tmpdir/edge.log" 2>&1
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "  edge-tts: exited $status" >&2
    sed 's/^/  edge-tts: /' "$tmpdir/edge.log" >&2
    return 1
  fi
  if ! is_audio_file "$candidate"; then
    echo "  edge-tts: output was not audio" >&2
    return 1
  fi
  cp "$candidate" "$OUT"
  return 0
}

# ---------- Tier 3: local system voice ----------
try_local_tts() {
  local candidate="$tmpdir/local.mp3"

  if command -v say >/dev/null 2>&1; then
    local aiff="$tmpdir/local.aiff"
    say -v Daniel -o "$aiff" "$TEXT" 2>"$tmpdir/say.err"
    local status=$?
    if [ "$status" -eq 0 ] && [ -s "$aiff" ] && command -v ffmpeg >/dev/null 2>&1; then
      ffmpeg -y -i "$aiff" -codec:a libmp3lame -qscale:a 4 "$candidate" -loglevel error
      if is_audio_file "$candidate"; then cp "$candidate" "$OUT"; return 0; fi
    fi
    echo "  say: failed or ffmpeg unavailable to encode mp3" >&2
  fi

  if command -v espeak-ng >/dev/null 2>&1; then
    local wav="$tmpdir/local.wav"
    espeak-ng -v en-gb-x-rp -s 150 -p 40 "$TEXT" -w "$wav" 2>"$tmpdir/espeak.err"
    local status=$?
    if [ "$status" -eq 0 ] && [ -s "$wav" ] && command -v ffmpeg >/dev/null 2>&1; then
      ffmpeg -y -i "$wav" -codec:a libmp3lame -qscale:a 4 "$candidate" -loglevel error
      if is_audio_file "$candidate"; then cp "$candidate" "$OUT"; return 0; fi
    fi
    echo "  espeak-ng: failed or ffmpeg unavailable to encode mp3" >&2
  fi

  echo "  local-tts: no working local voice found (say/espeak-ng + ffmpeg)" >&2
  return 1
}

echo "speak.sh: trying fish-audio..." >&2
if try_fish_audio; then
  echo "voice: fish-audio"
  exit 0
fi

echo "speak.sh: fish-audio failed, trying edge-tts..." >&2
if try_edge_tts; then
  echo "voice: edge-tts fallback"
  exit 0
fi

echo "speak.sh: edge-tts failed, trying local system voice..." >&2
if try_local_tts; then
  echo "voice: local-tts fallback"
  exit 0
fi

echo "voice: NONE — all three tiers failed, no audio produced" >&2
exit 1
