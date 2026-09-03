# Jarvis X — MASTER PLAN v3

**Date:** 2026-09-03 · **Supersedes:** `MASTER_PLAN_UPDATED.md` (2026-08-12), `PLAN.md`
**Evidence base:** `AS_BUILT.md`, `QUANTUM_FEASIBILITY.md`, `docs/triage/2026-09-repo-triage.md`
**Method:** runbook §5 — phase weights Planning 15 / Setup 10 / Build 45 / Test 20 / Delivery 10

`MASTER_PLAN_UPDATED.md` says "Week 2 complete, ready for Week 3." The repo now
holds a 39 KB `app.py`, a React `web/`, `sentinel/`, `packages/model-gateway`
(47/47), and an Electron shell. That plan is three weeks stale; this replaces it.
Old plans are archived, not deleted.

---

## 1. Hardware — settled, by direct measurement

The runbook §1.1 called this open across four candidate machines. Two sources now
agree: the repo's own record (`MASTER_PLAN_UPDATED.md:45`, sourced from
`WEEK_1_COMPLETE.md`) and a live reading taken on the machine on 2026-09-03
(`AS_BUILT.md` §6.1).

| Property | Value | Source |
|---|---|---|
| Machine | Asus Chromebook | `WEEK_1_COMPLETE.md` via `MASTER_PLAN_UPDATED.md:45` |
| CPU | Intel i5-1135G7, 8 vCPU | same; **confirmed live** by `nproc` → 8 |
| RAM | **14 GB** | same; **confirmed live** by `free -h` (14Gi total, 12Gi available) |
| Disk | **72 GB, 3.9 GB free (95% used)** | `df -h $HOME`, 2026-09-04 — **the binding constraint**; was 6.0 GB / 92% on 2026-09-03, before the Ollama reinstall cost ~2.1 GB. Re-run `df` before spending disk; this row has moved once already |
| GPU | none | same |
| OS | Crostini, Debian 12, kernel 6.6.119 | same |
| Ollama | 4 models: `moondream`, `qwen2.5-coder:7b`, `SILMA-9B-Instruct` (Q4_K_M), `nomic-embed-text` | `ollama list`, 2026-09-04 (`AS_BUILT.md` §1) — the `qwen2.5:7b + 3b` set `WEEK_1_COMPLETE.md` records is stale |

**The 7.7 GB figure was a different machine.** `00-repo-spec.md` describes a
Lenovo Y50-70 — not the dev box. That single mismatch generated most of the
runbook's four-machine confusion.

**Consequence:** model sizing should assume **14 GB, no GPU**, not 7.7 GB. This
does not overturn runbook §4 — 7B–14B coding models at long context are still
out of reach on CPU, and the RTX 3060 12 GB remains the unlock.

**Disk, not RAM, is the binding constraint.** The live reading confirmed 14Gi RAM
with 12Gi available — comfortable headroom — but `df -h $HOME` shows **6.0 GB free
of 72 GB, 92% used**. RAM was the question the runbook posed; it is answered and it
is not the limit. Anything that spends disk (model downloads, new dependencies) must
be sized against current free space, not this figure. That is what settles the OCR
question in §3.

**Update, 2026-09-04:** fixing `test-vision.js` (§2) required reinstalling Ollama,
which cost ~2.1 GB of its own binaries (no model re-pulled). `df -h $HOME` now
reads **3.9 GB free, 95% used** — re-check `df` before spending more disk; the
6.0 GB figure above is one day stale already.

---

## 2. Completion: 66%

One number, derived from the runbook's weights. **The weights are the runbook's;
the per-phase scores are judgment anchored to cited evidence, not measurements** —
so treat 66% as a defensible estimate, not a reading off an instrument. Of the
five phases, only **Test** moved from the prior 65% total (62% originally), and
only as far as this session's measurements on Ahmed's machine justify
(`AS_BUILT.md` §1–§2, 2026-09-03 and 2026-09-04) — the other four phase scores
are unchanged.

| Phase | Weight | Score | Contribution | Basis |
|---|---|---|---|---|
| Planning | 15 | 90% | 13.5 | `CONSTITUTION.md`, 4 decision records, `AS_BUILT.md`, this plan, triage — all current |
| Setup | 10 | 85% | 8.5 | Toolchain, Ollama + 4 models, Piper/Kokoro voices, Docker image builds and reaches healthy, CI green on 3 jobs |
| Build | 45 | 60% | 27.0 | Verified: path jail, validation (23/23), data layer, scheduler, i18n/a11y, voice routing, model-gateway (47/47), `jj` CLI, FastAPI app, TTS engine. Missing/stubbed: Electron (3 files), `jj status` stub. (`paper-trading` and `JX_NET` left this list on 2026-09-04 — one deleted, one gated — but the score is unchanged: removing a stub and fixing a dead flag are cleanup, not build progress.) |
| Test | 20 | 65% | 13.0 | Measured on Ahmed's machine: JS suite **20/20** (up from 19/20 on 2026-09-03, up from 13/19 in the original container run). The one remaining gap from the prior score — `test-vision.js` — is now fixed: Ollama's install was missing its `llama-server` binary; reinstalling it (no model re-pulled) brought vision to 3/3 and the full suite to 20/20 (`AS_BUILT.md` §1). model-gateway unchanged at 47/47. **Not moved, and still the dominant reason this isn't higher:** `test-guard.js`/`test-shell.js` are still zero-assertion stubs that pass unconditionally, the Python suites (`sentinel`, app-lock) are still entirely unverified, and E2E is still one script — none of that was touched by this pass, and it's a bigger gap than the one JS file that just got fixed |
| Delivery | 10 | 40% | 4.0 | Docker works; `.deb` ships an empty `/opt/jarvis-x`; remote access is git-only; `web/` builds |
| | | | **66.0%** | |

**Why not 91%.** That figure was `scripts/status.sh`'s 22/24 milestones, and
**17 of its 24 checks are bare `[ -f ]` file-existence tests** — one of which
passed happily while `code/shell.js` held the jail escape fixed in PR #2. It
measured file presence, not function. `AS_BUILT.md` §5 has the full
reconciliation of all four historical figures.

**Why the move from 65% to 66% is small despite the JS suite going fully
green.** All six previously-unmeasured subsystems now pass, including vision —
the full optimistic case this section once forecast. But the forecast's own
premise was that Test's score was capped mainly by those six unknowns; in
practice `test-guard`/`test-shell`'s zero assertions, the unverified Python
suites, and the thin E2E script were already the larger, unchanged discount
before this fix, and remain exactly as large now. Closing the last 1 of 20 JS
files moves the total by one point, not several.

**Biggest remaining uncertainty:** Build (unchanged — Electron, `jj status`) and the three Test-quality gaps just listed. The six
previously-unmeasured subsystems are now fully resolved and are no longer an
uncertainty at all.

---

## 3. Where the plan conflicts with the hard constraints

| Conflict | Status |
|---|---|
| **Paper trading** | **Ruled 2026-09-04: delete.** `code/paper-trading.js` and `config/trading.json` removed; `CONSTITUTION.md` §IV now forbids "trading of any kind, real or simulated" instead of permitting a testnet carve-out, and §III no longer gates trade proposals. Git history retains the code. |
| **Remote access via `0.0.0.0`** | Rejected. Every binding in the repo is deliberately `127.0.0.1`, port 8000 is already held by the live deployment, and runbook §7 forbids exposure. Git stays the sync layer. |
| **Local coding models to replace Claude Code** | Unchanged from runbook §4: not viable on CPU. Gemini CLI free tier is the out-of-limit answer. |
| **`JX_NET` gating** | **Ruled 2026-09-04: gate it.** Implemented in `code/test-net.js`; `test-agent-data-integration.js` now skips unless `JX_NET=1`. A skip is counted in its own column and can never read as a pass — the objection that gating hides a red test is answered by the reporting, and the test passes on Ahmed's machine anyway, so nothing red is being hidden. |
| **Quantum in the request path** | Rejected on measurement: 889× slower, less accurate than the shipped keyword matcher. `QUANTUM_FEASIBILITY.md` §5. Kept as a gated research track. |

---

## 4. The quantum track

Built and committed in `quantum/`. **Not wired into the request path**, and the
data is why — see `QUANTUM_FEASIBILITY.md`.

What is settled: local no-API quantum simulation **works** (8 qubits, 9 ms,
offline, free). The request-path ceiling is **16 qubits**; 24 qubits costs 8.4 s
and 805 MB. The `LLM → circuit → tone` design is `cos(θ)` to 1.45e-16 and is now
pinned as a failing-if-reintroduced test. A properly trainable VQC, given every
advantage, still loses to a zero-parameter keyword matcher — because the binding
constraint is **64 training queries**, not qubits.

**Promotion gate — all four, or it stays out of the request path:**
1. ≥ 500 real queries from `logs/queue.jsonl`
2. Beats the keyword matcher on the same split
3. Beats classical softmax on identical features *(the one that matters — a tie means ship classical, at 1/889th the cost)*
4. p95 < 50 ms on Ahmed's hardware

---

## 5. Re-sequenced work, in 1–3 hour tasks

Ordered by value per hour against the §2 evidence. **Per Ahmed's own rules:
income work first — if Outlier/Upwork hours aren't done this week, they precede
all of this.**

### Tier 1 — buy real information (do these first)

| # | Task | Hours | Why it's first | Done when |
|---|---|---|---|---|
| 1 | ~~Run the JS suite on the dev machine~~ | 0.5 | Converts the 6 unmeasured subsystems into knowns. Highest information per minute in the whole plan. | **Done, 2026-09-03.** `node jest-runner.js` → 19/20; `AS_BUILT.md` §1–§2 updated |
| 2 | ~~Confirm hardware with the Session 1 script~~ | 0.25 | Closes §1 empirically | **Done, 2026-09-03**, via `free -h` / `nproc` / `df -h $HOME` directly rather than the runbook's Session 1 script — no separate `~/PROFILE.md` was produced; the same numbers are recorded in `AS_BUILT.md` §6.1 |
| 3 | ~~Rule on paper trading + `JX_NET`~~ | 0.25 | Two one-line answers unblock §3 | **Done, 2026-09-04.** Delete / gate; both carried out, see §3 |
| 4 | Give `test-guard`/`test-shell` real assertions | 1.5 | Both have **zero** assertions and pass unconditionally. `test-shell` is the file that would have caught the jail escape. | Both assert; both fail if reverted |

### Tier 2 — close the real gaps

| # | Task | Hours | Why | Done when |
|---|---|---|---|---|
| 5 | Make the `.deb` ship `app.py` | 2 | Currently installs an empty `/opt/jarvis-x`; the launcher cannot work | `dpkg -i` then launch succeeds |
| 6 | Decide `JX_NET`: gate or make offline-capable | 1.5 | Makes the suite deterministic offline | 19/19 or an explicit skip contract |
| 7 | Real `jj status` | 2 | Prints `✅ Jarvis X ready` unconditionally today; runbook Session 6 wants live quota | Shows per-provider quota + health |
| 8 | Per-provider quota counters in SQLite | 3 | Runbook Session 6 proper: free-tier ceilings with 429 fallback | Counters persist; fallback verified |
| 9 | Install Piper voices / Ollama wherever task 1 showed gaps | 1–2 | Turns unmeasured into passing | Formerly-failing tests pass |

### Tier 3 — extend

| # | Task | Hours | Why | Done when |
|---|---|---|---|---|
| 10 | Build the 500-query dataset from `logs/queue.jsonl` | 2 | Quantum gate 1 — and it improves the **classical** router regardless | `quantum/data/` has ≥500 real queries |
| 11 | Re-run the benchmark on the real dataset | 1 | Lets gates 2–4 decide on evidence | Results appended to the study |
| 12 | Electron shell to a launchable app | 3 | 3 files today | Window opens, talks to the API |
| 13 | E2E flow test | 2.5 | One script today | Ask → answer → audio, asserted |

**Explicitly not scheduled:** local 7B+ coding models (§3), LAN/internet
exposure (§3), a quantum model in the request path (§4), quantum circuits > 16
qubits for anything user-facing.

---

## 6. What would change this plan

- **Task 1 is done** (§5). Measured 2026-09-03: 5 of the 6 previously-unmeasured
  subsystems passed in full; the 6th (vision) failed for a newly-diagnosed
  reason (Ollama's install was missing its `llama-server` binary, not a
  missing model). Fixed 2026-09-04 — reinstalled Ollama, no model re-pulled,
  JS suite now 20/20. §2 moved to only 66%, still short of the ~70% forecast
  here, because that forecast under-weighted `test-guard`/`test-shell`'s
  zero-assertion stubs and the unverified Python/E2E gaps, which this pass
  didn't touch and which turned out to be the bigger constraint than the six
  subsystems ever were.
- ~~A ruling against paper trading.~~ **Made 2026-09-04**, and carried out:
  both files deleted and `CONSTITUTION.md` amended.
- **The RTX 3060 12 GB.** Unlocks local 14B coding models (runbook §4) *and*
  lifts the quantum ceiling from 16 to ~24+ qubits, which would make gate 4
  reachable and is the one purchase that changes two constraints at once.
- **Task 10's dataset.** The single input most likely to overturn
  `QUANTUM_FEASIBILITY.md` §5.

---

*Superseded docs keep their history. `MASTER_PLAN_UPDATED.md` and `PLAN.md` are
Session 5 inputs, archived rather than deleted, per the triage rule.*
