# Jarvis X — AS-BUILT

**Generated:** 2026-09-03 · **Supersedes:** every completion percentage in the archive
**Method:** Sessions 1–4 of `JARVIS_X_REBUILD_RUNBOOK.md`, run against commit `8643e6e`,
with §1 and §6.1 re-measured 2026-09-03 directly on Ahmed's machine (post-merge, commit
`13efc52`) rather than the ephemeral cloud container Sessions 1–4 ran in, and §1's
`test-vision.js` entry updated again 2026-09-04 after fixing the Ollama install it found.

Every claim below cites a command output, a file path, or a test name. Claims that could
not be verified are quarantined in [§6 Unverified](#6-unverified--needs-your-input) rather
than estimated.

---

## 1. The headline number

**20 of 20 JavaScript test files passed on Ahmed's machine, 2026-09-04. 47 of 47
model-gateway tests pass.** The default `npm test` reports **19 passed, 1 skipped** — the
skip is `test-agent-data-integration.js`, gated behind `JX_NET` (§4). It passes; it is simply
not run without the network. `npm run test:net` runs all 20.

**The suite is now 21 files.** `code/test-paper-trading.js` was added later the same evening
with the rebuilt paper module (§6.2) — **22 assertions, all passing**, verified in the build
container, which is sufficient because that suite is fully offline by construction. The
21-file run has not been repeated on Ahmed's machine; the five files that need local Piper,
Kokoro and Ollama are unaffected by this change, so 21/21 there is expected but unmeasured.

That is the whole of what the tests prove. There is no single "percent complete" figure in
this document, because nothing measured here produces one — see §5 for why the old ones did
not either.

| Suite | Command | Result |
|---|---|---|
| JS suite, default | `npm test` | **19 passed, 0 failed, 1 skipped** — network test gated. Verified on Ahmed's machine 2026-09-04; when this row was written it was an inference from a container run (14 passed, 5 failed, 1 skipped there), not a measurement |
| JS suite, with network | `npm run test:net` | **20 passed, 0 failed** (exit 0), measured 2026-09-04 |
| model-gateway | `npm test` in `packages/model-gateway` | **47 passed, 0 failed** |
| Python — sentinel | `pytest sentinel/tests/test_smoke.py` | not verifiable (deps absent) |
| Python — app lock | `pytest test_app_generation_lock.py` | not verifiable (`fastapi` absent) |
| web build | — | not verifiable (`web/node_modules` absent) |

Before the fixes in §3, the JS suite was **9 passed, 10 failed**. At the time §1 was first
written (ephemeral container, Sessions 1–4) it stood at **13 passed, 6 failed** out of 19
files; the suite grew to 20 files (`test-watcher.js` added), and a day-1 re-measurement on
the real machine (2026-09-03) found **19 passed, 1 failed** — only `test-vision.js` still
red, and for a reason distinct from the other 5 (below).

### `test-vision.js` is now fixed — the real cause was a broken local Ollama install, not a missing model

The original **13/19** entry assumed all 6 then-failing files were blocked by missing local
dependencies (Ollama, Piper voices, Kokoro, network). That assumption was right for 5 of the
6 (§2) and wrong for the 6th. Measured directly on Ahmed's machine, 2026-09-03:

- `code/vision.js:3` requests `moondream`; `ollama list` showed `moondream:latest` already
  present (1.7 GB) — so the failure was never a missing model.
- `node code/test-vision.js` → `Vision failed: Ollama returned 500` on all 3 cases. Direct
  `curl localhost:11434/api/generate -d '{"model":"moondream","prompt":"test","images":[]}'`
  → HTTP 500, body: `"error starting llama-server: llama-server binary not found (checked:
  /usr/local/lib/ollama/llama-server, ...)."`
- `ls -l /usr/local/lib/ollama/llama-server` confirmed the file was absent. Ollama's own
  binary distribution was incomplete on this machine — the server component every model
  (not just moondream) depends on to run inference was simply not there.

**Fix, 2026-09-04:** reinstalled Ollama via the same bootstrap the repo already uses
(`bootstrap/install.sh:36`): `curl -fsSL https://ollama.com/install.sh | sh`. This
overwrites Ollama's own binaries/libraries only — it does not touch `OLLAMA_MODELS`
(`/usr/share/ollama/.ollama/models`), so no model was re-downloaded. Deliberately **not**
done: the `cmake -S llama/server --preset cpu && cmake --build --preset cpu` the 500's own
error message suggests — that needs build tooling and disk headroom this machine doesn't
have to spare (§6.1).

**Verified after the fix:**

| Check | Command | Result |
|---|---|---|
| Binary present | `ls -l /usr/local/lib/ollama/llama-server` | Present — genuine ELF executable (`file` confirms `ELF 64-bit LSB executable, x86-64, dynamically linked`), not a stub |
| Models intact, nothing re-fetched | `ollama list` | Same 4 models as before the reinstall: `moondream:latest`, `qwen2.5-coder:7b`, `hf.co/bartowski/SILMA-9B-Instruct-v1.0-GGUF:Q4_K_M`, `nomic-embed-text:latest` — same IDs and sizes |
| Service healthy | `systemctl status ollama` | `active (running)`, started cleanly post-reinstall |
| Inference works for a non-vision model too | `ollama run qwen2.5-coder:7b "hi"` | Responded ("Hello! How can I assist you today?") in ~28s — confirms the breakage was Ollama-wide, not moondream-specific |
| Vision test | `node code/test-vision.js` | **3/3 passed** |
| Full JS suite | `node jest-runner.js` | **20/20 passed** |

**Cost:** `df -h $HOME` before the reinstall: `72G total, 6.0G avail, 92% used`. After:
`72G total, 3.9G avail, 95% used` — the reinstall itself cost **~2.1 GB** (the current
Ollama release ships a `libggml-cpu-*.so` per CPU microarchitecture plus CUDA/Vulkan
scaffolding even though this machine uses none of it — `du -sh /usr/local/lib/ollama` →
2.1 GB). No model was re-pulled; the entire cost is Ollama's own binaries. **Disk is now
tighter than before this fix (3.9 GB free, 95% used) — see §6.1.**

**Correction to the task that requested this fix:** it was framed as explaining the outage
in commit `8643e6e` ("real outage, not hypothetical"). Reading that commit: its outage was
a **supervisord crash-loop** from a missing `logs/supervisord/` directory failing
supervisord's own startup validation for the (already-disabled) `ollama_DISABLED` stanza —
unrelated to the `llama-server` binary or Ollama's ability to serve models. The two are
separate incidents; this fix does not "explain" `8643e6e`, and nothing here has been written
into the docs claiming otherwise. `config/supervisord.conf`'s `ollama_DISABLED` stanza
(`autostart=false`, systemd owns the process now) is unaffected by today's fix and doesn't
need revisiting on this basis.

---

## 2. What exists and is verified working

| Component | Evidence |
|---|---|
| Path jail (`code/exec.js`) | `test-exec.js` 2/2 after fix |
| Action validation (`code/validate.js`) | `test-validate.js` **23/23** after fix |
| Model gateway — breaker, budget, store, telemetry, tier policy | `packages/model-gateway` **47/47** across 8 `*.test.js` files |
| Data layer + provider registry | `test-data-layer.js` 5/5; registers market, crypto, energy, news |
| Query resolution + response building + graceful degradation (Bitcoin / S&P 500 / Oil → data keys) | `test-agent-data-integration.js` **5/5**, measured on Ahmed's machine (`node code/test-agent-data-integration.js`) — the CoinGecko 403 that blocked Test 4 in the container no longer reproduces here |
| Scheduler | `test-scheduler.js` 8/8 |
| i18n EN/AR + ARIA labels | `test-accessibility.js` 3/3, `test-full-accessibility.js` 5/5 (after adding `i18next`) |
| Voice routing, including real Piper TTS round-trips | `test-voice-router.js` **8/8** on Ahmed's machine (`node code/test-voice-router.js`) — the 4 routing-table cases plus all 4 end-to-end audio cases (en-us, en-gb, ar-jo, ar-gulf); en-gb is the case `docs/DEVELOPMENT.md:33` flags as historically flaky for this test family and it passed cleanly this run, no re-run needed |
| Voice accent handling (Piper) | `test-voice-accents.js` 4/4, `test-voice-full-system.js` 9/9, `test-voice.js` **3/3** on Ahmed's machine (en_US-amy, ar_JO-kareem, ar-AE-emirati-female all round-trip) |
| Voice interaction (transcription + language routing) | `test-voice-interaction.js` **4/4** on Ahmed's machine (`node code/test-voice-interaction.js`) — English and Arabic transcription, both language routes |
| Kokoro accent synthesis | `test-kokoro.js` **5/5** on Ahmed's machine (`node code/test-kokoro.js`) — American, British and Australian-fallback accents round-trip; unknown accent correctly rejected |
| Vision (`code/vision.js`, Ollama `moondream`) | `test-vision.js` **3/3** on Ahmed's machine, 2026-09-04 (`node code/test-vision.js`), after reinstalling Ollama to restore its missing `llama-server` binary — see §1 |
| Live data provider plumbing | `test-live-data.js` 7/7 |
| Model listing | `test-list-models.js` 3/3 |
| Watcher (page-diff monitor) | `test-watcher.js` — file added since the container session, passes as part of the 20/20 measured above |
| `jj` CLI (`ask`, `plan`, `status`) | `./jj status` runs, after the fix in §3.5 |
| Paper trading, limits enforced (`code/paper-trading.js`) | `test-paper-trading.js` **22/22** — sizing derived from `riskPerTrade / stopLoss`, daily loss lockout, kill switch, allowlist |
| Price history + range signals (`code/market-analyst.js`) | `test-market-analyst.js` **26/26**, offline. Returns `insufficient` below 20 observations and one test fails the build on forward-looking language in any verdict |
| Live price collection, mock-filtered (`code/market-collect.js`) | `test-market-collect.js` **11/11**, offline. Refuses any price not tagged with a real provider source |
| Trade recommendations that cannot execute (`code/trade-advisor.js`) | `test-trade-advisor.js` **15/15** — includes a Proxy tripwire that throws if `book.open()` or `book.close()` is touched |
| Market brief CLI (`code/market-brief.js`) | `test-market-brief.js` **5/5**; also `hermes --market` |
| Hermes market context injection | `test_hermes_market_context.py` **11/11** (pytest) — injection, ordering above untrusted history, and the three unavailable-paths |
| Scheduler supervisor, AVO-derived (`code/supervisor.js`) | `test-supervisor.js` **20/20**, offline. Asserts the module contains no write, spawn or unlink primitive at all |

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

### 4.0 The market history is empty, and the data layer is why

Measured in-container, 2026-09-04, `node code/market-brief.js --collect`:
**0 of 6 instruments recorded a live price.**

| Instrument | Result | Cause |
|---|---|---|
| gold | skipped | EIA publishes no gold series; `energy-provider.js` hardcodes 2050.0 and says so. **No live source exists at all** — a keyless fallback was attempted and did not work; see §4.0.1. |
| sp500, nasdaq | skipped | `ALPHAVANTAGE_API_KEY` not set → provider served its MOCK constant |
| oil | skipped | `EIA_API_KEY` not set → MOCK constant |
| btc, eth | error | CoinGecko HTTP 403 from this container's egress proxy |

Every provider in `code/providers/` silently substitutes a hardcoded MOCK when
its key is missing, tagged `source: 'mock'`. `market-collect.js` refuses to
record those, which is why the number is 0 and not 4: a range built from
constants would show gold at exactly 0.00% volatility forever and the analyst
would report `hold` with total confidence and no information.

**Now measured on Ahmed's machine, 2026-09-04 01:56 UTC.** `node
code/market-brief.js --collect` on the Chromebook: **2 of 6 recorded** — btc
80966 and eth 2504.9, both `LIVE` from CoinGecko. The 403 above was this
container's egress proxy, not CoinGecko. `logs/market-history.jsonl` holds 2
rows; the recorder works end to end.

The other four behaved exactly as designed and refused: the run printed
`[energy] MOCK (no EIA gold series)`, `[market] MOCK (ALPHAVANTAGE_API_KEY not
set)` twice and `[energy] MOCK (EIA_API_KEY not set)`, and none of those four
reached the history file. Same run, full suite on that machine: **25 passed, 0
failed, 1 skipped** — the five container failures were environment, not code.

btc and eth need 19 more daily runs each before any verdict but
`insufficient`.

### 4.0.1 The keyless fallback — attempted, and it failed

`code/providers/stooq-provider.js` was written to close all four gaps at once:
Stooq needs no API key, so in principle it takes collection from 2 of 6 to
6 of 6 with no paid subscription.

**Probed on Ahmed's machine, 2026-09-04. All four symbols returned HTTP 404.**

```
gold    FAIL  xauusd  Stooq HTTP 404
sp500   FAIL  ^spx    Stooq HTTP 404
nasdaq  FAIL  ^ndx    Stooq HTTP 404
oil     FAIL  cl.f    Stooq HTTP 404
```

So **no instrument carries a `fallback`** in `config/trading.json`, and
`code/test-market-collect.js` asserts that none does. An unverified source does
not get to write history.

What the 404s do *not* settle is whether the endpoint is wrong or the four
codes are. A uniform 404 looks like a bad path, but Stooq may equally answer an
unknown symbol with 404 rather than the `N/D` row the parser expects. Fetching
a symbol known to exist (`aapl.us`) at the same URL separates the two; that has
not been run. `stooq.com` is blocked by the dev container's egress policy for
both `curl` and `WebFetch`, so this can only be measured on the Chromebook.

**Nothing was lost.** The failure was clean — 404 → logged error → no price
recorded — which is the design working. The provider and its 19 assertions
stay: the parser is correct regardless of which symbols turn out right, and the
collector's fallback mechanism is tested and working. Re-enabling is one config
line per instrument once `node code/providers/stooq-provider.js --probe`
reports 4 of 4.

**Still true, therefore:** btc and eth are the only two instruments that can
accumulate history. gold, sp500, nasdaq and oil need either API keys
(`ALPHAVANTAGE_API_KEY`, `EIA_API_KEY`) or a working keyless source, and gold
needs one that does not exist in this repo at all.

---

## 5. Reconciling the contradictory completion figures

The runbook (§1.2) calls 91% / 95% / 65% "irreconcilable". They are not — they are
**four different measurements of four different things**, and the archive conflated them.

| Figure | What it actually measured | Source |
|---|---|---|
| **91%** (22/24 milestones) | `scripts/status.sh` milestone checks | `NOTES.md:10` |
| **49/49** | `scripts/status.sh` **checks** — the doc that calls them "unit tests" is wrong | `NOTES.md:12` says "Checks: 49/49"; `docs/archive/JARVIS_X_STATUS_SNAPSHOT.md:34` mislabels them "unit tests" |
| **11/11** | the JS suite **when it had 11 test files**. It now has 20. | `docs/DEVELOPMENT.md:33` |
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

### 6.1 The hardware question (runbook §1.1) — now settled by direct measurement

Sessions 1–4 ran in an **ephemeral cloud container**, not on Ahmed's machine. That profile
(kept below for the software-version record) was never ground truth for a model or disk
decision:

```
Linux vm 6.18.44-fc-v24 · Ubuntu 24.04.4 LTS · crostini: no
CPU:  4 × Intel Xeon @ 2.10GHz     RAM: 15Gi, no swap     Disk: 30G avail
node v22.22.2 · npm 10.9.7 · python 3.11.15 · git 2.43.0 · docker 29.3.1
ollama MISSING · supervisord MISSING · uvicorn MISSING · pytest present, fastapi absent
```

**Measured directly on Ahmed's machine, 2026-09-03:**

| Command | Result |
|---|---|
| `free -h` | Mem: **14Gi total, 2.1Gi used, 9.5Gi free, 12Gi available**; Swap: 0B |
| `nproc` | **8** |
| `df -h $HOME` | `/dev/vdc`: **72G size, 65G used, 6.0G avail, 92% used** |

This corroborates `MASTER_PLAN_v3.md` §1's figures (14 GB RAM, 8 vCPU, sourced there from
`WEEK_1_COMPLETE.md`) against a live reading rather than an inherited record. RAM has
comfortable headroom (12 GB available of 14 GB). **Disk does not: only 6.0 GB is free out of
72 GB (92% used).** RAM was the open question the runbook posed; on these numbers it is
answered and is not the binding constraint — disk is. Any decision that spends disk (model
downloads, new dependencies — see `CAPABILITIES.md` §3.2 on OCR) should be sized against
current free space, not against the 14 GB RAM figure.

**Update, 2026-09-04:** the Ollama reinstall in §1 cost a further ~2.1 GB. `df -h $HOME`
now reads **3.9 GB avail, 95% used** — re-check `df` before sizing any future disk-spending
decision against the 6.0 GB figure above; it's stale by one day already.

Software versions in the container table above are the versions **the Sessions 1–4 test
results were produced under**, which is their only remaining legitimate use.

### 6.2 The trading-code ruling (runbook §1.3) — **settled 2026-09-04, after a reversal**

Ruled twice the same day. First: delete, on the basis that "no crypto trading bot"
supersedes the constitution's testnet carve-out. Then re-opened for a *built and tested*
paper module — a different question from whether to keep a dormant, unwired, untested one.
`DECISION_RECORD_paper-trading.md` carries the full reasoning; the short version is that
the net position ended **stricter than the original**.

The first ruling, carried out:

- `code/paper-trading.js` and `config/trading.json` **deleted**.
- `CONSTITUTION.md` §IV set to forbid "Trading of any kind, real or simulated"; it
  previously read "Real money trading (testnet only)", which permitted paper trading.
- `CONSTITUTION.md` §III's gate on "Proposing trades" removed.
- `hermes.py`'s description override and `scripts/status.sh`'s `[ -f ]` milestone for the
  file are removed (milestones 24 → 23, so the ratio is not distorted by dropping a check
  that used to pass).
- `NOTES.md`, `README.md` and the Obsidian glossary updated; `NOTES.md`'s deferred `paper.js`
  entry removed.

Deleted rather than archived, as instructed — git history retains both files.

**Then re-opened, same evening.** Both filenames exist again, rebuilt from scratch rather
than restored: `config/trading.json` names six permitted instruments (gold, S&P 500, Nasdaq,
oil, BTC, ETH) and `code/paper-trading.js` enforces every limit in it, with
`code/test-paper-trading.js` proving each one — **22 assertions, fully offline**. §IV now
forbids real-money trading and any instrument outside the six; §III gates paper-trade
proposals. `PaperBook` takes prices as arguments and opens no sockets, so no code path to a
broker exists.

The distinction that justified re-opening: the deleted module's limits lived in
`knowledge/Guidelines.md` under "Intended but NOT yet enforced", with no test file and no
caller. Prose limits are not limits. These execute.

**`knowledge/Guidelines.md`, and why it took a direct instruction.** That file's
§"Intended but NOT yet enforced" carried the old trading rules, but `NOTES.md:23` and
`README.md` name it **off-limits to Claude Code** via deny rules in
`~/.claude/settings.json` — on the principle that whatever can edit its own code must not
edit its own constraints. It was left alone until Ahmed asked for it directly, which is the
supervised case that rule exists to require. It now states the enforced paper-trading limits.
The deny rule on his machine still stands and may block a local session from the same edit.

**A second finding came out of opening it.** Its "Enforced in code" section told Jarvis its
shell allowlist was ten read-only commands: `ls cat head tail wc grep date pwd du df`.
`code/shell.js` actually allows **twenty**, including `rm`, `curl`, `wget`, `bash`, `python`
and `node`. Since that file's own instructions say *"Answer from this file directly; it is
already in your context"*, Jarvis would have told you it cannot run `rm`. It can. Corrected
and grouped the way `shell.js` groups them, so future drift between the two is visible.

### 6.3 Decisions I did not make for you
- **`JX_NET` gating.** Ruled on and implemented 2026-09-04 — see §4. The original
  objection (that gating converts a red test into a skip) is answered two ways: a
  skip is reported in its own column and never counted as a pass, and the test
  passes on Ahmed's machine anyway, so no red result is being concealed.

- **`test-guard.js` / `test-shell.js`.** Both need real assertions before they mean anything.
  Writing them is build work, not reconciliation, so I left them and documented them in §4.
- **The stale `rm not allowed` label** in `test-shell.js` implies `rm` should be blocked, but
  `shell.js:11` allows it deliberately. Confirm which you want before either is changed.

---

## 7. What runs, and how

```bash
node jest-runner.js                            # JS suite → 20/20 (Ahmed's machine, 2026-09-04)
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
