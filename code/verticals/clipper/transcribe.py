"""Clipper vertical -- stage 2: transcribe.

Runs faster-whisper on CPU (int8 quantization, beam_size=1 -- this is a
14 GB CPU-only host per CLAUDE.md, no GPU acceleration available). Caches
one JSON transcript per source name in media/transcripts/ and reuses it on
the next call unless force=True, so re-scoring or re-rendering the same
source never re-runs the model.
"""
import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
TRANSCRIPTS_DIR = PROJECT_ROOT / "media" / "transcripts"


def _cache_path(name: str) -> Path:
    return TRANSCRIPTS_DIR / f"{Path(name).stem}.json"


def transcribe(
    path: str,
    name: str,
    language: str = None,
    model_size: str = "base",
    force: bool = False,
) -> dict:
    """Transcribe a video/audio file, caching the result by source name.

    `path` is the file to transcribe; `name` identifies the source for the
    cache file (independent of `path`, so callers can re-key on the
    original filename even if `path` points at a copy).

    Returns {"language": str, "segments": [{"start": float, "end": float, "text": str}, ...]}.
    """
    cache_file = _cache_path(name)
    if cache_file.is_file() and not force:
        return json.loads(cache_file.read_text())

    # Imported lazily so importing this module (or the clipper package)
    # doesn't require faster-whisper to be installed unless transcription
    # actually runs.
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments_iter, info = model.transcribe(path, language=language, beam_size=1)

    segments = [
        {"start": seg.start, "end": seg.end, "text": seg.text.strip()}
        for seg in segments_iter
    ]
    result = {"language": info.language, "segments": segments}

    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(result, indent=2))
    return result
