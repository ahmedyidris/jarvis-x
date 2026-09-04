# Repo triage — 2026-09

**Runbook session:** 2 · **Base commit:** `8643e6e` · **Rule applied:** archive, never delete

337 tracked files, 5.4 MB, across 19 top-level directories:

| Dir | Files | Dir | Files |
|---|---|---|---|
| `code/` | 82 | `scripts/` | 18 |
| `automation/` | 54 | `bootstrap/` | 7 |
| `web/` | 36 | `config/` | 4 |
| *(root)* | 32 | `electron/` | 3 |
| `docs/` | 31 | `knowledge/`, `docker/`, `.github/` | 2 each |
| `sentinel/` | 29 | `bin/`, `memory/` | 1 each |
| `packages/` | 21 | | |

This triage covers the root directory and everything with a concrete disposition. It does
**not** rubber-stamp all 337 files: the bulk of `code/`, `automation/`, `web/`, `sentinel/`
and `packages/` is live source with tests or callers, and is KEEP by default. Files singled
out below are the ones where evidence pointed somewhere other than KEEP.

---

## ARCHIVED (moved this session)

All eight moved to `archive/2026-09/` via `git mv`. Nothing was deleted; every one is
recoverable with a single `git mv` back.

| File | Reason |
|---|---|
| `app.py.bak2` | Editor backup, differs from `app.py` (older snapshot). Already matched by `.gitignore:8` (`*.bak2`) — committed before that rule existed. Referenced by 0 files. |
| `hermes.py.bak3` | Editor backup, differs from `hermes.py`. `.gitignore` covers `*.bak`/`*.bak2` but not `.bak3`, so it slipped through. Referenced by 0 files. |
| `tts_setup.log` | 12 KB build log. Referenced by 0 files; `.gitignore:27` already excludes `logs/`. |
| `jarvis-x_1.0.0_amd64.deb` | **Non-functional artifact.** `dpkg -c` shows an empty `/opt/jarvis-x` and a launcher that runs `cd /opt/jarvis-x && python -m uvicorn app:app` — no `app.py` is shipped there. Already matched by `.gitignore:25`. |
| `ask` | Zero-byte file at repo root. Grep finds no reference to it as a *file* (all hits are the `/api/ask` endpoint). Accidental shell redirect. |
| `list` | Zero-byte. All grep hits are the `"list"` action type, not this file. |
| `shell` | Zero-byte. All grep hits are `code/shell.js` or the `shell` action type. |
| `code/ask` | Zero-byte, zero references. Archived as `code_ask`. |

Reproduction of the move (idempotent — skips anything already moved):

```bash
cd ~/jarvis-x && mkdir -p archive/2026-09
for f in app.py.bak2 hermes.py.bak3 tts_setup.log jarvis-x_1.0.0_amd64.deb \
         ask list shell code/ask; do
  git ls-files --error-unmatch "$f" >/dev/null 2>&1 \
    && git mv "$f" "archive/2026-09/$(echo "$f" | tr '/' '_')"
done
```

Regression-checked after the move: JS suite 13/19 (unchanged), model-gateway 47/47
(unchanged).

**Safe to `rm -rf archive/2026-09/` once nothing has broken for a month.** Git history
retains all eight regardless.

---

## KEEP — but fixed this session

| File | What was wrong |
|---|---|
| `code/exec.js` | Jail root guessed from `$HOME` instead of the checkout. See `AS_BUILT.md` §3.2 — **note this reverses a recorded decision.** |
| `code/shell.js` | `spawnSync` had no `cwd`, so validated paths executed elsewhere. Jail escape, reproduced. `AS_BUILT.md` §3.3 |
| `package.json` | `i18next` required by `code/i18n-config.js` but undeclared. `AS_BUILT.md` §3.1 |
| `packages/model-gateway/package.json` | Test script ran zero tests on Node 22. `AS_BUILT.md` §3.4 |
| `bin/jj` | Shell-style `#` comments appended into a JS file → `SyntaxError`; whole CLI dead. `AS_BUILT.md` §3.5 |
| `jj` (root symlink) | Pointed to `../bin/jj`, outside the repo — dangling. Repointed to `bin/jj`. |

---

## KEEP — flagged, no action taken

These need a ruling or build work, not a file move. Full detail in `AS_BUILT.md` §4 and §6.

| File | Flag |
|---|---|
| `code/paper-trading.js`, `config/trading.json` | ~~Flagged pending a ruling.~~ **Deleted, then rebuilt, both on 2026-09-04.** The originals were removed (an explicit exception to this document's move-never-delete rule). Later the same evening both were re-created from scratch as a tested module with enforced limits — not restored from history. The deletion stands as recorded; what exists now shares only the filenames. See `DECISION_RECORD_paper-trading.md`. |
| `code/test-guard.js` | Zero assertions, always exits 0, counted as PASS. Not a test. |
| `code/test-shell.js` | Zero assertions. Reads `r.status` but `run()` returns `exit_code`. Its `rm not allowed` label is stale — `rm` is deliberately allowlisted. |
| `package.json:11` (`test:net`) | ~~Dead flag.~~ **Resolved 2026-09-04:** `code/test-net.js` implements the gate; skips are counted separately from passes. |
| `.github/workflows/test.yml:29` | The `$HOME/jarvis-x` symlink step is now redundant given the `exec.js` fix. Harmless; removal is your call. |
| `electron/` (3 files) | `main.js` plus package files only. No test, no verified build. |
| `jarvis-x-pkg/` | Packaging source for the non-functional `.deb`. Kept — the fix is to make it ship `app.py`, not to delete it. |

---

## Planning docs — proposal only, NOT moved

The runbook (Session 4) says every superseded status doc should get a
*superseded by AS_BUILT.md* header. I have **not** edited or moved any of them: which docs
are genuinely superseded is a judgment that belongs to you, and Session 5 is where the
plans get merged.

| Doc | Size | Assessment |
|---|---|---|
| `REMAINING_WORK.md` | 43.8 KB | **KEEP.** Largest doc in the repo but actively accurate — its `:16` entry on the model-gateway decision matches what the code does. Best existing source on open work. |
| `NOTES.md` | 7.6 KB | **KEEP, correct two lines.** `:10` ("22/24, 91%") and `:12` ("Checks: 49/49") are the origin of the completion confusion. They are *not wrong*, just widely misread — see `AS_BUILT.md` §5. |
| `docs/archive/JARVIS_X_STATUS_SNAPSHOT.md` | — | **ARCHIVE-CANDIDATE.** Line 34 — "All 49/49 unit tests passing" — is the one demonstrably false claim found: those 49 are `scripts/status.sh` checks, not unit tests. Already under `docs/archive/`. |
| `WEEK_1_COMPLETE.md` | 3.3 KB | **ARCHIVE-CANDIDATE.** A Week-1 snapshot. `README.md` was already rewritten once because it "was a Week-1 snapshot describing a deleted file as the live router" (`docs/obsidian-vault/changelog/2026-08.md`). |
| `MASTER_PLAN_UPDATED.md` | 5.7 KB | **Session 5 input.** Do not archive before `MASTER_PLAN_v3.md` exists. |
| `PLAN.md` | 6.4 KB | **Session 5 input.** Still referenced by `docs/superpowers/plans/`. |
| `CONTEXT.md` | 10.9 KB | **KEEP.** Operating context, not a status snapshot. |
| `JARVIS_X_INTEGRATION_RUN.md` | 10.3 KB | **KEEP** pending review — a run log, superseded in substance by `AS_BUILT.md` §1. |
| `Jarvis_X_Status_Report.pdf` | 228 KB | **ARCHIVE-CANDIDATE.** Largest single file in the repo; a binary status snapshot, unreadable to grep and to every tool that maintains it. |
| `DECISION_RECORD_*.md` (3) | — | **KEEP permanently.** These are why the codebase is shaped as it is. |
| `CONSTITUTION.md` | 2.4 KB | **KEEP permanently.** Amended 2026-09-04 when trading was ruled out — §IV now forbids trading of any kind. |
| `BrandGuidelines.md`, `Design.md`, `EGTTS_RESEARCH.md`, `WINDOWS-VOICE-SETUP.md`, `README.md` | — | **KEEP.** Reference material, not status claims. |

Archiving the three ARCHIVE-CANDIDATE docs is one command, once you agree:

```bash
cd ~/jarvis-x && mkdir -p archive/2026-09
git mv WEEK_1_COMPLETE.md Jarvis_X_Status_Report.pdf archive/2026-09/
```

---

## DELETE

**Nothing in this session.** Per the runbook's rule, the 2026-09-03 triage deleted no
file — everything went to `archive/2026-09/`.

**Later exception, 2026-09-04:** `code/paper-trading.js` and `config/trading.json` were
deleted outright on Ahmed's explicit ruling, not archived. Recorded here so the rule and
its one exception sit in the same place. Git history retains both files.
