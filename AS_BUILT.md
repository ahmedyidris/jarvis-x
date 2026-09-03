# Jarvis X — AS-BUILT

**Generated:** 2026-09-03 · **Supersedes:** every completion percentage in the archive
**Method:** Sessions 1–4 of `JARVIS_X_REBUILD_RUNBOOK.md`, run against commit `8643e6e`

Every claim below cites a command output, a file path, or a test name. Claims that could
not be verified are quarantined in [§6 Unverified](#6-unverified--needs-your-input) rather
than estimated.

---

## 1. The headline number

**13 of 19 JavaScript test files pass. 47 of 47 model-gateway tests pass.**

That is the whole of what the tests prove. There is no single "percent complete" figure in
this document, because nothing measured here produces one — see §5 for why the old ones did
not either.

| Suite | Command | Result |
|---|---|---|
| JS suite | `node jest-runner.js` | **13 passed, 6 failed** (exit 1) |
| model-gateway | `npm test` in `packages/model-gateway` | **47 passed, 0 failed** |
| Python — sentinel | `pytest sentinel/tests/test_smoke.py` | not verifiable (deps absent) |
| Python — app lock | `pytest test_app_generation_lock.py` | not verifiable (`fastapi` absent) |
| web build | — | not verifiable (`web/node_modules` absent) |

Before the fixes in §3, the JS suite was **9 passed, 10 failed**.

### The 6 remaining JS failures are all missing local dependencies, not code defects

| Test file | Blocked by | Evidence |
|---|---|---|
| `test-vision.js` | Ollama not installed | `Vision failed: Ollama unreachable (fetch failed)` |
| `test-voice.js` | 3 Piper `.onnx` voices absent | `Voice model not found: .../en_US-amy-medium.onnx` |
| `test-voice-router.js` | 4 Piper `.onnx` voices absent | 4/8 cases pass; routing logic itself passes |
| `test-voice-interaction.js` | Piper voice + Python `soundfile` | 2/4 pass; both route assertions pass |
| `test-kokoro.js` | Kokoro model files + `soundfile` | 2/5 pass; `ModuleNotFoundError: No module named 'soundfile'` |
| `test-agent-data-integration.js` | Live network | `Data unavailable for crypto:btc. CoinGecko HTTP 403` |

Each of these should pass on the dev machine if Ollama, the Piper voices, and Kokoro are
installed there. **None of them is evidence of broken application code.** Conversely, none
of them is evidence of *working* application code — they are simply unmeasured here.

---

## 2. What exists and is verified working

| Component | Evidence |
|---|---|
| Path jail (`code/exec.js`) | `test-exec.js` 2/2 after fix |
| Action validation (`code/validate.js`) | `test-validate.js` **23/23** after fix |
| Model gateway — breaker, budget, store, telemetry, tier policy | `packages/model-gateway` **47/47** across 8 `*.test.js` files |
| Data layer + provider registry | `test-data-layer.js` 5/5; registers market, crypto, energy, news |
| Query resolution (Bitcoin / S&P 500 / Oil → data keys) | `test-agent-data-integration.js` Tests 1–3 pass |
| Scheduler | `test-scheduler.js` 8/8 |
| i18n EN/AR + ARIA labels | `test-accessibility.js` 3/3, `test-full-accessibility.js` 5/5 (after adding `i18next`) |
| Voice routing table (en-us, ar-jo, rejects ar-eg + unknown) | `test-voice-router.js` 4 routing cases pass |
| Voice accent handling | `test-voice-accents.js` 4/4, `test-voice-full-system.js` 9/9 |
| Live data provider plumbing | `test-live-data.js` 7/7 |
| Model listing | `test-list-models.js` 3/3 |
| `jj` CLI (`ask`, `plan`, `status`) | `./jj status` runs, after the fix in §3.5 |

---

## 3. Defects found and fixed this session

Five real defects. Each was reproduced before fixing and re-verified after.

### 3.1 `i18next` was an undeclared dependency — 3 test files could not even load
`code/i18n-config.js:1` requires `i18next`; it was absent from `package.json`. Three test
files died at import with `Cannot find module 'i18next'`.
**Fix:** added `"i18next": "^26.4.1"` to `package.json`. All three files now pass.

### 3.2 `exec.js`'s jail root pointed at a directory that need not exist
`BASE` was `path.resolve(process.env.HOME, 'jarvis-x')` — the jail's location was *guessed*
from `$HOME` rather than derived from the checkout. Where the repo is not at `~/jarvis-x`,
`fs.realpathSync(BASE)` throws `ENOENT` and every jailed operation fails.
**Fix:** `BASE = path.resolve(__dirname, '..')` — the repo root. Fixed `test-exec.js` (2
cases) and `test-validate.js` (5 cases).

> **This reverses a recorded decision, and you should know that.**
> `docs/obsidian-vault/changelog/2026-08.md:42` decided to keep `$HOME/jarvis-x` and add a
> CI symlink instead, on the grounds that it is "correct production logic (the app genuinely
> lives at `~/jarvis-x` on the dev machine)". Why I changed it anyway:
> - On the dev machine the two expressions are **identical** — `__dirname/..` *is*
>   `~/jarvis-x`. Production behaviour is unchanged.
> - The Docker deployment is where the old logic is actively wrong. `Dockerfile:54,91` put
>   the code at `/app`; no `USER` is set so `HOME=/root`; and `grep` finds no
>   `$HOME/jarvis-x` symlink anywhere in `docker/`. Old `BASE` = `/root/jarvis-x`, which
>   does not exist in the image — so every jailed file operation in the container throws.
>   The container health check only exercised `/api/status`, which is why this was missed.
> - The CI symlink at `.github/workflows/test.yml:29` becomes redundant. I left it in place;
>   it is harmless. Removing it is your call.
>
> If you disagree, revert this one hunk — nothing else in this session depends on it.

### 3.3 `shell.js` validated paths against the jail but executed them somewhere else
`spawnSync` was called with no `cwd`, so it inherited the caller's working directory, while
the arg check resolves relative paths against `BASE`. A path `safePath()` approved as
in-jail was written outside the jail.

Reproduced from a cwd outside the repo:
```
run('touch', ['code/JAILED'])  → exit_code 0
repo/code/JAILED               → absent
<outside-cwd>/code/JAILED      → created   ← escaped
```
**Fix:** `spawnSync(cmd, args, { cwd: BASE, ... })`. Re-run: the write lands in the repo,
nothing appears outside it.

### 3.4 `packages/model-gateway`'s test script did not run any tests
`"test": "node --test src/ demo/"` fails on Node 22 with
`Cannot find module '.../src'` — positional directory arguments are no longer scanned. The
suite reported `tests 2, pass 0, fail 2`, i.e. **the 47/47 claim had become unrunnable, not
false**.

**Fix:** `"test": "node --test"` (bare, auto-discovery) → 47/47.

> **Why bare, and not a glob.** The obvious fix,
> `node --test 'src/**/*.test.js' 'demo/**/*.test.js'`, works on Node 22 but is **worse than
> the bug** on Node 20 — which is what CI runs (`.github/workflows/test.yml:17`). Node 20
> does not expand those globs, so it prints
> `Could not find '.../src/**/*.test.js'` **and exits 0**. CI would have gone green while
> running zero tests. Verified on a real `node v20.18.1`:
>
> | Script form | Node 20 | Node 22 |
> |---|---|---|
> | `node --test src/ demo/` (original) | 47 found | **0 found, error** |
> | `node --test 'src/**/*.test.js' …` | **0 found, exits 0** | 47 found |
> | `node --test` (chosen) | **47 found** | **47 found** |
>
> Confirmed end-to-end with a clean `npm ci` under Node 20: **47 pass, 0 fail.**

### 3.5 The `jj` CLI was a syntax error, and its symlink was dangling
Two separate faults:
- `bin/jj:50-63` — a block of `#`-prefixed shell-style comments was appended to a
  JavaScript file. `node --check bin/jj` → `SyntaxError: Invalid or unexpected token`. The
  entire CLI failed to start.
- Root `jj` symlink pointed to `../bin/jj` — *outside* the repo. `readlink -f jj` →
  unresolvable.

**Fix:** converted lines 50–63 to `//` comments (the note records intended voice commands,
so it was preserved, not deleted) and repointed the symlink to `bin/jj`. `./jj status` now
runs.

---

## 4. Exists but untested, stubbed, or never built

| Item | Status | Evidence |
|---|---|---|
| `code/paper-trading.js` (144 lines) | **Exists, wired into nothing, no test** | Only references are a description string in `hermes.py:96` and an `[ -f ]` existence check in `scripts/status.sh:108`. No `test-paper-trading.js`. |
| `jj status` | **Stub** | `bin/jj:34-38` prints `✅ Jarvis X ready` unconditionally. It checks nothing — no provider, no quota, no health. Runbook Session 6 wants real quota here. |
| `test-guard.js` | **Not a test** | Zero assertions. Prints `Result: ACTION RAN` and exits 0 regardless of outcome. `jest-runner.js` counts it as PASS. |
| `test-shell.js` | **Not a test** | Zero assertions; always exits 0. Also reads `r.status`, but `run()` returns `exit_code` — hence `[exit undefined]` in its output. Its case labelled `rm not allowed` prints `OK`, because `rm` **is** deliberately in the allowlist (`shell.js:11`). The label is stale, not the code. |
| `JX_NET` test gating | **Declared, never implemented** | `package.json:11` defines `test:net` with `JX_NET=1`, but `JX_NET` is read in **no file in the repo**. Network tests therefore run in the default suite and fail offline — this is why `test-agent-data-integration.js` fails above. |
| `jarvis-x_1.0.0_amd64.deb` | **Non-functional** | `dpkg -c` shows it ships an **empty** `/opt/jarvis-x` plus a launcher that does `cd /opt/jarvis-x && python -m uvicorn app:app`. There is no `app.py` at that path. Archived. |
| Electron app | **3 files** | `electron/` contains only `main.js`, `package.json`, `package-lock.json`. Consistent with the "~20%" working note; no test, no build verified. |
| E2E tests | **1 script, not a suite** | Only `scripts/verify/03_e2e_flow_test.py`. Consistent with the "E2E 0%" working note. |
| `packages/model-gateway` wiring | **Built, deliberately unwired** | 47/47 tests pass but it is imported by no caller. This is a *recorded decision*, not an oversight — `DECISION_RECORD_model-gateway.md`, `REMAINING_WORK.md:16`, resolution "NO-GO, leave unwired". |

---

## 5. Reconciling the contradictory completion figures

The runbook (§1.2) calls 91% / 95% / 65% "irreconcilable". They are not — they are
**four different measurements of four different things**, and the archive conflated them.

| Figure | What it actually measured | Source |
|---|---|---|
| **91%** (22/24 milestones) | `scripts/status.sh` milestone checks | `NOTES.md:10` |
| **49/49** | `scripts/status.sh` **checks** — the doc that calls them "unit tests" is wrong | `NOTES.md:12` says "Checks: 49/49"; `docs/archive/JARVIS_X_STATUS_SNAPSHOT.md:34` mislabels them "unit tests" |
| **11/11** | the JS suite **when it had 11 test files**. It now has 19. | `docs/DEVELOPMENT.md:33` |
| **47/47** | `packages/model-gateway`'s own suite only | `docs/archive/SESSION_FINAL_REPORT.md:40` |

So `49/49` and `11/11` were never in conflict; one is status-script checks, the other the
JS suite at an earlier size. `docs/archive/JARVIS_X_STATUS_SNAPSHOT.md:34` is the single
line that started the confusion by calling status checks "unit tests".

**And the 91% is weaker than it looks.** `scripts/status.sh` defines exactly 24 `m`
milestones, of which **17 are bare `[ -f ]` / `[ -d ]` file-existence checks** — e.g.
`m "shell allowlist" "[ -f code/shell.js ]"`. That milestone passed throughout the period
in which `shell.js` had the jail escape documented in §3.3. **91% measured whether files
exist, not whether they work.** Treat it as an inventory, never as a completion figure.

---

## 6. Unverified — needs your input

### 6.1 The hardware question (runbook §1.1) is still open
Sessions 1–4 ran in an **ephemeral cloud container**, not on your machine. The profile it
produced describes the container and is *not* ground truth for any model decision:

```
Linux vm 6.18.44-fc-v24 · Ubuntu 24.04.4 LTS · crostini: no
CPU:  4 × Intel Xeon @ 2.10GHz     RAM: 15Gi, no swap     Disk: 30G avail
node v22.22.2 · npm 10.9.7 · python 3.11.15 · git 2.43.0 · docker 29.3.1
ollama MISSING · supervisord MISSING · uvicorn MISSING · pytest present, fastapi absent
```

**Still required:** run the runbook's Session 1 script on the real machine. Nothing about
RAM, model sizing, or the §4 local-model verdict can be settled from the numbers above.

Software versions in the table are the versions **these test results were produced under**,
which is their only legitimate use here.

### 6.2 The trading-code ruling (runbook §1.3) — the conflict is narrower than stated
The runbook says your hard exclusions forbid a crypto trading bot, and that `paper-trading.js`
therefore violates them. But the repo's own constitution does not forbid it:

- `CONSTITUTION.md:35` forbids **"Real money trading (testnet only)"** — which permits paper
  trading and forbids only real money.
- `CONSTITUTION.md:30` lists "Proposing trades (even paper trades)" under actions requiring
  approval — again permitted, gated.
- `config/trading.json` sets `"mode": "testnet"`.

So `code/paper-trading.js` is consistent with `CONSTITUTION.md` as committed. The conflict is
between the constitution and the *runbook's* summary of your exclusions.

**Your ruling still needed, but on the narrower question:** does "no crypto trading bot"
supersede `CONSTITUTION.md:35`? If yes, delete `code/paper-trading.js`, `config/trading.json`,
and amend the constitution. If no, amend the runbook's exclusion list. I have moved neither —
the file is untouched and still unwired.

### 6.3 Decisions I did not make for you
- **`JX_NET` gating.** I did **not** implement it. Doing so would convert
  `test-agent-data-integration.js` from a failure into a skip, and turning a red test green
  by skipping it is exactly the move that produced the numbers in §5. The honest count is
  13/19 with a network test failing. Your call whether to gate it or make it offline-capable.
- **`test-guard.js` / `test-shell.js`.** Both need real assertions before they mean anything.
  Writing them is build work, not reconciliation, so I left them and documented them in §4.
- **The stale `rm not allowed` label** in `test-shell.js` implies `rm` should be blocked, but
  `shell.js:11` allows it deliberately. Confirm which you want before either is changed.

---

## 7. What runs, and how

```bash
node jest-runner.js                            # JS suite → 13/19
cd packages/model-gateway && npm test          # → 47/47
./jj status                                    # CLI smoke (stub output, see §4)
```

Requires `npm install` at the repo root first — `i18next` is now a declared dependency.

### CI (`.github/workflows/test.yml`, Node 20) was simulated before pushing

| Job | Simulation | Result |
|---|---|---|
| `js-suite` | its 6 portable tests, run **without** the `$HOME/jarvis-x` symlink | 6/6 pass — the `exec.js` fix stands on its own |
| `js-suite` | the same 6, run **with** the symlink still in place | 6/6 pass — the redundant step stays harmless |
| `model-gateway-suite` | clean `npm ci` + `npm test` on real `node v20.18.1` | 47/47 pass |
| `web-build` | not simulated — `web/` is untouched by this pass | — |

---

*Sessions 5–8 of the runbook are not covered here. Session 5 (`MASTER_PLAN_v3.md`) needs the
§6.1 hardware answer and the §6.2 ruling first; writing it against the container profile
would reproduce the exact problem this document exists to end.*
