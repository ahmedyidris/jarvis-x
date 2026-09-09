# JARVIS X — COMPREHENSIVE PROJECT SYNC & GROUNDING PACK
**Target Platforms:** Google NotebookLM & Google Gemini Jarvis X Project Workspace  
**Document Version:** 5.0 (Reconciled & Synchronized)  
**Date:** 2026-09-09  
**Status:** PRODUCTION VERIFIED · ALL LOCAL & DRIVE ASSETS SYNCED  

---

## 1. EXECUTIVE MISSION & CORE IDENTITY

Jarvis X is Ahmed's autonomous, self-repairing personal AI ecosystem, operating primarily locally with intelligent, gated cloud offloading. The project operates on two permanent, non-competing tracks:

1. **Track 1 (Primary Mission — Personal Assistant & Self-Care):**
   - Autonomous Personal Assistant engineered for life organization, task execution, and proactive ADHD cognitive support.
   - Self-repairing, self-maintaining memory and runtime architecture that detects regressions, fixes failing harnesses, and preserves state across sessions.

2. **Track 2 (Secondary Mission — Monetization & Output Engines):**
   - **Content Automation:** High-throughput vertical video generation and highlight extraction (YouTube Shorts, TikTok, Instagram Reels) to build audience and monetization.
   - **Market Intelligence & Paper Trading:** Gated algorithmic market analysis, Stooq/Yahoo price feeds, automated paper trading simulation, and trade advisor workflows (real-money execution permanently prohibited by Constitution §IV).

---

## 2. HARDWARE ENVIRONMENT & MEASURED BENCHMARKS

- **Host Machine:** Chromebook (Crostini Linux Container, Debian 13 trixie, Kernel 6.6.135).
- **Compute:** 11th Gen Intel Core i5-1135G7 @ 2.40GHz, 8 threads, CPU-only inference (no discrete GPU).
- **Memory Reality:**
  - *Theoretical Total:* 14.12 GB RAM.
  - *Real Headroom Under Dev Load:* **3.7 GB – 4.0 GB free** (empirically measured via `llmfit`).
  - *Constraint:* Any local model load must strictly fit within the ~3.7 GB headroom without causing swap thrashing.
- **Inference Benchmarks (Empirical CPU Tok/s):**
  - `Qwen/Qwen2.5-3B-Instruct`: ~6.0 tokens/second (RAM footprint: 1.6 GB) — *Primary Local Workhorse*.
  - `Qwen/Qwen2.5-7B-Instruct`: ~2.4 tokens/second (RAM footprint: 3.9 GB) — *High-Reasoning Local Tier*.
  - `moondream:latest`: Vision recognition via Ollama (`llama-server`) — 25-45s per visual inspection.

---

## 3. SYSTEM ARCHITECTURE & COMPONENTS

The repository integrates four operational pillars sharing a single safety boundary:

### A. Web Chat Application (`app.py` + `web/`)
- **Backend:** FastAPI running under `uvicorn` on port 8000.
- **Frontend:** React + Vite Progressive Web App (PWA) supporting keyboard navigation, offline mode, and audio visualization.
- **LLM Routing:** `code/router.py` and `hermes.py` dispatching between local Ollama (`qwen2.5:3b`/`7b`) and external cloud providers (`gemini-3.6-flash`, Groq, OpenRouter).
- **Voice Stack:**
  - Speech-to-Text: `faster-whisper` (`base`/`small` models).
  - Text-to-Speech: Piper TTS (`ar_JO-kareem-medium`, `en_US-lessac`) and Kokoro TTS (American/British voices).
  - Egyptian Arabic Voice Cloning: Backed by 2.4 GB weights (`model.safetensors`) located in Google Drive `voicetut-tts`.

### B. Autonomous Agent Loop (`code/agent.js`, `code/scheduler.js`)
- **Autonomy Mode:** Human-present proposal loop (`agent.js`) proposing one validated action at a time; unattended scheduler (`scheduler.js`) restricted to read-only diagnostics and automated sweeps.
- **Safety Gate:** Governed by `CONSTITUTION.md` and `code/guard.js`. Every mutating action requires human confirmation.
- **Kill Switch:** Global kill switch located at `.jarvis-x-STOP` at repo root. Instant cessation of all agent actions and API jobs.
- **Audit Log:** Append-only ledger at `logs/actions.jsonl`.

### C. Phase B Video Pipeline (`automation/phase-b/`)
- Generates vertical 9:16 narrated educational MP4s across four distinct verticals:
  1. `economic_facts`
  2. `commodities_macro`
  3. `geopolitical_risk`
  4. `letters` (philosophical / essayist)
- **Fidelity Gate:** Sourced fact generators enforce semantic fidelity via a 3-call majority vote judge (`gemini-3.6-flash`, falling back to Groq LLaMA 3.3 70B).

### D. Clipper Vertical (`code/verticals/clipper/`)
- Automatic video highlight pipeline that takes long-form local video and extracts 15–60 second viral clips.
- **Pipeline Stages:**
  1. `ingest.py`: Validates video format, extracts high-fidelity audio track via ffmpeg.
  2. `transcribe.py`: Generates word-level timestamps using `faster-whisper`.
  3. `score.py`: Chunks transcript into overlapping 8-minute windows; calls Hermes (`qwen2.5`) to identify hooks, scores (0-10), and justifications.
  4. `render.py`: Centre-crops to target aspect ratios (`9:16`, `16:9`, `1:1`, `4:5`), scales, formats SRT subtitles, and burns in captions via ffmpeg.
- **API Exposure:** `POST /api/verticals/clipper` (job submission) and `GET /api/verticals/clipper/{job_id}` (status polling).

---

## 4. AS-BUILT VERIFICATION & TEST METRICS

- **JavaScript Test Suite:** **26 of 26 test files PASSING** (0 failing).
  - Full suite covers: accessibility, keyboard nav, agent-data layer, evaluation cases, exec sandboxing, guard jail, Kokoro TTS, Stooq market data provider, paper trading simulation, scheduler daemon, self-debug loop, supervisor, sweep, trade advisor, moondream vision, and voice router.
- **Hardware Integration Suites:** **5 of 5 suites GREEN** verified on live Chromebook hardware:
  - `test-kokoro.js`
  - `test-vision.js`
  - `test-voice.js`
  - `test-voice-interaction.js`
  - `test-voice-router.js`
- **Python Test Suites:** **18 of 18 tests PASSING**:
  - `test_clipper.py` (6/6 passed)
  - `test_app_generation_lock.py` (5/5 passed)
  - `test_hermes_ask_timeout_and_log.py` (4/4 passed)
  - `test_api_ask_reply_engine_integration.py` (3/3 passed)
- **Code Health Audit:**
  - `bash scripts/status.sh` reports **133 checks passed**, 93% milestone completion.
  - Zero-assertion sweep active in CI to prevent false-positive pass masks.

---

## 5. GOOGLE DRIVE ASSET INVENTORY (`/mnt/shared/GoogleDrive/MyDrive/Jarvis Files/`)

The following files on Google Drive serve as the canonical offline and external assets:

1. `JARVIS_X_MASTER_BLUEPRINT_v4.pdf` — Architecture blueprint (reconciled into Master Plan v5).
2. `Self-Repairing_Memory_Architecture_Template.pdf` — Memory self-healing design specifications.
3. `voicetut-tts/` — Model weights directory:
   - `model.safetensors` (2.45 GB)
   - `reference_speakers/`
   - `tokenizer.json` & `config.json`
4. `AI/` — Reference research library containing prompt guides, agent architecture blueprints, and Claude skills manuals.
5. `AS_BUILT.md` — Authoritative status report reflecting verified hardware and software numbers.
6. `MASTER_PLAN_v5.md` — Reconciled strategic roadmap.

---

## 6. ACTIVE STRATEGIC ROADMAP & NEXT PRIORITIES

1. **Self-Repairing Memory Architecture (From Drive Template):**
   - Transition from simple flat memory to a bitemporal three-branch knowledge graph (`user`, `directives`, `world`).
   - Automated consistency validation and periodic self-repair passes to reconcile conflicting memory nodes.
2. **Schema v5 Agent Upgrade:**
   - Add `confidence` rating and `approved_by` audit keys to all structured proposals.
3. **Automated Social Distribution for Video Verticals:**
   - Add automated publishing metadata and webhook dispatchers for approved clips generated by `code/verticals/clipper`.
4. **Voice Cloning Service Restoration:**
   - Mount `/mnt/shared/GoogleDrive/MyDrive/Jarvis Files/voicetut-tts` into `tts_worker.py` to activate the Egyptian Arabic conversational voice cloning engine.
