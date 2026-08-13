#!/usr/bin/env python3
"""
Phase B — Video Renderer (Week 1)

Takes the structured JSON produced by content_generator.py, synthesizes
narration audio via the existing local TTS engine
(jarvis-x/code/tts_engine.py's get_engine().synthesize()), and renders a
vertical short-form MP4 with MoviePy.

v1 rendering approach (defaults chosen for this pass, not requirements
handed down): no image generation — a solid-color background with the
letter rendered huge and centered, plus on_screen_text rendered smaller
below it. 1080x1920 (9:16 vertical), 30fps, H.264/AAC MP4 via MoviePy's
default ffmpeg export.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

# This file lives at jarvis-x/automation/phase-b/video_renderer.py, three
# levels below the repo root, so we need three parents (not two, as a
# script directly under jarvis-x/ would) to reach jarvis-x/ and import
# code.tts_engine the same way app.py and hermes.py do.
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from code.tts_engine import get_engine  # noqa: E402

from content_generator import generate_letter_content  # noqa: E402

CONTENT_DIR = Path(__file__).parent / "content"
OUTPUT_DIR = Path(__file__).parent / "output"

# Video spec (v1 defaults, see module docstring).
WIDTH, HEIGHT = 1080, 1920
FPS = 30
BACKGROUND_COLOR = (0x1B, 0x4D, 0x3E)  # deep teal-green: legible, distinct, not a MoviePy/PIL default gray

# Prefer a real installed TTF (checked via `fc-list` on this system) so
# TextClip doesn't fall back to a tiny bitmap default font.
_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def _pick_font() -> str | None:
    for candidate in _FONT_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    return None  # let MoviePy/PIL fall back to its own default


def _load_cached_or_generate(letter: str) -> dict:
    letter = letter.strip().upper()
    cached_path = CONTENT_DIR / f"letter_{letter}.json"
    if cached_path.exists():
        import json

        return json.loads(cached_path.read_text())
    return generate_letter_content(letter)


def render_letter_video(content: dict, output_path: str, voice_id: str = "en_us_piper") -> str:
    """Render one letter's MP4 from its content dict. Returns output_path."""
    # Imported lazily so importing this module doesn't require moviepy
    # unless a render is actually requested.
    from moviepy import (
        AudioFileClip,
        ColorClip,
        CompositeVideoClip,
        TextClip,
    )

    letter = content["letter"]
    on_screen_text = content["on_screen_text"]
    narration_script = content["narration_script"]
    target_duration = float(content["duration_seconds"])

    # 1. Synthesize narration audio via the existing, already-working TTS engine.
    #
    # NOTE: tts_engine.py's synthesize() actually returns just `audio_bytes`
    # (a bytes object), not the (audio_bytes, mime_type) tuple the original
    # task spec assumed — confirmed by how app.py and hermes.py both call it
    # (`audio_bytes = engine.synthesize(...)`, single return value). Reusing
    # the real API here rather than the assumed one.
    engine = get_engine()
    audio_bytes = engine.synthesize(narration_script, voice_id)

    tmp_audio = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp_audio.write(audio_bytes)
    tmp_audio.flush()
    tmp_audio.close()
    audio_path = tmp_audio.name

    try:
        audio_clip = AudioFileClip(audio_path)
        narration_duration = audio_clip.duration

        # Duration: use whichever is longer — never clip narration audio.
        final_duration = max(target_duration, narration_duration)

        font_path = _pick_font()
        font_kwargs = {"font": font_path} if font_path else {}

        # Solid-color background, held for the full duration.
        background = ColorClip(size=(WIDTH, HEIGHT), color=BACKGROUND_COLOR).with_duration(
            final_duration
        )

        # Huge centered letter.
        letter_clip = TextClip(
            text=letter,
            font_size=700,
            color="white",
            **font_kwargs,
        ).with_duration(final_duration)
        letter_clip = letter_clip.with_position(("center", HEIGHT * 0.30))

        # Smaller on-screen text below the letter.
        text_clip = TextClip(
            text=on_screen_text,
            font_size=90,
            color="white",
            size=(int(WIDTH * 0.85), None),
            method="caption",
            text_align="center",
            **font_kwargs,
        ).with_duration(final_duration)
        text_clip = text_clip.with_position(("center", HEIGHT * 0.62))

        video = CompositeVideoClip(
            [background, letter_clip, text_clip], size=(WIDTH, HEIGHT)
        ).with_duration(final_duration)
        video = video.with_audio(audio_clip)

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        video.write_videofile(
            output_path,
            fps=FPS,
            codec="libx264",
            audio_codec="aac",
            temp_audiofile=tempfile.mktemp(suffix=".m4a"),
            remove_temp=True,
            logger=None,
        )

        video.close()
        background.close()
        letter_clip.close()
        text_clip.close()
    finally:
        audio_clip.close()
        try:
            Path(audio_path).unlink()
        except OSError:
            pass

    return output_path


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 video_renderer.py <LETTER>", file=sys.stderr)
        sys.exit(1)

    letter_arg = sys.argv[1].strip().upper()
    content_data = _load_cached_or_generate(letter_arg)

    out_path = str(OUTPUT_DIR / f"letter_{letter_arg}.mp4")
    result_path = render_letter_video(content_data, out_path)
    print(f"Rendered: {result_path}")
