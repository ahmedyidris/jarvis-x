# HERMES — MASTER PLAN (Reconciled)
**Date:** 2026-08-12
**Status:** Week 2 partially complete — Hermes Core done, TTS Engine NOT done (see reconciliation note)

---

## Reconciliation Note

A status report pasted into this session claimed Week 2 TTS work ("Professional TTS
Engine locked", commit `a7f2e8d`, 9 voices, three working backends) that does not
exist on disk. This is the same failure mode `WEEK_1_COMPLETE.md` already flagged
once and told future sessions to discard: a polished completion report that outruns
the filesystem. Treat any "✅ COMPLETE" claim from a terminal-output paste as
unverified until checked against `git log` and the actual files — this doc only
counts something done if I found it on disk myself.

What's real vs. claimed for Week 2 TTS, checked against the filesystem directly:

| Claimed | Actual |
|---|---|
| `tts_engine.py` built, `synthesize(text, voice_id)` API | Does not exist anywhere on disk |
| sherpa-onnx, transformers installed | Not installed |
| Kokoro-82M ONNX ready, MMS-TTS-ara ready | No cache evidence either ever ran |
| 3 Piper voices: en_US-lessac, en_GB-vctk, ar_JO-kareem | Actually installed: `en_US-amy-medium`, `ar_JO-kareem-medium`, `ar-AE-emirati-female` — right count, wrong set, no en_GB |
| Commit `a7f2e8d` "Professional TTS Engine locked" | No such commit; nothing committed past `26d2d49` (hermes.py) |
| piper-tts installed, Piper test wavs generated | **Real** — `piper-tts` 1.6.0 in `venv-ai`; `/tmp/piper-test-en.wav` (89KB) + `/tmp/piper-test-ar.wav` (94KB), timestamped today |
| kokoro-onnx / kokoro-tts installed | **Real** — `kokoro-onnx` 0.3.9, `kokoro-tts` 2.3.1 in `venv-ai`, but no synthesis output found for either |

---

## BUILD STATUS (Actual Filesystem, Verified)

| Week | Task | Status | Evidence |
|------|------|--------|----------|
| **1** | Ollama + Voice Foundation | ✅ COMPLETE | `WEEK_1_COMPLETE.md`; qwen2.5:7b/3b loaded in Ollama, kokoro-tts synthesis tested |
| **2a** | Hermes Core | ✅ COMPLETE | `hermes.py`, 154 lines, committed `26d2d49` — CLI + SQLite state at `~/.hermes/state.db`, restart-safe |
| **2b** | TTS Engine | 🔶 IN PROGRESS | Deps installed (`piper-tts`, `kokoro-onnx`, `kokoro-tts` in `venv-ai`); 3 Piper voices downloaded; Piper en/ar test wavs generated in `/tmp`. **No `tts_engine.py` module, no Kokoro synthesis test, nothing committed.** |
| **3** | Router + Tier Selection | ⏳ NEXT | Not started |
| **4** | Web UI + Minimal App | — | Not started |

---

## WEEK 1 (Verified, from `WEEK_1_COMPLETE.md`)

- Chromebook Asus i5-1135G7, 8 vCPU, 14GB RAM, no GPU — Crostini (Debian 12, kernel 6.6.119)
- Ollama 0.32.9 running: qwen2.5:7b + qwen2.5:3b loaded
- kokoro-tts synthesis tested: "Hello, this is Hermes speaking" → 88K WAV, ~2s latency

## WEEK 2a — Hermes Core (Verified complete)

- `python3 hermes.py "question"` → qwen2.5, SQLite-backed, restart-safe
- Modes: `--status`, `--recall [N]`, `"question" [model]`
- Committed as `26d2d49`

## WEEK 2b — TTS Engine (Actual remaining work)

What exists to build on:
- `venv-ai` has `piper-tts` 1.6.0, `kokoro-onnx` 0.3.9, `kokoro-tts` 2.3.1, `onnxruntime` 1.28.0, `soundfile` 0.14.0
- Voices at `~/.local/share/piper-tts/voices/`: `en_US-amy-medium`, `ar_JO-kareem-medium`, `ar-AE-emirati-female`
- Prior history (`4161b5a`, `bbf3b43`) already explored Jordanian vs. Emirati vs. Egyptian Arabic — Egyptian was ruled out as "no CPU-viable option found"; decide whether to keep both `ar_JO` and `ar-AE` or drop one

What's actually left to do:
1. Write `tts_engine.py` with a real `synthesize(text, voice_id) -> (audio_bytes, mime_type)` API over Piper (and Kokoro if it's worth the added dependency weight over what `code/kokoro.js` already does in the Node side)
2. Run an actual Kokoro synthesis test and keep the output as evidence
3. Decide the Arabic voice: `ar_JO-kareem-medium` vs `ar-AE-emirati-female` (or keep both, exposed as separate voice IDs)
4. Commit the module once it's real
5. Only then move to Week 3 (router)

---

## WEEK 3 SCOPE (Next, unchanged)

**Smart Router:** local tier (qwen2.5:3b + Piper) vs. quality tier (qwen2.5:7b + Kokoro), with fallback to Piper if Kokoro is slow.

**Integrate TTS into Hermes:**
`python3 hermes.py "question" --voice <voice_id>` → text answer + audio file.

## WEEK 4 SCOPE (After Week 3)

FastAPI daemon (localhost:8000) wrapping Hermes + TTS, minimal HTML+JS front end (localhost:3000), voice dropdown, text-in / text+audio-out.

---

## OUT OF SCOPE / SEPARATE PROJECTS (for context, not part of this plan)

- `sentinel/` — separate portfolio project (AI incident-response copilot), documented in root `README.md`. Not part of Hermes.
- `automation/n8n/` — untracked, not referenced by this plan. Not evaluated here.
