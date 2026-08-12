# Windows Voice/Language Layer — Backup Setup Guide

**Status: UNVERIFIED.** Everything in this doc is translated from a build that
was actually installed, run, and round-trip-verified (real audio, transcribed
back to confirm correctness) on a separate Linux machine — not this one. Treat
every command here as untested until you run it and listen to the output
yourself. Where something needed real adaptation for Windows (audio
record/playback in particular), that's called out explicitly rather than
papered over.

Target hardware: Windows 11, Intel i7-4710HQ, GTX 860M (8GB). The GTX 860M is
Maxwell-era and unsupported by current Nvidia drivers — everything below is
CPU-only regardless of what GPU is present.

## What's actually confirmed to work (on the Linux build)

| Capability | Engine | Status |
|---|---|---|
| English — American | Kokoro-82M (`af_heart`) | ✅ verified |
| English — British | Kokoro-82M (`bm_george`) | ✅ verified |
| English — Australian | Kokoro-82M, **falls back to British** | ⚠️ no native AU voice exists in Kokoro-82M — the original plan's claim otherwise doesn't hold |
| Arabic — Jordanian | Piper (`ar_JO-kareem-medium`) | ✅ verified, solid quality |
| Arabic — Gulf/Emirati | Piper (`ar-AE-emirati-female`) | ✅ verified, but an early/unconverged community checkpoint — reliable on short phrases, degrades on longer sentences |
| Arabic — Egyptian | — | ❌ **not solved.** See "Why Habibi-TTS didn't work out" below |
| Arabic — Saudi/MSA | — | ❌ not attempted (`ISTNetworks/saudi-msa-piper` looked promising but was inaccessible without an HF login during research) |

## Step 0 — check what's already there

```powershell
pip list | findstr /i "tts torch ollama chatterbox kokoro"
ollama list
python --version
nvidia-smi
```

Also try actually running a TTS generation with whatever Phase 5 already
produced, in both languages, and listen to it. If it's not clean, unambiguous
audio in both, treat it as unverified and start from Step 1 below — a clean
restart is cheaper than debugging an uncertain foundation.

## Step 1 — Kokoro-82M (English)

```powershell
pip install kokoro-onnx
```

Download the model files (same files used on the Linux build):

```powershell
curl -L -o kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -L -o voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

~325MB + ~28MB — confirm you have >400MB free before starting.

Test script (`test_kokoro.py`):

```python
import soundfile as sf
from kokoro_onnx import Kokoro

k = Kokoro('kokoro-v1.0.onnx', 'voices-v1.0.bin')
print(k.get_voices())  # confirm af_* (American) and bm_*/bf_* (British) are in the list

samples, sr = k.create('The quick brown fox jumps over the lazy dog.', voice='af_heart', lang='en-us')
sf.write('test-american.wav', samples, sr)

samples, sr = k.create('The quick brown fox jumps over the lazy dog.', voice='bm_george', lang='en-gb')
sf.write('test-british.wav', samples, sr)
```

Run it, then **listen to both wav files** before doing anything else. Do not
skip this because the script exited without an error — "ran clean" and
"sounds right" are different claims.

There is no `au_*`/Australian voice prefix in `k.get_voices()` — confirmed
against the actual voice list, not assumed. If Australian coverage matters,
that's a real gap to solve separately (a fine-tune, per the original plan's
Step 4), not something Kokoro already provides.

## Step 2 — Arabic

### Why Habibi-TTS didn't work out (do this research before installing, don't skip it)

Before installing Habibi-TTS on this machine, check these first — they're
what killed it on the Linux build and will very likely apply here too:

1. **CPU speed.** Habibi-TTS wraps F5-TTS, a diffusion-transformer
   architecture — GPU-first by design. A documented real case: **7 minutes
   40 seconds to synthesize an 8-word sentence on CPU.** That's not "slower
   than Kokoro," it's a different category, unusable for anything
   interactive.
2. **Disk space.** `pip install torch` on Windows/x86_64 pulls a large
   default build; combined with F5-TTS's dependency stack (`transformers`,
   `accelerate`, `bitsandbytes`, `datasets`, `gradio`, etc.) plus a model
   checkpoint (1.35GB+ for the "Unified" model, or per-dialect for the
   Specialized ones), budget several GB. Check free disk space first.
3. **License**: Apache 2.0 covers the Egyptian/MSA/Iraqi/Algerian/Moroccan
   *specialized* checkpoints. The Saudi/UAE specialized checkpoints, **and
   the convenient all-in-one "Unified" checkpoint**, are all
   CC-BY-NC-SA-4.0 (non-commercial) — confirmed from the model card, not
   assumed.
4. **Interface mismatch.** Habibi isn't "pick a named voice" — it's
   zero-shot voice cloning (F5-TTS architecture). Every synthesis call
   needs a reference audio clip + its exact transcript. "Test the Egyptian
   model" means sourcing an Egyptian Arabic reference clip first, not just
   calling a function with a voice name.

If your GPU situation is different on this machine than assumed, or you're
willing to accept multi-minute waits per sentence for a non-interactive use
case, Habibi may still be worth trying — just go in with eyes open on all
four points above, verified against your actual environment (`nvidia-smi`,
`Get-PSDrive` for disk space) rather than assumed from this doc.

### What actually worked instead: Piper

Piper is already CPU-fast (VITS-based, small ONNX files, sub-second
synthesis) and has one official Arabic voice plus one usable community voice:

```powershell
pip install piper-tts
```

**Jordanian Arabic** (official, solid quality):
```powershell
curl -L -o ar_JO-kareem-medium.onnx https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx
curl -L -o ar_JO-kareem-medium.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx.json
echo مرحبا كيف حالك اليوم | piper --model ar_JO-kareem-medium.onnx --output_file test-ar-jo.wav
```

**Gulf/Emirati Arabic** (community checkpoint, early/unconverged — keep test
sentences short, e.g. "السلام عليكم", not long ones):
```powershell
curl -L -o ar-AE-emirati-female.onnx https://huggingface.co/vadimbelsky/arabic-emirati-female-piper/resolve/main/arabic-emirati-female-model.onnx
curl -L -o ar-AE-emirati-female.onnx.json https://huggingface.co/vadimbelsky/arabic-emirati-female-piper/resolve/main/arabic-emirati-female-model.onnx.json
```

**Egyptian Arabic**: no working option found. Ruled out or unavailable:
Habibi-TTS (see above), NAMAA-Egyptian-TTS (Chatterbox architecture — ~5GB
model download, likely too large alongside its own dependencies), MMS-TTS
(`facebook/mms-tts-ara` — genuinely CPU-fast VITS model, but it's a single
generic/MSA checkpoint with no Egyptian dialect control, and is
CC-BY-NC-4.0/non-commercial). If Egyptian is a hard requirement, this is
still open — don't assume it's solved just because Jordanian/Emirati are.

### Verify before moving on (don't skip)

Round-trip each generated wav through STT to confirm it actually says the
right thing — a file existing and playing back is not proof of that:

```python
from faster_whisper import WhisperModel
model = WhisperModel('tiny', device='cpu', compute_type='int8')  # multilingual, not tiny.en
segments, info = model.transcribe('test-ar-jo.wav', beam_size=5, language='ar')
print(info.language, info.language_probability, ' '.join(s.text for s in segments))
```

## Step 3 — Routing layer

The actual router built on the Linux machine (`code/voice-router.js` in this
repo) maps a language/accent code to an engine call:

```
en-us, en-gb   -> Kokoro
en-au          -> Kokoro, falls back to en-gb (no native AU voice)
ar, ar-jo      -> Piper ar_JO-kareem-medium
ar-gulf        -> Piper ar-AE-emirati-female
ar-eg          -> explicitly unsupported, rejected with a clear reason
                  rather than silently misrouted
```

Port this logic directly — it's plain Node.js with no Linux-specific calls
in the routing logic itself (`code/voice-router.js`). What **does** need
Windows-specific rework is everything underneath it that shells out to
Linux-only audio tools:

- `arecord` (recording) and `aplay` (playback) — both ALSA-specific, **do
  not exist on Windows.** Options: Python's `sounddevice` + `soundfile`
  (cross-platform, PortAudio-backed — note this needed no extra system
  install to work as a subprocess call on the Linux box's `piper`/`aplay`
  path, but PortAudio's Windows wheel situation should be checked
  independently), or shell out to `ffplay`/`ffmpeg` if already on PATH.
- `piper` and `kokoro_onnx`'s Python calls are OS-agnostic — those port as-is,
  just via `python.exe` instead of `python3`, and Windows path separators
  (use `path.join`, already the case in this codebase, so no change needed
  there).

Do not consider Step 3 done on this machine until you feed it real English
and Arabic input and confirm both the routing decision *and* the resulting
audio are correct — same self-test discipline as Steps 1 and 2.

## Standing rules (carried over, still apply)

- One step at a time. Don't open Habibi and Piper and MMS-TTS all at once
  "to compare" — that's how the CPU-speed and disk-space problems above got
  found *before* burning an install, not after.
- A step is only done when its self-test actually passed with real audio,
  not when the command exited 0.
- If something breaks, restart from the step that stopped passing its own
  self-test — not from Step 1, and not the routing layer either (it's
  disposable; the underlying engines aren't).
