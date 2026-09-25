#!/usr/bin/env python3
"""
SCRIPT RENDERER — the bridge from the JS content pipeline to Week 1's MP4
composition.

`code/content-pipeline.js` produces an approved SCRIPT and needs a CUT.
`video_renderer.py`'s `render_video()` already produces a vertical MP4 from a
content dict — TTS narration, solid background, headline, caption, atomic
write, and a real check on ffmpeg's return code. None of that is
letter-specific; its own docstring says so. What was missing was an adapter and
a way for Node to call it.

So this file is deliberately thin. It does not re-implement composition, it
builds the dict `render_video()` already accepts and hands it over. Rewriting
the composition would have meant re-learning the two bugs that file records
paying for: a truncated MP4 left behind by an interrupted encode, and
`write_videofile()` returning cleanly while ffmpeg had actually failed to
finalise the container.

USAGE — one JSON object on stdin, one JSON object on stdout:

    echo '{"script": "...", "headline": "CPI at 2.4%", "out": "/tmp/x.mp4"}' \\
      | python3 automation/phase-b/script_renderer.py

    -> {"ok": true, "file": "/tmp/x.mp4", "bytes": 831204, "durationSeconds": 31.4}
    -> {"ok": false, "why": "moviepy is not installed in this interpreter ..."}

IT REFUSES RATHER THAN REPORTING A RENDER IT DID NOT DO. Every failure path
returns `ok: false` with a reason, and the success path is only taken after the
output file exists and is non-empty on disk. That rule is not decoration here:
the version of `code/content-render.js` this replaces returned
`{ok: true, file: "rendered.mp4"}` for any job, having rendered nothing, and
the pipeline would have attached that string as a cut and asked Ahmed to
approve a video that did not exist.
"""

import json
import sys
from pathlib import Path

# This file lives at jarvis-x/automation/phase-b/, so two parents reach
# automation/ and three reach the repo root -- the same arithmetic
# video_renderer.py does, and for the same reason.
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# How long a headline may be before it stops being a headline. A 700px glyph
# and a 40-word sentence do not share a layout.
MAX_HEADLINE_CHARS = 60

DEFAULT_VOICE = "en_us_piper"


def build_content(job: dict) -> dict:
    """
    Turn a content-pipeline job into the dict `render_video()` accepts.

    Pure: no filesystem, no model, no ffmpeg. Everything that can be wrong
    about the request is decided here, where a test can reach it without any
    of those installed.
    """
    script = job.get("script")
    if not isinstance(script, str) or not script.strip():
        raise ValueError("a render needs a script — the job has none")

    headline = job.get("headline")
    if headline is None:
        # Derived rather than invented: the first line of the brief, trimmed.
        # A mechanical rule, not a judgement about what the video is "really"
        # about -- that judgement is Ahmed's and he can pass `headline`
        # explicitly to make it.
        brief = job.get("brief") or ""
        headline = brief.strip().splitlines()[0] if brief.strip() else ""
    headline = str(headline).strip()
    if not headline:
        raise ValueError("a render needs a headline, and the job's brief is empty so none could be derived")
    if len(headline) > MAX_HEADLINE_CHARS:
        headline = headline[: MAX_HEADLINE_CHARS - 1].rstrip() + "…"

    # duration_seconds is a FLOOR, not a target: render_video() takes
    # max(target, narration). Passing 0 means "however long the narration
    # actually is", which is the honest answer -- inventing a duration here
    # would either pad the end with silence or claim a length nobody chose.
    return {
        "headline": headline,
        "on_screen_text": headline,
        "narration_script": script.strip(),
        "duration_seconds": float(job.get("durationSeconds") or 0),
    }


def render(job: dict) -> dict:
    """Render one job. Returns the result dict; never raises for an expected failure."""
    try:
        content = build_content(job)
    except ValueError as e:
        return {"ok": False, "why": str(e)}

    out = job.get("out")
    if not isinstance(out, str) or not out.strip():
        return {"ok": False, "why": "a render needs an output path (`out`)"}

    try:
        from video_renderer import render_video
    except Exception as e:  # noqa: BLE001 - the reason is what the caller needs
        return {"ok": False, "why": f"cannot import video_renderer: {e}"}

    try:
        render_video(
            content,
            out,
            voice_id=job.get("voiceId") or DEFAULT_VOICE,
            headline_field="headline",
            # A short phrase, not a single giant glyph. Week 1's 700px suits
            # one letter; a headline needs to fit on the frame.
            headline_font_size=int(job.get("headlineFontSize") or 96),
            caption_font_size=int(job.get("captionFontSize") or 64),
        )
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "why": f"render failed: {type(e).__name__}: {e}"}

    # THE FILE IS THE PROOF, NOT THE RETURN. video_renderer.py's own comments
    # record discovering that write_videofile() can return cleanly while
    # ffmpeg failed to finalise the container. It checks the return code now,
    # and this checks the artifact -- two independent reasons to believe a
    # video exists before telling anyone it does.
    path = Path(out)
    if not path.is_file():
        return {"ok": False, "why": f"render reported success but {out} does not exist"}
    size = path.stat().st_size
    if size == 0:
        return {"ok": False, "why": f"render reported success but {out} is empty"}

    result = {"ok": True, "file": str(path), "bytes": size}
    try:
        from moviepy import VideoFileClip

        with VideoFileClip(str(path)) as clip:
            result["durationSeconds"] = round(float(clip.duration), 2)
    except Exception:  # noqa: BLE001
        # Not being able to measure it does not make the file fake. Reported
        # as absent rather than guessed.
        result["durationSeconds"] = None
    return result


def main() -> int:
    raw = sys.stdin.read()
    try:
        job = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "why": f"stdin is not valid JSON: {e}"}))
        return 1
    if not isinstance(job, dict):
        print(json.dumps({"ok": False, "why": "stdin must be a JSON object"}))
        return 1

    result = render(job)
    print(json.dumps(result))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
