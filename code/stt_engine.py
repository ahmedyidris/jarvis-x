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
