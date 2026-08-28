#!/usr/bin/env bash
# Jarvis X voice loop: speak, get a spoken Egyptian reply.
# Usage: bash scripts/talk.sh [seconds]   (default 8)
set -uo pipefail
cd ~/jarvis-x
SEC=${1:-8}
W=/tmp/jx_in.wav

echo "Recording ${SEC}s... speak now."
arecord -f S16_LE -r 16000 -c 1 -d "$SEC" "$W" 2>/dev/null
echo "Transcribing..."
Q=$(curl -s -X POST http://127.0.0.1:8000/api/transcribe -F "audio=@$W" | jq -r .text)
[ -z "$Q" ] || [ "$Q" = "null" ] && { echo "Heard nothing."; exit 1; }
echo "  YOU:  $Q"

echo "Thinking..."
R=$(curl -s -X POST http://127.0.0.1:8000/api/ask \
      -H "Content-Type: application/json" \
      -d "$(jq -nc --arg q "$Q" '{question:$q,tier:"quality",speak:true}')")
TEXT=$(echo "$R" | jq -r .response)
AUDIO=$(echo "$R" | jq -r .audio)
echo "  JARVIS: $TEXT"

if [ "$AUDIO" != "null" ] && [ -n "$AUDIO" ]; then
  F=~/.hermes/audio/$(basename "$AUDIO")
  [ -f "$F" ] && ffplay -autoexit -nodisp -loglevel quiet "$F"
else
  echo "  (no audio returned)"
fi
