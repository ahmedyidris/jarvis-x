# Jarvis X — MASTER PLAN v4

**Date:** 2026-09-09 · **Supersedes:** `MASTER_PLAN_v3.md` (2026-09-03) for planning
purposes only — v3's §1 hardware measurement and §2 completion methodology are still
correct as *records of what was true then*; don't edit them, read this instead for
current state.
**Evidence base:** `AS_BUILT.md` §8 (this session's record), `REMAINING_WORK.md`,
`CLAUDE.md`/`GEMINI.md` (corrected/created this session), `DECISION_RECORD_*.md` (6),
`llmfit doctor`/`fit` output, live `scripts/status.sh` and a real `POST /api/ask` round
trip against the running system.
**Method:** same runbook weighting v3 used (Planning 15 / Setup 10 / Build 45 / Test 20 /
Delivery 10) where a phase-weighted estimate is given below — flagged as judgment, not
measurement, same caveat v3 gave its own 66% figure.

`MASTER_PLAN_v3.md` was written against a machine that had accumulated three weeks of
build-up (91% disk full, a stale hardware profile question). This machine is now, as of
2026-09-08, a **freshly rebuilt Crostini container** — same physical hardware, same repo,
but every runtime dependency (Ollama models, Python venv, Claude Code plugins/skills,
`web/dist`, systemd units) had to be re-established from a clean disk. That rebuild, and
what it revealed, is most of what's new in this document. Old plans are archived, not
deleted — see `archive/2026-09/`.

---

## 1. Mission & Vision

This section restates `CONSTITUTION.md` §I for a reader who won't open that file — it is
not a new charter, and `CONSTITUTION.md` remains the sole authoritative version. If the
two ever disagree, `CONSTITUTION.md` wins and this section needs fixing.

**Identity.** Jarvis X is a locally-first, autonomous personal AI assistant, built and
run by one person (Ahmed) on his own hardware, not a hosted product with other users.

**Sovereign principles** (verbatim from `CONSTITUTION.md` §I):
- Runs on Ahmed's hardware — no cloud dependency for the core loop.
- Self-improves through logged evidence, not self-reported confidence.
- Operates unattended with read-only standing permissions; anything else is gated.
- All critical actions gated for human approval — a degraded model backend never skips
  the gate (`README.md` Rules §5).
- Governed by written rules only: `CONSTITUTION.md`, and the rules that inherit its
  authority (`knowledge/Guidelines.md`, `memory/rules.md`).

**What "locally-first" means in practice, not just principle**, as this session found it:
the web-chat path (`app.py` → `hermes.py` → `code/router.py` → Ollama) is genuinely 100%
local by default and was verified live this session (§4). The agent-autonomy path
(`code/agent.js`/`scheduler.js`) and the Phase B content pipeline both call remote models
(Gemini, Groq, OpenRouter) **by design**, gated through `guard()` — this is not a
violation of "no cloud dependency," because that principle has always been scoped to the
core chat path, not the agent-autonomy or batch-content paths (confirmed against
`DECISION_RECORD_p4-gemini-judge.md`'s own reasoning on this exact question). `CLAUDE.md`
and `GEMINI.md` (both corrected/created this session) now say this explicitly, rather than
leaving it inferable.

**What Jarvis X is not, and isn't trying to become**, per the record so far: not a
product with users other than Ahmed; not a trading system (real-money trading is
forbidden absolutely, `CONSTITUTION.md` §IV); not yet answering `PLAN.md`'s flagged open
strategic question ("personal assistant vs. content business vs. product vs. patentable
IP") — that question is still open and this document does not resolve it, because it
isn't an engineering question.

---

## 2. Hardware — same machine, rebuilt container, healthier disk

| Property | v3 (2026-09-04) | v4 (2026-09-09) | Source |
|---|---|---|---|
| CPU | Intel i5-1135G7, 8 vCPU | **same** — 11th Gen i5-1135G7 @ 2.40GHz, 8 threads | `llmfit doctor` (new this session) |
| RAM | 14 GB, 12Gi available | 14.12 GB total, **3.7Gi available at a normal working moment** | `free -h`, `llmfit doctor` |
| GPU | none | none, confirmed | `llmfit doctor`: `has_gpu: false` |
| Disk | **3.9 GB free, 95% used** (binding constraint) | **43 GB free of 72 GB, 41% used** | `df -h $HOME`, 2026-09-09 |
| Ollama models | `moondream`, `qwen2.5-coder:7b`, `SILMA-9B-Instruct`, `nomic-embed-text` | `qwen2.5:3b`, `qwen2.5:7b`, `moondream`, `nomic-embed-text` — matches `CLAUDE.md`/`bootstrap/install.sh` exactly | `ollama list` |
| Container state | 3 weeks of accumulated build-up | **freshly rebuilt** (2026-09-08) | this session |

**The RAM story changed, and it matters more than the disk story now.** v3 treated disk
as the binding constraint and RAM as comfortable (12Gi available). Disk is now healthy
(41% used, rebuilt container). But **RAM headroom under real working conditions is
tight**: 3.7Gi available is not an edge case, it's what `free -h` reads with normal
multi-session dev use (this session found 3 concurrent `claude` processes running on this
box — §6). `llmfit`'s per-model numbers (below) should be read against that 3.7Gi figure,
not the 14GB total.

**`llmfit` — installed this session, use it before adding any model, not after** (`pip
install llmfit`, into `venv-ai`; `AlexsJones/llmfit`, MIT, PyPI 1.1.14):

| Model | Fit @ 14GB | Speed score | Baseline est. | Min RAM |
|---|---|---|---|---|
| `Qwen/Qwen2.5-3B-Instruct` | 100/100 | 15/100 | ~6.0 tok/s | 1.6 GB |
| `Qwen/Qwen2.5-7B-Instruct` | 100/100 | 6/100 | ~2.4 tok/s | 3.9 GB |

`qwen2.5:7b`'s 3.9 GB requirement is essentially the entire 3.7Gi normally free. In
practice this means: **don't run a 7b-tier request concurrently with a second heavy
session** (another Claude/Gemini CLI instance, a browser-automation skill, Phase B video
rendering) without expecting contention — this restates `REMAINING_WORK.md`'s already-
flagged "Ollama single-slot serialization" problem with an actual number behind it,
it doesn't resolve that open policy decision (still Ahmed's call: don't run concurrent
heavy jobs / set `OLLAMA_NUM_PARALLEL>1` / build a priority proxy).

---

## 3. Progress report

Two different completion metrics exist in this repo, measuring different things — stating
both, not picking one, because conflating them is exactly the mistake `AS_BUILT.md` §5
already had to untangle once:

**A. `scripts/status.sh` milestone/check count — mechanical, file/behavior-existence
based.** As of this session: **130/134 checks passing, 27/30 milestones (90%)**. This
number is honest about what it measures (does a file exist, does a test pass, does a
grep match) and honest about what it doesn't (whether the passing test asserts anything
real — `test-guard.js`/`test-shell.js` are still flagged in `REMAINING_WORK.md`'s Tier-2
backlog as zero-assertion stubs that pass unconditionally). Treat 90% as "the scaffolding
is in place," not "90% of the product works."

**B. Phase-weighted judgment estimate — v3's method, re-scored.** v3 scored 66% across
Planning 15/Setup 10/Build 45/Test 20/Delivery 10. This session's evidence moves two of
those five:
- **Setup**: was scored against a container with 3.9GB free disk and an unverified
  hardware profile. Now: disk healthy (41% used), hardware profile confirmed identical
  and stable across a full container rebuild, all bootstrap steps completed and verified
  live (§4) rather than assumed. **Setup moves from partial to complete for this session's
  purposes** — though "complete" here means "this container reached the same state the
  prior one was in," not "the bootstrap process itself is bug-free" (it needed three live
  fixes this session — `logs/supervisord/`, `web/dist/`, `venv-ai`'s missing `pip` — that
  `bootstrap/install.sh` should arguably absorb; see §5).
- **Test**: two real corrections landed (Hermes-backbone step E measured;
  `REMAINING_WORK.md`'s P4 status corrected from stale to current), but also one real
  regression risk was *found, not fixed*: the P4 semantic-fidelity judge has never been
  exercised against a live Gemini/Groq endpoint (no `.env` anywhere this code has run).
  Net: roughly flat, evidence quality went up more than pass-rate did.
- Build/Planning/Delivery: not meaningfully touched this session — no new product
  feature shipped, only tooling/environment/docs. Unchanged from v3's judgment.

**This session's honest estimate: ~68%, not a large move from v3's 66%.** The work done
was almost entirely environment/tooling/documentation-integrity work, not new product
capability — which is exactly what "resume building" meant this time (bootstrap
completion, tool integration, doc accuracy), not new features. That's a legitimate kind
of progress and this document says so plainly, rather than inflating the number to make
a tooling session look like a feature session.

---

## 4. What's verified live, right now, on this machine

Not "should work" — actually exercised this session:

- `hermes-api` supervisord process: `RUNNING`.
- Dashboard root (`http://127.0.0.1:8000/`): HTTP 200.
- `POST /api/ask` against `qwen2.5:3b` (local tier): real round trip, real model response,
  no mocking.
- Ollama daemon: reachable, all 4 architecture-specified models present and correctly
  named (no stale/wrong model tags, unlike CLAUDE.md's text before this session's fix).
- Voice (Piper + Kokoro + faster-whisper), English + Jordanian/Gulf Arabic: 8/8 tests,
  once `venv-ai` is on `$PATH` (it needs to be — see §6).
- JS test suite: 130/134 `scripts/status.sh` checks pass (§3A).
- P4 semantic/numeric-fidelity unit tests: 51/51 (mocked — not live, see §5).
- Claude Code: `ecc@ecc` plus 12 official-marketplace plugins, 17 project skills
  restored and symlinked, global guardrail settings merged.
- `llmfit` 1.1.14 and `@google/gemini-cli` 0.59.0: both installed and runnable.

**Not verified / known-down:**
- `tts-worker` (Egyptian Arabic voice cloning): `FATAL` — missing `chatterbox` package +
  ~5GB `voices/` assets, not restored by bootstrap, not chased this session (§5).
- Gemini CLI: installed, unauthenticated (`gemini -p` fails cleanly with the auth error,
  not a crash) — needs Ahmed's interactive OAuth or an API key he supplies, neither of
  which this session could do (§5).
- P4 judge, live: code is wired in and unit-tested, but has literally never made a real
  network call on this machine (`logs/.judge-cache.json` doesn't exist) — same blocker
  as Gemini CLI auth.
- `jarvis-supervisord.service` systemd unit: not installed (needs `sudo`, not done
  without an explicit go-ahead this session).

---

## 5. Local + Online Blueprint

```
                              ┌─────────────────────────────────────────┐
                              │            THIS MACHINE                  │
                              │  i5-1135G7 · 8 threads · 14GB RAM · noGPU │
                              └─────────────────────────────────────────┘

  LOCAL (default path, no network required)          ONLINE (opt-in, key-gated, self-disabling)
  ───────────────────────────────────────            ──────────────────────────────────────────
  Browser (PWA)                                        code/gemini.js ──> Gemini API
    │                                                     (gemini-3.6-flash / -3.5-flash)
    ▼
  app.py (FastAPI) ──> hermes.py ──> code/router.py     code/providers/registry.js
    │                    │              │  TIERS:         ├─> Gemini   (quality tier)
    │                    │              │  local  → qwen2.5:3b          ├─> Groq     (fast/smart tiers,
    │                    │              │  quality→ qwen2.5:7b          │             also P4 judge fallback)
    │                    ▼              ▼                 └─> OpenRouter (fallback)
    │              tts_engine.py / stt_engine.py        each self-disables without its
    │              (Piper, Kokoro, faster-whisper)      key in ~/.jarvis-x/.env — no
    │              tts_worker.py (Egyptian, DOWN)       silent fallback to a cloud call
    ▼                                                    without one.
  Ollama @ localhost:11434
    qwen2.5:3b · qwen2.5:7b · moondream · nomic-embed-text

  code/agent.js ──┐
  code/scheduler.js ┤──> validate.js ──> guard.js (kill switch + audit log) ──> lib.js execute()
                                                                                    ├─> exec.js (jailed FS)
                                                                                    ├─> shell.js (allowlisted)
                                                                                    └─> router.js ──> gemini.js (gated) ──[ONLINE]

  automation/phase-b/*_generator.py ──> Ollama (narration, local)
                                     └─> enforce_semantic_fidelity() ──[ONLINE]──> Gemini/Groq judge
                                     └─> video_renderer.py ──> tts_engine.py + MoviePy ──> MP4 (local)

  Dev tooling, both local processes, neither wired into Jarvis's own runtime:
    Claude Code CLI  ──[ONLINE, own auth]──> api.anthropic.com
    Gemini CLI       ──[ONLINE, UNAUTHENTICATED]──> generativelanguage.googleapis.com
    llmfit           ──local hardware inspection, no network required for `fit`/`info`/`doctor`
```

**Reading this blueprint**: the left column runs with the network off. The right column
requires a key in `~/.jarvis-x/.env` and fails closed (not silently) without one — that's
deliberate design (`guard()`'s gating, and `_call_gemini_judge()`'s explicit "fails closed,
never treats a failed judge call as a pass" contract), not an accident of what's
configured on this particular machine. Claude Code and Gemini CLI are development
tooling that write to this repo; they are not part of the running Jarvis system and
nothing in `app.py`/`hermes.py`/`code/agent.js` calls either of them.

**What's aspirational, not built** (moved out of `CLAUDE.md`'s architecture claims this
session, since it had no code behind it): a remote VPS gateway (`futrx`/DuckDNS/LXD) for
external/mobile access. If this is still wanted, it needs its own decision record and a
build plan — nothing in this blueprint assumes it exists.

---

## 6. Debugging log — what broke, and current fix status

| # | Symptom | Root cause | Status |
|---|---|---|---|
| 1 | Only `moondream` in `ollama list` | Fresh container, bootstrap step 3 partially run | **Fixed** — all 4 models pulled |
| 2 | 4 voice test files failing (`spawn piper ENOENT`, `soundfile` import error) | `venv-ai` not on `$PATH` in the working shell | **Not a bug** — 8/8 once `PATH` includes `~/venv-ai/bin` |
| 3 | `sounddevice` import: `OSError: PortAudio library not found` | `libportaudio2` system package never installed | **Fixed** — `apt-get install libportaudio2` |
| 4 | `~/venv-ai/bin/pip` missing | `ensurepip` had installed `pip3`/`pip3.11` console scripts, not `pip` | **Fixed** — `ensurepip --upgrade` restored it; use `python3 -m pip` either way |
| 5 | `supervisord` refuses to start: log directory doesn't exist | Validates every program's log-file dir at its own startup, before any child's `mkdir -p` runs — same class of bug `config/supervisord.conf`'s own comments already document for `ollama_DISABLED` | **Fixed** — created `logs/supervisord/` |
| 6 | `hermes-api` crashes on import: `Directory 'web/dist/assets' does not exist` | Bootstrap step 5 (`npm run build --prefix web`) never ran on this container | **Fixed** — built, 239ms, no errors |
| 7 | `tts-worker`: `ModuleNotFoundError: No module named 'chatterbox'` | Undocumented dependency — not in `bootstrap/requirements-venv-ai.txt` at all | **Open** — needs the package *and* ~5GB of `voices/` assets (checkpoint + Ahmed's reference audio) not restored by bootstrap. Not chased without direction (real disk/bandwidth cost, personal data) |
| 8 | `gemini -p "..."` fails with an auth-method error | Never authenticated — no OAuth session, no `GEMINI_API_KEY` | **Open, needs Ahmed** — interactive OAuth or an API key in `~/.jarvis-x/.env`, which Claude Code is structurally denied from touching |
| 9 | Explain.py's Hermes-routing "cost" was unmeasured (`DECISION_RECORD_hermes-backbone.md` step E) | Never benchmarked | **Fixed** — measured, no cost found (§7 of that record) |
| 10 | `REMAINING_WORK.md` reported P4's judge as "not wired in" | Doc not updated after the 2026-08-31 wiring commit (`d320cc1`) | **Fixed** — dated addendum appended |
| 11 | `CLAUDE.md` claimed `hermes3:3b`, a `remote.futrx` layer, and the wrong kill-switch path | Never corrected since first written; nothing enforces doc/code sync here | **Fixed** — corrected in place, see `AS_BUILT.md` §8.3 |
| 12 | Uncommitted `app.py`/`code/verticals/` changes appeared mid-session, not authored here | A second, concurrent Claude Code session on the same machine building a video-clipper vertical | **Not a bug** — flagged to Ahmed live, not touched, no file overlap occurred |

**Not found broken, worth stating so it isn't re-checked needlessly**: git integrity
(`git fsck` clean), the kill switch itself (`.jarvis-x-STOP` correctly absent, correctly
respected by `isStopped()` checks across `code/`), the audit-log gate design, and every
locked skill/plugin the bootstrap script names.

---

## 7. Re-sequenced work, in 1–3 hour tasks

Same shape as v3 §5 — tiers by how much judgment vs. legwork each needs, not by
importance.

### Tier 1 — needs Ahmed directly, nothing else blocks it
1. Fill `~/.jarvis-x/.env` (Gemini/Groq/OpenRouter keys) — unblocks Gemini CLI, the P4
   live acceptance test, and the two remote tiers in `code/providers/registry.js`.
2. Decide on `jarvis-supervisord.service` (install now with `sudo`, or manage differently
   on this box) — currently just `supervisord` run ad hoc via `scripts/start-jarvis.sh`.
3. Decide whether Egyptian Arabic voice cloning (`tts-worker`) is worth ~5GB + finding/
   re-recording the reference audio, or should be dropped from the architecture until
   then.

### Tier 2 — close real gaps, no new decisions needed
1. Add `chatterbox` to `bootstrap/requirements-venv-ai.txt` (it's a real, undocumented
   dependency regardless of whether §Tier-1.3 is pursued now).
2. Have `bootstrap/install.sh` create `logs/supervisord/` and run the `web/` build step
   unconditionally rather than assuming a fresh container always completes step 5 —
   this session's #5/#6 above are exactly the kind of partial-bootstrap failure the
   script's own "idempotent, safe to re-run" design intends to prevent.
3. Once §Tier-1.1 lands: re-run `scripts/verify/07_semantic_fidelity_live.py` for real,
   record the result in `REMAINING_WORK.md` P4 (append, don't rewrite) — this is the one
   piece of "wired in and tested" that still isn't "verified live."
4. `router.py`'s `TIERS` doesn't include `nomic-embed-text` anywhere — either wire it into
   a real embedding-search feature, or stop treating it as part of the pulled-model set
   in docs until there's a consumer.

### Tier 3 — extend, once Tier 1/2 are done
1. `DECISION_RECORD_hermes-backbone.md` option D (unify `~/.hermes/state.db`/
   `logs/*.jsonl`, merge the two tier tables) — evidence bar cleared (§7 of that record),
   scope estimate ~1 day, still needs Ahmed's go-ahead to start.
2. Whatever the second, concurrently-running Claude Code session's `code/verticals/
   clipper/` work turns into — not this document's to plan, since it wasn't reviewed
   here, but worth reconciling with this plan once it lands.
3. `PLAN.md`'s open strategic question ("who is this for?") — not an engineering task,
   but blocks prioritizing anything past Tier 2 with real confidence.

---

## 8. What would change this plan

- A filled `.env` changes §4's "not verified" list into "verified" for at least three
  items in one step — re-run this document's §3/§4 after that, don't assume it carries
  forward unchanged.
- A `df -h` reading below ~20GB free would restore disk as the binding constraint v3
  described — re-check before any large download (`chatterbox`'s dependencies,
  `voices/` assets, a new local model).
- If the concurrently-running session's clipper work lands, `README.md`'s system list
  (§"What it is") needs a fourth entry, and this document's §5 blueprint needs it too.
