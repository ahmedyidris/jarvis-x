# Jarvis X — Development Guide

See `docs/architecture.md` first for the system overview this guide assumes.

## Adding a new Phase B vertical

Use `automation/phase-b/commodities_macro_generator.py` (or `geopolitical_risk_generator.py`) as the template — both follow the exact same shape as `economic_facts_generator.py`, the original.

1. **Decide letters-shaped vs. economic-facts-shaped first**, explicitly — don't default to "LLM invents." See `automation/phase-b/stages/01_source_content/CONTEXT.md`'s "New vertical checklist." Everything below assumes economic-facts-shaped (the common case).

2. **Source real facts by hand, via the `WebSearch` tool, before writing any code.** This is not optional or a nice-to-have — it's the entire reason this pattern exists (a local LLM must never be allowed to invent a "fact" and have it presented as true). Pick a topic, run several targeted, dated queries (e.g. `"<topic> August 2026"`), and pull out concrete facts with a real `source_name`/`source_url` actually returned by the search.

   **Check for overlap with existing verticals first.** `commodities_macro`'s oil fact already covers Iran/Strait-of-Hormuz tension; its wheat fact already covers Black Sea/Ukraine grain exports. Don't re-source the same underlying event into a new vertical's `SOURCED_FACTS` — either pick a genuinely distinct angle or skip the topic.

3. **Copy the generator file's structure exactly:** `SOURCED_FACTS` list (with a comment recording the exact WebSearch queries and the date they were run), `_build_prompt()`/`_build_strict_retry_prompt()`, `_parse_llm_json()`, `_fallback_image_prompt()`, `generate_<vertical>_content()`, `generate_and_render_all()`. Reuse `content_generator.py`'s Ollama-calling helpers (`_call_ollama`, `_detect_json_format_support`, `_extract_json_object`) unmodified — every generator does.

4. **Add one thin wrapper function to `video_renderer.py`** (e.g. `render_<vertical>_video()`) choosing `headline_field`/`headline_font_size`/`caption_font_size`/default `voice_id`. Never touch `render_video()` itself — it's generic on purpose, shared by every vertical.

5. **Generate content, then manually read every generated JSON against its source fact before trusting it.** This step is not optional either: the shared retry/validation logic checks JSON shape and non-empty fields, but has **no check for numeric fidelity to the source**. Building the `geopolitical_risk` vertical found 2 of 5 outputs with a fabricated number (a "40%" and a "29.5%" that appear nowhere in the source) despite the explicit anti-invention prompt instruction — caught only by manually reading each file. Do this for every new vertical until an automated fidelity check exists (see `REMAINING_WORK.md`).

6. **Render at least one full video and verify it's real, not just that the script exited 0:**
   ```bash
   ffprobe -v error -show_entries format=duration,size \
     -show_entries stream=codec_type,codec_name,width,height,duration \
     -of default=noprint_wrappers=0 <path>.mp4
   ```
   Expect two streams (`h264` @ 1080x1920, `aac`) and a nonzero `duration` on both the format and each stream.

7. **Update the four docs every prior vertical updated:** `automation/phase-b/CONTEXT.md` (vertical count + one-paragraph description), both `stages/*/CONTEXT.md` files (new vertical's rows in the relevant tables), `_config/voices.md` (voice mapping row).

## How to test locally before push

- **JS suite:** `node jest-runner.js` from the repo root. Runs every `code/test-*.js` file via `child_process.spawnSync`, treats non-zero exit or an `Error`/`FAIL`/`❌` in output (without a `✅`) as a failure. As of this writing: 11/11 pass; one test (`test-voice-interaction.js`'s Arabic-vs-Malay language-detection case) has been observed intermittently flaky — a failure there alone, with everything else green, is not necessarily a new regression, but don't assume that reflexively either; re-run once to check before dismissing it.
- **model-gateway package suite:** `cd packages/model-gateway && npm test` — runs `node --test src/ demo/`. 47/47 as of this writing. This package is not wired into the live system (see `DECISION_RECORD_model-gateway.md`), but its own tests still matter if anyone works on it directly.
- **Python (`sentinel/`):** `pip install -r sentinel/requirements.txt` (or the pinned `sentinel/requirements.lock.txt` for a reproducible install) into a venv, then `pytest tests/test_smoke.py` — import/wiring only, no live Ollama call, safe for CI. For a real end-to-end check (actually invokes the LangGraph agent against local Ollama), use FastAPI's `TestClient` directly against `app.main.app` and expect it to take a couple of minutes on CPU-only local models — this is not a quick smoke test.
- **Frontend (`web/`):** `npm run build` (runs `tsc -b && vite build`) — catches type errors and confirms the production bundle builds clean.
- **`scripts/status.sh`** — the closest thing to a full-system health check: runtime versions, Ollama reachability, every `code/*.js` file parses, every `code/test-*.js` passes, git integrity, all 9 safety invariants, milestone percentage. Takes ~2 minutes (runs the full JS suite plus `git fsck`). Pass `--net` to also hit live Gemini + the local model; `--fix` for the handful of genuinely safe auto-fixes it knows about (currently just `.env` permissions + `.gitignore` entries).
- **Before touching `code/guard.js` or `code/validate.js` behavior indirectly** (i.e. by changing a caller): always run a live kill-switch check, not just the unit tests — write the `.jarvis-x-STOP` file by hand, confirm the path you changed actually halts, then remove it. Unit tests can pass while a real end-to-end wiring bug (like this session's `agent.js`/`scheduler.js` gate bugs) still exists undetected.

## Known issues + workarounds

| Issue | Workaround |
|---|---|
| `app.py`'s `/api/ask` doesn't check the kill switch — only `/api/killswitch` does | If you need chat to actually stop too, check `Path(__file__).parent / ".jarvis-x-STOP"` manually at the top of `/api/ask`. Not done automatically — this is a product decision (should chat count as "autonomous action"?), not an obvious bug fix. See `docs/architecture.md`'s kill-switch section. |
| Phase B's economic-facts-shaped generators don't validate numeric fidelity to source facts | Manually read every generated JSON against its `headline_fact` before shipping a new vertical or re-running an existing one. See step 5 above. |
| Running any diagnostic/test as the `jarvis` system user (not `ahmedyidris`) hits git's "dubious ownership" protection | Fixed via `git config --global --add safe.directory /home/ahmedyidris/jarvis-x` — but note this had to be added to `/home/ahmedyidris/.gitconfig` specifically (not `jarvis`'s own `$HOME`), because `config/supervisord.conf` sets `HOME="/home/ahmedyidris"` for any real supervised process running as `jarvis`. |
| `~/.jarvis-x/` (secrets dir) is owned by a separate `jarvis` system user, `700` permissions | `ahmedyidris` cannot `stat`/`chmod` it directly — use `sudo -u jarvis <command>`, with `HOME=/home/ahmedyidris` set explicitly if the command needs to resolve paths under `~/.jarvis-x/` correctly (`jarvis`'s own passwd-file home is `/home/jarvis`, not this). |
| `bootstrap/requirements-venv-ai.txt` still lists `elevenlabs==2.63.0` even though ElevenLabs support was removed from `code/tts_engine.py` | Left alone on purpose — that file is documented as a frozen `pip freeze` snapshot of the real environment, not a curated list; an installed-but-unused package is harmless. Low-priority cleanup if anyone wants a leaner fresh-install. |
| Disk is often tight (8.5G free of 35G as of this writing) | Before any heavy install/build verification (a fresh venv, a full bootstrap rehearsal), check `df -h /` first. Prefer a disposable scratch venv you delete afterward over installing into `~/venv-ai` directly, unless you're intentionally updating the real environment. |

## Architecture summary

See `docs/architecture.md` for the full picture — three separate systems (web chat, JS agent-autonomy, Phase B video pipeline), the kill-switch mechanism, and why `packages/model-gateway` exists but isn't wired in.
