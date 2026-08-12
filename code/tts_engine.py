#!/usr/bin/env python3
"""Professional TTS Engine — Piper, Kokoro, MMS-TTS"""
import subprocess, json, tempfile, os
from pathlib import Path

class TTSEngine:
    def __init__(self):
        self.cache_dir = Path.home() / ".hermes" / "audio_cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    def list_voices(self):
        return [
            {"id": "en_us_piper", "name": "English US (Piper)", "lang": "en_US", "quality": "fast"},
            {"id": "en_gb_piper", "name": "English UK (Piper)", "lang": "en_GB", "quality": "fast"},
            {"id": "en_us_kokoro", "name": "English US (Kokoro)", "lang": "en_US", "quality": "quality"},
            {"id": "en_gb_kokoro", "name": "English UK (Kokoro)", "lang": "en_GB", "quality": "quality"},
            {"id": "ar_msa_piper", "name": "Arabic MSA (Piper)", "lang": "ar", "quality": "balanced"},
            {"id": "ar_msa_mms", "name": "Arabic MSA (MMS)", "lang": "ar", "quality": "balanced"},
        ]
    
    def synthesize(self, text, voice_id):
        """Synthesize speech using Piper or Kokoro"""
        if "kokoro" in voice_id:
            return self._synthesize_kokoro(text, voice_id)
        else:
            return self._synthesize_piper(text, voice_id)
    
    def _synthesize_kokoro(self, text, voice_id):
        try:
            from kokoro import KPipeline
            lang_code = voice_id[3] if len(voice_id) > 3 else 'a'
            voice_name = voice_id.split('_')[2] if 'kokoro' in voice_id else 'amy'
            pipeline = KPipeline(lang_code=lang_code, voice=voice_name)
            audio, sr = pipeline(text)
            
            import io, soundfile as sf
            buffer = io.BytesIO()
            sf.write(buffer, audio, sr, format='wav')
            return buffer.getvalue(), 'audio/wav'
        except:
            return self._synthesize_piper(text, voice_id.replace('kokoro', 'piper'))
    
    def _synthesize_piper(self, text, voice_id):
        model_map = {
            "en_us_piper": "en_US-lessac-medium",
            "en_gb_piper": "en_GB-vctk-medium",
            "ar_msa_piper": "ar_JO-kareem-medium",
        }
        model = model_map.get(voice_id, "en_US-lessac-medium")
        
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            tmp_path = tmp.name
        
        try:
            cmd = f"echo '{text}' | piper -m ~/.local/share/piper/voices/{model}.onnx -f {tmp_path}"
            subprocess.run(cmd, shell=True, capture_output=True, timeout=30)
            with open(tmp_path, 'rb') as f:
                return f.read(), 'audio/wav'
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

_engine = None

def get_engine():
    global _engine
    if _engine is None:
        _engine = TTSEngine()
    return _engine
