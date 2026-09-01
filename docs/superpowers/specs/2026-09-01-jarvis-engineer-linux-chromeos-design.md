# Jarvis Engineer — Linux/ChromeOS Design

Status: draft (pending review)
Date: 2026-09-01
Author: Ahmed, drafted with Claude

## Context

`Jarvis_Master_Blueprint_v0.1.pdf` (`/mnt/chromeos/MyFiles/Downloads/`) is a
27-section pre-implementation design document for "Jarvis Engineer": a
local-first AI systems engineer that scans a device, correlates evidence,
ranks root causes, explains them in plain language, and (eventually)
executes and verifies safe fixes. It positions Jarvis Engineer as the
device-engineering half of one strategic platform with the existing Jarvis X
intelligence layer, Windows-first, with a Free/Pro monetization split.

A prior feasibility review found two real blockers to building the blueprint
as written: no Windows machine exists to build/test the Windows MVP against
(this project's only hardware is `penguin`, a Chromebook running Debian 12
under Crostini), and `/` is at 93% full, already fighting a disk-watchdog
cron. Two decisions came out of that review, confirmed directly by Ahmed:

1. **Retarget the platform scope to Linux + ChromeOS only.** Windows,
   macOS, Android, and iOS/iPadOS are dropped from this initiative entirely
   — not deferred, not phased in later. "ChromeOS" in practice means this
   tool running correctly inside the Crostini container it already lives
   in; there is no separate ChromeOS-native client in scope.
2. **No Free/Pro paywall on Linux/ChromeOS — everything ships free.** The
   blueprint's Free/Pro architecture concept is dropped for this platform,
   not merely unpriced. If a Windows/macOS build is ever pursued later
   under the original blueprint, that platform could carry a paywall —
   that would be a separate decision, not inherited from this spec.

Everything else in the blueprint — the product constitution, the Universal
Intelligence Workflow, the diagnostic philosophy, the full domain set
(storage/File Intelligence, Security & Privacy, Network, Hardware Health,
Health Index), the layered architecture, and the per-capability development
lifecycle — carries over unchanged, just retargeted to Linux/ChromeOS.

This document specs the full target architecture as the north star, but
**only fully specs the first implementation phase** (storage/space
diagnosis). Later phases get their own spec when their turn comes, per the
blueprint's own rule that no capability is implemented until it has been
individually researched, evidenced, and reviewed.

## Scope

**In (target architecture, all phases):** storage/space diagnosis, File
Intelligence (duplicates, safe-cleanup categories), Security & Privacy
Intelligence, Network Intelligence, Hardware Health (Linux-native
telemetry), a Health Index, and eventually Act (automated fixes) +
Verify — all on Linux/ChromeOS(Crostini), all free.

**In (this implementation plan, Phase 1 only):** storage/space domain,
read-only, Observe → Diagnose → Explain. No Act, no Verify, no Health Index
yet.

**Out, indefinitely:** Windows, macOS, Android, iOS/iPadOS; a Free/Pro
paywall; a ChromeOS-native (non-Crostini) client; Linked Devices and deep
Jarvis X integration; any UI beyond CLI text output.

**Out, deferred to a future phase/spec:** File Intelligence duplicates and
cleanup, Security/Network/Hardware domains, the Health Index, Act + Verify.

## Product constitution (carried over unchanged)

The blueprint's Section 5 constitution governs this build exactly as
written: local by default, privacy by design, diagnose before acting,
explain before changing, evidence before conclusions, minimum necessary
change, permission for consequential actions, rollback wherever technically
possible, verify after every repair, never pretend certainty where evidence
is incomplete, hardware diagnosis is never presented as hardware repair.

Concretely for Phase 1: this build makes **zero changes to the system**. It
observes and explains only.

## Architecture (target, all phases)

Retargets the blueprint's Section 18 layering into a Python package at
`code/engineer/`, following the existing `code/` convention:

```
code/engineer/
  core/
    scan.py        # orchestrator + CLI entrypoint (Observe -> Diagnose -> Explain -> print)
    state.py        # append-only scan-history snapshots, ~/.jarvis-x/engineer/history/*.jsonl
  evidence/
    __init__.py     # shared Evidence/Domain interface
    storage.py       # Phase 1 domain
    file_intel.py      # Phase 2 (not built yet)
    security.py         # Phase 3 (not built yet)
    network.py            # Phase 4 (not built yet)
    hardware.py             # Phase 5 (not built yet)
  diagnose.py                # rule-engine runner; imports one rules module per domain
  explain.py                  # local-LLM prose generation (all domains share this)
  actions/                      # placeholder package; empty until Act is unlocked (Phase 7)
```

**Core:** orchestration, CLI, and the local history store. No permission
model beyond "read-only" exists yet since no write actions ship until
Phase 7.

**Evidence layer:** one module per domain, each exposing a `collect()` that
returns a plain evidence dict. Anything the platform or the Crostini
container can't expose is an explicit `"unavailable": "<reason>"` entry, not
a silent omission — this is the blueprint's "platform limitations must be
surfaced clearly" rule (Section 8), applied here because Crostini has no
access to host-side SMART/battery/thermal data.

**Reasoning layer:** `diagnose.py` runs deterministic rules per domain,
producing a ranked list of findings; `explain.py` turns findings into the
three-section report. The rules decide the diagnosis; the LLM never does —
this matches the blueprint's "never pretend certainty" principle and keeps
diagnostic accuracy auditable independent of model quality.

**Finding schema** (every rule, every domain, matches blueprint page 5):
`issue, severity, evidence, probable_root_cause, confidence,
affected_components, recommended_action, risk, expected_result,
verification_method`.

**Action layer / Verification layer:** the package boundary
(`code/engineer/actions/`) exists now so Phase 7 slots in without a
restructure, but nothing lives there yet. Verification (rescan + compare)
only makes sense once actions exist, so it's deferred alongside it.

## Capability roadmap (retargeted Section 20)

| Phase | Domain | Status |
|---|---|---|
| 1 | Storage/space — Observe/Diagnose/Explain, read-only | **This implementation plan** |
| 2 | File Intelligence — duplicates, safe-cleanup categories, preview-only | Future spec |
| 3 | Security & Privacy Intelligence | Future spec |
| 4 | Network Intelligence | Future spec |
| 5 | Hardware Health — Linux-native only (`smartctl`, `/sys` thermal, `/sys/class/power_supply`); explicitly unavailable inside Crostini | Future spec |
| 6 | Health Index | Deferred until diagnostic accuracy across shipped domains is established — blueprint explicitly warns against a cosmetic vanity metric |
| 7 | Act + Verify (automated fixes) | Deferred until diagnostic reliability is proven per domain — Section 25's gate is about safety/quality, not pricing, so "fully free" does not pull this forward |
| — | Linked Devices, deep Jarvis X integration | Out of scope indefinitely |

Each future phase follows the blueprint's Section 21 lifecycle: research →
define evidence → define diagnosis → define safe actions → implement →
test → adversarial review → verify → document → release → measure → update
knowledge. Skipping straight to "implement" for a domain without that
research step is exactly what the blueprint's Section 21 warns against
("do not implement a feature simply because an API exists").

## Phase 1 detailed design — Storage domain (the actual next build)

**Evidence (`evidence/storage.py`):** overall usage via
`shutil.disk_usage("/")`; size of a fixed candidate-path list (jarvis-x's
own subdirectories, `venv-ai`, the Ollama models directory, `~/.cache`,
pip/npm/apt caches, Downloads); a growth check against the previous scan's
snapshot for the same paths.

**History (`core/state.py`):** each scan's evidence appends to
`~/.jarvis-x/engineer/history/storage-scans.jsonl` (append-only, matching
the existing `actions.jsonl`/`decisions.jsonl` convention) so the
growth-since-last-scan rule has something to compare against.

**Diagnosis (`diagnose.py`, storage rules):** deterministic, no LLM —
low-free-space thresholds, single-path space-hog detection, rapid-growth
since last scan, and known safe-to-review clutter (stale `.bak`/`.bak2`/
`.bak3` files and package caches — this repo already has literal examples:
`app.py.bak2`, `hermes.py.bak3`). Each rule emits one Finding.

**Explanation (`explain.py`):** turns the ranked findings into the
blueprint's required three sections — *What I found*, *What I recommend*,
*What I can do*. Uses `code/router.py`'s `Router().resolve("local")` to get
the model name (`qwen2.5:3b`) and POSTs directly to Ollama's
`http://localhost:11434/api/generate` — **not** through `hermes.py`'s
`HermesCore.ask()`. That was a deliberate correction during design: every
`HermesCore.ask()` call unconditionally writes into `~/.hermes/state.db`'s
`conversations` table, which `build_context()` later replays as real
prior-turn chat history. A diagnostic explain-step call is not a
conversational turn, so going through `HermesCore` would pollute real chat
history with scan output. The prompt instructs the model to use only the
given findings, invent nothing, and stay in plain language.

**CLI (`core/scan.py`):** `python3 code/engineer/core/scan.py` runs
Observe → Diagnose → Explain and prints the three-section report to the
terminal.

## Error handling

- Ollama unreachable or errors: print the structured findings without
  prose, clearly labeled as such — never fail silently, never fabricate an
  explanation.
- Evidence unavailable in this environment (Crostini boundary): reported as
  an explicit field, always visible in the CLI output, not dropped.

## Security model (carried over, scoped to what applies now)

Phase 1 requests no write/repair permissions and touches no `guard.js`
gating, since it performs zero actions. Diagnostic history under
`~/.jarvis-x/engineer/history/` can contain sensitive path/filename
information — stays local, never transmitted, same as the rest of
jarvis-x's local-first posture. When Phase 7 (Act) is eventually
specced, it must separate read-only observation permissions from repair
permissions and gate consequential actions behind `guard.js`-style human
approval, per the blueprint's Section 23 — noted here as a future
requirement, not built now.

## Testing

- `diagnose.py` rules: pure functions over evidence dicts — pytest unit
  tests with synthetic fixtures, matching the existing convention (e.g.
  `test_app_generation_lock.py`).
- `evidence/storage.py`: integration-style test against a temp-dir fixture
  plus a manual run against the real machine (it shells out to real
  `du`/`df`/`shutil.disk_usage`).
- `explain.py`: unit test with a stubbed Ollama response for the prompt/
  parsing logic; a real end-to-end run against the local model is a manual
  smoke-test step, not part of the automated suite.

## Explicitly out of scope for this spec

Windows/macOS/Android/iOS; the Free/Pro paywall; a ChromeOS-native
(non-Crostini) client; Act/Verify automation; the Health Index; Linked
Devices/Jarvis X integration; any UI beyond CLI text; File Intelligence
duplicate-detection (Phase 2); Security/Network/Hardware domains (Phases
3–5).
