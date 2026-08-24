# Rules (human-written, authoritative)
# The agent never writes to this file. Edit it yourself.

- Ahmed builds and runs Jarvis X from a Chromebook via Crostini (Debian 12).
- Project root is ~/jarvis-x. All paths are relative to it.
- No real-money trading exists. Nothing in this system places trades.

## What Jarvis X is
- A local-first personal AI assistant. Local inference (Ollama), CPU-only,
  no GPU. Privacy by default: the core chat path never leaves the machine.
- Hermes is the core: hermes.py, backed by ~/.hermes/state.db.

## What exists and works
- Hermes: local Q&A over qwen2.5:3b / 7b, conversation memory, these rules.
- Voice: Piper TTS, 4 installed voices verified working 2026-08-24 --
  en_US-amy, en_GB-alba, ar_JO-kareem (Jordanian), ar-AE-emirati.
  Faster-Whisper STT, multilingual.
- Egyptian Arabic TTS does NOT work and is not installed. Habibi-TTS and
  NAMAA were both evaluated and ruled out (diffusion too slow on CPU, or
  too large for this disk). ar-eg fails loudly rather than misrouting to
  another dialect. Australian English likewise has no installed voice.
- Dashboard: React + FastAPI on :8000 — system health, live market data,
  content pipeline, config.
- Content pipeline: 4 verticals (letters, economic_facts, commodities_macro,
  geopolitical_risk). Sourced fact -> LLM narration -> TTS -> rendered video.
- Fidelity checks: numeric (deterministic, always on) and semantic (Gemini
  judge, run deliberately — free tier is 20 calls/day).
- Desktop app: Electron, installed as a .deb, launches from the app grid.
- Agent: proposes actions from goals, jailed to the repo, shell allowlist,
  human approval for writes, kill switch.

## Excluded by design — do not suggest these
- No trading bot. No real money moves anywhere.
- No multi-agent council.
- No eGPU or hardware modification.
- No self-debug loop until routing accuracy is boring.

## Superseded plans — ignore if encountered
- Any plan targeting Windows 11 / i7-4710HQ / GTX 860M is for hardware Ahmed
  does not have. Kokoro and Habibi-TTS belong to those plans; the working
  stack is Piper + Faster-Whisper.
- Any plan relocating compute to an Oracle VPS ("Cloud Hub", thin client)
  is the opposite of this system's local-first design.

## Constraints
- No budget available. Free tiers and existing hardware only — do not
  suggest paid services, subscriptions, or hardware purchases.

## Preferences
- Answer completely but concisely. No padding, no restating the question.
