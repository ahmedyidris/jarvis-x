# Jarvis X — Plan and Status

**This is the only current plan.** Everything in `docs/archive/` is superseded.
Structure follows Completion Plan v2 (2026-08-19), which existed only as a PDF
outside the repo — that gap is why the project felt untracked.

Regenerate every number here: `bash scripts/status.sh` · `npm test` ·
`bash scripts/verify/run-all.sh` · `node code/eval-agent.js`

Last verified: 2026-08-24

---

## Where the project actually is

A local-first AI assistant that works. Not a prototype, not scaffolding.

- **Hermes** — local Q&A over Ollama, remembers conversations, knows the
  project and its own codebase. `jarvis ask "..."` — 2.5s generic.
- **Voice** — Piper TTS + Faster-Whisper STT, English and Egyptian Arabic.
- **Content pipeline** — 4 verticals, sourced fact → narration → TTS →
  rendered 1080×1920 h264/aac video. 25+ pieces on disk.
- **Dashboard** — React + FastAPI, 9 endpoints, live data, job control.
- **Desktop app** — Electron, `.deb` installs, launches from the app grid.
- **Agent** — jailed, allowlisted, human-gated, kill switch.

Tests: 19 jest, 18 pytest, E2E, verify suite. `status.sh` 100/1.
The one failing check is the self-debug loop, deliberately unbuilt.

---

## Phase 1 — Verify + core completion

### 1A. Verification — DONE, with two known gaps
Evidence: `docs/VERIFICATION_2026-08.md` (2026-08-21), re-run 2026-08-24.

| Check | State |
|---|---|
| Electron builds, launches, survives restart | ✅ + now packaged and installed |
| 4 verticals produce real output | ✅ all 4, video verified |
| E2E flow | ✅ 65s |
| Failure modes | ⚠️ 3/4 — Ollama-down returns HTTP 200 |
| Recovery (kill switch, restart, restore) | ✅ |
| Performance baseline | ✅ recorded |

**Open from 1A:**
- Ollama-down returns HTTP 200 with `{"response":"Error: "}`. A client
  checking status codes sees success. `hermes.py` now raises
  `HermesBackendError`, but the API layer still needs to map it to 5xx.
- Disk-full was only tested at the Python level. Jarvis X's own behaviour
  under a full disk is untested (P8).

### 1B. Real-time data — MOSTLY DONE
`code/data-layer.js`, `cache-layer.js`, 6 providers, staleness metadata on
every datapoint, disk cache with per-provider TTL, secret redaction.
Live Data reads 6/10 sources; 2 need API keys, 2 are free-tier limited.
**Open:** provider cost/limits not documented in one place.

### 1D. Audit trail — PARTIAL
`logs/actions.jsonl`, 1236 rows, append-only. Since 2026-08-24 rows carry
`schema:v2` with an allow/deny verdict and outcome — before that, 331 of 414
shell rows had no verdict at all.
**Open:** only 92 of 1236 rows are v2 (the rest are historical). Not
queryable except by grep. No export. No retention policy. `code/audit-trail.js`
is an in-memory ring buffer for data fetches — misnamed, unrelated.

### 1C. Dashboard rebuild — PARTIAL
Five tabs, all endpoints healthy, real controls only.
**Open vs Plan v2's spec:** no decision inspector (inputs → reasoning →
sources → output), no output library with filter/preview, no per-vertical
schedule/pause controls.

### Voice + accessibility (goal 6) — PARTIAL
Verified 2026-08-24. 7 routes, all synthesizing: en, en-us (Piper
en_US-amy), en-gb (en_GB-alba), ar, ar-jo (ar_JO-kareem), ar-gulf, ar-ae
(ar-AE-emirati). Routes previously pointed at Kokoro, whose import fails
here — three of six were dead.

**Not available, no CPU-viable local model:** Egyptian Arabic (Habibi and
NAMAA both evaluated and rejected — diffusion too slow, or too large for
this disk) and Australian English. Both fail loudly rather than misrouting.
ar-eg is the one that matters most and is the one missing.

**Accessibility is browser code sitting in a Node directory.**
`caption-layer.js`, `wcag-audit.js`, `accessible-tts.js`,
`accessible-stt.js` call `document`/`localStorage`/`window` but live in
`code/` as CommonJS. Nothing imports them and nothing can — the React app
is TS in `web/src/`. Using them means porting to components, not wiring.
The dashboard does have baseline aria/role coverage (~20 attributes,
largely from shadcn), so it is not inaccessible — but captions, the WCAG
audit and the accessible TTS/STT wrappers are unreachable today.

---

## Phase 2 — Accuracy + self-debug — NOT STARTED

The 77% that gated this was a hand-count over a log nothing had written to
since the pre-`type` agent — unreproducible, not merely stale.
`code/eval-agent.js` now measures on demand: **15/15**, stable across 3 runs,
6/6 on held-out goals.

**Self-debug still does not ship.** 15 cases, one model, and the eval cases
and few-shot examples were written in the same sitting — 15/15 overstates
generalization. Widen the set and re-measure first.

**Fidelity checking** (Plan v2's grounding requirement) is real:
- Numeric — deterministic, always on, 31 files clean.
- Semantic — Gemini judge, 0/5 false positives, catches known defects.
  GO for deliberate review, NOT automatic gating: nondeterministic recall
  (hence any-flag voting at `votes=3`) and a hard 20 calls/day free tier.

---

## Phase 3-5 — NOT STARTED
Cross-platform + mobile · multi-user · general writing. See archive for the
full v2 text. Phase 3's sync layer is the large one; Phase 1 schema
decisions should keep asking "does this survive multi-user".

---

## What to distrust

Two things were diagnosed as broken for multiple sessions while working
correctly:

1. A "recurring orphaned root process" was this project's own Docker
   container with `restart=unless-stopped`. Two stacks meant two Ollama
   daemons on 8 vCPUs — the real cause of the latency variance AND the E2E
   test's 120s timeout. `docker stop` took load 2.23 → 0.04.
2. The Gemini judge's "5/5 false-positive rate" was measured against a
   fixture nobody had verified. It contained two real errors that had
   shipped. Every model that flagged it was right.

Both: an unverified assumption disqualified something that worked.
Verify the fixture before it disqualifies anything.

---

## Honest open questions

- **Who is this for?** Every archived plan assumes a different answer —
  personal assistant, content business, sellable product, patentable IP.
  The code doesn't need this answered; the roadmap does.
- **Repo is public.** Flagged as a patent concern in the 2026-08-19 handoff,
  still unresolved.
- **No budget.** Free tiers and existing hardware only.
