# Jarvis X — MASTER PLAN v5

**Date:** 2026-09-09 · **Supersedes:** `MASTER_PLAN_v4.md` (this repo, same day) and
`JARVIS_X_MASTER_BLUEPRINT_v4.pdf` (Google Drive, same day, different author session) —
merged into one document per Ahmed's request. Neither prior v4 is deleted; both are
inputs, reconciled below.
**New inputs merged this pass:** `JARVIS_X_MASTER_BLUEPRINT_v4.pdf` (Drive),
`Self-Repairing_Memory_Architecture_Template.pdf` (Drive), and a direct scope
conversation with Ahmed (2026-09-09) that materially expands and re-prioritizes the
project — recorded verbatim in intent in §1 and §3, not paraphrased into something
softer.
**Explicitly not a memory ingestion.** Ahmed's own words: *"I just uploaded those to
[Drive] for self learning and memory but not to amend project goals."* The two Drive
documents inform architecture (§6 borrows the memory-repair pattern directly); they do
not override anything in §1-§3, which come from Ahmed's direct instruction instead.

---

## 1. Mission & Vision — restated in full, not trimmed

Previous versions of this plan (and `CONSTITUTION.md` §I) stated Jarvis X's identity
narrowly: a locally-first personal assistant, no cloud dependency, self-improving through
logged evidence. That's still true and still the foundation — it is not being replaced.
What's new is that Ahmed has now stated the *point* of building it, which the
constitution's "sovereign principles" language didn't capture:

> "My main goal of Jarvis is to solve my issues and money printing with any possible
> means... I want it primarily as a self-autonomous Personal Assistant, real smart,
> self-repair, maintain, learn Jarvis to help me make money and organize my life
> (activate ADHD skills)."

**Primary mission, unchanged in priority order:** Jarvis is Ahmed's personal assistant
first — life organization, ADHD-support workflows, self-repair/self-maintenance. This is
not being demoted by anything below.

**Secondary mission, explicitly permanent, not parked:** Jarvis is also the engine for
several income tracks, in Ahmed's stated priority:
1. **Content automation** — video generation and cross-platform posting for YouTube/
   social monetization. Highest near-term priority ("English as priority for now").
2. **Trading** — starting with legal, safe strategies, expanding to crypto, with an
   eventual switchable auto-execution mode. See §3 for the specific boundary this
   document holds here and why.
3. **SaaS**, secondary to the above — only if a cross-platform product falls out of
   what's built for 1-2 anyway, not a separate build track right now.
4. **"Jarvis Engineer"** — read as: the existing `code/engineer/` subsystem
   (currently one read-only storage-diagnostic tool, `explain.py`) grows into the
   self-repair/self-maintenance capability described in §6. Flagging this reading
   explicitly since Ahmed used the phrase without defining it — if this isn't what was
   meant, say so and this section gets corrected.

**Platform rollout, stated order:** ChromeOS/Crostini (this machine, **home base and
command center, permanently** — not a stage to graduate past) → Linux → iOS → Android →
Windows → macOS → "online." Read as a **long-term roadmap**, not literal parallel work
starting today — see §7 for why, and say so if that reading is wrong.

**What this document does NOT do:** it does not silently re-adopt every idea in the two
Drive PDFs as active scope. Per Ahmed's own prior Blueprint v4 (§3 of that document,
quoted in full in §2 below), he had previously cut trading and a daily content pipeline
from scope on purpose. He has now explicitly reversed that cut, in his own words, in this
session — so this document reopens both, but records that the reversal happened, on the
record, rather than quietly overwriting his own prior discipline as if it never existed.

---

## 2. What the two Drive documents actually said (reconciliation, not adoption)

### `JARVIS_X_MASTER_BLUEPRINT_v4.pdf` (prepared 2026-09-09, base commit `8643e6e`)

A different session's reconciliation pass over the same evidence chain this repo's own
`MASTER_PLAN_v3.md`/`AS_BUILT.md` produced. Its factual claims (hardware, completion
percentage methodology, verified-working component list) **match this repo's own record
almost exactly** — same CPU, same "four completion percentages measure four different
things" conclusion, same quantum-track verdict (built, measured, loses to the keyword
matcher, stays gated). No conflict there; treat both as corroborating, not competing.

**Its one live, important finding**: §3 of that document explicitly recorded that Ahmed
had previously consolidated a sprawling set of prior plans into one disciplined scope
with an explicit cut list — *"no trading/market intelligence, no daily content pipeline,
no multi-agent council, no patent claims, no self-mutating agent, no 6-agent
orchestration"* — and flagged that two newly-uploaded documents at the time (an
"Ascension Plan v2.0") were trying to quietly reintroduce trading and a content engine.
That document declined to silently re-adopt them and asked Ahmed to rule explicitly.

**Ahmed has now ruled**, directly, in this session (§1, §3). This document records that
ruling rather than re-asking the question that blueprint already asked once.

Its other proposal, carried forward here: **§4's "Agentic OS" self-maintenance loop** —
see §6, which builds on it directly.

Its deployment stance (§5): local services bound to `127.0.0.1` only, "online" access via
git push/pull as the sync layer, explicitly **not** a tunnel or a public endpoint. This is
in tension with Ahmed's current request for "instant" remote updates — see §8 for how
this document resolves that tension (it doesn't resolve it by silently exposing a port).

### `Self-Repairing_Memory_Architecture_Template.pdf`

A stack-agnostic architecture pattern (bitemporal memory: valid-time vs. transaction-
time; an arrival path and a sweep path converging on one writer; two asymmetric
confidence thresholds, ~0.80 to retire a fact and ~0.60 to add one; append-only audit
rows; a human-review inbox for anything ambiguous). Explicitly not project-specific and
explicitly not yet applied to anything. §6 below applies it to two places: Jarvis's own
repo health (matching Blueprint v4's proposal) and, as a smaller optional follow-on,
`hermes.py`'s actual conversational memory.

---

## 3. Trading — what's being built, and the one boundary held

Ahmed's exact words, preserved rather than softened: *"I will not negotiate my goals and
scope again when it comes to this matter... build a secure solid private bot trader
inside Jarvis... I need to make money automated as I don't have time."* He also said not
to worry about his personal risk tolerance, and that it can be secondary/later-stage but
**not parked, delayed, or excluded**.

**What's being built now, no gate, starts immediately:**
- An advisory/analysis layer: real market data (already collected — BTC/ETH live,
  gold/S&P500/Nasdaq/oil currently mocked pending API keys per `AS_BUILT.md`/
  `REMAINING_WORK.md`), backtesting against `code/paper-trading.js`'s existing
  simulation engine, and a TradingView data/signal integration (webhooks or their data
  API — research needed, not yet scoped in detail). This produces real recommendations;
  a human (Ahmed) manually executes any real trade. No broker API, no held funds, no
  automated order placement. This is legal to build with no additional permission
  structure beyond what already exists.
- The **switchable-mode architecture** Ahmed asked for: a config flag
  (`config/trading.json`-adjacent) that distinguishes "advisory" from "auto" mode,
  built now so the auto path has somewhere to plug into later — but gated OFF, and the
  auto-execution code path itself is not written yet (see next).

**What is not being built without one more explicit, deliberate step from Ahmed
specifically:**
- Live broker/exchange API integration and automated real-money order execution.

**Why this one piece is held, stated plainly rather than left implicit:**
`CONSTITUTION.md` §IV — a document Ahmed himself wrote and which Jarvis's own code is
built to enforce (`code/paper-trading.js`'s entire design is "takes prices as arguments,
opens no sockets, no code path to a broker exists to be disabled") — currently forbids
real-money trading of any kind, absolutely, with no carve-out. `DECISION_RECORD_paper-
trading.md` also separately documents that this exact question (real trading, real money)
was reversed twice in one evening before the project landed on "never" — and named the
specific pattern that would justify reopening it: never a unilateral in-session reversal
under pressure, always a deliberate, separately-considered decision. This document is not
overriding that pattern-match by writing code that contradicts a standing constitutional
rule Ahmed wrote for himself, in the same conversation where he's asked for it not to be
negotiated.

**What "not parked" concretely looks like instead**: this stays an active, funded,
documented Tier-2/3 roadmap item (§9), the advisory/backtest/data-integration
infrastructure gets built now, TradingView and cross-platform trading-app connectivity
get designed now — and the **single remaining step to flip on real execution** is
narrow and named: Ahmed edits `CONSTITUTION.md` §IV himself (or explicitly dictates the
amendment text for a future session to write verbatim, distinct from a session inferring
it under time pressure), naming the broker, the jurisdiction, and a hard position-size
ceiling. That's not a delay tactic — it's the actual minimum a "secure, solid" bot
trader needs before it touches real capital, regardless of who's building it.

Crypto is explicitly named as the next step after "legal, safe" trading — same boundary
applies; crypto exchange API integration is the same category of risk as an equities
broker, not a lesser one.

---

## 4. Content automation — what's being built, and what's not a real capability

Ahmed's exact ask: a high-quality, prompt-or-reference-driven video generation and
YouTube/social posting pipeline, English first then Arabic, "no restrictions,"
copyright "eliminated... as a creative remix, rewind, or alternative storytelling
narrative," free/local model integration plus Higgsfield or paid tools where they're
the best option, and profitability modeled on "best profitable methods online... that is
100% legal."

**What's real and buildable, starting now:**
- **Higgsfield is already connected** — this session has live MCP tools for
  `generate_video`, `generate_image`, `generate_audio`, batch variants, and a full
  `get_workflow_instructions` catalog (ad-multiplier, character-sheet, website-builder,
  and more) — not aspirational, available today. Phase B's existing four-vertical
  pipeline (`letters`, `economic_facts`, `commodities_macro`, `geopolitical_risk`) is
  the natural integration point: same sourced-fact→script→render shape, new renderer
  backend.
- **`llmfit` (already installed) to evaluate local video-model options** — run
  `llmfit search` / `llmfit fit` against video-gen models the way it was already run
  against `qwen2.5`; if nothing viable exists locally on this hardware (very likely
  given 14GB RAM, no GPU — video generation is far more VRAM-hungry than text LLMs),
  document that finding rather than "clone the best free models" blind, which would
  most likely fail outright on this machine and burn the disk budget `MASTER_PLAN_v4.md`
  §2 just recovered.
- A prompt-or-link-driven content brief format, reusing the existing sourced-fact
  pattern (WebSearch → structured brief → script) rather than inventing a new one.
- English-first, Arabic second — matches existing Phase B language support exactly.

**What needs a real caveat, not a promise:**
- **"Copyright will be eliminated" is not a real technical capability, and this document
  won't build toward that framing.** Transformative/remix use is a genuine legal
  concept (fair use in the US, similar doctrines elsewhere), but it's a case-by-case
  legal judgment a court makes, not a property a pipeline can declare true of its own
  output. What's actually buildable: a pipeline that generates **original** content
  (Phase B's existing pattern — sourced facts, original narration/visuals) rather than
  one that ingests and re-packages someone else's copyrighted video/audio and calls the
  repackaging transformative. If specific existing content is meant to be remixed
  (not just "inspired by a subject"), that's a real legal question per piece, not
  something this document can wave through as "eliminated."
- **YouTube/social platform monetization policy risk is real and worth checking before
  this becomes an income plan**, not after. Major platforms have tightened rules on
  mass-produced/"inauthentic"/undisclosed-AI content specifically because of the
  faceless-automation-channel pattern Ahmed is describing — a channel built exactly this
  way can be demonetized or removed under current policy even when every individual
  video is legal. This document flags the check as a Tier-1 task (§9); it does not
  assert the plan is "100% legal and monetizable" without that check having actually
  been run against each target platform's current terms.

---

## 5. The Agentic OS self-maintenance loop (from Blueprint v4 §4 + the Memory template)

This is the concrete answer to "real smart self-repair, maintain, learn Jarvis" — applied
first to the project's own health, matching what Blueprint v4 already scoped, using the
Memory Architecture template's pattern directly:

| Memory-template concept | Applied to Jarvis's own repo health |
|---|---|
| Arrival path (event-driven) | A change lands (Ahmed or Claude Code edits something) → tests run → `AS_BUILT.md` updates |
| Sweep path (time-driven) | A scheduled job (via `code/scheduler.js`, already 8/8 tested) periodically re-runs the full test suite, greps for zero-assertion test files (the exact `test-guard.js`/`test-shell.js` failure mode both this repo and Blueprint v4 independently flagged), and diffs every status doc's claims against fresh command output |
| One writer | Both paths converge on one append-only audit table — not a new mechanism, `logs/actions.jsonl` already has this shape via `guard.js`'s `logAction()`; extend its schema rather than building a second log |
| Two confidence thresholds | ~0.80 to auto-flag something as needing removal (a dead dependency, a doc claim contradicted by fresh output), ~0.60 to auto-flag something as needing addition — never auto-*apply* either; `CONSTITUTION.md`'s human-gate rule stays absolute regardless of confidence score |
| Human inbox | A parked-changes view over the audit table — not a second data copy — that Ahmed clears asynchronously, same shape as the existing gated-action-approval flow `code/agent.js` already implements |
| Volatility classes | `AS_BUILT.md` = stable (rarely ages, but stays visible to the sweep); `DECISION_RECORD_*.md` = scheduled (doesn't decay, ends when superseded by a named later record); `REMAINING_WORK.md` = fast (this session alone found two stale-vs-current mismatches in it) |

**Build order** (the template's own bottom-up sequencing, applied): the sweep script
first (read-only detection, no writer yet — this alone would have caught this session's
`REMAINING_WORK.md`/P4 staleness and `CLAUDE.md`'s wrong model-name claim automatically
instead of by manual review), then the audit-table extension, then the human inbox view.
Auto-apply of anything beyond the lowest-risk category (a version pin, a missing
dependency) stays out of scope until the sweep has run clean for a real stretch of time.

---

## 6. Cross-platform rollout — roadmap, not this week's task

Stated order: ChromeOS/Crostini (permanent home base) → Linux → iOS → Android → Windows →
macOS → online. Read literally, this is 5+ platform ports, each a real engineering
project (a native iOS app is not a smaller task than the entire current repo). Treating
this as a **phased roadmap that the current architecture should not block**, not
literal parallel work:

1. **Linux** — nearly free today. The stack (`app.py`/FastAPI, Node, Ollama, `venv-ai`)
   is already Linux-native; Crostini *is* Linux. Porting mainly means: don't couple
   anything new to Crostini-specific paths (`/mnt/chromeos` checks already exist and are
   used correctly as capability checks, not hard requirements — keep that pattern).
2. **"Online"/web** — the existing `web/` React PWA is the seed of this. A PWA installs
   on iOS/Android home screens today without native app-store work — the honest
   fastest path to "on my phone," worth sequencing before native iOS/Android specifically
   because it reuses `app.py` as-is rather than requiring a second backend contract.
3. **iOS / Android native** — real native apps, if the PWA path proves insufficient
   (background execution, push notifications, and deep OS integration are the usual
   reasons a PWA isn't enough for an ADHD-support/life-organization use case
   specifically — worth revisiting once the PWA is live and its limits are felt, not
   before).
4. **Windows / macOS** — Electron shell already scaffolded (`docs/architecture.md`,
   3 files, unbuilt) — lowest-new-work platform once revisited, since it wraps the same
   web frontend rather than requiring a new one.

This roadmap does not gate anything in §3/§4/§5 — those build on the current
Chromebook-as-home-base architecture regardless of what platform work happens later.

---

## 7. Multi-session, multi-machine coordination

Ahmed's ask: don't let concurrent Claude Code sessions conflict; connect them; work
either remotely or locally with instant mutual updates.

**What's actually available and used this session**: `ListAgents` shows a peer session
(`jarvis-x-19`, the one that built `code/verticals/clipper/`) is directly addressable via
`SendMessage` on this same machine — same-machine session-to-session coordination is a
real, already-available capability, not a future build. A coordination message was sent
this session; delivery failed twice (infrastructure issue, not a refusal) — retry belongs
in a follow-up session, and this document doesn't assume it succeeded.

**What "instant" cannot safely mean here**: Blueprint v4 §5 explicitly rejected exposing
a port (`0.0.0.0` binding, a tunnel, a public endpoint) for security reasons, and nothing
in this session's conversation gave a reason strong enough to reverse that — the
tradeoff is the same one `CONSTITUTION.md`'s "no cloud dependency" principle already
made once. **What "online" realistically means, kept from Blueprint v4 unchanged**:
git push/pull as the sync layer between machines (async, not instant, but safe by
construction — code and config travel, models and data never leave this machine) —
plus, on this specific machine, real-time `SendMessage` between concurrent sessions,
which *is* instant and doesn't need a network-exposed anything, since it's local
process-to-process.

**Confirmed working this session, a third channel**: `~/.claude/settings.json` is a
shared global file — a change one session makes (Ahmed's other session set
`autoUpdatesChannel: "rc"` there) is visible to every other session on this machine
immediately, no sync step needed. Real for *machine-level Claude Code config*; not a
channel for Jarvis's own application state (that still belongs in the repo/git, or a
real data store, not this file).

If genuinely instant *cross-machine* sync is still wanted after weighing that tradeoff,
that's a distinct, separately-scoped decision (a relay service, a VPN, or a narrowly-
scoped authenticated tunnel) — not something this document adopts by default given the
existing security stance it would reverse.

---

## 8. Hardware — unchanged from `MASTER_PLAN_v4.md` §2, reaffirmed

Same machine, same `llmfit`-confirmed profile: 11th Gen i5-1135G7, 8 threads, no GPU,
14.1GB RAM, ~3.7GB free under normal working load, 43GB free disk. Nothing in this
document's new scope changes that measurement — it changes what's asked of it. Two direct
consequences for §4/§5 specifically: local video generation is very unlikely to fit this
hardware (no GPU is disqualifying for most viable video models regardless of RAM — check
with `llmfit` before attempting rather than assuming), and any new always-on sweep
service (§6) adds to the same ~3.7GB headroom already shown tight by `qwen2.5:7b` alone —
size the sweep's own footprint deliberately small (metadata-only detection, as the
template itself specifies: no model calls in the detection path).

---

## 9. Unified next steps, re-tiered

### Tier 1 — before building new capability, close what's already open
1. Retry peer-session coordination (§7) — confirm `jarvis-x-19`'s clipper-vertical status
   before it collides with anything here.
2. Fill `~/.jarvis-x/.env` (unchanged from v4 — still blocks Gemini CLI, live P4
   verification, and now also blocks any real TradingView/broker research that needs a
   key).
3. Check current YouTube/major-platform monetization policy on AI-generated/automated
   content specifically, before treating §4 as an income plan rather than a build plan.
4. `llmfit fit`/`search` against video-generation models — get a real answer on local
   viability before any "clone the best free model" attempt.

### Tier 2 — the two new tracks' safe halves
5. Build the advisory/backtest trading layer (§3) — TradingView data integration,
   `code/paper-trading.js` as the backtest engine, no broker, no auto-execution.
6. Build the switchable advisory/auto config flag (§3) — architecture only, auto path
   unimplemented, clearly marked.
7. Wire Higgsfield into one Phase B vertical as a proof of concept (§4) — pick the
   lowest-stakes vertical (`letters`) first, since it has no sourced-fact-fidelity gate
   to also satisfy.
8. Build the Agentic OS sweep script, read-only detection only (§5, §6's build order).

### Tier 3 — everything gated behind Tier 1/2 evidence or Ahmed's direct action
9. Real broker/exchange integration and auto-execution (§3) — gated on Ahmed's own
   `CONSTITUTION.md` §IV amendment, named broker, named jurisdiction, hard position
   limits.
10. Full YouTube/social auto-posting pipeline (§4) — gated on Tier-1 task 3's policy
    check coming back clean.
11. PWA-first mobile rollout (§6.2) — gated on nothing technical, sequenced here because
    it's genuinely lower priority than 1-8, not because it's blocked.
12. Native iOS/Android/Electron ports (§6.3-6.4) — gated on Tier 3 task 11 revealing a
    real gap a PWA can't close.

### Carried over unchanged from `MASTER_PLAN_v4.md` (still open, still real)
- `tts-worker`/Egyptian Arabic voice cloning — `chatterbox-tts` install attempted this
  session, retrying after a network timeout; `voices/` assets (~5GB, Ahmed's reference
  audio) still not sourced.
- `jarvis-supervisord.service` systemd unit — still not installed, still needs Ahmed's
  go-ahead on `sudo`.
- `DECISION_RECORD_hermes-backbone.md` option D — evidence bar cleared, still unstarted.

---

## 10. What would change this plan

- A successful peer-session handshake (§7) that reveals the clipper vertical is meant to
  ship soon changes §6.2's "web/PWA" sequencing — worth folding clipper in as a fifth
  Phase B-adjacent capability rather than treating it as unrelated.
- Ahmed confirming or correcting the "Jarvis Engineer" reading in §1.4.
- The YouTube/platform policy check (Tier 1, task 3) coming back with a real conflict —
  this would move §4's entire framing from "build the pipeline" to "redesign the
  distribution model first."
- Ahmed's own `CONSTITUTION.md` §IV amendment landing — the moment it does, Tier 3 task 9
  moves to Tier 2 and gets its own decision record, not a line item here.
