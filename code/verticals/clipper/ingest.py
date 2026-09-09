"""Clipper vertical -- stage 1: ingest.

ingest(source) accepts a LOCAL FILE PATH ONLY. No URL support, no yt-dlp, no
network path anywhere in this module -- that constraint is deliberate (this
vertical never reaches out to the network on its own) and must not be
"improved" without discussing it first.
"""
import json
import shutil
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = PROJECT_ROOT / "media" / "raw"

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"}


class IngestError(Exception):
    """Raised when the source path is missing, not a file, or not an allowed video extension."""


def _ffprobe(path: Path) -> dict:
    """Return {"duration": float, "width": int, "height": int} for a video file via ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-show_entries", "format=duration",
        "-of", "json",
        str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise IngestError(f"ffprobe failed on {path.name}: {result.stderr.strip()}")

    try:
        data = json.loads(result.stdout)
        stream = data["streams"][0]
        return {
            "duration": float(data["format"]["duration"]),
            "width": int(stream["width"]),
            "height": int(stream["height"]),
        }
    except (KeyError, IndexError, ValueError) as e:
        raise IngestError(f"ffprobe returned unparseable output for {path.name}: {e}") from e


def ingest(source: str) -> dict:
    """Copy a local video file into media/raw/ and return its metadata.

    `source` must be a path to an existing local file with an allowed
    extension -- URLs and any other network path are rejected outright.

    Returns {"path": str, "name": str, "duration": float, "width": int, "height": int}.
    """
    if "://" in source:
        raise IngestError(f"URLs are not supported by this vertical: {source!r}")

    src_path = Path(source).expanduser()
    if not src_path.is_file():
        raise IngestError(f"source is not a local file: {source!r}")

    ext = src_path.suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise IngestError(
            f"unsupported extension {ext!r} -- allowed: {sorted(ALLOWED_EXTENSIONS)}"
        )

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    dest_path = RAW_DIR / src_path.name
    if dest_path.resolve() != src_path.resolve():
        shutil.copy2(src_path, dest_path)

    meta = _ffprobe(dest_path)
    return {
        "path": str(dest_path),
        "name": dest_path.name,
        "duration": meta["duration"],
        "width": meta["width"],
        "height": meta["height"],
    }
