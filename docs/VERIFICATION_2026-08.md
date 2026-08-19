# Jarvis-X Verification Report — 2026-08

Produced against `docs/superpowers/plans/2026-08-20-phase1a-verification.md`.
Each section below is real command output, not a manual assertion. A ❌ here
becomes a new dated entry in `REMAINING_WORK.md`, not something silently
marked done.

## Task 1: Electron build + launch + restart

- Fixed `electron/package.json`'s invalid `^latest` version pins → pinned to `electron@43.4.1`, `electron-builder@26.15.3`.
- Fixed `electron/main.js`'s wrong port (8001 → 8000).
- Ran `scripts/verify/01_electron_build.sh`. Full log: `scripts/verify/output/01_electron_build.log`.

**Result:** ✅
```
PASS (initial launch): dashboard loaded
PASS (relaunch after kill (restart survival)): dashboard loaded
=== Task 1: ALL PASS ===
```

## Task 2: Vertical output verification (4 verticals, corrected from spec's "5")

Ran `scripts/verify/02_verticals_output.py` per vertical. Raw results: `scripts/verify/output/02_verticals_output.json`.

Two real environment issues found and fixed in the script before it produced trustworthy results (both documented in comments in the script itself):

1. **Wrong content root.** `hermes-api` (started via `supervisorctl -c config/supervisord.conf`) runs `uvicorn app:app` with `directory=/home/ahmedyidris/jarvis-x` — the **main checkout**, not this worktree. `app.py`'s `PHASE_B_ROOT` is relative to wherever `app.py` itself lives, so all generated content and video actually lands under `/home/ahmedyidris/jarvis-x/automation/phase-b/...`, never under this worktree. The script's `CONTENT_ROOT`/`RENDER_ROOT` were corrected to point at the live checkout instead of being derived from the verify script's own path.
2. **Filename-diff detection was blind to 3 of the 4 verticals.** `economic_facts`, `commodities_macro`, and `geopolitical_risk` each iterate a small, fixed, hardcoded `SOURCED_FACTS` list and `generate_and_render_all()` unconditionally overwrites every one of that list's filenames on every run (confirmed by reading `geopolitical_risk_generator.py`: `out_path.write_text(...)` with no existence check, and by each vertical's fact-count exactly matching its existing-file-count in the repo before this task ran). Only `letters` mints a genuinely new filename per run. A plain before/after filename-set diff therefore reported "no new file" — a false FAIL — for all 3 fact-based verticals even though the job did real, fresh work. Fixed by snapshotting `{filename: mtime_ns}` and treating a filename as changed if it's new **or** its mtime advanced.

A post-implementation review then found two more real gaps, fixed in a follow-up commit without re-running any generation job (the already-produced files on disk were re-read through the fixed code):

3. **No durable evidence.** The raw results JSON originally recorded only `keys` (field names), never field *values* — so every "exact match" / "usable" / "defect found" judgment above lived only in the generated files under the main checkout, which the next run of any of the 3 fact-based verticals overwrites entirely. Fixed: every `new_files[]` entry now also carries `headline_fact_excerpt` and `narration_script_excerpt` (first 400 chars, verbatim) straight from the generated JSON, so the raw results file (`scripts/verify/output/02_verticals_output.json`) is itself durable evidence, independent of the live filesystem. Confirmed the geopolitical_risk US-China-tariffs entry's `narration_script_excerpt` preserves the "from 125% to 125%" defect text verbatim (the full `narration_script` is 264 chars, well inside the 400-char excerpt).
4. **Video check only ran for `letters`.** `economic_facts`/`commodities_macro`/`geopolitical_risk`'s own generator functions are literally named `generate_and_render_all()`, and real rendered mp4s existed on disk for all 4 verticals all along — the script just never checked or recorded this for 3 of them. Fixed by generalizing: every vertical's content JSON and rendered mp4 share the same filename stem under `CONTENT_ROOT`/`RENDER_ROOT` respectively (confirmed by listing both dirs for all 4 verticals), so `video_path`/`video_exists`/`video_size_bytes` are now populated for every `new_files[]` entry, not just `letters`'.

| Vertical | Job completed | New file | Valid JSON | Video | Usable (manual review) |
|---|---|---|---|---|---|
| letters | ✅ done, 60.3s | `letter_D.json` | ✅ | ✅ `letter_D.mp4`, 122,302 bytes, 1080×1920 h264/aac, 15.0s | ✅ — "D is for Dog", narration/on-screen text/video duration all coherent and on-topic, no garbling |
| economic_facts | ✅ done, 297.2s | 3 files regenerated (Egypt inflation, Egypt fuel prices, US Fed rates) | ✅ (all 3) | ✅ 3/3 mp4s exist, 358,043–464,636 bytes | ✅ — all numbers in `narration_script`/`on_screen_text` (14.9%, 12%, 3.5–3.75%, EGP 24.00/22.25) match `headline_fact` exactly, no invention |
| commodities_macro | ✅ done, 782.7s | 7 files regenerated (oil, nat gas, copper, gold, wheat, jobs report, CPI) | ✅ (all 7) | ✅ 7/7 mp4s exist, 332,059–432,626 bytes | ✅ — spot-checked all 7 against their `headline_fact`; every cited number ($88.38, $2.79, $6.59/47%, $4,400, $6.75/3.37%, -23,000/4.1%, 3.4%/3.5%) matches, no invention found |
| geopolitical_risk | ✅ done, 596.0s | 5 files regenerated (Red Sea, Taiwan Strait, US-China tariffs, Suez Canal, South China Sea) | ✅ (all 5) | ✅ 5/5 mp4s exist, 371,109–584,842 bytes | ⚠️ — 4/5 clean (numbers match their `headline_fact` exactly: 6 deaths, 150 transits/16.7%, etc.); **1/5 has a real fidelity defect**: `georisk_us-china-trade-tariffs.json`'s `narration_script` reads "a 90-day pause was placed on increasing tariffs on Chinese goods **from 125% to 125%**" — logically incoherent (states no change happened) and misstates the source, which says the pause prevents the tariff from *rising to* 125% (implying it's currently below that). This is the same class of bug `REMAINING_WORK.md` P4 already flagged (LLM garbling a real number under an anti-invention prompt) — not a new fabricated digit this time, but a garbled restatement of an existing one that changes its meaning. **Confirms P4's gap is still open**: the shared retry/validation logic checks JSON shape and non-empty fields only, still has no numeric/logical-fidelity check, so this passed silently and would have shipped un-reviewed. Verbatim evidence preserved in `scripts/verify/output/02_verticals_output.json`'s `georisk_us-china-trade-tariffs.json` entry's `narration_script_excerpt`. |

**Result:** ⚠️ (4/4 verticals produced real, on-disk, valid-JSON output with working rendered video — the core claim under test — but manual review caught a live recurrence of the P4 numeric-fidelity gap in 1 of geopolitical_risk's 5 facts. Not something to fix in this task per the brief; flagged here, with durable verbatim evidence in the raw results JSON, and left as an open item for `REMAINING_WORK.md`.)

## Task 3: E2E flow test (query → decision → content+TTS+video → API response)

Ran `scripts/verify/03_e2e_flow_test.py` against the `letters` vertical (the
one vertical with a real decision + separate render step).

Same environment fix carried forward from Task 2: since `hermes-api` actually
runs `uvicorn app:app` with `directory=/home/ahmedyidris/jarvis-x` (the main
checkout, per `config/supervisord.conf`), the script pins `LIVE_ROOT` to
`/home/ahmedyidris/jarvis-x` explicitly rather than deriving `CONTENT_DIR`/
`RENDER_DIR` from the verify script's own location — the latter would
silently point at this worktree instead of where generated content and
video actually land.

The run exercised the full path end to end: `POST /api/dashboard/generate/letters`
(agent decision — `_next_letter_to_generate()` picked the next un-generated
letter, `E`) → `content_generator.py E` (content JSON) → separate render step
(TTS narration baked into an mp4) → polled `/api/dashboard/overview` until the
job reported `done` (75s) → verified the new content file's shape, verified
the rendered video exists with a real audio track via `ffprobe`, then read
both the content JSON and the video back through the dashboard API
(`GET /api/dashboard/content/letters/letter_E.json`,
`GET /api/dashboard/video/letters/letter_E.mp4`).

```
=== 1. Baseline state before triggering generation ===

=== 2. Agent decision: POST /api/dashboard/generate/letters ===

=== 3. Poll until content+video render completes (up to 340s) ===
job done in 75s

=== 4. Identify which letter this run generated ===
generated letter: E

=== 5. Content artifact: valid JSON, expected shape ===

=== 6. Video artifact: exists, non-trivial size, has an audio track (TTS) ===
video ok: 161555 bytes, 1 audio stream(s)

=== 7. API response: read the artifact back through the dashboard API ===

=== E2E FLOW: PASS (query -> decision -> content+TTS+video -> API response) ===
```

**Result:** ✅ (query → agent decision → content generation → TTS-narrated
video render → API-served response, confirmed end to end against real
processes in a single run; letter `E`, video `letter_E.mp4`, 161,555 bytes,
1 audio stream, job completed in 75s — well inside the 340s budget)

---

## Task 4: Failure-mode tests

Ran `scripts/verify/04_failure_modes.py`. Raw results: `scripts/verify/output/04_failure_modes.json`.

| Failure mode | Graceful? | Notes |
|---|---|---|
| Ollama down | ❌ | Real `supervisorctl stop ollama`, then `POST /api/ask`. Returned **HTTP 200**, not 500/503: `{"question":"ping","response":"Error: ","tier":"local","model":"qwen2.5:3b","voice":null,"audio":null}`. No traceback leaked, no crash — `hermes.py`'s `ask()` catches the failed `curl` subprocess (`returncode != 0`) and returns `f"Error: {result.stderr}"` as ordinary answer text with a 200 status; `stderr` was empty here because the underlying `curl` call uses `-s` (silent), which also suppresses curl's own connection-refused message. Net effect: a caller checking only the HTTP status code cannot detect this failure — it looks like a successful answer whose text happens to be `"Error: "`. Ollama was restarted immediately after in the script's `finally` block and confirmed back up (new pid, fresh `RUNNING` state, and a live follow-up query returned a real answer, `"OK"`). |
| Malformed input | ✅ | `POST /api/ask` with `question` omitted → HTTP 422 with a proper pydantic validation body (`{"detail":[{"type":"missing","loc":["body","question"],"msg":"Field required",...}]}`). No crash. |
| Ollama call timeout | ✅ | Verified by reading `hermes.py`, not reproduced live (would need an artificially slow model to force a real 120s hang): line 67 bounds the `curl`→Ollama subprocess call at `timeout=120`; on `TimeoutExpired` (line 91-92) it returns `"Error: Query timeout (120s)"` as the answer text over a normal HTTP 200 — no hang, no 500. |
| Disk full | ✅ | Simulated via a throwaway 1MB tmpfs at `/tmp/jarvis-verify-diskfull` (not the real disk), then wrote 5MB into it. The write raised `OSError` with `errno=28` (`ENOSPC`), as expected — no half-written file left behind. tmpfs was unmounted and the directory removed in the script's `finally` block; confirmed gone afterward (`mount` shows no entry, `ls` reports "No such file or directory"). |

**Result:** ❌ *(3/4 failure modes degrade gracefully; script exited 1: `FAIL (non-graceful): ['ollama_down']`)* — the ollama-down path is a genuine finding, not a script bug: `hermes-api` answers with HTTP 200 and an essentially empty `"Error: "` string instead of a 5xx status when the local LLM backend is unreachable, so a client relying on status codes alone would treat a hard backend outage as a successful (if oddly blank) answer. Ollama and hermes-api were both confirmed healthy again immediately after the run; no live system was left degraded. Worth a follow-up item in `REMAINING_WORK.md`: either surface curl's stderr without `-s`/with `-S`, or have `hermes.py` return a distinct error signal (status field, or raise) instead of folding backend failures into the answer text.

**Post-run health confirmation (real output, captured after the script finished and again re-confirmed independently of the script's own recovery logic):**

```
$ supervisorctl -c config/supervisord.conf status
hermes-api                       RUNNING   pid 711, uptime 1 day, 22:51:42
ollama                           RUNNING   pid 11999, uptime 0:06:06

$ curl -s http://localhost:8000/api/status
{"status":"online","version":"Hermes v1","conversations":41,"available_tiers":["local","quality"],"available_voices":{"en_us_piper":"English US (Piper)","en_gb_piper":"English UK (Piper)","en_us_kokoro":"English US (Kokoro)","en_gb_kokoro":"English UK (Kokoro)","ar_msa_piper":"Arabic MSA (Piper)","ar_msa_mms":"Arabic MSA (MMS)","ar_eg_egtts":"Arabic Egyptian (EGTTS, voice-cloned, slow/async)"}}
```

`ollama`'s pid (11999) and short uptime confirm it is the process the script's `finally` block restarted, not a stale one left over from before the test; `hermes-api` (pid 711) never went down and kept serving (`conversations` climbed 40→41 across the run). tmpfs cleanup was confirmed the same way: `mount | grep jarvis-verify-diskfull` matched nothing and `ls /tmp/jarvis-verify-diskfull` reported "No such file or directory".
