# Jarvis X / StarNet — Technical Handoff
# Date: 2026-09-24
# Author: session notes, Ahmed Yidris

---

## PART 1 — CURRENT WORKING STATE

### Jarvis X

Location: `~/jarvis-x`
Repo: https://github.com/ahmedyidris/jarvis-x (branch: master)
Latest commit: `99652aa` — feat(api): OpenAI-compatible /v1/chat/completions + /v1/models

Services (managed by supervisord under systemd unit `jarvis-supervisord.service`):
- hermes-agent    RUNNING
- hermes-api      RUNNING  (uvicorn, port 8000)
- tts-worker      RUNNING  (degraded — chatterbox model absent, returns 500 on /synthesize)

Model tiers (all verified working via POST /api/ask):
| tier     | provider | model                     |
|----------|----------|---------------------------|
| local    | ollama   | qwen2.5:3b                |
| fast     | groq     | openai/gpt-oss-20b        |
| smart    | groq     | openai/gpt-oss-120b       |
| quality  | gemini   | gemini-3.6-flash          |
| frontier | gemini   | gemini-3.6-flash          |

OpenAI-compatible adapter is live at:
- `GET  http://127.0.0.1:8000/v1/models`
- `POST http://127.0.0.1:8000/v1/chat/completions`
  - model field accepts: local | fast | smart | quality | frontier
  - returns OpenAI chat.completion shape
  - persona loaded from `config/system_prompt.txt` and prepended

Persona file: `~/jarvis-x/config/system_prompt.txt`

### StarNet

Location: `~/starnet`
Repo: androoAGI/starnet, local branch `feat/harness-backend`
Working commit: `658dc7ce9` (agentId sanitization)

State:
- Runs as web app: `node sidecar/index.js` → http://127.0.0.1:8787
- Currently: only Ollama works as provider
- Groq/Gemini: keys verify as VALID but every run either returns HTTP 400 or kills the sidecar
- Tauri desktop shell: built successfully at one point, but deleted (was slow, no benefit over web)

Working agent: Raqib (Overseer)
Working model: `qwen2.5:7b` via Ollama (slow — ~10 tok/s)
Working provider file: `sidecar/providers/openai-compatible.js`

---

## PART 2 — FIXES THAT LANDED (with commands)

### 1. Jarvis env var quoting bug

`registry.js` read `.env` as text and kept surrounding quotes on every key. Every cloud call went out as `Authorization: Bearer "gsk_..."` — quotes and all. Every provider rejected silently.

Fix: strip quotes from `.env`:
```bash
sed -i 's/^\([A-Z_]*\)="\(.*\)"$/\1=\2/' ~/.jarvis-x/.env
```

2. Jarvis system prompt dropped on registry tiers

The registry: branch in hermes.py replaced the curl command without including the system prompt. So fast/smart/frontier all answered "I am Qwen" despite the prompt forbidding it.

Fix: prepend system in the registry branch (committed as 4281158).

3. Groq fast model 404

registry.js had fast: 'groq/compound-mini'. That model doesn't exist on this account. Correct name: openai/gpt-oss-20b.

Fix: sed -i "s|fast: 'groq/compound-mini'|fast: 'openai/gpt-oss-20b'|" code/providers/registry.js (committed as b634ed8).

4. Gemini model name

registry.js had gemini-3.6-flash. Google's models-list endpoint does NOT show this model (it's stale), but the model works. Do not change it to a model from the list — the list is wrong.

Verified working: gemini-3.6-flash (with the key in .env).

5. IPv6 truncation (Crostini + Cloudflare)

Crostini resolves to IPv6 first. For Cloudflare-fronted APIs (Groq, OpenRouter), the IPv6 path truncates POST bodies.

Fix — system-level:

```bash
sudo tee -a /etc/gai.conf > /dev/null << 'EOF'
precedence ::ffff:0:0/96  100
EOF
```

Fix — Node processes (does NOT cover c-ares resolver):

```bash
export NODE_OPTIONS="--dns-result-order=ipv4first"
```

Note: Node's https.get uses c-ares and ignores both of these. It still times out on nodejs.org, api.groq.com, etc. curl works because it uses glibc's resolver.

6. systemd EnvironmentFile for Jarvis

Jarvis services were starting without API keys because systemd units don't inherit shell exports.

Fix:

```bash
sudo mkdir -p /etc/systemd/system/jarvis-supervisord.service.d
sudo tee /etc/systemd/system/jarvis-supervisord.service.d/env.conf > /dev/null << 'EOF'
[Service]
EnvironmentFile=/home/ahmedyidris/.jarvis-x/.env
Environment="NODE_OPTIONS=--dns-result-order=ipv4first"
EOF
sudo systemctl daemon-reload
sudo systemctl restart jarvis-supervisord.service
```

7. OpenAI-compatible adapter in Jarvis (app.py)

Added /v1/chat/completions and /v1/models. Placed BEFORE the SPA wildcard route (@app.get("/{full_path:path}")) — otherwise the wildcard catches GET /v1/models and serves index.html.

Imports needed at top of app.py:

· Request in the fastapi import block
· import time
· JSONResponse in the from fastapi.responses line

Tier → model resolution:

```python
tier_to_model = {
    "local":    "qwen2.5:3b",
    "fast":     "registry:fast",
    "smart":    "registry:smart",
    "quality":  "registry:quality",
    "frontier": "registry:quality",
}
```

8. Ollama model directory

Ollama's systemd unit ran as user ollama and couldn't read ~/.ollama. Pointed it at the system path:

```bash
sudo tee /etc/systemd/system/ollama.service.d/override.conf >/dev/null << 'EOF'
[Service]
Environment="OLLAMA_MODELS=/usr/share/ollama/.ollama/models"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_KEEP_ALIVE=5m"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_FLASH_ATTENTION=1"
EOF
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

9. StarNet provider env vars — CORRECT names

The registry reads these plain names (no SKYNET_ prefix):

· GROQ_API_KEY
· GEMINI_API_KEY
· OPENROUTER_API_KEY
· CUSTOM_OPENAI_BASE_URL
· CUSTOM_OPENAI_KEY

The SKYNET_<PROVIDER>_API_KEY pattern mentioned in secrets.js is for Discord/Telegram bot tokens, NOT provider keys.

10. StarNet message sanitization

StarNet attaches internal fields (agentId and others) to outgoing messages. Strict validators reject them with HTTP 400.

Fix — in sidecar/providers/openai-compatible.js, filter message objects to OpenAI schema before send:

```javascript
req.messages.map(m => {
  const o = {};
  for (const k of ['role','content','tool_calls','tool_call_id','name','function_call']) {
    if (k in m) o[k] = m[k];
  }
  return o;
})
```

Committed on branch feat/harness-backend as 658dc7ce9.

---

PART 3 — BUGS STILL OPEN

Bug A: StarNet Groq runs kill the sidecar

Symptom: after picking Groq and sending a message, the sidecar process dies with no error in /tmp/starnet.log. The log ends normally after "connectors up".

Not fixed. Not diagnosed. Likely one of:

· Streaming HTTP to Cloudflare-fronted endpoints fails silently on Crostini
· Some uncaught async error kills Node without logging
· The provider adapter dereferences a field that doesn't exist for non-Ollama providers

The stream: false patch made it worse (broke Ollama too). It was reverted.

Bug B: Jarvis /v1 endpoint doesn't read files

POST /v1/chat/completions with a question about a file returns "I don't have that file" because Jarvis is a chat API. It doesn't read the filesystem.

This is expected behavior. Callers (Aider, Continue, StarNet agents) must read the file themselves and include its content in the message.

Bug C: StarNet custom provider verification rejects localhost

When adding http://127.0.0.1:8000/v1 as a custom provider in the StarNet UI, verification fails even with a valid key. The registry has the correct CUSTOM_OPENAI_BASE_URL env var support but the UI-side verification blocks it.

Not investigated fully. The env-var path (CUSTOM_OPENAI_BASE_URL at launch) may bypass the UI verification if StarNet reads it at boot.

Bug D: tts-worker degraded

Chatterbox TTS model is not installed. Worker starts, reports {"loaded": false}, returns 500 on /synthesize. This is intentional and honest — it refuses rather than returning silent audio. To fix: obtain the ~5GB chatterbox-ckpt and place at ~/jarvis-x/voices/chatterbox-eg/.

Bug E: Kimi / consumer AI subscriptions don't give API access

Google AI Pro unlocks 3.1 Pro in the consumer app. The API tier for gemini-3.1-pro-preview is limit: 0 — paid API only. Same for most consumer subscriptions. Free API access is limited to:

· Gemini: gemini-3.6-flash (verified working)
· Groq: openai/gpt-oss-20b, openai/gpt-oss-120b (verified)
· OpenRouter: free models with shared-pool rate limits

---

PART 4 — LAUNCH COMMANDS

Jarvis X

Services run automatically under systemd. To restart:

```bash
sudo systemctl restart jarvis-supervisord.service
sleep 8
supervisorctl -c ~/jarvis-x/config/supervisord.conf status
```

To test:

```bash
curl -s http://127.0.0.1:8000/v1/models | python3 -m json.tool
curl -s -XPOST http://127.0.0.1:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"smart","messages":[{"role":"user","content":"Say ready"}]}' \
  | python3 -m json.tool
```

StarNet (web mode)

```bash
pkill -f "node sidecar/index.js"
sleep 2
cd ~/starnet
set -a && source ~/.jarvis-x/.env && set +a
NODE_OPTIONS="--dns-result-order=ipv4first" \
GROQ_API_KEY="$GROQ_API_KEY" \
GEMINI_API_KEY="$GEMINI_API_KEY" \
OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
CUSTOM_OPENAI_BASE_URL="http://127.0.0.1:8000/v1" \
CUSTOM_OPENAI_KEY="sk-jarvis-local" \
nohup node sidecar/index.js > /tmp/starnet.log 2>&1 &
```

Open http://127.0.0.1:8787
Set Raqib's model to OLLAMA → qwen2.5:7b
(Do NOT pick Groq — Bug A.)

Aider (coding agent)

```bash
set -a && source ~/.jarvis-x/.env && set +a
cd ~/jarvis-x
aider --model groq/openai/gpt-oss-120b --no-show-model-warnings
```

Inside Aider:

· /add <path> to include a file
· Plain text on its own line = question to the model
· /exit to quit

Hermes CLI

```bash
set -a && source ~/.jarvis-x/.env && set +a
hermes
```

~/.bashrc needs: export PATH="$HOME/venv-ai/bin:$PATH"

---

PART 5 — ENVIRONMENT FACTS

Hardware: ASUS Chromebook, Crostini (Debian 13 trixie)
RAM: 14GB total, ~9-10GB free after Chrome
CPU: 11th Gen i5, no GPU
Disk: 72GB total, ~11GB free (after cleanup)
Python: 3.11 in ~/venv-ai (uv-managed)
Node: 20.x (system), 22.x (bundled for Tauri)

Key paths:

· ~/.jarvis-x/.env — API keys (chmod 600)
· ~/jarvis-x/ — Jarvis source
· ~/starnet/ — StarNet source
· ~/.local/share/StarNet/workspaces/ — StarNet state
· ~/.ollama/models/ OR /usr/share/ollama/.ollama/models — Ollama models (check which one is active)

Ollama models present:

· qwen2.5:7b (4.7GB)
· qwen2.5:3b (1.9GB)
· qwen2.5-coder:7b (4.7GB)
· qwen2.5-coder:3b (1.9GB)
· nomic-embed-text (274MB)

---

PART 6 — GOTCHAS TO REMEMBER

1. Never paste shell commands into Aider. Inside Aider's > prompt, only /commands or natural language. Anything else gets sent to the model as a question.
2. Never paste Python or YAML into bash. If it's not a shell command, put it in a file first with a heredoc.
3. The SKYNET_ prefix is for channel tokens, not provider keys. Provider keys use plain names.
4. Google's models-list endpoint is stale. gemini-3.6-flash works even though it isn't listed. Don't trust the list.
5. Node's https ignores NODE_OPTIONS=--dns-result-order=ipv4first when it uses c-ares. curl works because it uses glibc. If a Node script fails with a network error but curl works, that's why.
6. StarNet's workspace lock is fragile. After any ungraceful exit, the sidecar refuses to start with WORKSPACE_BUSY. Fix:
   ```bash
   cat ~/.local/share/StarNet/workspaces/.starnet-workspace-owner.json
   # note the PID, kill it if it's dead
   pkill -f "node sidecar/index.js"
   rm ~/.local/share/StarNet/workspaces/.starnet-workspace-owner.json
   ```
7. Chrome tabs eat 10GB of your 14GB. Before any heavy build, close them. free -h should show 6GB+ available.
8. The Tauri build is 30-60 min and needs 8GB disk + 6GB RAM. It's rebuildable but not useful for daily work on this hardware.
9. Jarvis's quality tier maps to Gemini. If it returns ollama responses, the Gemini key is missing or invalid. Verify:
   ```bash
   curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=$GEMINI_API_KEY" \
     -H 'Content-Type: application/json' \
     -d '{"contents":[{"parts":[{"text":"hi"}]}]}'
   ```
10. ollama list shows only the active OLLAMA_MODELS directory. If models are missing, check which directory the systemd unit is pointed at.

---

PART 7 — WHAT TO TRY NEXT (in priority order)

Priority 1: StarNet Groq bug

Diagnose why the sidecar dies on Groq calls.

```bash
# Start sidecar in foreground to see the death
cd ~/starnet
set -a && source ~/.jarvis-x/.env && set +a
NODE_OPTIONS="--dns-result-order=ipv4first" \
GROQ_API_KEY="$GROQ_API_KEY" \
node sidecar/index.js
```

Then send a message and watch the terminal. The exit reason will appear there.

Or add logging to sidecar/providers/openai-compatible.js around the fetch call.

Priority 2: Route StarNet through Jarvis

Get the custom provider UI to accept localhost, OR confirm the env-var path works. Then all StarNet traffic goes through Jarvis, which handles fallbacks and never dies on truncation.

Priority 3: Station view in Jarvis

Instead of a StarNet clone, add a "Station" tab to Jarvis's existing React frontend:

· Roster file at config/agents.yaml
· Four endpoints in app.py: list, chat, transcript, task
· Simple grid UI in React
· One background worker per agent

This is a real weekend project. StarNet is the ambition; a station tab in Jarvis is achievable.

Priority 4: Fix the voice pipeline

Obtain the chatterbox checkpoint (~5GB). Place at ~/jarvis-x/voices/chatterbox-eg/. Restart tts-worker.

---

PART 8 — WHAT NOT TO DO

· Do not chase a StarNet clone. Jarvis already has 80% of StarNet's useful features. Add a station view to Jarvis instead.
· Do not build the Tauri desktop shell for daily use. Web UI is faster and identical in function.
· Do not re-enable stream: false on the OpenAI-compatible adapter. It breaks all providers.
· Do not put API keys in git. .env is gitignored — keep it that way.
· Do not run YOLO-mode agents on this machine. The venv and StarNet workspace have both been destroyed by that pattern.

---

END OF HANDOFF
