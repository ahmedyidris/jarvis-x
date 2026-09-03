---
title: Troubleshooting
---

# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `test-voice.js`/`test-voice-interaction.js` fail intermittently | These invoke real Piper/Kokoro subprocess synthesis — timing-sensitive under system load. Confirmed 2026-08-16: one failed under `scripts/status.sh`'s full concurrent load, passed cleanly (3/3) standalone moments later with no code change. | Re-run in isolation before treating a failure here as a regression. |
| `git fsck`/any git command fails with "dubious ownership" when run as the `jarvis` system user | Repo is owned by `ahmedyidris`; git refuses cross-user access without an explicit exception. | `git config --global --add safe.directory /home/ahmedyidris/jarvis-x` — added to `/home/ahmedyidris/.gitconfig` specifically, since `config/supervisord.conf` sets `HOME=/home/ahmedyidris` for any real process running as `jarvis`, not `jarvis`'s own `/home/jarvis`. |
| Can't `stat`/`chmod` anything under `~/.jarvis-x/` | Owned by a separate `jarvis` system user, `700` permissions — by design. | `sudo -u jarvis <command>`, with `HOME=/home/ahmedyidris` set explicitly if the command needs to resolve paths under `~/.jarvis-x/` correctly. |
| CI (`.github/workflows/test.yml`) doesn't run all 11 JS tests | 5 of them need real local Ollama/Piper/Kokoro infrastructure a GitHub-hosted runner doesn't have. | By design — see the workflow file's own comments. Only the 6 self-contained tests + `model-gateway` + the `web` build run in CI. |
| Pushing a change under `.github/workflows/` gets rejected | GitHub requires the `workflow` OAuth scope specifically, separate from general repo write access. | `gh auth refresh -h github.com -s workflow` (interactive device-code approval), then push normally. |
| Disk is tight (check `df -h /`) | Ollama's model store (~8.6GB) + `venv-ai` (~3.8GB) are the two big local consumers. | Nothing to blindly delete — both are actively used. See [[docker-single-container]]'s note on why Google Drive isn't a practical way to offload these (multi-GB binaries via an API-based file connector is impractical). |
| Phase B video render output missing after a while | `automation/phase-b/stages/02_render_video/output/` is gitignored and regenerable — safe to delete anytime to free space, re-run `video_renderer.py` to get it back. | Not a bug. |

| `df -h` on the `/mnt/chromeos` 9p mount reports wildly different total capacity between two calls seconds apart (e.g. 109G→7.8G) | That mount's `statfs` data is not trustworthy from inside Crostini. | Verify with `ls -la`/`tar -tzf <file>` directly on the file in question rather than trusting `df` on this mount. Caused a real false alarm 2026-08-31 (a backup file believed lost was fully intact). |
| Dashboard `TALK` button reports `MIC UNAVAILABLE: NotSupportedError` | Intermittent `getUserMedia` failure — confirmed via `dashboard/mic-diagnostic.html` (3x retry + device enumeration) that on a real device this comes and goes (2 fails, 2 successes across attempts on the identical page), not a hard ChromeOS/Crostini-level block. | `dashboard.html`'s mic acquisition now retries once (800ms delay) on `NotSupportedError`/`AbortError` before surfacing an error. Run `mic-diagnostic.html` on the actual device first if it recurs, rather than assuming a permanent block. |

See [[debug-the-kill-switch]] for the kill-switch-specific runbook.
