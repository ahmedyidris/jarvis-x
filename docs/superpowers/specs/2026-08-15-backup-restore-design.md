# Backup & Restore — Design

Status: approved (pending final user review)
Date: 2026-08-15
Author: Ahmed, drafted with Claude

## Context

jarvis-x has been backed up so far by ad-hoc `tar czf` runs producing
`jarvis-x-backup-*.tar.gz` in the home directory, done manually and
inconsistently (three tiny ones from Aug 10-11, one 40MB one from Aug 15).
There is no restore path at all — the closest thing is a comment block in
`config/jarvis-supervisord.service` documenting the four commands needed to
reinstall the systemd unit if the Crostini container is ever recreated.

The project's code is already safe (git repo, clean tree, pushed to
`github.com/ahmedyidris/jarvis-x`), but several things live outside git and
would be lost on container loss:

- `.env` (gitignored — the one real secret file)
- `~/.hermes/` — the live `hermes-api` runtime state (state.db, audio, audio_cache)
- `/etc/systemd/system/jarvis-supervisord.service` — installed outside any
  git-tracked path; the repo only holds a reference copy that can drift
- The `venv-ai` Python environment (3.8GB) and the four Ollama models
  (8.6GB) — not secrets, but expensive to lose and non-trivial to recreate
  from memory

This project builds a repeatable backup/restore pair — a script, a restore
script, and a manual — plus a cron schedule so a comprehensive backup exists
at all times going forward.

## Scope

**In:** the jarvis-x project only — its working tree, `.env`, `~/.hermes`,
the live systemd unit, and a manifest (not raw bytes) for `venv-ai` and
Ollama models. A `backup.sh` / `restore.sh` pair, a `docs/RESTORE.md` manual
covering both scripted and fully-manual restore, and a cron job that runs
`backup.sh` daily and prunes old archives.

**Out:** the separate `~/.openjarvis` tool (unrelated third-party install,
not part of jarvis-x), whole-home-directory backup, and archiving the raw
`venv-ai`/Ollama bytes (reproducible from the manifest instead — see
Approaches below).

## Repo layout

```
jarvis-x/
  scripts/
    backup.sh          # creates ~/jarvis-x-backup-<ts>.tar.gz + .sha256
    restore.sh          # restores from an archive (defaults to newest)
  docs/
    RESTORE.md          # the manual: quick path + full manual fallback
```

Cron entry (installed via `crontab`, not repo-tracked since crontabs are
host state): `backup.sh` daily at 03:00, pruning archives beyond the last 14.

## Backup contents

`backup.sh` produces `~/jarvis-x-backup-<YYYYMMDD_HHMMSS>.tar.gz` containing:

1. **Working tree** — `~/jarvis-x` including `.git` (so `git log`/history
   travels with the backup and a restore doesn't depend on GitHub being
   reachable), excluding what `.gitignore` already excludes
   (`node_modules/`, `logs/`, `__pycache__/`, `.claude/worktrees/`,
   `sentinel/.venv/`, etc.) plus `.claude/settings.local.json`. This
   captures uncommitted work too, not just what's pushed.
2. **`.env`** — copied explicitly since it's gitignored and holds the real
   secrets (API keys).
3. **`~/.hermes/`** — copied in full (556K: `state.db`, `audio/`,
   `audio_cache/`).
4. **The live systemd unit** — `/etc/systemd/system/jarvis-supervisord.service`,
   plus a `diff` against the repo's reference copy
   (`config/jarvis-supervisord.service`) written to `MANIFEST.txt` so drift
   is visible at backup time, not discovered during a crisis restore.
5. **`MANIFEST.txt`** — the reproducibility manifest:
   - `pip freeze` from `venv-ai`
   - `ollama list` output (model names + sizes)
   - current git commit hash + `git status --short` (should be empty; flagged
     if not)
   - hostname, timestamp, jarvis-x directory size
   - the systemd-unit diff from point 4
6. **`<archive>.sha256`** — checksum written next to the archive, so
   `restore.sh` can verify integrity before touching anything.

## Approaches considered (venv/models)

- **Raw archive** — `tar` the actual 3.8GB venv + 8.6GB of model blobs.
  Rejected: balloons backups to 12GB+ for content that's fully reproducible
  from a package list, multiplying storage cost on every run for no benefit
  on a machine that has internet access to restore.
- **Manifest only (chosen)** — record `pip freeze` and `ollama list` output
  (a few KB). Restore reruns `pip install -r` / `ollama pull` per entry.
  Requires internet at restore time, which is the expected case; the manual
  documents the raw-archive fallback as an explicit manual step for anyone
  restoring somewhere offline.

## restore.sh

`scripts/restore.sh [archive]` — defaults to the newest
`~/jarvis-x-backup-*.tar.gz` if no path given.

1. Verify the archive against its `.sha256` (or the one alongside it);
   abort with a clear error on mismatch or missing checksum unless
   `--skip-verify` is passed.
2. If `~/jarvis-x`, `~/.env`-equivalent, or `~/.hermes` already exist and
   are non-empty, move each aside to `<path>.pre-restore.bak` first — never
   overwrite silently. `--force` skips the safety copy for a scratch/test
   restore.
3. Extract the working tree into `~/jarvis-x`.
4. Restore `.env` into `~/jarvis-x/.env`.
5. Restore `~/.hermes/`.
6. Recreate `venv-ai`: create the venv if missing, `pip install -r` the
   `requirements.txt` extracted from `MANIFEST.txt`'s `pip freeze` block.
7. Re-pull Ollama models: `ollama pull <name>` for each line in the
   manifest's model list (skips ones already present locally).
8. Install the systemd unit: `sudo cp` the unit into
   `/etc/systemd/system/`, `daemon-reload`, `enable --now`.
9. Health check: `curl http://127.0.0.1:8000/api/status`, print a clear
   PASS/FAIL summary as the final line of output.

`--dest <dir>` redirects steps 3-5 into a scratch directory instead of the
real paths, for dry-run testing without touching a live install.

If `ollama` or `uv`/Python aren't installed at all, the script prints the
one-line install command for each (from the manual) and exits rather than
guessing package-manager specifics.

## docs/RESTORE.md

Three sections:

1. **Quick path** — `./scripts/restore.sh` (or point it at a specific
   archive), what it does, what the final PASS/FAIL line means.
2. **Full manual fallback** — every step above spelled out by hand, for a
   brand-new Crostini container where the repo doesn't exist yet (clone
   from GitHub first, since the archive itself may not be at hand) or where
   the script can't run for some reason.
3. **Troubleshooting** — the two issues this project's own history already
   hit once: the supervisord socket/port collision when an old manually-started
   instance is still holding `/tmp/jarvis-supervisor.sock`, and `venv-ai`
   Python-version mismatches after a base-image change.

## Cron

`backup.sh` runs daily at 03:00 via the user's crontab, and prunes archives
in `~` beyond the most recent 14 (`ls -t ... | tail -n +15 | xargs rm -f`).
Installing the crontab line is a one-time manual step documented in
RESTORE.md (not scripted into `backup.sh` itself, so re-running the backup
script never silently rewrites the user's crontab).

## Error handling

- `backup.sh` runs under `set -euo pipefail`, writes to a temp file and
  renames atomically into place so a failed run never leaves a
  half-written archive at the expected filename, and warns (rather than
  aborting) if an optional piece is missing (e.g. `~/.hermes` absent) while
  still failing hard if the jarvis-x working tree itself can't be read.
- `restore.sh` validates the archive before any filesystem mutation and
  never deletes pre-existing state — only moves it aside.

## Testing

1. Dry run: `backup.sh` then `restore.sh --dest /tmp/restore-test` — diff
   the extracted tree against the live one, confirm the manifest parses.
2. One real restore-in-place test (on a throwaway copy of the current
   state, not the live container) confirming `hermes-api` comes back and
   `/api/status` returns healthy.
