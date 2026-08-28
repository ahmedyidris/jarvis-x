#!/bin/bash
# ask_jarvis.sh – text or voice query
# Usage:
#   ask_jarvis.sh "سؤالك هنا"
#   ask_jarvis.sh --voice

set -e

RECORD_SECONDS=5
TMP_AUDIO="/tmp/ask_jarvis_record.wav"

# If --voice, record and transcribe
if [ "$1" = "--voice" ]; then
    echo "🎤 Recording $RECORD_SECONDS seconds..."
    # Record with arecord (or fallback to ffmpeg/sox)
    if command -v arecord &>/dev/null; then
        arecord -d "$RECORD_SECONDS" -f cd -t wav "$TMP_AUDIO" >/dev/null 2>&1
    elif command -v ffmpeg &>/dev/null; then
        ffmpeg -f alsa -i default -t "$RECORD_SECONDS" -ar 16000 -ac 1 "$TMP_AUDIO" -y >/dev/null 2>&1
    elif command -v parecord &>/dev/null; then
        parecord --record --file="$TMP_AUDIO" --duration="$RECORD_SECONDS" >/dev/null 2>&1
    else
        echo "❌ No recording tool found (install arecord, ffmpeg, or parecord)"
        exit 1
    fi
    echo "📝 Transcribing..."
    # Call the STT engine via Python
    QUESTION=$(python3 -c "
import sys
sys.path.insert(0, '/home/ahmedyidris/jarvis-x')
from code.stt_engine import transcribe
text = transcribe('$TMP_AUDIO')
print(text.strip() if text else '')
" 2>/dev/null)
    if [ -z "$QUESTION" ]; then
        echo "❌ Transcription failed or empty. Check stt_engine.py"
        exit 1
    fi
    echo "🗣️ You said: $QUESTION"
else
    QUESTION="$1"
fi

# If no question, prompt
if [ -z "$QUESTION" ]; then
    read -p "❓ Ask Jarvis: " QUESTION
fi

# Query LLM (SILMA Q3)
RESPONSE=$(curl -s http://127.0.0.1:11434/api/generate \
    -d "{\"model\": \"hf.co/bartowski/SILMA-9B-Instruct-v1.0-GGUF:Q3_K_M\", \"prompt\": \"$QUESTION\", \"stream\": false}" \
    | jq -r '.response')

if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "null" ]; then
    echo "❌ LLM returned empty. Check Ollama."
    exit 1
fi

echo "🤖 Jarvis: $RESPONSE"

# Trim to 200 chars for TTS
SHORT=$(echo "$RESPONSE" | cut -c1-200)

# Synthesize
curl -s -X POST http://127.0.0.1:8001/synthesize \
    -H "Content-Type: application/json" \
    -d "{\"text\":\"$SHORT\"}" \
    -o /tmp/answer.wav

# Play
ffplay -autoexit -nodisp /tmp/answer.wav 2>/dev/null
