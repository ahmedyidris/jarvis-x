# Stage 02 — Render Video

Layer 2 contract for the rendering stage of the Phase B video pipeline.
Takes the JSON produced by `stages/01_source_content/` and turns it into an
MP4. All rendering logic lives in one file, `video_renderer.py` (at the
`automation/phase-b/` root, unchanged by the ICM restructure — only its
input/output path constants were updated to point into `stages/`).

## Inputs

A content dict matching either vertical's schema from
`stages/01_source_content/` (read from `output/letters/*.json` or
`output/economic_facts/*.json`), specifically the fields `narration_script`,
`on_screen_text`, and `duration_seconds` — plus whichever field is passed as
`headline_field` (see below).

## Process

`render_video(content, output_path, voice_id, headline_field, ...)` is the
one generic rendering function both verticals call through thin wrappers
(`render_letter_video()` for letters, `render_economic_video()` for
economic_facts) — extracted in commit `7f74c11` specifically so the
MoviePy/TTS composition logic is never forked per-vertical:

1. Synthesize narration audio for `content["narration_script"]` via the
   existing local TTS engine, `code/tts_engine.py`'s `get_engine().synthesize(text, voice_id)`.
2. Build a solid-color 1080x1920 background held for the clip's full
   duration.
3. Render `content[headline_field]` as large, centered text (font size is
   the one real per-vertical knob — see below).
4. If `content["on_screen_text"]` exists and differs from the headline
   field, render it as a smaller caption below the headline.
5. **Duration rule:** `final_duration = max(target_duration, narration_duration)`
   — `target_duration` is `content["duration_seconds"]`, `narration_duration`
   is the actual synthesized audio's length. Narration audio is never
   clipped; if it runs long, the video runs long to match, never the
   reverse.
6. Composite and export via MoviePy's `write_videofile()`.

## Video format spec (both verticals, fixed constants in `video_renderer.py`)

| Property | Value |
|---|---|
| Resolution | 1080x1920 (9:16 vertical, short-form) |
| Frame rate | 30fps |
| Renderer | MoviePy |
| Video codec | libx264 (h264) |
| Audio codec | aac |
| Background | solid color, `(0x1B, 0x4D, 0x3E)` deep teal-green |
| Font | `/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf` if present, else MoviePy/PIL default |

## Voice-per-vertical mapping

See `_config/voices.md` for the full table and rationale. Summary:
- letters → `en_us_piper` (fast, kid-friendly)
- economic_facts → `en_us_kokoro` (higher-quality, adult-audience tone)
- commodities_macro → `en_us_kokoro` (same adult-audience tone as economic_facts)

## Per-vertical wrapper differences (the only things that vary)

| Vertical | `headline_field` | `headline_font_size` | `caption_font_size` | default `voice_id` |
|---|---|---|---|---|
| letters (`render_letter_video`) | `"letter"` (single glyph) | 700 | 90 | `en_us_piper` |
| economic_facts (`render_economic_video`) | `"on_screen_text"` (short phrase) | 85 | 60 | `en_us_kokoro` |
| commodities_macro (`render_commodities_macro_video`) | `"on_screen_text"` (short phrase) | 85 | 60 | `en_us_kokoro` |

A new vertical adds one more thin wrapper function choosing these four
values — it does not touch `render_video()` itself.

## Outputs

`output/letters/letter_<LETTER>.mp4`, `output/economic_facts/econ_<slug>.mp4`,
or `output/commodities_macro/commodmacro_<slug>.mp4`. This directory is
git-ignored (regenerable from stage 01's JSON at any time via
`video_renderer.py` — see `automation/phase-b/.gitignore`).

## Directory layout
```
stages/02_render_video/
  CONTEXT.md              # this file
  output/
    letters/*.mp4              # gitignored, regenerable
    economic_facts/*.mp4       # gitignored, regenerable
    commodities_macro/*.mp4    # gitignored, regenerable
```

## Verifying a render

Always confirm output is a real video, not just that the script exited 0:
```
ffprobe -v error -show_entries format=duration,size \
  -show_entries stream=codec_type,codec_name,width,height,duration \
  -of default=noprint_wrappers=0 <path>.mp4
```
Expect two streams (`h264` video @ 1080x1920, `aac` audio) and a nonzero
`duration` on both the format and each stream.
