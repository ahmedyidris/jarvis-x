# Jarvis X — PLAN 5 (unified)

*Written 2026-09-09 against `master` at `b2b61e4`. Supersedes PLAN v3, the Aug 28
status report, the v2.0 "Ascension" plan, "Week 7 Ascension", and
MASTER_BLUEPRINT_v4 as the statement of **goals and priority**. It does not
supersede `AS_BUILT.md` as the statement of **what exists** — that stays the
evidence file.*

## 0. What this is, and what the two new PDFs are not

Ahmed's instruction, verbatim: *"I just uploaded those two files for self
learning and memory but not to amend project goals."*

So `docs/incoming/JARVIS_X_MASTER_BLUEPRINT_v4.pdf` and
`SelfRepairing_Memory_Architecture_Template.pdf` are **reference material**.
They are merged into the repo as reading and as design input. Neither one sets
scope. Where the blueprint's §3 "cut list" conflicts with the mission below,
**the mission below wins** — that is Ahmed's ruling, given directly.

## 1. Mission, in priority order

This is the part every previous plan got wrong by treating the legs as peers.

**PRIMARY — Jarvis itself.** A self-autonomous personal assistant that is
genuinely smart, self-repairing, self-maintaining, and learning. Its job is to
*solve Ahmed's problems and organise his life* — explicitly including ADHD
support (external working memory, task capture, follow-through, reducing the
cost of starting). Everything else is downstream of this working.

**SECONDARY — income.** "Money printing with any possible means." Four legs,
ranked by how unblocked they are right now:

| Leg | Blocked by | Honest status |
|---|---|---|
| **Content creation + monetisation** (YouTube, all free social) | Nothing in the rules. Awaiting Ahmed's content rules — see §6. | Not built. **Highest ceiling, zero rule friction.** |
| **Jarvis Engineer** (the assistant doing real engineering work) | Nothing | Partly real — this repo *is* the demo. 396 assertions, 20 CI suites. |
| **SaaS** ("if I have a cool solid project that's cross platform") | Needs a product to exist first | Not started. Deliberately downstream of the platform work in §2. |
| **Trading** — **committed, two-phase** | Phase 1 blocked by nothing. Phase 2 needs one rule amendment. See §6.1. | 712 LOC, 106 assertions, all six suites in CI, wired into nothing. |

Ranking is about *what is unblocked*, not about what matters. Ahmed's words on
trading, after the conflict below was put to him and he reaffirmed:

> *"I will not park this project... you may make it secondary or at a later
> stage but not parked, delayed or forgotten completely or excluded from the
> overall project. I need to make money automated as I don't have time."*

Recorded as a **commitment**, not a maybe. "Secondary" means sequenced after
Jarvis itself, not deprioritised out of existence.

## 2. Platform order (Ahmed's, verbatim)

1. **ChromeOS** — the Asus Chromebook. *Home base and command centre.* Everything
   proves out here first.
2. Linux
3. iOS
4. Android
5. Windows
6. macOS
7. Online (remote)

Consequence for design: **nothing may require a GPU, and nothing may require a
port open to the internet.** Git stays the sync layer (§4). A feature that only
works on the Chromebook is fine; a feature that only works with a GPU is not on
the roadmap at all.

## 3. Agentic OS — the self-maintenance loop

Both new PDFs converge on the same shape, and it is the right one. Two paths,
one writer:

```
arrival  (event-driven)   change made -> tests run -> evidence file updates ─┐
                                                                             ├─> ONE WRITER -> append-only log
sweep    (time-driven)    timer fires -> find rot nobody reported ───────────┘        │
                                                                                      └─> below the bar -> human inbox
```

The asymmetry is the whole point, and this repo has proved it five times: **a
broken build turns CI red; a check that quietly stopped checking signals
nothing.** Instances found by hand, never by tooling:

`test-data-layer.js`, `test-shell.js`, `test-guard.js`,
`test-agent-data-integration.js` — each exited 0 while asserting nothing or
skipping everything. And the fifth, found 2026-09-09 by running the sweep by
hand: **`test-helper.js` is in CI's list of 20, emits 0 bytes, has 0 assertions,
and exits 0 unconditionally.** It is a library, not a test.

### What already exists

| Piece | State |
|---|---|
| One writer | `lib.js`'s `execute()` — single dispatch point for every action |
| Append-only audit log | `logs/actions.jsonl`, schema v4: `origin` (test vs app) + `actor` (which of eight entry points), both derived from `argv[1]` so the agent cannot set them |
| Kill switch | `~/.jarvis-x/STOP`, checked in `guard.js` and re-checked in `shell.js` so it self-defends regardless of caller |
| Constraint files mechanically protected | `OFF_LIMITS` in `validate.js`, gated twice |
| Clock injected, not called | House rule in `test.yml`; `selfdebug.js` takes `now` as a parameter |
| Self-diagnosis | `selfdebug.js` — reads the log, groups failures by actor, proposes, never fixes |

### What is missing, in build order

1. **The zero-assertion sweep.** Fails CI when a listed suite cannot report an
   assertion count. ~1h. The cheapest permanent defence this repo can buy, and
   there is a live instance right now.
2. **`confidence` + `approved_by` on the audit log** (schema v5). These are what
   turn the log from a record into a gate. A v4 row must read as *absent*, never
   as a default — a guessed `1.0` on old rows is a lie the gate would then trust.
3. **The weekly sweep.** Re-run the suites, diff `AS_BUILT.md`'s claims against
   fresh command output, park anything that drifted.
4. **Bitemporal memory.** `code/memory.js` is a flat JSONL observer today: no
   `valid_from`/`valid_to`, no volatility class, no confidence. The second PDF is
   the design. Days of work — after 1–3.

Confidence-gated, never autonomous: routine low-risk fixes get proposed with a
diff; anything that deletes, disables, or touches a constraint file parks for
Ahmed. **Two thresholds, not one — destroying information requires more
confidence than adding it.**

## 4. Two Claude Codes, one repo — the connection protocol

Ahmed: *"Claude code app is running in background, I don't want you both to
conflict, I want you both to connect."*

There are two agents on this repo — a remote cloud session and the local one on
the Chromebook — plus Ahmed. The real failure mode is not disagreement, it is
**two agents pushing to the same branch and silently overwriting each other's
work.** That needs a mechanism, not an intention.

`HANDOFF.md` at the repo root is that mechanism. It is deliberately the dumbest
thing that works:

- **Branch namespaces never overlap.** Remote sessions use `claude/remote-*`,
  the Chromebook uses `claude/local-*`. Neither ever pushes to the other's
  namespace. `master` is written only by a merged PR.
- **Read before you write.** `git pull` and read `HANDOFF.md` before touching
  anything. Claim what you are taking. Push the claim immediately, so the other
  side can see it before it starts.
- **Append-only.** Same discipline as the audit log — you add a row, you never
  rewrite someone else's.

Why not something cleverer: a lock server or a coordination daemon would be more
machinery than two agents and one human can justify, and it would be one more
thing that can be down. Git is already the sync layer and it already has the
only primitive that matters — a push either fast-forwards or it is rejected.

## 5. LLM fit on this machine

14 GB RAM, 8 vCPU, **no GPU**, no swap. Measured, from `NOTES.md` and the code:

| Model | Routing accuracy | Verdict |
|---|---|---|
| `qwen2.5:3b` | 3/4 | **Current default.** Hardcoded in `local.js`, temp 0. |
| `qwen2.5:7b` | 4/4 | Referenced 4× in code. Best local accuracy that fits. |
| `qwen2.5:1.5b` | ~0/4 | Do not use for routing. |
| `hermes3:3b` | 4/4 actions, **3/4 malformed JSON** | **Removed.** `NOTES.md:89`. |
| `moondream` | — | Vision. Referenced 3×, unmeasured. |
| Gemini (hard tier) | 4/4 | Free-tier cloud offload for heavy context. |

**Two drift findings:** `CLAUDE.md` lists `hermes3:3b` and `nomic-embed-text` as
part of the architecture. `hermes3:3b` was removed for malformed JSON, and
**neither string appears anywhere in `code/` or `config/`.** They are documented,
not wired.

Nothing here needs a 70B model and nothing should reach for one. The `3b`→`7b`
gap is the only local upgrade with measured evidence behind it.

## 6. Rulings

### 6.1 Trading — RULED 2026-09-09. Two phases, one switch.

The conflict was put to Ahmed. He reaffirmed, in his own words, and told me not
to raise it again:

> *"1 safely then 2 when auto mode enabled, make a switchable mode for auto
> trading, make both possible 1 then two... I want to make money first from safe
> trading and legally I can, then crypto... build a secure solid private bot
> trader inside Jarvis and connect with TradingView and all other local free AI
> models... I will not negotiate my goals and scope again when it comes to this
> matter."*

**That is his decision and this document treats it as settled.** The concern was
raised once; repeating it would be arguing, not advising.

His sequencing, which is also the safe sequencing — that is a convenience, not a
reason:

**Phase 1 — buildable now, no rule change needed.** Everything in the quote
except real money:
- A real bot trader inside Jarvis: strategy, signals, position sizing, risk
  limits, kill-switch integration.
- TradingView connection for charts and signals.
- Local free models on the analysis, per §5.
- Paper execution against the six instruments in `config/trading.json`.
- **Honest, auditable performance measurement.** This is the part that makes
  phase 2 a decision instead of a gamble: a strategy with no measured edge on
  paper has no edge with real money either, and the only thing that tells you
  which you have is the measurement.

**Phase 2 — the switch.** Real-money mode, off by default, one explicit flag.
It requires amending `CONSTITUTION.md` §IV and the three lines in
`memory/rules.md`. Ahmed has authorised that in principle. It has **not** been
done, for one reason only: he said *"1 then 2"*, and phase 1 does not exist yet.
Amending the rule before there is anything to switch on would remove a control
and gain nothing.

When phase 1 is built and measured, the amendment is a single deliberate commit
he approves, and per-trade approval stays a separate switch from real-money
mode — so "real money" and "no human in the loop" remain two decisions, not one.

**What no phase changes:** the kill switch still halts everything, and every
trade still writes an audit row.

### 6.2 Content — RULED 2026-09-09. His voice, Jarvis's production line.

Two answers, and they fit together better than they first look.

On authorship he chose, explicitly: **"Your words, Jarvis assists."**

On scope he asked for: *"a high quality video generation model, automated for
income... I can write a prompt for subject or give a link for similar subject...
English first then Arabic... integrate with all free content creation tools,
models, repos, skills, plugins, connectors, make room for free Higgsfield or
paid integration... create an automation process to generate videos, content,
media and post on YouTube and social media... 100% legal."*

The resolution, and it is the whole design: **Ahmed owns the idea and the
narrative; Jarvis owns everything downstream of it.**

| Ahmed | Jarvis, automated |
|---|---|
| A prompt, a subject, or a reference link | Research, outline, shot list |
| The narrative angle — the thing that makes it his | Script draft in his voice, for his edit |
| Approves the script | Voice, render, edit, thumbnail, title, description, tags |
| Approves the finished cut | Schedules and posts, tracks views and revenue |

That is what fixes *"text overcame me for its generated"*: the flood was
generated text arriving with no gate. Here the gate is at the script, where it
is cheapest to say no, and the automation is on production, where volume
actually costs him time.

**Higgsfield is already connected to the remote session** — `generate_video`,
`generate_image`, `generate_audio`, batch generation, shorts studio, and
TikTok publishing. That is the fastest route to "best quality possible" and it
needs no new integration work. Local free models handle what they can per §5;
Higgsfield handles what a 14 GB CPU-only box cannot, which for video generation
is most of it.

**English first, then Arabic** — and Arabic has a known trap already recorded in
this repo: a romanisation bug silently converted Arabic to Latin script before
it reached the TTS engine. Any Arabic pipeline has to assert on the script of
the string that actually reaches the renderer.

**On copyright, taking his own "100% legal" as the binding constraint.** He is
right that transformative work is legal — commentary, criticism, parody, and
genuinely new narrative around source material. Two things are worth stating
because they are what actually costs money, not law:

1. **Legality and monetisation are different tests.** YouTube's Content ID is
   automated pattern matching. It does not evaluate fair use. Re-used footage
   gets claimed and demonetised even when a court would call it transformative
   — so a pipeline built on other people's frames earns nothing regardless of
   who is right.
2. **Original generation sidesteps both tests.** Higgsfield-generated visuals
   over his own script have no third-party claim to make. That is not a
   compromise on his goal, it is the only version of it that gets paid.

So: reference links are **inputs to research**, and the frames that ship are
generated or licensed. Same content, same automation, and it can actually be
monetised.

### 6.3 "No limit" on Claude Code

Ahmed: *"deployment on claude code when available with no limit."*

Honest answer: **no code in this repo can do that.** Usage limits are a function
of the Claude plan and account, not of anything Jarvis controls. What this repo
*can* do — and §3 and §5 are exactly this — is make the local free models carry
as much as possible so the metered tier is spent only where it earns its keep.

## 7. Next actions, in order

**Tier 1 — cheap, unblocked, closes a live defect.**

1. **The zero-assertion sweep**, and drop `test-helper.js` from the CI list
   (`test-data-layer.js` already covers it with 28 assertions). Must key on
   **exit code plus a parsed count**, not one output format — `test-scheduler.js`
   prints `8/8 passed` and is fine, `test-helper.js` prints nothing and is not.
   ~1h.
2. **`HANDOFF.md` live on both sides.** Already needed once: two sessions were
   independently writing a Plan 5. ~15 min.
3. **Five hardware suites on the Chromebook** — `test-kokoro`, `test-vision`,
   `test-voice`, `test-voice-interaction`, `test-voice-router`. Only that machine
   can run them.
4. **`schema` v5**: `confidence` + `approved_by`. The gate every approval flow
   below depends on. ~1h.

**Tier 2 — the two income legs, now ruled.** Both proceed under existing rules.

5. **Content pipeline, phase 1** (§6.2): prompt/link → research → outline →
   script draft in his voice → *his edit* → Higgsfield render → thumbnail,
   title, description → queue. Posting automated, publishing gated on his
   approval of the cut. English first.
6. **Trading, phase 1** (§6.1): bot trader, TradingView signals, local models on
   analysis, paper execution on the six instruments, and the honest performance
   measurement that makes phase 2 a decision rather than a guess.

**Tier 3 — real gaps, no ruling needed.**

7. `jj status` prints `✅ Jarvis X ready` unconditionally (`bin/jj:34-38`). A
   status command that cannot report a problem is worse than none.
8. Reconcile `CLAUDE.md` with the code: `hermes3:3b` and `nomic-embed-text` are
   documented architecture that appears nowhere in `code/` or `config/` (§5).
9. Weekly sweep (§3 item 3).
10. Bitemporal memory (§3 item 4).

**Tier 4 — gated on Tier 2 producing a measurement.**

11. Trading phase 2 (§6.1): the `CONSTITUTION.md` §IV + `memory/rules.md`
    amendment and the real-money switch. One deliberate commit Ahmed approves,
    once phase 1 exists and has a measured result to approve *against*.

## 8. What has NOT changed, whatever else does

- **Today, and until Ahmed approves the phase-2 amendment: no real-money
  trading, no broker connection, no autonomous execution.** §6.1 records that he
  has authorised phase 2 in principle and sequenced it after phase 1 — so this
  line is the *current* state, not a permanent one, and it changes by his
  explicit commit and no other route.
- The kill switch (`~/.jarvis-x/STOP`) halts everything.
- Nothing binds to `0.0.0.0`. Git is the sync layer.
- `guard.js`, `validate.js`, `exec.js`, `shell.js`, `Guidelines.md`,
  `memory/rules.md`, `CONSTITUTION.md` stay off-limits to *agent*
  self-modification.
- **Open-source code and other LLMs are not blocked and never were.**
  `shell.js`'s allowlist constrains what the *agent* may spawn — and it already
  permits `bash`, `python`, `node`, `curl`, `wget`. Ahmed, Gemini CLI, ollama and
  any other tool at the terminal do not route through it at all.
- A test must never depend on the control it is testing.
- This document gets superseded the moment §7 Tier 1 produces fresh evidence.
