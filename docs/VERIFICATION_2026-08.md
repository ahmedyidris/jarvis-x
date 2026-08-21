# Jarvis-X Verification Report — 2026-08

Produced against `docs/superpowers/plans/2026-08-20-phase1a-verification.md`.
Each section below is real command output, not a manual assertion. A ❌ here
becomes a new dated entry in `REMAINING_WORK.md`, not something silently
marked done.

## Summary

| # | Check | Result |
|---|---|---|
| 1A.1 | Electron builds + launches + survives restart | ✅ |
| 1A.2 | 4 verticals produce real, usable output | ⚠️ — 4/4 verticals produced real, valid-JSON, working-video output (the core claim), but manual review caught real narration fidelity defects in 2 of geopolitical_risk's 5 facts ("from 125% to 125%" — logically incoherent, garbled from its source; and a second fact restating "since the previous fall" as "since earlier this year", changing when the event happened). Confirms the P4 numeric/semantic-fidelity gap in `REMAINING_WORK.md` is still open. |
| 1A.3 | E2E flow (query→decision→TTS→video→API) | ✅ |
| 1A.4 | Failure modes degrade gracefully | ❌ — 3/4 graceful (malformed input, Ollama timeout, disk full); Ollama-down returns HTTP 200 with an essentially empty `{"response":"Error: "}` body instead of a 5xx, invisible to any client checking only status codes. |
| 1A.5 | Kill-switch + restart + restore recovery | ✅ |
| 1A.6 | Performance baseline recorded | ✅ — numbers recorded (startup 3.63s, decision latency avg 14.6s/p95 51.4s over a 5ms–97.6s range across a mixed/stale 41-row sample — see Task 6 for its real composition, hermes-api 282.5MB / ollama 4,328.6MB point-in-time RSS during active generation (not a ceiling), letters video-gen 60.3s). The intra-tier latency variance, a `model="--tier"` recording bug, and the mixed sample are filed as a separate observability gap (P7), not a failure of this check itself. |

**Phase 1A exit criteria met:** NO — Task 4's Ollama-down path is a confirmed ❌, and Task 2's geopolitical_risk fidelity defects (2/5 facts, both semantic restatements — see Task 2 below) are a confirmed real content-quality gap (⚠️, not a clean pass). Both are filed below in `REMAINING_WORK.md`; see that file for full detail and status.

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
| geopolitical_risk | ✅ done, 596.0s | 5 files regenerated (Red Sea, Taiwan Strait, US-China tariffs, Suez Canal, South China Sea) | ✅ (all 5) | ✅ 5/5 mp4s exist, 371,109–584,842 bytes | ⚠️ — 3/5 clean (numbers match their `headline_fact` exactly: 150 transits/16.7%, etc.); **2/5 have real fidelity defects**, both *semantic* — a meaning-changing restatement of a sourced claim, not an invented number: (1) `georisk_us-china-trade-tariffs.json`'s `narration_script` reads "a 90-day pause was placed on increasing tariffs on Chinese goods **from 125% to 125%**" — logically incoherent (states no change happened) and misstates the source, which says the pause prevents the tariff from *rising to* 125% (implying it's currently below that). (2) `georisk_red-sea-shipping-attacks.json`'s `headline_fact` says the six shipping deaths mark the first since "**the previous fall**" (i.e. fall 2025), but its own `narration_script` restates the same claim as "since **earlier this year**" (2026) — a different, incorrect time frame for the same sourced fact. Both are the same class of bug `REMAINING_WORK.md` P4 already flagged (LLM garbling a sourced claim under an anti-invention prompt) — not fabricated digits this time, but garbled restatements that change meaning. **Confirms P4's gap is still open, and broadens its scope**: the defect class is semantic (meaning-changing restatement), not purely numeric — the shared retry/validation logic checks JSON shape and non-empty fields only, still has no fidelity check of any kind, so both of these passed silently and would have shipped un-reviewed. Verbatim evidence for both preserved in `scripts/verify/output/02_verticals_output.json`'s `georisk_us-china-trade-tariffs.json` and `georisk_red-sea-shipping-attacks.json` entries' `narration_script_excerpt`/`headline_fact_excerpt` fields. |

**Result:** ⚠️ (4/4 verticals produced real, on-disk, valid-JSON output with working rendered video — the core claim under test — but manual review caught a live recurrence of the P4 numeric/semantic-fidelity gap in 2 of geopolitical_risk's 5 facts. Not something to fix in this task per the brief; flagged here, with durable verbatim evidence in the raw results JSON, and left as an open item for `REMAINING_WORK.md`.)

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
| Disk full — **Python-level ENOSPC sanity check only** | ✅ (as what it actually tests) | This check mounts a throwaway 1MB tmpfs at `/tmp/jarvis-verify-diskfull` (not the real disk) and writes 5MB directly **in this verification script's own Python process** — proving Python's `OSError(ENOSPC)` behavior (which it does: `errno=28`, no half-written file left behind, tmpfs cleanly unmounted afterward), but proving nothing about how `hermes-api`, `content_generator.py`, or `video_renderer.py` actually behave when their real output directory fills up. **Jarvis-X's own behavior under a full disk (partial writes, job status on failure, truncated video files) remains untested.** See `REMAINING_WORK.md` P8. |

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

## Task 5: Recovery test (kill-switch, supervisord restart, restore.sh)

Ran `scripts/verify/05_recovery_test.sh` against the *live* deployed system. Full log: `scripts/verify/output/05_recovery_test.log`.

**Same class of bug as Tasks 2 and 3, specific to this task, fixed before running:** `hermes-api` runs from the main checkout (`/home/ahmedyidris/jarvis-x`, per `config/supervisord.conf`'s `directory=`), and both `app.py`'s `STOP_FILE` and `code/guard.js`'s `STOP_FILE` resolve relative to wherever those files physically live — the main checkout's `.jarvis-x-STOP`, not this worktree's copy. Running `node code/stop.js` from this worktree would have created/touched a `.jarvis-x-STOP` file here that the live service never sees, making step 5.2's 503 check (and 5.3's guard check) silently test nothing. Fixed by running the kill-switch-touching commands (steps 5.1, 5.3, 5.4) with the main checkout as the working directory (`cd /home/ahmedyidris/jarvis-x && node code/stop.js ...`), while steps 5.2 (curl to `localhost:8000`), 5.5 (`supervisorctl`), and 5.6 (`restore.sh --dest`) were left as-is since they already target the live service or an explicit throwaway path. Confirmed after the run that no `.jarvis-x-STOP` file was left in either checkout, and that `config/supervisord.conf` is byte-identical between the worktree and the main checkout (same `unix:///tmp/jarvis-supervisor.sock`), so `supervisorctl -c config/supervisord.conf` from this worktree really does control the live `hermes-api`/`ollama` processes.

**Post-review fix (safety-net trap):** review flagged that under `set -euo pipefail`, an unexpected failure anywhere between step 5.1 (engage) and step 5.4 (disengage) would abort the script and leave the live main checkout's `.jarvis-x-STOP` engaged — halting the real system. Fixed by adding `trap '(cd "$MAIN_CHECKOUT" && node code/stop.js off) >/dev/null 2>&1 || true' EXIT` immediately after step 5.1's engage, so the kill switch is unconditionally disengaged on any exit path (success, an assertion `FAIL`/`exit 1`, or a `set -e` abort). It is silenced on both streams so it never duplicates step 5.4's own logged disengage line on the success path (`node code/stop.js off` is idempotent — `fs.rmSync(..., { force: true })` — so the trap firing after step 5.4 already ran is a harmless no-op). Verified the trap actually works by running a throwaway copy of the script with step 5.2's check forced to fail right after the trap is armed: the script exited 1 as expected, and an independent `ls` immediately afterward confirmed the live checkout's `.jarvis-x-STOP` was already gone — the trap had disengaged it. The real script was then re-run clean (output below) to confirm `ALL PASS` still holds with the trap in place and introduces no extra log noise.

```
=== Phase 1A / Task 5: kill-switch + supervisord restart + restore ===
--- 5.1 engage kill switch (against live main checkout: /home/ahmedyidris/jarvis-x) ---
Kill switch ENGAGED. All actions halted.
STOPPED
--- 5.2 confirm the API refuses a generate request while stopped ---
generate/letters while stopped -> HTTP 503
--- 5.3 confirm guard.js blocks a guarded JS action while stopped (against live main checkout) ---
blocked as expected: ⛔ Kill switch active – action blocked
--- 5.4 disengage kill switch (against live main checkout) ---
Kill switch CLEARED. Jarvis X may act.
RUNNING
--- 5.5 supervisord restart resilience ---
hermes-api: stopped
hermes-api: started
PASS: hermes-api healthy after restart (attempt 1)
--- 5.6 restore.sh against a throwaway destination (never touches the live install) ---
using backup: /home/ahmedyidris/jarvis-x-backup-20260819_023409.tar.gz -> /tmp/jarvis-restore-verify-13786
✅ Checksum verified
✅ Extracted
PASS: restore produced a real, complete tree at /tmp/jarvis-restore-verify-13786
=== Task 5: ALL PASS ===
```

**Result:** ✅ `=== Task 5: ALL PASS ===` — kill switch, engaged against the live main checkout, produced a real HTTP 503 from `hermes-api` on `POST /api/dashboard/generate/letters` and a real thrown error from `code/lib.js`'s `execute()`; disengaging restored normal operation. `supervisorctl restart hermes-api` came back healthy (`"status":"online"`) within 1 second (fresh pid, replacing the pre-restart pid). `restore.sh` against the latest real backup (`jarvis-x-backup-20260819_023409.tar.gz`, checksum-verified) with `--dest /tmp/jarvis-restore-verify-$$` produced a complete tree (`app.py` and `.git` present) and exited without touching the live install; the throwaway destination was removed afterward. Post-run health check confirmed the live system undisturbed: no `.jarvis-x-STOP` left on disk in either checkout, `supervisorctl status` shows both `hermes-api` (new pid, fresh restart, e.g. pid 13846 in this final run) and `ollama` `RUNNING`, and `curl http://localhost:8000/api/status` returns `"status":"online"`.

## Task 6: Performance baseline

Ran `scripts/verify/06_performance_baseline.py`. Raw results: `scripts/verify/output/06_performance_baseline.json`.

**Same class of bug as Tasks 2, 3, and 5, specific to this task, fixed before running:** the brief's `measure_video_gen_wallclock()` derived `letters_dir` relative to this script's own location (this worktree), but `hermes-api` runs from the main checkout (`/home/ahmedyidris/jarvis-x`, per `config/supervisord.conf`'s `directory=`), and `app.py`'s `CONTENT_ROOT` is likewise derived relative to `app.py`'s own file location — the main checkout, not this worktree. Confirmed the two had already diverged: the main checkout's `letters` output dir held 5 real files (newest from today, 01:50), while this worktree's copy held only 2 stale ones (both timestamped to worktree creation, 00:34). Fixed by pointing `letters_dir` at an explicit `MAIN_CHECKOUT = Path("/home/ahmedyidris/jarvis-x")` constant instead of deriving it from the script's own `REPO`. The other three measurement functions were left as written in the brief — `measure_startup`/`measure_decision_latency`/`measure_memory` use `supervisorctl`, `~/.hermes/state.db` (already an absolute path outside any checkout), and `pgrep`/`ps` by process name, none of which are worktree-relative.

**A second, unrelated bug found during the first live run and fixed before the numbers below:** `measure_memory()`'s `pgrep -f "uvicorn app:app"` / `"ollama serve"` patterns are not scoped to jarvis-x — this host's process table also contains an unrelated pair of root-owned processes inside a separate Docker container (`/root/venv-ai/bin/uvicorn app:app --host 0.0.0.0 --port 8000` and a second `ollama serve`, both confirmed via `/proc/<pid>/cgroup` showing a `/docker/...` path distinct from this host's own cgroup) that happen to share the same command substrings. The first run measured `hermes_api_mb: 472.4` / `ollama_mb: 62.0` — inflated by that stray container's ~190MB and ~23MB respectively. Fixed by adding `pgrep -u <current user>` (the real, supervised jarvis-x processes run as `ahmedyidris`; the stray container processes run as `root`).

**Third bug, found during whole-branch review and fixed 2026-08-20:** `measure_memory()`'s `"ollama serve"` pattern only matches ollama's own long-lived supervisor process, not the separate `ollama runner`/`llama-server` child process that actually holds a loaded model's weights in memory — and the original `main()` called `measure_memory()` *before* `measure_video_gen_wallclock()` ran, i.e. before any model had ever been loaded, so the "memory ceiling" numbers above (`ollama_mb: 38.8`) were always an idle-process sample, not a ceiling of anything. Confirmed live: `ps aux | grep -i ollama` while a real `letters` generation job was in flight showed a second, transient process — `/usr/local/lib/ollama/llama-server --model ... --port 46445 ...` — using **~2.05GB RSS**, dwarfing the `ollama serve` supervisor's ~40-60MB. Fixed by (a) reordering `main()` to trigger the `letters` job first and sample memory once partway through it, while a model is actually loaded and generating, and (b) broadening the pgrep pattern from `"ollama serve"` to plain `"ollama"` (still owner-scoped, so it doesn't re-admit the unrelated Docker container) so it catches the runner child too. Relabeled below from "memory ceiling" to "point-in-time RSS during active generation" — a single sample mid-job still isn't a true ceiling (peak-over-time), just an honest reading taken while work was actually happening, unlike the original idle sample.

```
$ ~/venv-ai/bin/python3 scripts/verify/06_performance_baseline.py
hermes-api: stopped
hermes-api: started
{
  "startup_s": 3.63,
  "decision_latency_ms": {
    "n": 41,
    "min_ms": 5,
    "max_ms": 97603,
    "avg_ms": 14621.8,
    "p95_ms": 51398
  },
  "memory": {
    "hermes_api_mb": 282.5,
    "ollama_mb": 4328.6
  },
  "memory_note": "point-in-time RSS sampled during an active `letters` generation job (not before -- a model was actually loaded and generating at sample time), broadened to also match ollama's separate runner/llama-server child process, not just its own supervisor process. Not a true ceiling: a single sample, not a peak-over-time observation.",
  "letters_video_gen": {
    "status": "done",
    "wallclock_s": 60.3
  }
}

Wrote /home/ahmedyidris/jarvis-x/.claude/worktrees/phase1a-verification/scripts/verify/output/06_performance_baseline.json
```

| Metric | Value |
|---|---|
| Startup time | 3.63s (`supervisorctl stop` → `start` → first healthy `/api/status`) |
| Per-decision latency (last 41 of 50 requested — only 41 conversation rows exist total; **sample composition disclosed below, not a clean measurement**) | avg 14621.8ms (14.6s) / p95 51398ms (51.4s); min 5ms, max 97603ms (97.6s) |
| Point-in-time RSS during active generation (hermes-api / ollama) — **not a memory ceiling** | hermes-api 282.5MB RSS / ollama **4,328.6MB RSS** (sampled while a `letters` job was running and a model was loaded; broadened pattern now also catches ollama's runner/llama-server child, which is where nearly all of this is) |
| Letters video-gen wall-clock | 60.3s (`status: done`, one new letter — `letter_I` — fully content-generated + video-rendered) |

**Result:** ✅ *(numbers recorded — this task always "passes" by having real numbers, even if the numbers themselves are concerning; a concerning number becomes a REMAINING_WORK.md entry, same as any other ❌ above)*

**The per-decision latency row is not a clean measurement — its sample composition, checked directly against `~/.hermes/state.db`, is:**
- **n=41** total rows (all conversation rows that exist; the query asked for the last 50 but only 41 exist).
- **`voice_id` is `NULL` in all 41 rows** — TTS/voice synthesis was never exercised in this sample at all, ruling out "quality tier + voice synthesis is slow" as an explanation for the high end of the range.
- **Model mix:** 35/41 `qwen2.5:3b` (local tier), 4/41 `qwen2.5:7b` (quality tier), and **2/41 rows where `model` is literally the string `--tier`** — an argv-parsing bug in whatever wrote those two rows, unrelated to anything else tested in Task 6.
- **The max (97,603ms) and p95 (51,398ms) values both belong to `qwen2.5:3b` rows on trivial prompts** ("Hello. Hello. Hello. Hello." and "hello, who are you"), not to the quality tier — the variance is intra-tier, on the fast model, not explained by tier choice.
- **4/41 rows are degenerate `"No response"` results at single-digit-millisecond latencies** (the 2 `--tier` rows plus 2 more `qwen2.5:3b` rows) — these are averaged in with real answers by the raw query, understating what a real answer actually costs.
- **Most rows predate this verification session by days:** 38/41 rows are timestamped 2026-08-12 through 2026-08-16; only 3/41 are from this session (2026-08-20).

This is filed in full as `REMAINING_WORK.md` P7 (rewritten 2026-08-20 to match what the data actually shows, replacing an earlier guess that turned out to be contradicted by it).

**Post-run health confirmation (real output, captured after this re-run's own live `hermes-api` restart):**

```
$ supervisorctl -c config/supervisord.conf status
hermes-api                       RUNNING   pid 21131, uptime 0:02:40
ollama                           RUNNING   pid 20931, uptime 0:03:29

$ curl -s http://localhost:8000/api/status
{"status":"online","version":"Hermes v1","conversations":41,"available_tiers":["local","quality"],"available_voices":{"en_us_piper":"English US (Piper)","en_gb_piper":"English UK (Piper)","en_us_kokoro":"English US (Kokoro)","en_gb_kokoro":"English UK (Kokoro)","ar_msa_piper":"Arabic MSA (Piper)","ar_msa_mms":"Arabic MSA (MMS)","ar_eg_egtts":"Arabic Egyptian (EGTTS, voice-cloned, slow/async)"}}
```

`hermes-api`'s pid (21131) is fresh from this run's own `supervisorctl stop`/`start`. The video-gen check against the main checkout confirmed a new `letter_I.json` (03:00) and matching `letter_I.mp4` (179,980 bytes, under `02_render_video/output/letters/`, 03:01) landed there, timestamped to this run.
