#!/usr/bin/env python3
"""
HERMES TTS ENGINE — Week 2b

Two real backends, both CPU-only, both verified working on this machine:
  - Piper  (fast, ~instant, good default for every voice)
  - Kokoro (slower, more natural, English only)

Voice coverage is intentionally honest about what could and couldn't be found.
See VOICE_RESEARCH_NOTES at the bottom for what was checked and rejected.

Usage:
    python3 tts_engine.py --list
    python3 tts_engine.py "Hello there" --voice en_us_piper -o out.wav
    python3 tts_engine.py "مرحبا" --voice ar_msa_piper -o out.wav

API:
    from tts_engine import TTSEngine
    engine = TTSEngine()
    audio_bytes, mime_type = engine.synthesize("Hello", "en_us_piper")
"""

import argparse
import io
import sys
import wave
from pathlib import Path

VENV_SITE_PACKAGES = Path.home() / "venv-ai" / "lib" / "python3.11" / "site-packages"
if VENV_SITE_PACKAGES.exists() and str(VENV_SITE_PACKAGES) not in sys.path:
    sys.path.insert(0, str(VENV_SITE_PACKAGES))

PIPER_VOICE_DIR = Path.home() / ".local" / "share" / "piper-tts" / "voices"
KOKORO_MODEL = Path.home() / "jarvis-x" / "models" / "kokoro" / "kokoro-v1.0.onnx"
KOKORO_VOICES = Path.home() / "jarvis-x" / "models" / "kokoro" / "voices-v1.0.bin"

# voice_id -> (backend, model-specific reference)
# Only entries that were actually downloaded/verified locally are listed here.
VOICES = {
    # English
    "en_us_piper":  {"backend": "piper",  "model": "en_US-amy-medium",   "desc": "US English, female (fast)"},
    "en_gb_piper":  {"backend": "piper",  "model": "en_GB-alba-medium",  "desc": "UK English, female (fast)"},
    "en_us_kokoro": {"backend": "kokoro", "model": "af_heart",           "desc": "US English, female (natural)"},
    "en_us_kokoro_m": {"backend": "kokoro", "model": "am_eric",          "desc": "US English, male (natural)"},
    "en_gb_kokoro": {"backend": "kokoro", "model": "bf_emma",            "desc": "UK English, female (natural)"},
    "en_gb_kokoro_m": {"backend": "kokoro", "model": "bm_george",        "desc": "UK English, male (natural)"},
    # Arabic — closest available to "formal"/MSA is Jordanian; Egyptian has no
    # CPU-viable voice yet (see notes below), so it is deliberately NOT listed here.
    "ar_msa_piper": {"backend": "piper",  "model": "ar_JO-kareem-medium", "desc": "Arabic (Jordanian, closest to MSA), male"},
    "ar_msa_piper_low": {"backend": "piper", "model": "ar_JO-kareem-low", "desc": "Arabic (Jordanian), male, faster/lower quality"},
    "ar_ae_piper":  {"backend": "piper",  "model": "ar-AE-emirati-female", "desc": "Arabic (Emirati/Gulf), female — addition, not MSA"},
}

DEFAULT_VOICE = "en_us_piper"


class TTSEngine:
    def __init__(self):
        self._piper_cache = {}
        self._kokoro = None

    def list_voices(self):
        return [{"voice_id": vid, **meta} for vid, meta in VOICES.items()]

    def synthesize(self, text, voice_id=DEFAULT_VOICE):
        """Returns (audio_bytes, mime_type)."""
        if voice_id not in VOICES:
            raise ValueError(f"Unknown voice_id: {voice_id!r}. Available: {list(VOICES)}")
        meta = VOICES[voice_id]
        if meta["backend"] == "piper":
            return self._synthesize_piper(text, meta["model"])
        elif meta["backend"] == "kokoro":
            return self._synthesize_kokoro(text, meta["model"])
        raise RuntimeError(f"Unhandled backend: {meta['backend']}")

    # -- Piper --------------------------------------------------------------

    def _load_piper(self, model_name):
        if model_name not in self._piper_cache:
            from piper import PiperVoice
            onnx_path = PIPER_VOICE_DIR / f"{model_name}.onnx"
            if not onnx_path.exists():
                raise FileNotFoundError(
                    f"Piper voice not downloaded: {onnx_path}\n"
                    f"Run: python3 -m piper.download_voices {model_name} "
                    f"--download-dir {PIPER_VOICE_DIR}"
                )
            self._piper_cache[model_name] = PiperVoice.load(str(onnx_path))
        return self._piper_cache[model_name]

    def _synthesize_piper(self, text, model_name):
        voice = self._load_piper(model_name)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav_file:
            voice.synthesize_wav(text, wav_file)
        return buf.getvalue(), "audio/wav"

    # -- Kokoro ---------------------------------------------------------------

    def _load_kokoro(self):
        if self._kokoro is None:
            from kokoro_onnx import Kokoro
            if not KOKORO_MODEL.exists() or not KOKORO_VOICES.exists():
                raise FileNotFoundError(f"Kokoro model files missing: {KOKORO_MODEL}, {KOKORO_VOICES}")
            self._kokoro = Kokoro(str(KOKORO_MODEL), str(KOKORO_VOICES))
        return self._kokoro

    def _synthesize_kokoro(self, text, voice_name):
        import soundfile as sf

        kokoro = self._load_kokoro()
        samples, sample_rate = kokoro.create(text, voice=voice_name, lang="en-us")
        buf = io.BytesIO()
        sf.write(buf, samples, sample_rate, format="WAV")
        return buf.getvalue(), "audio/wav"


def main():
    parser = argparse.ArgumentParser(description="Hermes TTS engine")
    parser.add_argument("text", nargs="?", help="Text to synthesize")
    parser.add_argument("--voice", default=DEFAULT_VOICE, help="voice_id (see --list)")
    parser.add_argument("-o", "--output", default="output.wav", help="Output WAV path")
    parser.add_argument("--list", action="store_true", help="List available voices")
    args = parser.parse_args()

    engine = TTSEngine()

    if args.list or not args.text:
        for v in engine.list_voices():
            print(f"  {v['voice_id']:20s} [{v['backend']:6s}] {v['desc']}")
        if not args.text:
            return
        return

    audio_bytes, mime = engine.synthesize(args.text, args.voice)
    Path(args.output).write_bytes(audio_bytes)
    print(f"Wrote {len(audio_bytes)} bytes ({mime}) -> {args.output}")


if __name__ == "__main__":
    main()


# ---------------------------------------------------------------------------
# VOICE RESEARCH NOTES (2026-08-12) — what was checked before wiring voices up
# ---------------------------------------------------------------------------
# Arabic, priority order requested: Egyptian > formal (MSA) > rest as additions.
#
#   Egyptian Arabic (arz) — NOT AVAILABLE in any CPU/ONNX-friendly stack found:
#     - Piper's official catalog (rhasspy/piper-voices) has no ar_EG/arz voice,
#       only ar_JO (Jordanian).
#     - MMS-TTS only ships a single Arabic checkpoint, facebook/mms-tts-ara,
#       which is Standard Arabic (macrolanguage "ara"), not Egyptian.
#     - Found OmarSamir/EGTTS-V0.1 on HuggingFace — a real Egyptian Arabic TTS
#       model, but it's XTTS-v2 based (PyTorch, voice-cloning architecture,
#       much heavier than Piper/Kokoro). Not integrated here — would need
#       real CPU-latency testing on this Chromebook before it's a fair
#       Week-2b deliverable. Tracked as a follow-up, not silently dropped.
#   Formal/MSA — closest available is Piper's ar_JO-kareem (Jordanian
#     pronunciation reads as fairly neutral/formal). Wired as ar_msa_piper.
#     facebook/mms-tts-ara is a second candidate but requires `transformers`,
#     which is not installed in venv-ai — not wired in this pass.
#   Additions — ar-AE-emirati-female (Gulf), already downloaded, wired as
#     ar_ae_piper.
#
# English, requested: US, UK, Irish, Australian ("okay if not found").
#   US, UK — both available via Piper (en_US-amy, en_GB-alba) and Kokoro
#     (af_*/bf_* etc, verified locally — 54 voices loaded from the model
#     already in this repo: af_/am_ = US, bf_/bm_ = UK. No en-specific
#     Irish or Australian voices exist in Kokoro's set).
#   Irish (en_IE) — NOT FOUND. Checked Piper's official catalog, the
#     OpenVoiceOS community Piper-voice collection, and Kokoro's voice list.
#     No CPU-viable Irish English voice located anywhere.
#   Australian (en_AU) — NOT FOUND either, same search. Per instructions,
#     this one's fine to skip.
