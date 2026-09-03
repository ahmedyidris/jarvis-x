# Jarvis X — MASTER PLAN v3

**Date:** 2026-09-03 · **Supersedes:** `MASTER_PLAN_UPDATED.md` (2026-08-12), `PLAN.md`
**Evidence base:** `AS_BUILT.md`, `QUANTUM_FEASIBILITY.md`, `docs/triage/2026-09-repo-triage.md`
**Method:** runbook §5 — phase weights Planning 15 / Setup 10 / Build 45 / Test 20 / Delivery 10

`MASTER_PLAN_UPDATED.md` says "Week 2 complete, ready for Week 3." The repo now
holds a 39 KB `app.py`, a React `web/`, `sentinel/`, `packages/model-gateway`
(47/47), and an Electron shell. That plan is three weeks stale; this replaces it.
Old plans are archived, not deleted.

---

## 1. Hardware — mostly settled, from the repo's own record

The runbook §1.1 called this open across four candidate machines. The repo
answers it: `MASTER_PLAN_UPDATED.md:45`, sourced from `WEEK_1_COMPLETE.md`,
records a **verified** profile.

| Property | Value | Source |
|---|---|---|
| Machine | Asus Chromebook | `WEEK_1_COMPLETE.md` via `MASTER_PLAN_UPDATED.md:45` |
| CPU | Intel i5-1135G7, 8 vCPU | same |
| RAM | **14 GB** | same; corroborated by `JARVIS X v2.pdf` diagnostics (8 cores, 14 GB) |
| GPU | none | same |
| OS | Crostini, Debian 12, kernel 6.6.119 | same |
| Ollama | 0.32.9, qwen2.5:7b + 3b | same |

**The 7.7 GB figure was a different machine.** `00-repo-spec.md` describes a
Lenovo Y50-70 — not the dev box. That single mismatch generated most of the
runbook's four-machine confusion.

**Consequence:** model sizing should assume **14 GB, no GPU**, not 7.7 GB. This
does not overturn runbook §4 — 7B–14B coding models at long context are still
out of reach on CPU, and the RTX 3060 12 GB remains the unlock.

**Still worth 5 minutes:** run the runbook Session 1 script on the machine to
confirm RAM and free disk today. Everything below holds at either 14 or 16 GB.

---

## 2. Completion: 62%

One number, derived from the runbook's weights. **The weights are the runbook's;
the per-phase scores are judgment anchored to cited evidence, not measurements** —
so treat 62% as a defensible estimate, not a reading off an instrument.

| Phase | Weight | Score | Contribution | Basis |
|---|---|---|---|---|
| Planning | 15 | 90% | 13.5 | `CONSTITUTION.md`, 4 decision records, `AS_BUILT.md`, this plan, triage — all current |
| Setup | 10 | 85% | 8.5 | Toolchain, Ollama + 4 models, Piper/Kokoro voices, Docker image builds and reaches healthy, CI green on 3 jobs |
| Build | 45 | 60% | 27.0 | Verified: path jail, validation (23/23), data layer, scheduler, i18n/a11y, voice routing, model-gateway (47/47), `jj` CLI, FastAPI app, TTS engine. Missing/stubbed: Electron (3 files), `jj status` stub, `paper-trading` unwired, `JX_NET` dead |
| Test | 20 | 45% | 9.0 | 13/19 JS files pass but **6 unmeasured**; `test-guard`/`test-shell` have **zero assertions**; Python suites unrunnable without deps; E2E is one script |
| Delivery | 10 | 40% | 4.0 | Docker works; `.deb` ships an empty `/opt/jarvis-x`; remote access is git-only; `web/` builds |
| | | | **62.0%** | |

**Why not 91%.** That figure was `scripts/status.sh`'s 22/24 milestones, and
**17 of its 24 checks are bare `[ -f ]` file-existence tests** — one of which
passed happily while `code/shell.js` held the jail escape fixed in PR #2. It
measured file presence, not function. `AS_BUILT.md` §5 has the full
reconciliation of all four historical figures.

**Biggest uncertainty:** Build and Test. Six subsystems (Ollama vision, three
voice paths, Kokoro, live data) are *unmeasured* rather than known-broken. If
they all pass on Ahmed's machine, Test rises materially and the total lands
nearer 70%.

---

## 3. Where the plan conflicts with the hard constraints

| Conflict | Status |
|---|---|
| **Paper trading** — `code/paper-trading.js` (144 lines) + `config/trading.json` exist | `CONSTITUTION.md:35` forbids only *real-money* trading ("testnet only"); `:30` permits gated paper trades; config is `"mode": "testnet"`. **No violation as committed.** Conflict is with the runbook's summary of the exclusions, not the code. **Needs a one-line ruling.** |
| **Remote access via `0.0.0.0`** | Rejected. Every binding in the repo is deliberately `127.0.0.1`, port 8000 is already held by the live deployment, and runbook §7 forbids exposure. Git stays the sync layer. |
| **Local coding models to replace Claude Code** | Unchanged from runbook §4: not viable on CPU. Gemini CLI free tier is the out-of-limit answer. |
| **`JX_NET` gating** | Dead flag: declared in `package.json:11`, read nowhere. Not implemented deliberately — gating the failing network test would convert a red test to a skip. **Needs a ruling.** |
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
| 1 | Run the JS suite on the dev machine | 0.5 | Converts the 6 unmeasured subsystems into knowns. Highest information per minute in the whole plan. | Output pasted; `AS_BUILT.md` §1 updated |
| 2 | Confirm hardware with the Session 1 script | 0.25 | Closes §1 empirically | `~/PROFILE.md` exists |
| 3 | Rule on paper trading + `JX_NET` | 0.25 | Two one-line answers unblock §3 | Rulings recorded |
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

- **Task 1's output.** If the 6 unmeasured subsystems pass, §2 moves to ~70% and
  Tier 2 shrinks. If they fail on the real machine too, they become Tier 1 bugs.
- **A ruling against paper trading.** Deletes `code/paper-trading.js`,
  `config/trading.json`, and needs a `CONSTITUTION.md` amendment.
- **The RTX 3060 12 GB.** Unlocks local 14B coding models (runbook §4) *and*
  lifts the quantum ceiling from 16 to ~24+ qubits, which would make gate 4
  reachable and is the one purchase that changes two constraints at once.
- **Task 10's dataset.** The single input most likely to overturn
  `QUANTUM_FEASIBILITY.md` §5.

---

*Superseded docs keep their history. `MASTER_PLAN_UPDATED.md` and `PLAN.md` are
Session 5 inputs, archived rather than deleted, per the triage rule.*
