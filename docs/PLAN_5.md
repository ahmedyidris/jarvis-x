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
| **Trading** ("safe if possible") | **A standing absolute rule. See §6.** | 712 LOC, 106 assertions, all six suites in CI, wired into nothing. Paper only. |

Read the ordering literally: **content and engineering are where real money is
reachable without touching a single safety rule.** Trading is the one leg with a
hard block in front of it, and it is also the one Ahmed ranked "if possible".

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

## 6. Open rulings — Ahmed's to make, not mine

### 6.1 Trading: "real profit" vs. an absolute standing rule

Ahmed asked for *"the most efficient stable safe real profit system"* and *not to
drop trading completely.*

`memory/rules.md` currently says, in three separate places:

> - No real money moves. Paper trading only; every open and close needs approval.
> - No real-money trading and no broker connection, ever.
> - No autonomous trade execution: a paper trade is proposed, Ahmed approves it.

**"Real profit" and "no real money, ever" cannot both be true.** This is a
direct collision on money, it is hard to reverse, and `memory/rules.md` is a
constraint file. **Nothing about it has been changed.** Paper trading, the six
instruments in `config/trading.json`, and the approval requirement all stand
exactly as they were.

What can proceed today with no rule change at all: making the paper system
honest and *measured* — a real, auditable edge on paper, with the six suites
already in CI. If there is no measurable edge on paper, there is no real-money
question worth asking. If there is one, that is the moment to decide the rule,
with a number in hand instead of a hope.

**Ahmed's call, and only Ahmed's**, and it is three separate questions, not one:
does the paper-only rule change; does a broker connection become permissible;
does execution stay approval-gated. Recommended default until then: **build the
measurement, keep the rule.**

### 6.2 Content creation rules

Ahmed: *"come back to me on content creation rules because I don't want to
entirely drop it but enhance it, text overcame me for its generated."*

Read as: the volume of generated text became unmanageable, and the fix is better
rules, not abandoning the leg. This is the **highest-ceiling, least-blocked
income leg**, so it deserves a real conversation rather than a guess. Needed
before anything is built: what platforms, what cadence, whose voice, how much is
generated vs. written, and what the review gate is before anything publishes.

### 6.3 "No limit" on Claude Code

Ahmed: *"deployment on claude code when available with no limit."*

Honest answer: **no code in this repo can do that.** Usage limits are a function
of the Claude plan and account, not of anything Jarvis controls. What this repo
*can* do — and §3 and §5 are exactly this — is make the local free models carry
as much as possible so the metered tier is spent only where it earns its keep.

## 7. Next actions, in order

Tier 1 — cheap, unblocked, closes a live defect:

1. **The zero-assertion sweep**, and drop `test-helper.js` from the CI list
   (`test-data-layer.js` already covers it with 28 assertions). ~1h.
2. **`HANDOFF.md`** live, and both agents using it. ~15 min.
3. **Run the five hardware suites on the Chromebook** — `test-kokoro`,
   `test-vision`, `test-voice`, `test-voice-interaction`, `test-voice-router`.
   Only that machine can. Converts six unknowns into knowns.
4. **`schema` v5**: `confidence` + `approved_by`. ~1h.

Tier 2 — needs a ruling from §6 first:

5. Content pipeline — blocked on §6.2.
6. Paper-trading measurement — proceeds under the existing rule; §6.1 is only
   needed if the measurement finds an edge.

Tier 3 — real gaps, no ruling needed:

7. `jj status` currently prints `✅ Jarvis X ready` unconditionally
   (`bin/jj:34-38`). A status command that cannot report a problem is worse than
   none.
8. Reconcile `CLAUDE.md` with the code: remove or wire `hermes3:3b` and
   `nomic-embed-text` (§5).
9. Weekly sweep (§3 item 3).
10. Bitemporal memory (§3 item 4).

## 8. What has NOT changed, whatever else does

- No real-money trading, no broker connection, no autonomous execution. §6.1 is
  a question, not a change.
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
