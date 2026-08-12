# HERMES — MASTER PLAN (Reconciled)
**Date:** 2026-08-12
**Status:** Week 2 complete (Hermes Core + TTS Engine). Ready for Week 3.

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
| **2b** | TTS Engine | ✅ COMPLETE | `tts_engine.py`, committed `d0a5111`. 9 voice_ids, all synthesized and verified (not just installed) — see below. |
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

## WEEK 2b — TTS Engine (Verified complete, `d0a5111`)

Priority order requested: Arabic (Egyptian > formal/MSA > rest), English (US, UK, Irish, Australian-if-found).

`tts_engine.py` wires two CPU-only backends — Piper (fast) and Kokoro (natural,
English only) — behind `TTSEngine.synthesize(text, voice_id) -> (audio_bytes, mime_type)`.
Every voice_id below was actually run and produced audio in `/tmp/tts-verify/`,
not just installed:

| voice_id | backend | latency (this machine) | notes |
|---|---|---|---|
| `ar_msa_piper` | Piper, `ar_JO-kareem-medium` | ~1.8s | closest available to formal/MSA |
| `ar_msa_piper_low` | Piper, `ar_JO-kareem-low` | ~1.3s | same voice, faster/lower quality |
| `ar_ae_piper` | Piper, `ar-AE-emirati-female` | ~2.0s | Gulf addition, not MSA |
| `en_us_piper` | Piper, `en_US-amy-medium` | ~1.2s | |
| `en_gb_piper` | Piper, `en_GB-alba-medium` | ~1.2s | downloaded this session |
| `en_us_kokoro`(+`_m`) | Kokoro `af_heart`/`am_eric` | ~4-6s | natural, slower |
| `en_gb_kokoro`(+`_m`) | Kokoro `bf_emma`/`bm_george` | ~5s | natural, slower |

**Egyptian Arabic — priority 1, not delivered.** Researched, not silently
dropped: no CPU-viable ONNX/Piper voice exists in the official Piper catalog,
the OpenVoiceOS community collection, or MMS-TTS (which only ships a single
Standard-Arabic checkpoint, `facebook/mms-tts-ara`, under the macrolanguage
code `ara` — not Egyptian `arz`). Best real lead: `OmarSamir/EGTTS-V0.1` on
HuggingFace, an actual Egyptian Arabic TTS model — but it's XTTS-v2 based
(PyTorch voice-cloning architecture), much heavier than Piper/Kokoro, and
needs real CPU-latency testing on this Chromebook before it's fair to call
it a deliverable. **Follow-up, not forgotten.**

**Irish / Australian English — not found.** Checked Piper's official
catalog, the OpenVoiceOS Piper-voice collection, and Kokoro's full 54-voice
set (loaded and enumerated locally: `af_/am_` = US, `bf_/bm_` = UK, no
Irish or Australian entries exist). Australian was flagged as okay-to-skip;
Irish wasn't, but genuinely isn't available in any CPU-friendly stack found
so far.

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
