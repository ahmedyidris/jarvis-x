"""Clipper vertical -- stage 4: render.

Cuts one short clip per pick with ffmpeg: seeks with -ss before -i (fast
input seeking), centre-crops to the target aspect ratio, scales, and
optionally burns in subtitles from an SRT written next to the output. No
face tracking -- this is a CPU-only machine, tracking would be too slow to
be worth it.
"""
import subprocess
from pathlib import Path

DEFAULT_ASPECT = "9:16"

# width, height per supported aspect ratio.
ASPECT_DIMENSIONS = {
    "9:16": (1080, 1920),
    "16:9": (1920, 1080),
    "1:1": (1080, 1080),
    "4:5": (1080, 1350),
}


class RenderError(Exception):
    """Raised when ffmpeg fails to produce a clip."""


def _aspect_filter(aspect: str) -> str:
    """Build the ffmpeg crop+scale filter for a centre crop to `aspect`."""
    if aspect not in ASPECT_DIMENSIONS:
        raise RenderError(f"unsupported aspect ratio {aspect!r} -- choose from {sorted(ASPECT_DIMENSIONS)}")
    w, h = ASPECT_DIMENSIONS[aspect]
    num, den = aspect.split(":")
    # Centre-crop the source to the target aspect first (so scale never
    # distorts), then scale to the exact target dimensions.
    crop = f"crop='min(iw,ih*{num}/{den})':'min(ih,iw*{den}/{num})'"
    return f"{crop},scale={w}:{h}"


def _format_srt_timestamp(seconds: float) -> str:
    millis_total = round(seconds * 1000)
    hours, millis_total = divmod(millis_total, 3_600_000)
    minutes, millis_total = divmod(millis_total, 60_000)
    secs, millis = divmod(millis_total, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def _write_srt(segments: list, clip_start: float, clip_end: float, srt_path: Path) -> None:
    """Write an SRT covering [clip_start, clip_end), with timestamps rebased to clip-relative 0."""
    lines = []
    index = 1
    for seg in segments:
        if seg["end"] <= clip_start or seg["start"] >= clip_end:
            continue
        rel_start = max(seg["start"], clip_start) - clip_start
        rel_end = min(seg["end"], clip_end) - clip_start
        if rel_end <= rel_start:
            continue
        lines.append(str(index))
        lines.append(f"{_format_srt_timestamp(rel_start)} --> {_format_srt_timestamp(rel_end)}")
        lines.append(seg["text"].strip())
        lines.append("")
        index += 1
    srt_path.write_text("\n".join(lines), encoding="utf-8")


def render_clip(
    source_path: str,
    pick: dict,
    segments: list,
    output_path: str,
    aspect: str = DEFAULT_ASPECT,
    subtitles: bool = True,
) -> dict:
    """Cut, crop, and optionally subtitle one clip.

    `pick` is one {"start", "end", ...} dict from score.score(). `segments`
    is the full transcript's segment list, used to build the burned-in SRT.

    Returns {"path": str, "srt_path": str or None}.
    """
    start = pick["start"]
    duration = pick["end"] - start
    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    vf = _aspect_filter(aspect)
    srt_path = None

    if subtitles:
        srt_path = out_path.with_suffix(".srt")
        _write_srt(segments, start, pick["end"], srt_path)
        # Run ffmpeg with cwd=output dir (below) so the subtitles filter can
        # reference the SRT by bare filename -- ffmpeg's filtergraph syntax
        # treats ':' and other path characters specially, so an absolute
        # path here would otherwise need escaping.
        force_style = "FontSize=18,PrimaryColour=&H00FFFFFF,BorderStyle=3,Outline=1,Shadow=0"
        vf = f"{vf},subtitles={srt_path.name}:force_style='{force_style}'"

    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-i", str(Path(source_path).resolve()),
        "-t", str(duration),
        "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        out_path.name,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=out_path.parent, timeout=120)
    if result.returncode != 0:
        raise RenderError(f"ffmpeg failed on {out_path.name}: {result.stderr.strip()[-2000:]}")

    return {"path": str(out_path), "srt_path": str(srt_path) if srt_path else None}
