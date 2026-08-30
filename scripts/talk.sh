#!/usr/bin/env bash
# Jarvis X voice loop. Usage: bash scripts/talk.sh [seconds]
set -uo pipefail
cd ~/jarvis-x
SEC=${1:-8}
W=/tmp/jx_in.wav

echo "Recording ${SEC}s -- speak now."
arecord -f S16_LE -r 16000 -c 1 -d "$SEC" "$W" 2>/dev/null

echo "Transcribing..."
Q=$(curl -s -X POST http://127.0.0.1:8000/api/transcribe -F "audio=@$W" | jq -r .text)
if [ -z "$Q" ] || [ "$Q" = "null" ]; then echo "Heard nothing."; exit 1; fi
echo "  YOU: $Q"

echo "Thinking..."
R=$(curl -s -X POST http://127.0.0.1:8000/api/ask \
      -H "Content-Type: application/json" \
      -d "$(jq -nc --arg q "$Q" '{question:$q,tier:"quality",speak:true}')")
echo "  JARVIS: $(echo "$R" | jq -r .response)"

A=$(echo "$R" | jq -r .audio)
if [ "$A" != "null" ] && [ -n "$A" ]; then
  F=~/.hermes/audio/$(basename "$A")
  [ -f "$F" ] && ffplay -autoexit -nodisp -loglevel quiet "$F"
fi
