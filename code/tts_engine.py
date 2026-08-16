#!/usr/bin/env python3
"""Professional TTS Engine — Piper, Kokoro, MMS-TTS"""
import subprocess, json, tempfile, os, sys, shutil
from pathlib import Path

# A bare "piper" resolves via PATH, and on this machine /usr/bin/piper is an
# unrelated GTK mouse-configuration tool that happens to share the name (dpkg
# confirms it) -- it crashes on `gi.require_version('Gtk', ...)` with no
# display. The real piper-tts binary lives next to whatever Python is running
# this file (installed via `pip install piper-tts` into this venv), so resolve
# it from sys.executable rather than trusting PATH -- this also survives the
# supervised process's minimal systemd-inherited PATH, which never included
# this venv's bin/ directory to begin with.
_PIPER_BIN = str(Path(sys.executable).parent / "piper")
if not Path(_PIPER_BIN).exists():
    _PIPER_BIN = shutil.which("piper") or "piper"

class TTSEngine:
    def __init__(self):
        self.cache_dir = Path.home() / ".hermes" / "audio_cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def list_voices(self):
        voices = [
            {"id": "en_us_piper", "name": "English US (Piper)", "lang": "en_US", "quality": "fast"},
            {"id": "en_gb_piper", "name": "English UK (Piper)", "lang": "en_GB", "quality": "fast"},
            {"id": "en_us_kokoro", "name": "English US (Kokoro)", "lang": "en_US", "quality": "quality"},
            {"id": "en_gb_kokoro", "name": "English UK (Kokoro)", "lang": "en_GB", "quality": "quality"},
            {"id": "ar_msa_piper", "name": "Arabic MSA (Piper)", "lang": "ar", "quality": "balanced"},
            {"id": "ar_msa_mms", "name": "Arabic MSA (MMS)", "lang": "ar", "quality": "balanced"},
        ]
        # ElevenLabs was dropped for Egyptian Arabic (decision made
        # 2026-08-16): the only voice it was ever used for was a Bella
        # (English) stand-in, since a real Egyptian voice was blocked by the
        # free-tier "no library voices via API" restriction -- EGTTS-V0.1
        # below is the sole Egyptian Arabic option now.
        # Local Egyptian Arabic voice clone (EGTTS-V0.1) — CPU-viable but slow
        # (3-10x real-time + a 90-220s cold load). Async use only, not for
        # live replies. See project memory "egtts-egyptian-arabic-followup"
        # for why: no CPU-viable option currently matches authentic Egyptian
        # dialect quality; this is the closest available local trade-off.
        voices.append({"id": "ar_eg_egtts", "name": "Arabic Egyptian (EGTTS, voice-cloned, slow/async)", "lang": "ar_EG", "quality": "async-only"})
        return voices

    def synthesize(self, text, voice_id):
        """Synthesize speech using Piper, Kokoro, or EGTTS"""
        if "egtts" in voice_id:
            return self._synthesize_egtts(text)
        elif "kokoro" in voice_id:
            return self._synthesize_kokoro(text, voice_id)
        else:
            return self._synthesize_piper(text, voice_id)

    def _synthesize_egtts(self, text):
        """Egyptian Arabic, voice-cloned, local — see code/egtts_engine.py.
        BLOCKING and slow (15-90s warm, up to ~5min cold). Callers on an
        async event loop must dispatch this off-thread themselves."""
        from code.egtts_engine import synthesize as egtts_synthesize
        return egtts_synthesize(text)
    
    def _synthesize_kokoro(self, text, voice_id):
        try:
            from kokoro import KPipeline
            import numpy as np
            import soundfile as sf

            # Two bugs fixed here (found + verified live 2026-08-13 while
            # building the Phase B Week 2 pipeline; this path had never
            # actually been exercised before):
            #
            # 1. lang_code="en" is not a valid Kokoro lang_code -- the
            #    package asserts against {"a": American English, "b":
            #    British English, ...}. Map our en_us_/en_gb_ ids to "a"/"b".
            # 2. voice_id.replace(...) left the bare string "kokoro", which
            #    is not a real Kokoro voice pack name (a 404 from HF
            #    confirms this) -- real voice packs look like "af_heart".
            #    Map each accent to a real, general-purpose voice pack.
            if "en_gb" in voice_id:
                lang_code, voice = "b", "bf_emma"
            else:
                lang_code, voice = "a", "af_heart"

            pipeline = KPipeline(lang_code=lang_code)
            # pipeline() returns a generator of Result objects (Kokoro
            # splits long text into multiple chunks internally) -- each
            # chunk's .audio is a separate tensor, so concatenate them all
            # into one waveform rather than keeping only the last chunk.
            chunks = [
                result.audio.numpy()
                for result in pipeline(text, voice=voice)
                if result.audio is not None
            ]
            if not chunks:
                raise RuntimeError("Kokoro produced no audio output")
            samples = np.concatenate(chunks)

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                sf.write(tmp.name, samples, 24000)
                with open(tmp.name, "rb") as f:
                    wav_data = f.read()
                os.unlink(tmp.name)
            return wav_data
        except Exception as e:
            raise RuntimeError(f"Kokoro synthesis failed: {e}")
    
    def _synthesize_piper(self, text, voice_id):
        try:
            # Map voice_id to Piper model. piper-tts 1.6.0's CLI resolves a
            # bare model name only through its own download cache
            # (piper.download_voices) and raises "Unable to find voice: ..."
            # for anything not fetched that way -- it does not scan
            # arbitrary voice directories. Voices here were downloaded
            # straight into ~/.local/share/piper-tts/voices/, so we must
            # pass full paths to the .onnx and .onnx.json ourselves via -m/-c
            # rather than rely on that cache lookup.
            voices_dir = Path.home() / ".local" / "share" / "piper-tts" / "voices"
            piper_models = {
                "en_us_piper": "en_US-amy-medium",
                "en_gb_piper": "en_GB-alba-medium",
                "ar_msa_piper": "ar_JO-kareem-medium",
            }
            model = piper_models.get(voice_id, "en_US-amy-medium")
            model_path = voices_dir / f"{model}.onnx"
            config_path = voices_dir / f"{model}.onnx.json"
            if not model_path.exists():
                raise RuntimeError(f"Piper voice not found on disk: {model_path}")

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                cmd = [_PIPER_BIN, "--model", str(model_path), "--config", str(config_path), "--output-file", tmp.name]
                subprocess.run(cmd, input=text.encode(), check=True)
                with open(tmp.name, "rb") as f:
                    wav_data = f.read()
                os.unlink(tmp.name)
            return wav_data
        except Exception as e:
            raise RuntimeError(f"Piper synthesis failed: {e}")

def get_engine():
    """Singleton getter"""
    if not hasattr(get_engine, "_instance"):
        get_engine._instance = TTSEngine()
    return get_engine._instance
