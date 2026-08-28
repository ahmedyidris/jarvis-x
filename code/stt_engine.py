#!/usr/bin/env python3
"""Local speech-to-text via faster-whisper. CPU-only, no network calls."""
import io
import logging
import os
import wave
from faster_whisper import WhisperModel

logger = logging.getLogger('STTEngine')

_engine = None

class STTEngine:
    def __init__(self, model_size=None):
        # Was hardcoded "tiny.en" -- an ENGLISH-ONLY model. Arabic (and every
        # other non-English language) could not be transcribed at all, let
        # alone detected. "tiny" is the multilingual build of the same size.
        #
        # 2026-08-28: measured tiny vs small vs large-v3 on 40s of real
        # Egyptian speech. tiny produced nonsense with Latin fragments and
        # repetition loops; small produced partial sense; large-v3 produced a
        # coherent, recognizable transcript in 34s on CPU. large-v3 is the
        # default. Not resident -- loads per call, so RAM cost is transient.
        # Override: JX_STT_MODEL (small is ~8x faster if latency matters).
        # Superseded note: NOT upgraded to base/small despite the assumption that bigger
        # is better for Arabic: on the one clean Piper-synthesized MSA sample
        # tested (2026-08-24), base was WORSE -- it mis-transcribed the ending
        # of وبركاته and dropped punctuation that tiny kept. n=1 on clean
        # synthesized audio, so this is not a WER measurement; base may still
        # win on noisy real-microphone input. Re-measure against real
        # recordings before changing the default. Override: JX_STT_MODEL.
        model_size = model_size or os.environ.get("JX_STT_MODEL", "large-v3")
        logger.info(f"Loading faster-whisper model: {model_size}")
        self.model = WhisperModel(model_size, device="cpu", compute_type="int8")

    def transcribe(self, wav_bytes: bytes, language: str = None) -> str:
        """Text only. Kept returning str so existing callers do not break."""
        return self.transcribe_detailed(wav_bytes, language)["text"]

    def transcribe_detailed(self, wav_bytes: bytes, language: str = None) -> dict:
        """Text plus detected language and its confidence.

        `language` pins the decode when the caller already knows -- Whisper's
        auto-detection is unreliable on short clips (under ~3s) and the
        smaller models will happily romanize Arabic into Latin script and
        then label it Malay.
        """
        buf = io.BytesIO(wav_bytes)
        segments, info = self.model.transcribe(buf, beam_size=5, language=language)
        return {
            "text": " ".join(seg.text for seg in segments).strip(),
            "language": info.language,
            "language_probability": getattr(info, "language_probability", None),
        }

def get_engine() -> STTEngine:
    global _engine
    if _engine is None:
        _engine = STTEngine()
    return _engine
