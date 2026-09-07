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
| `code/test-guard.js` | ~~Zero assertions, always exits 0, counted as PASS. Not a test.~~ **RESOLVED 2026-09-04.** Replaced with 14 assertions covering the kill switch, the audit-log shape, and the two bugs `guard.js`'s own comments record: a blocked action leaving no trace, and an async failure logged as a success. |
| `code/test-shell.js` | ~~Zero assertions. Reads `r.status` but `run()` returns `exit_code`. Its `rm not allowed` label is stale — `rm` is deliberately allowlisted.~~ **RESOLVED 2026-09-04.** Replaced with 21 assertions covering the allowlist, argument validation, the path jail, the working directory, the kill switch and the audit trail. All three faults are now asserted against directly: `exit_code` is checked and `status` asserted absent, and a test pins that `rm`/`curl`/`wget`/`bash`/`python`/`node` **are** allowlisted. |

**Why this mattered more than a stale label.** Both files were in the CI `js-suite` list, so CI was running two files that could not fail — guarding `shell.js` (the command allowlist) and `guard.js` (the kill switch and audit log), the two most safety-critical modules here. Demonstrated 2026-09-04 by emptying `shell.js`'s `ALLOWED` set entirely: both still exited 0. Both replacements are mutation-tested against six deliberate breaks, including that one.

One of those six initially **escaped**: deleting `cwd: BASE` — the original jail escape — passed, because the test ran `pwd` from the repo root and the process cwd happened to be the jail. The test now `chdir`s elsewhere first, and a second test plants a decoy `package.json` in that directory to prove a relative path still resolves against the jail. Recorded because a test that passes for the wrong reason is the thing this whole entry is about.
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

---

## TESTS THAT CANNOT FAIL — the running tally

This document flagged `test-shell.js` and `test-guard.js` on 2026-09-03 as
"zero assertions, always exits 0, counted as PASS", and no action was taken
until 2026-09-04. Keeping the tally here so the next one is found by reading
rather than by an eval breaking.

| file | fault | in CI then | status |
|---|---|---|---|
| `code/test-shell.js` | zero assertions | yes | **fixed 2026-09-04**, 21 assertions |
| `code/test-guard.js` | zero assertions | yes | **fixed 2026-09-04**, 14 assertions |
| `code/test-data-layer.js` | had assertions, then `runTests().catch(console.error)` threw them away — and it loaded dotenv so it made live Alpha Vantage calls | no | **fixed 2026-09-07**, 28 assertions, in CI, offline |
| `code/test-accessibility.js` | `.catch(console.error)` | no | **OPEN** |
| `code/test-agent-data-integration.js` | `.catch(console.error)`, plus `requireNet()` at the top skipping 4 offline cases | no | **fixed 2026-09-07**, 13 offline assertions, in CI |
| `code/test-full-accessibility.js` | `.catch(console.error)` | no | **OPEN** |
| `code/test-voice-accents.js` | `.catch(console.error)` | no | **OPEN** |
| `code/test-voice-full-system.js` | `.catch(console.error)` | no | **OPEN** |

The five open ones are not in CI, so they are not lying to CI — but they lie
to anyone who runs them by hand, which is the only way they ever run. They
are unfixed for a reason worth stating rather than leaving implied: each
needs hardware or a network this container does not have (Piper/Kokoro
binaries, downloaded voice models, CoinGecko), so a rewrite here could be
verified only by reading it. Fixing them means running them on the
Chromebook. `test-agent-data-integration.js` is the cheapest — it needs only
network — and would be the one to start with.

**Verified 2026-09-07, so it is not assumed:** the two CI-listed files that do
not use `test-helper.js` are fine. `test-helper.js` is the helper itself.
`test-scheduler.js` ends with `process.exitCode = pass === total ? 0 : 1` —
mutation-checked by removing `'git_log'` from `scheduler.js`'s `READ_ONLY`
set, which produced exit 1.

Since 2026-09-07 they share a second fault: none imports `test-helper.js`, so
none gets the audit-log redirect added that day, and each still appends its
fixtures to the machine's real `logs/actions.jsonl` when run by hand — which
is the only way they run. `selfdebug.js` then reads those fixtures. One pass
over these files should fix both faults at once: make them fail properly and
route them through `test-helper.js`. `test-agent-data-integration.js` is still
the cheapest start (network only, no voice hardware).

**The pattern to grep for**, on any new test file that does not use
`test-helper.js`:

```bash
grep -l "catch(console.error)" code/test-*.js
```

A match is a file that prints its failures and exits 0. (`test-data-layer.js`
matches only because its header quotes the line it used to end with.)
