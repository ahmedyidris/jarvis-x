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

import os
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

CONTENT_DIR = Path(__file__).parent / "stages" / "01_source_content" / "output" / "letters"
OUTPUT_DIR = Path(__file__).parent / "stages" / "02_render_video" / "output" / "letters"

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


def render_video(
    content: dict,
    output_path: str,
    voice_id: str = "en_us_piper",
    headline_field: str = "on_screen_text",
    headline_font_size: int = 700,
    caption_font_size: int = 90,
) -> str:
    """Render one MP4 from a content dict. Returns output_path.

    Generic MoviePy composition extracted from Week 1's letter-specific
    renderer: TTS synthesis, background+text rendering, and audio/video
    duration reconciliation don't actually care whether `headline_field`
    holds a single letter or a short economic headline — only the font
    size sensibly differs between a giant single glyph (Week 1) and a
    short phrase (Week 2). Both `render_letter_video` and
    `render_economic_video` (in economic_facts_generator.py) call this.

    - `headline_field`: which key in `content` holds the large, prominent
      text drawn in the upper-middle of the frame (Week 1: "letter",
      Week 2: could be "topic" or "on_screen_text").
    - `content["on_screen_text"]` (if present and different from the
      headline field) is always rendered as the smaller caption below it;
      otherwise the caption is skipped.
    """
    # Imported lazily so importing this module doesn't require moviepy
    # unless a render is actually requested.
    from moviepy import (
        AudioFileClip,
        ColorClip,
        CompositeVideoClip,
        TextClip,
    )

    headline_text = content[headline_field]
    caption_text = content.get("on_screen_text")
    if caption_text == headline_text:
        caption_text = None
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

        # Large headline text (a single letter in Week 1; a short phrase
        # in Week 2 — "caption" wrapping handles both).
        headline_clip = TextClip(
            text=headline_text,
            font_size=headline_font_size,
            color="white",
            size=(int(WIDTH * 0.9), None),
            method="caption",
            text_align="center",
            **font_kwargs,
        ).with_duration(final_duration)
        headline_clip = headline_clip.with_position(("center", HEIGHT * 0.30))

        clips = [background, headline_clip]

        if caption_text:
            # Smaller on-screen text below the headline.
            caption_clip = TextClip(
                text=caption_text,
                font_size=caption_font_size,
                color="white",
                size=(int(WIDTH * 0.85), None),
                method="caption",
                text_align="center",
                **font_kwargs,
            ).with_duration(final_duration)
            caption_clip = caption_clip.with_position(("center", HEIGHT * 0.62))
            clips.append(caption_clip)

        video = CompositeVideoClip(clips, size=(WIDTH, HEIGHT)).with_duration(final_duration)
        video = video.with_audio(audio_clip)

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # Render to a sibling temp path first, then atomically rename over
        # the real destination. write_videofile() writes directly to its
        # target and would otherwise leave a truncated/corrupt .mp4 behind
        # if interrupted mid-encode (disk full, killed process, ffmpeg
        # crash) -- same root issue REMAINING_WORK.md P8 found and fixed
        # for the JSON generators' out_path.write_text(...). os.replace() on
        # the same filesystem is atomic, so output_path either still holds
        # its old content (a re-render) or the complete new file -- never a
        # partial one. Real extension (.mp4) preserved on the temp name
        # (inserted before the suffix, not appended after it) so ffmpeg's
        # own extension-based container/muxer detection still sees .mp4.
        out = Path(output_path)
        tmp_output_path = str(out.with_name(out.stem + ".tmp" + out.suffix))
        try:
            video.write_videofile(
                tmp_output_path,
                fps=FPS,
                codec="libx264",
                audio_codec="aac",
                temp_audiofile=tempfile.mktemp(suffix=".m4a"),
                remove_temp=True,
                logger=None,
            )
            # write_videofile() returning is NOT proof of a good file: a
            # real disk-full test (mounting a tiny tmpfs over the output
            # dir) showed moviepy's FFMPEG_VideoWriter.close() calls
            # self.proc.wait() but never checks the ffmpeg subprocess's
            # returncode -- so a failure while ffmpeg finalizes the
            # container (writing the trailing moov atom, which happens
            # *after* all frame data was already piped through
            # successfully) is silently swallowed. Confirmed live: a
            # disk-full render returned normally from write_videofile() and
            # produced a file truncated to exactly the tmpfs's capacity,
            # with `moov atom not found` from ffprobe. Can't patch moviepy
            # itself, so verify the actual artifact before trusting it.
            probe = subprocess.run(
                ["ffprobe", "-v", "error", tmp_output_path],
                capture_output=True, text=True,
            )
            if probe.returncode != 0:
                raise RuntimeError(
                    f"write_videofile() reported success but ffprobe rejects the "
                    f"output as invalid: {probe.stderr.strip()}"
                )
            os.replace(tmp_output_path, output_path)
        except Exception:
            Path(tmp_output_path).unlink(missing_ok=True)
            raise

        video.close()
        for clip in clips:
            clip.close()
    finally:
        audio_clip.close()
        try:
            Path(audio_path).unlink()
        except OSError:
            pass

    return output_path


def render_letter_video(content: dict, output_path: str, voice_id: str = "en_us_piper") -> str:
    """Render one letter's MP4 from its content dict. Returns output_path.

    Thin Week-1-shaped wrapper around the generic `render_video`: the
    letter itself is the big headline (font size 700, same as the
    original implementation), and on_screen_text is the smaller caption.
    """
    return render_video(
        content,
        output_path,
        voice_id=voice_id,
        headline_field="letter",
        headline_font_size=700,
        caption_font_size=90,
    )


def render_economic_video(content: dict, output_path: str, voice_id: str = "en_us_kokoro") -> str:
    """Render one economic-fact MP4 (Week 2) from its content dict.

    Thin wrapper around the generic `render_video`, same pattern as
    `render_letter_video`: the short `on_screen_text` caption is the big
    headline here (there's no separate single-glyph element like Week 1's
    "letter"), sized down from 700 to something readable for a full short
    sentence. Defaults to the `en_us_kokoro` voice per this week's brief
    (a general/adult audience, not Week 1's kids tone).
    """
    return render_video(
        content,
        output_path,
        voice_id=voice_id,
        headline_field="on_screen_text",
        headline_font_size=85,
        caption_font_size=60,
    )


def render_commodities_macro_video(content: dict, output_path: str, voice_id: str = "en_us_kokoro") -> str:
    """Render one commodities/macro MP4 (Week 3) from its content dict.

    Same shape as render_economic_video() -- on_screen_text is the
    headline, same font sizes, same default voice (adult-audience factual
    content, same tone as Week 2).
    """
    return render_video(
        content,
        output_path,
        voice_id=voice_id,
        headline_field="on_screen_text",
        headline_font_size=85,
        caption_font_size=60,
    )


def render_geopolitical_risk_video(content: dict, output_path: str, voice_id: str = "en_us_kokoro") -> str:
    """Render one geopolitical-risk MP4 (Week 4) from its content dict.

    Same shape as render_economic_video()/render_commodities_macro_video() --
    on_screen_text is the headline, same font sizes, same default voice
    (adult-audience factual/news content, same tone as Weeks 2-3).
    """
    return render_video(
        content,
        output_path,
        voice_id=voice_id,
        headline_field="on_screen_text",
        headline_font_size=85,
        caption_font_size=60,
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 video_renderer.py <LETTER>", file=sys.stderr)
        sys.exit(1)

    letter_arg = sys.argv[1].strip().upper()
    content_data = _load_cached_or_generate(letter_arg)

    out_path = str(OUTPUT_DIR / f"letter_{letter_arg}.mp4")
    result_path = render_letter_video(content_data, out_path)
    print(f"Rendered: {result_path}")
