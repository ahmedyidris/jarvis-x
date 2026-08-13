# Voice-per-vertical mapping

Reference file for `stages/02_render_video/CONTEXT.md`. This is the current
default `voice_id` each vertical's render call uses (`code/tts_engine.py` is
the engine these IDs resolve against — see its `AVAILABLE_VOICES`-style list
around line 33).

| Vertical         | Default voice_id | Engine  | Why                                                                 |
|------------------|-------------------|---------|----------------------------------------------------------------------|
| letters          | `en_us_piper`     | Piper   | Fast, kid-friendly synthesis; `render_letter_video()`'s default in `video_renderer.py`. |
| economic_facts   | `en_us_kokoro`    | Kokoro  | Higher-quality/more natural voice for an adult audience; `render_economic_video()`'s default, and `economic_facts_generator.py`'s `generate_and_render_all()` / `__main__` default. |

Fallback chain (see `code/router.py`'s `FALLBACK_CHAINS`): if Kokoro fails,
`en_us_kokoro` falls back to `en_us_piper` (and `en_gb_kokoro` to
`en_gb_piper`).

Both voice IDs are just the `voice_id` argument to `render_video()` /
`get_engine().synthesize(text, voice_id)` — a new vertical can pick either
existing ID, or a new one added to `code/tts_engine.py`, without touching
`video_renderer.py`'s composition logic.
