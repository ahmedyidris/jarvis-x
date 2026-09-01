# Jarvis Engineer — File Intelligence (Phase 2) Design

Status: draft (pending review)
Date: 2026-09-01
Author: Ahmed, drafted with Claude

## Context

`docs/superpowers/specs/2026-09-01-jarvis-engineer-linux-chromeos-design.md` (the
retargeted master blueprint spec) names Phase 2 as File Intelligence —
duplicates, safe-cleanup categories, preview-only — and explicitly reserves
`code/engineer/evidence/file_intel.py` in its target architecture. Phase 1
(storage/space domain) shipped, merged to `master`, and its whole-branch
review confirmed the layered architecture (Core/Evidence/Reasoning/
Explanation) holds up cleanly with zero coupling between `diagnose.py` and
`evidence/storage.py` — this phase is the first real test of whether that
separation scales to a second domain.

Two scoping decisions came out of brainstorming for this phase, confirmed
directly by Ahmed:

1. **This slice covers safe-cleanup categories only — package-manager
   caches and old backup files — not duplicate-file detection.** Duplicate
   detection is new evidence-collection work (hashing) and a different
   kind of finding; it gets its own future phase/spec rather than being
   bundled into this one, matching the blueprint's own "one capability at
   a time" lifecycle.
2. **Scan scope is the whole home directory (`$HOME`), not just the
   jarvis-x repo.** Phase 1's `check_backup_file_clutter` rule was
   deliberately narrow (repo-scoped, because that's what a diagnostic tool
   living inside jarvis-x needed first). File Intelligence is a
   general-purpose device domain per the blueprint, so its backup-file
   check scans `$HOME` — reusing the same cheap approach (os.walk + stat,
   no hashing) so the wider scope doesn't materially change scan cost.

## Scope

**In:** two new File Intelligence rules — package-cache-size-over-threshold
(pip, npm, apt) and home-wide old-backup-file clutter — plus extending
`core/scan.py` to run both the storage and file_intel domains together in
one CLI invocation, merging findings into one report.

**Out:** duplicate-file detection (future phase), any actual deletion/
cleanup execution (Act is still deferred per Phase 1's spec, unchanged by
this phase), Security/Network/Hardware domains, the Health Index.

## Architecture

Extends `code/engineer/` per the target layout already named in the Phase 1
spec:

```
code/engineer/
  evidence/
    storage.py            # Phase 1 (unchanged)
    file_intel.py          # this phase — package caches + backup files
  diagnose.py                # Phase 1's storage rules (unchanged)
  diagnose_file_intel.py       # this phase — file_intel rules, imports Finding from diagnose.py
  explain.py                     # Phase 1 (unchanged) — already domain-agnostic, takes list[Finding]
  core/
    scan.py                       # extended: runs both domains, merges findings
    state.py                        # Phase 1 (unchanged) — already domain-parameterized
```

**Why a separate `diagnose_file_intel.py` instead of growing `diagnose.py`:**
`diagnose.py`'s own docstring already scopes it to "the storage/space
domain," and the master spec's Reasoning-layer description says `diagnose.py`
should "import one rules module per domain" — Phase 1 only had one domain,
so that distinction was invisible until now. Keeping domains in separate
rule files matches the same decoupling principle Phase 1 established
(evidence modules don't import each other; rule modules don't import
evidence modules) and avoids touching Phase 1's already-shipped, already-
reviewed code.

**Why extend `scan.py` rather than add a second CLI:** the blueprint's
actual vision is one unified "Scan My Device" experience, not a
per-domain CLI proliferation. `explain.py` and the observation-gaps
mechanism (`scan.py`'s "What I couldn't check" section) are already
domain-agnostic — they operate on `list[Finding]` and evidence dicts
generically — so running two domains and merging their findings/evidence
before calling `explain()` once is additive, not a rewrite.

## Evidence collected (`evidence/file_intel.py`)

**Package caches** — a fixed list of known, unambiguously-safe-to-clear
cache paths (distinct from Phase 1's broad `~/.cache` "space hog"
candidate, which mixes safe and unsafe content):
- `~/.cache/pip`
- `~/.npm`
- `/var/cache/apt/archives`

Each reports `{"path": str, "size_bytes": int}` or `{"path": str,
"unavailable": "<reason>"}`, using the same defensive logic Phase 1's
`dir_size_bytes()` already established (missing path and permission-denied
path — via `os.access(path, os.R_OK | os.X_OK)`, the exact fix from
Phase 1's review — both report `unavailable`, per the same Global
Constraint Phase 1 enforces). `file_intel.py` does not import `storage.py`:
it defines its own small `dir_size_bytes`-equivalent function, duplicating
Phase 1's ~15 lines of logic rather than importing it. This keeps domain
modules fully independent (matching Phase 1's established pattern of
evidence modules never importing each other) at the cost of one small,
literal duplication — an acceptable trade given the alternative is
introducing a new shared low-level module before a third domain exists to
justify it.

**Old backup files** — same `*.bak`/`*.bak<N>` pattern as Phase 1's
`_scan_backup_files`, scanned from `Path.home()` instead of
`JARVIS_X_ROOT`, with an extended skip-dir list for a home-wide walk:
`.git`, `node_modules`, `__pycache__` (Phase 1's set) plus `venv-ai`,
`.cache`, `.npm`, `.pyenv`, `.rustup`, `.cargo`, `.venvs` (large
dependency/environment directories that exist in this home directory and
are not worth walking into looking for stray backup files).

## Rules (`diagnose_file_intel.py`, deterministic, no LLM)

- **Cache-over-threshold:** each package cache whose size exceeds a
  threshold (reuse Phase 1's spirit — a fixed byte threshold, e.g. 100MB,
  tuned during implementation) produces a Finding recommending the
  cache-specific clear command (`apt clean` / `pip cache purge` / `npm
  cache clean`) as guidance text only — no execution, matching Phase 1's
  read-only posture.
- **Home-wide backup clutter:** same shape as Phase 1's
  `check_backup_file_clutter`, but over the home-wide scan's results.

Both rules produce `Finding` objects using the exact schema already defined
in `diagnose.py` (imported, not redefined): `issue, severity, evidence,
probable_root_cause, confidence, affected_components, recommended_action,
risk, expected_result, verification_method`.

## `core/scan.py` extension

`run()` becomes: collect evidence from both `evidence/storage.py` and
`evidence/file_intel.py`; run both domains' rules
(`diagnose.run_rules()` and a new `diagnose_file_intel.run_rules()`) against
their respective evidence and each domain's own previous snapshot (history
stays domain-keyed, per Phase 1's `state.py`, which already parameterizes
on `domain: str` — no change needed there); merge both domains' findings
into one list before calling `explain()` once; merge both domains'
"unavailable" candidates into one "What I couldn't check" section.

## Global Constraints (unchanged from Phase 1, still binding)

- Read-only: zero filesystem writes except the existing
  `state.append_snapshot()` path (now called twice, once per domain, same
  mechanism).
- No Free/Pro tier logic.
- Every Finding matches the exact 10-field schema.
- Never call `hermes.py`'s `HermesCore.ask()` — `explain.py` is unchanged
  and already satisfies this; nothing in this phase touches LLM calls
  directly.
- Anything unobservable is reported as an explicit `"unavailable"` field,
  always visible in CLI output (Phase 1's fix wave already built the
  observation-gaps mechanism this phase reuses).
- Platform: Linux / ChromeOS-Crostini only.

## Testing

Same conventions as Phase 1: pytest unit tests for the rules (pure
functions over synthetic evidence dicts), `tmp_path`-based tests for the
evidence collector (including a permission-denied case, mirroring Phase
1's fix), and an integration test joining `file_intel.collect()`'s real
output to `diagnose_file_intel.run_rules()`'s real behavior — Phase 1's
final review found exactly this kind of seam untested for the storage
domain, so this phase builds it in from the start rather than retrofitting
it after a review catches the gap again.

## Explicitly out of scope for this spec

Duplicate-file detection, Act/Verify automation, the Health Index,
Security/Network/Hardware domains, any actual deletion/cleanup execution,
any UI beyond CLI text.
