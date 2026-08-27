#!/bin/bash
# Stop TTS to free memory
#supervisorctl -c ~/jarvis-x/config/supervisord.conf stop tts-worker

# Get user question (pass as argument or prompt)
if [ -z "$1" ]; then
    read -p "Ask Jarvis (in Arabic): " question
else
    question="$1"
fi

# Query SILMA via Ollama (using the full model name)
response=$(curl -s http://127.0.0.1:11434/api/generate \
    -d "{\"model\": \"hf.co/bartowski/SILMA-9B-Instruct-v1.0-GGUF:Q3_K_M\", \"prompt\": \"$question\", \"stream\": false}" \
    | jq -r '.response')

echo "Jarvis: $response"

# Restart TTS and wait for load
#supervisorctl -c ~/jarvis-x/config/supervisord.conf start tts-worker
sleep 15

# Trim response to ~200 chars for TTS safety
short=$(echo "$response" | cut -c1-200)
curl -s -X POST http://127.0.0.1:8001/synthesize \
    -H "Content-Type: application/json" \
    -d "{\"text\":\"$short\"}" \
    -o /tmp/answer.wav

ffplay -autoexit -nodisp /tmp/answer.wav
