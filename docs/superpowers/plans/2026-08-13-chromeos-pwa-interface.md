# Jarvis-X Chrome OS PWA Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Jarvis-X's static single-turn `index.html` form with a real, installable Chrome OS PWA (shadcn/ui + Tailwind + Radix, per Design.md's HUD spec), running fully local (Ollama + Piper/Kokoro/EGTTS + faster-whisper), supervised by `supervisord` instead of ad-hoc terminal tabs — with zero paid-API dependency in the new interface's own code path.

**Architecture:** Keep `app.py` (FastAPI, `127.0.0.1:8000`) as the single backend process and extend it with history/kill-switch/transcribe endpoints; build a new React+Vite+shadcn SPA in `web/` that gets `vite build`-compiled to static assets FastAPI serves directly (one origin, one port, installable via Chrome's "Install app"), so there's no second dev-server process and no CORS surface. `supervisord` (new) manages exactly two long-running daemons — `ollama serve` and the FastAPI/uvicorn process — replacing the currently-manual "open a terminal and run it" workflow and the aspirational, nonexistent `systemctl start jarvis-core` referenced in `CONSTITUTION.md`.

**Tech Stack:** FastAPI + uvicorn (existing, in `~/venv-ai`), React 18 + Vite + TypeScript, Tailwind CSS, shadcn/ui, Radix primitives, faster-whisper (already installed in `~/venv-ai`, currently unused), Piper/Kokoro/EGTTS-V0.1 (existing, unchanged), supervisord (new system package).

**Spec:** `/home/ahmedyidris/jarvis-x/Design.md` (visual/HUD spec — sci-fi dark theme, persistent sidebar, bilingual EN/AR with RTL mirroring, sharp 2–4px corners), `/home/ahmedyidris/jarvis-x/CONSTITUTION.md` (gating/kill-switch philosophy), `/home/ahmedyidris/jarvis-x/knowledge/Guidelines.md` (routing reality — read-only reference, not modified by this plan).

## Global Constraints

- **No paid API calls anywhere in this plan's code.** Every new endpoint talks only to `localhost:11434` (Ollama) or local Python libraries. Any future "free-tier cloud fallback" (Groq, Gemini free tier) must sit behind an explicit, off-by-default toggle the human flips per-session — never auto-selected. This plan does not wire one up; it only leaves the toggle point documented (Task 7).
- **Never edit `code/guard.js`, `code/validate.js`, `knowledge/Guidelines.md`, or `memory/rules.md`.** These are Edit-denied in `~/.claude/settings.json` by design. Task 13 produces exact text for Ahmed to paste in himself — no task in this plan calls Edit/Write on those four paths.
- **Ground truth over documentation when they conflict.** The kill-switch file is `.jarvis-x-STOP` at the repo root (`/home/ahmedyidris/jarvis-x/.jarvis-x-STOP`), per `code/guard.js:5` — not `~/.jarvis-x/STOP` as `CONSTITUTION.md` states. Every task that touches the kill switch uses the real path.
- **Everything binds to `127.0.0.1` only.** No `0.0.0.0`, no exposed ports beyond what already exists.
- **New frontend lives in its own `web/` subfolder** with its own `package.json` — do not add React/Vite/Tailwind deps to the repo-root `package.json` (it's the JS agent runtime's manifest, tested via `jest-runner.js`; keep it untouched).
- **All new Python code runs under `~/venv-ai`** (has fastapi 0.141.1, uvicorn 0.52.2, faster-whisper, piper — confirmed installed), matching how `app.py` already runs today.
- **`sentinel/` and `automation/n8n/` are out of scope** — do not touch them.

---

## Phase 1 — Process supervision (supervisord)

### Task 1: Install and configure supervisord for Ollama + FastAPI

**Files:**
- Create: `/home/ahmedyidris/jarvis-x/config/supervisord.conf`
- Create: `/home/ahmedyidris/jarvis-x/logs/supervisord/` (log directory)

**Interfaces:**
- Produces: two supervised programs, `ollama` and `hermes-api`, reachable via `supervisorctl status`/`restart`/`stop` for every later task that needs the backend running.

- [ ] **Step 1: Install supervisor**

```bash
sudo apt update && sudo apt install -y supervisor
```

- [ ] **Step 2: Verify it's not already running as a system service (Crostini has no systemd)**

Run: `pgrep supervisord || echo "not running yet"`
Expected: `not running yet` (Crostini's Debian container has no systemd/init to auto-start it — we launch it ourselves, and Task 2 covers making that survive a Chromebook reboot).

- [ ] **Step 3: Write the supervisord config**

```ini
; /home/ahmedyidris/jarvis-x/config/supervisord.conf
[unix_http_server]
file=/tmp/jarvis-supervisor.sock

[supervisord]
logfile=/home/ahmedyidris/jarvis-x/logs/supervisord/supervisord.log
pidfile=/tmp/jarvis-supervisord.pid
childlogdir=/home/ahmedyidris/jarvis-x/logs/supervisord

[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface

[supervisorctl]
serverurl=unix:///tmp/jarvis-supervisor.sock

[program:ollama]
command=/usr/local/bin/ollama serve
autostart=true
autorestart=true
startretries=3
stdout_logfile=/home/ahmedyidris/jarvis-x/logs/supervisord/ollama.out.log
stderr_logfile=/home/ahmedyidris/jarvis-x/logs/supervisord/ollama.err.log
environment=HOME="/home/ahmedyidris"

[program:hermes-api]
command=/home/ahmedyidris/venv-ai/bin/uvicorn app:app --host 127.0.0.1 --port 8000
directory=/home/ahmedyidris/jarvis-x
autostart=true
autorestart=true
startretries=3
startsecs=3
stdout_logfile=/home/ahmedyidris/jarvis-x/logs/supervisord/hermes-api.out.log
stderr_logfile=/home/ahmedyidris/jarvis-x/logs/supervisord/hermes-api.err.log
```

- [ ] **Step 4: Create the log directory and start supervisord**

```bash
mkdir -p /home/ahmedyidris/jarvis-x/logs/supervisord
supervisord -c /home/ahmedyidris/jarvis-x/config/supervisord.conf
```

- [ ] **Step 5: Verify both programs are RUNNING**

Run: `supervisorctl -c /home/ahmedyidris/jarvis-x/config/supervisord.conf status`
Expected:
```
hermes-api                      RUNNING   pid 1234, uptime 0:00:05
ollama                          RUNNING   pid 1235, uptime 0:00:05
```
(If `ollama` shows `FATAL`/`BACKOFF`, an `ollama serve` from an earlier terminal session is likely still holding port 11434 — `pkill ollama` first, then `supervisorctl restart ollama`.)

- [ ] **Step 6: Verify the API actually answers through supervisord's process, not a leftover manual one**

Run: `curl -s http://127.0.0.1:8000/api/status | python3 -m json.tool`
Expected: JSON with `"status": "online"` and `"available_tiers": ["local", "quality"]`.

- [ ] **Step 7: Verify restart resilience**

Run: `supervisorctl -c /home/ahmedyidris/jarvis-x/config/supervisord.conf restart hermes-api && sleep 2 && curl -s http://127.0.0.1:8000/api/status`
Expected: same JSON as Step 6 — process came back on its own.

- [ ] **Step 8: Commit**

```bash
cd /home/ahmedyidris/jarvis-x
git add config/supervisord.conf
git commit -m "infra: add supervisord config for ollama + hermes-api"
```

### Task 2: Auto-start supervisord on Chromebook login (Crostini has no systemd)

**Files:**
- Create: `/home/ahmedyidris/jarvis-x/scripts/start-jarvis.sh`
- Modify: `~/.bashrc` (append only, one guarded block)

**Interfaces:**
- Consumes: `config/supervisord.conf` from Task 1.
- Produces: `start-jarvis.sh`, callable manually or from shell login, idempotent (safe to run if already running).

- [ ] **Step 1: Write the idempotent start script**

```bash
#!/usr/bin/env bash
# /home/ahmedyidris/jarvis-x/scripts/start-jarvis.sh
set -euo pipefail
CONF="/home/ahmedyidris/jarvis-x/config/supervisord.conf"
SOCK="/tmp/jarvis-supervisor.sock"

if [[ -S "$SOCK" ]] && supervisorctl -c "$CONF" status >/dev/null 2>&1; then
  echo "jarvis: supervisord already running"
else
  echo "jarvis: starting supervisord"
  supervisord -c "$CONF"
fi
supervisorctl -c "$CONF" status
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x /home/ahmedyidris/jarvis-x/scripts/start-jarvis.sh
```

- [ ] **Step 3: Test it twice in a row (idempotency check)**

Run: `/home/ahmedyidris/jarvis-x/scripts/start-jarvis.sh && /home/ahmedyidris/jarvis-x/scripts/start-jarvis.sh`
Expected: second run prints `jarvis: supervisord already running`, not a duplicate-socket error.

- [ ] **Step 4: Wire into shell login (append, don't overwrite)**

```bash
cat >> ~/.bashrc <<'EOF'

# --- jarvis-x autostart (added by chromeos-pwa-interface plan) ---
if [[ -f "$HOME/jarvis-x/scripts/start-jarvis.sh" ]]; then
  "$HOME/jarvis-x/scripts/start-jarvis.sh" >/tmp/jarvis-autostart.log 2>&1
fi
EOF
```

- [ ] **Step 5: Verify by opening a fresh Crostini terminal tab**

Run (in a new terminal): `curl -s http://127.0.0.1:8000/api/status`
Expected: JSON response, with no manual command run in that tab.

- [ ] **Step 6: Commit**

```bash
cd /home/ahmedyidris/jarvis-x
git add scripts/start-jarvis.sh
git commit -m "infra: auto-start supervisord from shell login (no systemd on Crostini)"
```

---

## Phase 2 — Backend API extensions (local-only, curl-testable before any UI exists)

### Task 3: `/api/history` — expose Hermes' existing SQLite conversation log

> **Executed 2026-08-13.** Deviation from plan: `hermes.py`'s `recall()` (unmodified)
> selects `voice_id`/`audio_path`, but the live `~/.hermes/state.db` predated those
> columns being added to `init_db()`'s `CREATE TABLE IF NOT EXISTS` (which never
> migrates an existing table) — the route 500'd until a one-time `ALTER TABLE
> conversations ADD COLUMN voice_id TEXT` / `ADD COLUMN audio_path TEXT` was run
> directly against the live DB. No code changed beyond this plan's own. Verified
> working via curl both directly (`127.0.0.1:8000`) and through the Phase 3 Vite
> proxy (`localhost:5173`). Commit: `49c5f60`.

**Files:**
- Modify: `/home/ahmedyidris/jarvis-x/app.py`

**Interfaces:**
- Consumes: `hermes_module.HermesCore().recall(limit)` — already exists (`hermes.py:118`), returns `list[dict]` with keys `timestamp, user_input, response, model, latency_ms, voice_id`.
- Produces: `GET /api/history?limit=N` → `{"conversations": [...]}`, used by the sidebar memory panel (Task 7).

- [x] **Step 1: Add the route**

```python
@app.get("/api/history")
async def history(limit: int = 20):
    hermes = hermes_module.HermesCore()
    conversations = hermes.recall(limit)
    hermes.close()
    return {"conversations": conversations}
```

- [x] **Step 2: Restart the API and verify**

Run: `supervisorctl -c config/supervisord.conf restart hermes-api && curl -s "http://127.0.0.1:8000/api/history?limit=3" | python3 -m json.tool`
Expected: `{"conversations": [...]}` with up to 3 most-recent entries (empty list is fine on a fresh DB — ask something via `/api/ask` first if you want to see one).

- [x] **Step 3: Commit**

```bash
git add app.py
git commit -m "feat(api): add /api/history endpoint for conversation recall"
```

### Task 4: `/api/killswitch` — read and toggle the real STOP file

> **Executed 2026-08-13**, exactly as written — round trip verified
> (`false → true → true → false`) and cross-checked live against `code/guard.js`'s
> `isStopped()` via `node -e`, both directly on `127.0.0.1:8000` and through the
> Phase 3 Vite proxy. Left in the safe (`stopped: false`) state afterward.
> Commit: `b954a6e`.

**Files:**
- Modify: `/home/ahmedyidris/jarvis-x/app.py`

**Interfaces:**
- Produces: `GET /api/killswitch` → `{"stopped": bool}`; `POST /api/killswitch {"stopped": true|false}` → same shape, after creating/removing the file.
- Ground truth: the file is `.jarvis-x-STOP` at the repo root, matching `code/guard.js`'s `STOP_FILE = path.join(__dirname, '..', '.jarvis-x-STOP')` — **not** `~/.jarvis-x/STOP` from `CONSTITUTION.md` (see Task 13).

- [x] **Step 1: Add the model and routes**

```python
STOP_FILE = Path(__file__).parent / ".jarvis-x-STOP"

class KillSwitchRequest(BaseModel):
    stopped: bool

@app.get("/api/killswitch")
async def killswitch_status():
    return {"stopped": STOP_FILE.exists()}

@app.post("/api/killswitch")
async def killswitch_set(req: KillSwitchRequest):
    if req.stopped:
        STOP_FILE.write_text(datetime.now().isoformat() + "\n")
    else:
        STOP_FILE.unlink(missing_ok=True)
    return {"stopped": STOP_FILE.exists()}
```

- [x] **Step 2: Restart and verify the round trip**

Run:
```bash
supervisorctl -c config/supervisord.conf restart hermes-api
curl -s http://127.0.0.1:8000/api/killswitch
curl -s -X POST http://127.0.0.1:8000/api/killswitch -H 'Content-Type: application/json' -d '{"stopped": true}'
curl -s http://127.0.0.1:8000/api/killswitch
curl -s -X POST http://127.0.0.1:8000/api/killswitch -H 'Content-Type: application/json' -d '{"stopped": false}'
```
Expected sequence: `{"stopped": false}` → `{"stopped": true}` → `{"stopped": true}` → `{"stopped": false}`.

- [x] **Step 3: Verify the JS agent runtime actually respects it (cross-check against `guard.js`, read-only)**

Run:
```bash
curl -s -X POST http://127.0.0.1:8000/api/killswitch -H 'Content-Type: application/json' -d '{"stopped": true}'
node -e "const {isStopped} = require('./code/guard.js'); console.log(isStopped());"
curl -s -X POST http://127.0.0.1:8000/api/killswitch -H 'Content-Type: application/json' -d '{"stopped": false}'
```
Expected: `node` prints `true` in the middle — confirms the API's file write is the same file `guard.js` checks, not a divergent path.

- [x] **Step 4: Commit**

```bash
git add app.py
git commit -m "feat(api): add /api/killswitch wired to guard.js's real STOP_FILE"
```

### Task 5: `/api/transcribe` — wire the already-installed faster-whisper

> **Executed 2026-08-13**, exactly as written. Real `arecord -d 3 -f cd -t wav`
> capture used (not a synthetic/empty WAV) — the multipart upload → model load →
> transcription pipeline works end-to-end with no errors, verified both directly
> and through the Phase 3 Vite proxy. Honesty caveat: this agent has no way to
> physically speak into the mic, and re-running the identical captured file
> through `/api/transcribe` repeatedly produced different sentences each time —
> the classic Whisper hallucination pattern on quiet non-speech audio, meaning
> the capture picked up ambient noise, not real words. The plumbing is proven
> correct; the specific transcribed text is not a verified speech-accuracy
> result and would need a human actually speaking into the mic to confirm that.
> Commit: `cf0b7e0`.

**Files:**
- Create: `/home/ahmedyidris/jarvis-x/code/stt_engine.py`
- Modify: `/home/ahmedyidris/jarvis-x/app.py`

**Interfaces:**
- Produces: `STTEngine.transcribe(wav_bytes: bytes) -> str`, and `POST /api/transcribe` (multipart `audio` file, WAV) → `{"text": "..."}`.
- This replaces `code/stt.js`'s approach (server-side `arecord` capture + per-call subprocess spawn) with client-side capture (browser `MediaRecorder`, wired in Task 8) posting a finished blob — the model load itself is the same `faster_whisper.WhisperModel("tiny.en", device="cpu", compute_type="int8")` already proven working in `code/stt.js:24`.

- [x] **Step 1: Write the STT engine module (mirrors `code/tts_engine.py`'s singleton pattern)**

```python
#!/usr/bin/env python3
"""Local speech-to-text via faster-whisper. CPU-only, no network calls."""
import io
import logging
import wave
from faster_whisper import WhisperModel

logger = logging.getLogger('STTEngine')

_engine = None

class STTEngine:
    def __init__(self, model_size="tiny.en"):
        logger.info(f"Loading faster-whisper model: {model_size}")
        self.model = WhisperModel(model_size, device="cpu", compute_type="int8")

    def transcribe(self, wav_bytes: bytes) -> str:
        # faster-whisper reads from a path or file-like object; wrap the
        # uploaded bytes so nothing touches disk.
        buf = io.BytesIO(wav_bytes)
        segments, _info = self.model.transcribe(buf, beam_size=5)
        return " ".join(seg.text for seg in segments).strip()

def get_engine() -> STTEngine:
    global _engine
    if _engine is None:
        _engine = STTEngine()
    return _engine
```

- [x] **Step 2: Write a standalone test using a real recorded sample (not a placeholder)**

```bash
# Record 3 seconds of test speech directly (Crostini has arecord + audio passthrough)
arecord -d 3 -f cd -t wav /tmp/stt-test.wav
/home/ahmedyidris/venv-ai/bin/python3 -c "
from code.stt_engine import get_engine
with open('/tmp/stt-test.wav', 'rb') as f:
    print(get_engine().transcribe(f.read()))
"
```
Expected: printed text roughly matching what you said into the mic (tiny.en is English-only and imperfect on Arabic — acceptable for v1, noted as a follow-up in Task 13).

- [x] **Step 3: Add the FastAPI route**

```python
from fastapi import UploadFile, File
from code.stt_engine import get_engine as get_stt_engine

@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    wav_bytes = await audio.read()
    text = await asyncio.to_thread(get_stt_engine().transcribe, wav_bytes)
    return {"text": text}
```

- [x] **Step 4: Restart and verify end-to-end over HTTP**

Run: `supervisorctl -c config/supervisord.conf restart hermes-api && curl -s -F "audio=@/tmp/stt-test.wav" http://127.0.0.1:8000/api/transcribe`
Expected: `{"text": "<what you said>"}`.

- [x] **Step 5: Commit**

```bash
git add code/stt_engine.py app.py
git commit -m "feat(api): add /api/transcribe using the already-installed faster-whisper"
```

---

## Phase 3 — shadcn/ui PWA frontend

### Task 6: Scaffold the Vite + React + Tailwind + shadcn/ui app in `web/`

**Files:**
- Create: `/home/ahmedyidris/jarvis-x/web/` (new Vite project — `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `src/main.tsx`, `src/index.css`, `components.json`)

**Interfaces:**
- Produces: a running dev server on `localhost:5173` proxying `/api/*` to `127.0.0.1:8000`, and a `npm run build` script producing `web/dist/` for Task 9 to serve.

- [ ] **Step 1: Scaffold Vite**

```bash
cd /home/ahmedyidris/jarvis-x
npm create vite@latest web -- --template react-ts
cd web
npm install
```

- [ ] **Step 2: Install Tailwind**

```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

- [ ] **Step 3: Configure Tailwind content paths**

```js
// web/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
}
```

```css
/* web/src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Set up path aliases (required by shadcn's CLI)**

```json
// web/tsconfig.json — add under "compilerOptions"
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

```ts
// web/vite.config.ts
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
})
```

- [ ] **Step 5: Initialize shadcn/ui**

```bash
npx shadcn@latest init -d
npx shadcn@latest add button card textarea switch scroll-area separator badge
```

- [ ] **Step 6: Verify the dev server runs with a shadcn component rendering**

```tsx
// web/src/App.tsx (temporary smoke-test content, replaced in Task 7)
import { Button } from "@/components/ui/button"
export default function App() {
  return <Button>Jarvis online</Button>
}
```

Run: `npm run dev` (in `web/`), open the Crostini-forwarded URL in Chrome.
Expected: a styled button reading "Jarvis online" — confirms Tailwind + shadcn are wired correctly before building the real UI.

- [ ] **Step 7: Commit**

```bash
cd /home/ahmedyidris/jarvis-x
git add web/
git commit -m "feat(web): scaffold Vite + React + Tailwind + shadcn/ui app"
```

### Task 7: Build the chat + sidebar shell (functional skeleton of Design.md's HUD layout)

**Files:**
- Create: `web/src/lib/api.ts`
- Create: `web/src/components/Sidebar.tsx`
- Create: `web/src/components/ChatPanel.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `/api/ask`, `/api/history`, `/api/killswitch`, `/api/voices` (all exist as of Phase 2).
- Produces: `askJarvis()`, `getHistory()`, `getKillswitch()`, `setKillswitch()` — typed fetch wrappers every component below calls; `<Sidebar>` and `<ChatPanel>` — composed into `<App>`.

- [ ] **Step 1: Typed API client**

```ts
// web/src/lib/api.ts
export type Tier = "local" | "quality"

export interface AskResponse {
  question: string
  response: string
  tier: Tier
  model: string
  voice: string | null
  audio: string | null
}

export interface HistoryEntry {
  timestamp: string
  user_input: string
  response: string
  model: string
  latency_ms: number
  voice_id: string | null
}

export async function askJarvis(question: string, tier: Tier, speak: boolean): Promise<AskResponse> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, tier, speak }),
  })
  if (!res.ok) throw new Error(`ask failed: ${res.status}`)
  return res.json()
}

export async function getHistory(limit = 20): Promise<HistoryEntry[]> {
  const res = await fetch(`/api/history?limit=${limit}`)
  const data = await res.json()
  return data.conversations
}

export async function getKillswitch(): Promise<boolean> {
  const res = await fetch("/api/killswitch")
  const data = await res.json()
  return data.stopped
}

export async function setKillswitch(stopped: boolean): Promise<boolean> {
  const res = await fetch("/api/killswitch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stopped }),
  })
  const data = await res.json()
  return data.stopped
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const form = new FormData()
  form.append("audio", blob, "recording.wav")
  const res = await fetch("/api/transcribe", { method: "POST", body: form })
  const data = await res.json()
  return data.text
}
```

- [ ] **Step 2: Sidebar — model tier, kill switch, recent memory**

```tsx
// web/src/components/Sidebar.tsx
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { getHistory, getKillswitch, setKillswitch, type HistoryEntry, type Tier } from "@/lib/api"

interface SidebarProps {
  tier: Tier
  onTierChange: (tier: Tier) => void
}

export function Sidebar({ tier, onTierChange }: SidebarProps) {
  const [stopped, setStopped] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  useEffect(() => {
    getKillswitch().then(setStopped)
    getHistory(10).then(setHistory)
  }, [])

  async function toggleKillswitch() {
    const next = await setKillswitch(!stopped)
    setStopped(next)
  }

  return (
    <aside className="flex h-full w-72 flex-col gap-4 border-r border-border bg-background p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Model tier</span>
        <Button
          size="sm"
          variant={tier === "local" ? "default" : "outline"}
          onClick={() => onTierChange(tier === "local" ? "quality" : "local")}
        >
          {tier === "local" ? "local (3b)" : "quality (7b)"}
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Kill switch</span>
        <div className="flex items-center gap-2">
          {stopped && <Badge variant="destructive">STOPPED</Badge>}
          <Switch checked={!stopped} onCheckedChange={toggleKillswitch} />
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <span className="text-sm font-medium">Recent memory</span>
        <ScrollArea className="mt-2 h-full pr-2">
          {history.map((h, i) => (
            <div key={i} className="mb-2 rounded border border-border p-2 text-xs">
              <p className="truncate text-muted-foreground">{h.user_input}</p>
              <p className="truncate">{h.response}</p>
            </div>
          ))}
        </ScrollArea>
      </div>
    </aside>
  )
}
```

- [ ] **Step 3: Chat panel**

```tsx
// web/src/components/ChatPanel.tsx
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { askJarvis, type AskResponse, type Tier } from "@/lib/api"

interface Message {
  role: "user" | "jarvis"
  text: string
  audio?: string | null
}

export function ChatPanel({ tier }: { tier: Tier }) {
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [speak, setSpeak] = useState(false)
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!input.trim() || busy) return
    const question = input.trim()
    setMessages((m) => [...m, { role: "user", text: question }])
    setInput("")
    setBusy(true)
    try {
      const res: AskResponse = await askJarvis(question, tier, speak)
      setMessages((m) => [...m, { role: "jarvis", text: res.response, audio: res.audio }])
      if (res.audio) new Audio(res.audio).play()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex h-full flex-1 flex-col gap-4 p-4">
      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[70ch] rounded p-3 ${
              m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"
            }`}
          >
            {m.text}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Ask Jarvis..."
          className="flex-1"
        />
        <div className="flex flex-col gap-2">
          <Button onClick={send} disabled={busy}>
            {busy ? "..." : "Ask"}
          </Button>
          <Button variant={speak ? "default" : "outline"} onClick={() => setSpeak((s) => !s)}>
            🔊
          </Button>
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Compose the shell**

```tsx
// web/src/App.tsx
import { useState } from "react"
import { Sidebar } from "@/components/Sidebar"
import { ChatPanel } from "@/components/ChatPanel"
import type { Tier } from "@/lib/api"

export default function App() {
  const [tier, setTier] = useState<Tier>("local")
  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      <Sidebar tier={tier} onTierChange={setTier} />
      <ChatPanel tier={tier} />
    </div>
  )
}
```

- [ ] **Step 5: Manual verification against the real backend**

Run: `npm run dev` (in `web/`, with supervisord's `hermes-api` already running per Phase 1), open in Chrome.
Expected: typing a question and hitting Enter shows both messages, the sidebar's recent-memory list updates after a refresh, and toggling the kill-switch Switch flips the `STOPPED` badge and — verified by re-running Task 4 Step 3's `node -e` check — actually creates/removes `.jarvis-x-STOP`.

- [ ] **Step 6: Commit**

```bash
cd /home/ahmedyidris/jarvis-x
git add web/src
git commit -m "feat(web): chat + sidebar shell wired to the local API"
```

> **Visual pass, not a separate task to hand-author here:** once this skeleton works, apply Design.md's actual HUD aesthetic (cyan glow, sharp 2–4px corners, RTL mirroring for Arabic) using this repo's own `.claude/skills/design-taste-frontend` or `impeccable` skill against `Design.md` as the brief — that's exactly what those installed skills are for, and hand-duplicating their output into this plan would just go stale against Design.md's still-open accent-color decision.

### Task 8: Client-side voice capture (MediaRecorder → `/api/transcribe`)

**Files:**
- Create: `web/src/components/MicButton.tsx`
- Modify: `web/src/components/ChatPanel.tsx`

**Interfaces:**
- Consumes: `transcribeAudio()` from `web/src/lib/api.ts` (Task 7).
- Produces: `<MicButton onText={(text) => void}>` — `ChatPanel` passes a callback that fills the textarea.

- [ ] **Step 1: Write the mic button**

```tsx
// web/src/components/MicButton.tsx
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { transcribeAudio } from "@/lib/api"

export function MicButton({ onText }: { onText: (text: string) => void }) {
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const recorder = new MediaRecorder(stream)
    chunksRef.current = []
    recorder.ondataavailable = (e) => chunksRef.current.push(e.data)
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" })
      const text = await transcribeAudio(blob)
      onText(text)
      stream.getTracks().forEach((t) => t.stop())
    }
    recorder.start()
    recorderRef.current = recorder
    setRecording(true)
  }

  function stop() {
    recorderRef.current?.stop()
    setRecording(false)
  }

  return (
    <Button variant={recording ? "destructive" : "outline"} onClick={recording ? stop : start}>
      {recording ? "⏹ stop" : "🎙 speak"}
    </Button>
  )
}
```

- [ ] **Step 2: Wire it into `ChatPanel`**

```tsx
// web/src/components/ChatPanel.tsx — add alongside the existing Button/speak toggle
import { MicButton } from "@/components/MicButton"
// ...inside the returned JSX, in the flex column next to the Ask/speak buttons:
<MicButton onText={(text) => setInput((prev) => (prev ? prev + " " + text : text))} />
```

- [ ] **Step 3: Manual verification**

In Chrome, click "🎙 speak", say a short sentence, click "⏹ stop".
Expected: the transcribed text appears in the textarea within a couple seconds (tiny.en is CPU-fast). Grant the mic permission prompt the first time — Crostini's audio passthrough plus `arecord` working (confirmed in Phase 2 Task 5) means the browser's own mic capture will work too.

> **Note on the FastAPI multipart upload format:** `MediaRecorder`'s default output is WebM/Opus, not WAV — `faster-whisper` handles compressed containers directly via its internal ffmpeg decode path (ffmpeg is already installed, confirmed in this plan's grounding), so no client-side WAV conversion is needed. If a transcode error appears in `logs/supervisord/hermes-api.err.log`, that's the one thing to check first.

- [ ] **Step 4: Commit**

```bash
cd /home/ahmedyidris/jarvis-x
git add web/src
git commit -m "feat(web): client-side voice capture via MediaRecorder + /api/transcribe"
```

---

## Phase 4 — Production build, single-origin serving, PWA installability

### Task 9: Serve the built SPA from FastAPI (one process, one port)

**Files:**
- Modify: `/home/ahmedyidris/jarvis-x/app.py`
- Modify: `web/vite.config.ts` (set `build.outDir`)

**Interfaces:**
- Consumes: `web/dist/` (Vite's build output).
- Produces: `GET /` and any non-`/api` path → the SPA's `index.html` (client-side routing fallback); `/assets/*` → the built JS/CSS.

- [ ] **Step 1: Point Vite's build output at a path `app.py` will serve**

```ts
// web/vite.config.ts — add to defineConfig(...)
build: {
  outDir: "dist",
  emptyOutDir: true,
},
```

- [ ] **Step 2: Build it**

```bash
cd /home/ahmedyidris/jarvis-x/web
npm run build
```

Expected: `web/dist/index.html` and `web/dist/assets/*.js`/`*.css` exist.

- [ ] **Step 3: Mount it in FastAPI, replacing the old static `FileResponse("index.html")`**

```python
# app.py — near the top, after `app = FastAPI(...)`
from fastapi.staticfiles import StaticFiles

WEB_DIST = Path(__file__).parent / "web" / "dist"

# Replace the old root() route entirely:
@app.get("/")
async def root():
    return FileResponse(WEB_DIST / "index.html")

# Mount built assets (JS/CSS/etc.) under /assets
app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

# SPA fallback: any unmatched non-/api path serves index.html too,
# so client-side routes (if added later) don't 404 on refresh.
@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(WEB_DIST / "index.html")
```

- [ ] **Step 4: Restart and verify the built SPA is served, not the old `index.html`**

Run:
```bash
supervisorctl -c config/supervisord.conf restart hermes-api
curl -s http://127.0.0.1:8000/ | grep -o '<title>[^<]*</title>'
```
Expected: the Vite-generated title (e.g. `<title>Vite + React + TS</title>` until Task 10 renames it), not the old hand-written `index.html`'s content — confirming FastAPI is now serving `web/dist/index.html`.

- [ ] **Step 5: Open in Chrome and do a full click-through**

Visit `http://127.0.0.1:8000/`, ask a question, toggle the kill switch, use the mic button — everything from Phase 3 should work identically from this single served origin.

- [ ] **Step 6: Commit**

```bash
git add app.py web/vite.config.ts
git commit -m "feat: serve built SPA from FastAPI, retire static index.html"
```

> Old `index.html` at the repo root is superseded but left in place (untouched, not deleted) — it's still referenced by `MASTER_PLAN_UPDATED.md`'s Week 4 history and costs nothing to keep as a record of what "v1 shipped" actually looked like.

### Task 10: PWA manifest, icons, and Chrome OS install

**Files:**
- Create: `web/public/manifest.json`
- Create: `web/public/icon-192.png`, `web/public/icon-512.png`
- Modify: `web/index.html`

**Interfaces:**
- Produces: a Chrome-installable PWA — the browser's omnibox shows an install icon once `manifest.json` and icons are present and linked.

- [ ] **Step 1: Write the manifest**

```json
{
  "name": "Jarvis-X",
  "short_name": "Jarvis",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#0f172a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

(`background_color`/`theme_color` reuse `index.html`'s existing gradient start color, `#0f172a`, as a placeholder — replace once Design.md's HUD accent color is finalized.)

- [ ] **Step 2: Generate two placeholder icons (swap for real artwork later — this only unblocks installability)**

```bash
cd /home/ahmedyidris/jarvis-x/web/public
python3 -c "
from PIL import Image, ImageDraw
for size in (192, 512):
    img = Image.new('RGB', (size, size), '#0f172a')
    d = ImageDraw.Draw(img)
    d.text((size*0.3, size*0.4), 'J', fill='#60a5fa')
    img.save(f'icon-{size}.png')
"
```

(Requires `Pillow` — `~/venv-ai/bin/pip install pillow` first if not already present.)

- [ ] **Step 3: Link the manifest and set a real page title**

```html
<!-- web/index.html -->
<title>Jarvis-X</title>
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#0f172a" />
```

- [ ] **Step 4: Rebuild and restart**

```bash
cd /home/ahmedyidris/jarvis-x/web && npm run build
supervisorctl -c /home/ahmedyidris/jarvis-x/config/supervisord.conf restart hermes-api
```

- [ ] **Step 5: Install it — this step is manual, not scriptable**

In Chrome, visit `http://127.0.0.1:8000/`. Click the install icon in the right side of the address bar (or Chrome menu → "Save and share" → "Install page as app"). Confirm.
Expected: Jarvis-X opens in its own standalone window (no address bar/tabs) and a launcher icon appears — right-click it in the shelf and choose "Pin" to keep it there permanently.

- [ ] **Step 6: Commit**

```bash
cd /home/ahmedyidris/jarvis-x
git add web/public web/index.html
git commit -m "feat(web): PWA manifest + icons, installable from Chrome"
```

---

## Phase 5 — Guardrail reconciliation (documentation only — no Edit/Write calls on protected files)

### Task 11: Hand Ahmed the exact diffs for Edit-denied files

**Files:** none created or modified by this task — it produces text for Ahmed to paste in himself.

Two real inconsistencies surfaced while grounding this plan, both in files this plan is not allowed to touch:

**1. `CONSTITUTION.md`'s kill-switch path is wrong.** It should reference the file `code/guard.js` actually checks:

```diff
- Kill switch via `~/.jarvis-x/STOP`
+ Kill switch via `.jarvis-x-STOP` at the repo root (see code/guard.js:5)
```

**2. `knowledge/Guidelines.md`'s quick/hard/max Gemini tiers are not part of the chat path this plan builds on.** Worth a one-line clarification so a future session doesn't assume the new PWA calls Gemini (it doesn't — `router.py`'s `local`/`quality` tiers are both Ollama-only, confirmed in `app.py`'s `/api/ask`):

```diff
  ## Available models (reality, not plan)
+ (These tiers are consumed by the JS agent-autonomy path — code/agent.js via
+ router.js — not by the web chat interface. The web chat's router.py only
+ ever calls local Ollama models; see docs/superpowers/plans/2026-08-13-chromeos-pwa-interface.md.)
  - quick tier    -> gemini-3.6-flash        (remote, free tier)
```

**3. `config/voice.json` still carries a dead paid-API entry** (`ar_eg_elevenlabs`, blocked on a 402 from ElevenLabs' free tier, superseded by the working local `ar_eg_egtts` voice clone). This file is *not* Edit-denied, so this can be a real task rather than a handoff:

- [ ] Remove the `ar_eg_elevenlabs` block from `config/voice.json`, keeping `ar_eg_egtts` as the Egyptian Arabic voice.
- [ ] Run: `python3 -c "import json; json.load(open('config/voice.json'))"` — confirms the file is still valid JSON after the edit.
- [ ] Commit: `git commit -am "chore: drop dead ElevenLabs voice entry, EGTTS-V0.1 local voice is the real Egyptian option"`

- [ ] **Step: Present items 1 and 2 above to Ahmed for manual application** (this plan's execution should stop here and paste the two diffs into chat rather than attempting Edit/Write against the denied paths).

---

## Self-Review

**Spec coverage:** Design.md's sidebar (model tier/scheduler/audit/kill-switch/memory) → Task 7's `<Sidebar>` covers tier + kill-switch + memory; "scheduler/audit" panels are follow-up UI, not blocking for a working v1 and are called out in Task 7's visual-pass note rather than invented here. CONSTITUTION.md's kill-switch → Task 4 + Task 11. "100% local, gated free-API fallback only" → Global Constraints + confirmed `router.py`/`app.py` never call a remote model already; Task 11 documents where the one remaining remote dependency (Gemini, JS-agent-only) actually lives so it isn't silently assumed to be part of this build. supervisord → Phase 1. shadcn/ui + Tailwind + Radix PWA → Phase 3 + Phase 4. Voice (STT+TTS) → Task 5 (STT, new) + existing Piper/Kokoro/EGTTS (TTS, untouched, already wired via `/api/ask`'s `speak` flag).

**Placeholder scan:** every code block above is complete, runnable code with real paths from this machine (not `your-path-here`); the one intentionally-placeholder asset (Task 10's generated "J" icons) is explicitly flagged as swap-later artwork, not a plan gap.

**Type consistency:** `Tier = "local" | "quality"` (matches `router.py`'s only two real tiers, not the Gemini quick/hard/max names) is used identically in `api.ts`, `Sidebar.tsx`, `ChatPanel.tsx`, `App.tsx`. `AskResponse`/`HistoryEntry` field names match `app.py`'s actual JSON responses and `hermes.py`'s `recall()` row keys exactly.
