#!/usr/bin/env python3
"""Professional TTS Engine — Piper, Kokoro, MMS-TTS, ElevenLabs"""
import subprocess, json, tempfile, os, io
from pathlib import Path

class TTSEngine:
    def __init__(self):
        self.cache_dir = Path.home() / ".hermes" / "audio_cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.elevenlabs_key = os.getenv("ELEVENLABS_API_KEY") or self._load_elevenlabs_key()
    
    def _load_elevenlabs_key(self):
        """Load ElevenLabs API key from ~/.elevenlabs_key"""
        key_file = Path.home() / ".elevenlabs_key"
        if key_file.exists():
            return key_file.read_text().strip()
        return None
    
    def list_voices(self):
        voices = [
            {"id": "en_us_piper", "name": "English US (Piper)", "lang": "en_US", "quality": "fast"},
            {"id": "en_gb_piper", "name": "English UK (Piper)", "lang": "en_GB", "quality": "fast"},
            {"id": "en_us_kokoro", "name": "English US (Kokoro)", "lang": "en_US", "quality": "quality"},
            {"id": "en_gb_kokoro", "name": "English UK (Kokoro)", "lang": "en_GB", "quality": "quality"},
            {"id": "ar_msa_piper", "name": "Arabic MSA (Piper)", "lang": "ar", "quality": "balanced"},
            {"id": "ar_msa_mms", "name": "Arabic MSA (MMS)", "lang": "ar", "quality": "balanced"},
        ]
        # Add ElevenLabs Egyptian if API key is available
        if self.elevenlabs_key:
            voices.append({"id": "ar_eg_elevenlabs", "name": "Arabic Egyptian (ElevenLabs)", "lang": "ar_EG", "quality": "premium"})
        # Local Egyptian Arabic voice clone (EGTTS-V0.1) — CPU-viable but slow
        # (3-10x real-time + a 90-220s cold load). Async use only, not for
        # live replies. See project memory "egtts-egyptian-arabic-followup"
        # for why: no CPU-viable option currently matches authentic Egyptian
        # dialect quality; this is the closest available local trade-off.
        voices.append({"id": "ar_eg_egtts", "name": "Arabic Egyptian (EGTTS, voice-cloned, slow/async)", "lang": "ar_EG", "quality": "async-only"})
        return voices

    def synthesize(self, text, voice_id):
        """Synthesize speech using Piper, Kokoro, ElevenLabs, or EGTTS"""
        if "elevenlabs" in voice_id:
            return self._synthesize_elevenlabs(text, voice_id)
        elif "egtts" in voice_id:
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
    
    def _synthesize_elevenlabs(self, text, voice_id):
        """Synthesize using ElevenLabs (cloud)"""
        if not self.elevenlabs_key:
            raise ValueError("ELEVENLABS_API_KEY not configured")
        
        try:
            from elevenlabs.client import ElevenLabs
        except ImportError:
            raise ImportError("elevenlabs SDK not installed. Run: pip install elevenlabs")
        
        client = ElevenLabs(api_key=self.elevenlabs_key)
        
        # Map voice_id to ElevenLabs voice name
        voice_map = {
            "ar_eg_elevenlabs": "Zahra"  # Arabic female voice
        }
        elevenlabs_voice = voice_map.get(voice_id, "Zahra")
        
        audio_stream = client.text_to_speech.convert(
            text=text,
            voice_id=elevenlabs_voice,
            model_id="eleven_multilingual_v2"
        )
        
        # Collect audio chunks into WAV
        wav_buffer = io.BytesIO()
        for chunk in audio_stream:
            wav_buffer.write(chunk)
        
        return wav_buffer.getvalue()
    
    def _synthesize_kokoro(self, text, voice_id):
        try:
            from kokoro import KPipeline
            pipeline = KPipeline(lang_code="en")
            samples = pipeline(text, voice=voice_id.replace("en_us_", "").replace("en_gb_", ""))
            import soundfile as sf
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
            # Map voice_id to Piper model
            piper_models = {
                "en_us_piper": "en_US-amy-medium",
                "en_gb_piper": "en_GB-vctk-medium",
                "ar_msa_piper": "ar_JO-kareem-medium",
            }
            model = piper_models.get(voice_id, "en_US-amy-medium")
            
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                cmd = ["piper", "--model", model, "--output-file", tmp.name]
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
