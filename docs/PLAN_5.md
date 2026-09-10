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
| **Jarvis Engineer** (the assistant doing real engineering work) | Nothing | Partly real — this repo *is* the demo. 424 assertions, 20 CI suites, gated by `sweep.js`. |
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
| Kill switch | `.jarvis-x-STOP` at the repo root (corrected 2026-09-10 — this row said `~/.jarvis-x/STOP`, which halts nothing), checked in `guard.js` and re-checked in `shell.js` so it self-defends regardless of caller |
| Constraint files mechanically protected | `OFF_LIMITS` in `validate.js`, gated twice |
| Clock injected, not called | House rule in `test.yml`; `selfdebug.js` takes `now` as a parameter |
| Self-diagnosis | `selfdebug.js` — reads the log, groups failures by actor, proposes, never fixes |

### What is missing, in build order

1. **The zero-assertion sweep.** Fails CI when a listed suite cannot report an
   assertion count. ~1h. The cheapest permanent defence this repo can buy, and
   there is a live instance right now.
2. ~~**`confidence` + `approved_by` on the audit log** (schema v5).~~
   **DONE 2026-09-09** — `code/guard.js` schema v5, `code/test-gate.js`
   (22 assertions), in CI. 15 mutations, 15 caught. The absent-not-default rule
   is the point and is pinned by its own test: `gateVerdict()` is three-valued
   (`approved` / `refused` / `unknown`) so absence cannot ride in as a boolean,
   and every pre-v5 row returns `unknown`. `readConfidence()` on such a row
   returns no `value` key at all, so a call site cannot write `?? 1.0`.
   Two kinds of unknown are kept apart: `pre-v5` (the log could not record it —
   permanent) and `not-claimed` (a live v5 call site said nothing — a real thing
   to fix). A malformed claim is neither stored nor silently dropped: the row
   keeps `confidence_rejected` / `approved_by_rejected`, which reads as unknown
   to the gate and as a bug to whoever greps for it.
3. ~~**The weekly sweep.**~~ **DONE 2026-09-09** — `code/weekly-sweep.js`.
   Re-runs the suites, diffs doc claims against fresh output, parks anything
   that drifted. See §7 item 9.
4. **Bitemporal memory.** `code/memory.js` is still the flat JSONL observer in
   the live path. `code/memory-bitemporal.js` (2026-09-09) adds the store
   beside it — `valid_from`/`valid_to`, volatility class, confidence, and the
   rest of the template's schema — but **layers 3–7 are not built and nothing
   uses it yet**. See §7 item 10 for exactly what exists. Still days of work
   remaining; the foundation is no longer one of them.

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

1. ~~**The zero-assertion sweep**~~ — **DONE 2026-09-09.** `code/sweep.js`,
   `code/test-sweep.js` (20 assertions), and a CI step that fails the build.
   Keys on **exit code plus a count parsed from any known format**, so it
   clears `test-scheduler.js` (`8/8 passed`, 8 real checks) and flags
   `test-helper.js` (0 bytes, 0 assertions) — the pair a one-format sweep gets
   backwards. Reads the suite list out of `.github/workflows/test.yml` rather
   than keeping a copy that could drift. `test-helper.js` removed from the CI
   list by the sweep's first real run; `test-data-layer.js` still covers it
   with 28 assertions. 15 mutations, all caught — **two escaped the first run
   and both were bugs in my tests**, which is what the exercise is for.
2. **`HANDOFF.md` live on both sides.** Already needed once: two sessions were
   independently writing a Plan 5. ~15 min.
3. **Five hardware suites on the Chromebook** — `test-kokoro`, `test-vision`,
   `test-voice`, `test-voice-interaction`, `test-voice-router`. Only that machine
   can run them.
4. ~~**`schema` v5**: `confidence` + `approved_by`.~~ **DONE 2026-09-09.**
   The gate every approval flow below depends on. See §3 item 2 for what
   landed and the rule it protects. `guard()` takes an optional fourth
   argument, so all existing three-arg call sites keep working and record
   `not-claimed` rather than a fabricated default — no call site was rewritten
   to claim a confidence it does not actually have.

**Tier 2 — the two income legs, now ruled.** Both proceed under existing rules.

5. **Content pipeline, phase 1** (§6.2) — **the two gates are built,
   2026-09-10; the production steps are not.** `code/content-pipeline.js` +
   `code/test-content-pipeline.js` (34 assertions, 25/25 mutations caught),
   in CI. The flow is prompt/link → research → outline → script draft in his
   voice → *his edit* → Higgsfield render → thumbnail, title, description →
   queue, with posting automated and publishing gated on his approval of the
   cut. English first.

   **What landed is the state machine and the two gates** — the half where
   correctness matters and the half that needs no credentials. Research,
   scripting, rendering and posting are injected functions with **no
   defaults**, so the module opens no socket and there is no code path from
   the suite to YouTube even if a test tried to take one.

   Four rules, each pinned by a caught mutation, because a gate that reports
   green while doing nothing is worse than no gate:

   1. **An approval is bound to the artifact it approved.** Approve a script,
      regenerate it, and the approval is void — otherwise "approve, then swap"
      publishes something he never read. SHA-256 of the exact text, the same
      mechanism as `source_hash` in the memory store. Re-approving the new
      draft restores it, so the rule is not a trapdoor; re-attaching identical
      bytes does not void anything, since it binds to content, not to the act
      of writing.
   2. **An approval names its gate.** A `script` approval must not satisfy the
      `cut` gate. Not hypothetical caution — `test-memory-integration.js`
      found exactly this class of bug one module over, where two distinct
      intents collapsed into one token and every layer's own suite stayed
      green.
   3. **Absence of an approval is never approval.** Verdicts are
      `guard.js`'s three-valued `gateVerdict()`, so "he said no" and "we never
      asked" stay different facts. `by` has no default, because a default of
      `'human'` would let a forgetful call path mint a human approval.
   4. **Posting is reachable only from `queued`**, which is reachable only
      through the cut gate — and the cut gate is re-checked *at post time*,
      not just at queueing, because the cut can be re-attached in between.

   The gate is at the script because that is where saying no is cheapest, and
   §6.2's reasoning is the whole design: the flood Ahmed described was
   generated text arriving with no gate at all. Automating production while
   gating the narrative fixes that; the reverse is what caused it.

   **`jj content` is the surface he operates them through** —
   `code/content-cli.js` + `code/test-content-cli.js` (29 assertions, 21/21
   mutations caught), in CI, wired into `bin/jj`. Without it the gates were a
   library nobody could reach. Commands: `queue` (what is on his desk),
   `list`, `show <id>` (the artifact in full, never truncated — he cannot
   approve what he cannot read, with a hash beside each artifact so a log row
   can be matched back to specific bytes by eye), `approve`, `reject`. A short
   id prefix resolves, but an **ambiguous** one refuses rather than picking
   the first match, since approving the wrong job is exactly the mistake a
   convenience feature must not cause.

   **The honest boundary, stated because "gate" implies more than it
   delivers.** `approve` refuses without an interactive terminal — but that is
   a **speed bump, not a security boundary**, and the code says so in the
   refusal text itself, with a test that fails if someone rewrites it into a
   confident one. `code/shell.js`'s allowlist includes `node` and `bash`, so
   an agent with shell access can bypass the CLI entirely and call
   `content-pipeline.js` directly; no check at this layer can stop that. What
   the gates *do* defend against is the pipeline advancing on its own, an
   artifact reaching YouTube unread, and an approval carrying over to a
   re-drafted script. The mitigation for the rest is that every approval
   writes an audit row carrying `actor` and `origin`, so a minted one is
   **detectable afterwards rather than prevented beforehand** — detection, not
   prevention, and named as such.

   **Not wired into `code/scheduler.js`**, pinned by a test. Still to build:
   the research/outline/script steps, the Higgsfield render call, and the
   poster — all of which now plug into an enforced machine with a working
   review surface, rather than inventing their own control flow.
6. **Trading, phase 1** (§6.1) — **one clause of five done, 2026-09-09.**
   The clause that gates phase 2 is built: **the honest performance
   measurement**, `code/trading-performance.js` +
   `code/test-trading-performance.js` (28 assertions, 15/15 mutations caught),
   in CI. Read-only — it imports `fs` and `path` and nothing else, asserted by
   its own test, so there is no path from it to an order.

   Its design is mostly defences against a performance report flattering
   itself, each one a named rule: seven trades is not a win rate (the default
   verdict is `insufficient-evidence` and it is the hardest of the three to
   escape); realized-only P&L flatters a book that never closes its losers (open
   exposure is reported separately and *never* netted in); a profit inside the
   noise is not a profit (expectancy sits beside its dispersion); zero stop-outs
   means the stop-derived position sizing in `config/trading.json` is
   UNVALIDATED rather than working; and the window is always stated.

   **The ceiling is deliberate: the strongest verdict it can ever return is
   `promising`.** There is no `ready`, `approved` or `go` value, and a test
   asserts none can exist. Authorising real money is a `CONSTITUTION.md` §IV
   amendment that is Ahmed's alone, and a report able to print its own approval
   would be making that decision for him. Every rendered report repeats that in
   its footer.

   **The bot-trader clause is BLOCKED on a ruling, not on effort.**
   `CONSTITUTION.md` §III gates *proposing* a paper trade on one-tap human
   approval, and `code/trade-advisor.js` already refuses to execute for that
   reason — with `code/test-trade-advisor.js` asserting it via a book that
   throws if `open()` or `close()` is touched. A bot that generates and
   executes its own proposals cannot satisfy both documents, and building one
   would mean deleting that test. `DECISION_RECORD_autonomous-trading-loop.md`
   sets out three options (leave §III as written / amend it for paper
   proposals / automate only the exits) and is Ahmed's to rule on under §VII.

   **Still not built** — the other four clauses: the bot-trader loop (above),
   TradingView signals, local models on analysis, and the scheduled paper
   execution that would actually populate `logs/trading-journal.jsonl`. Run
   today against this container's empty journal the report correctly returns
   `insufficient-evidence` on both bars, which is the honest state: the
   measurement exists and has nothing to measure yet.

**Tier 3 — real gaps, no ruling needed.**

7. ~~**`jj status` prints `✅ Jarvis X ready` unconditionally**~~ — **DONE
   2026-09-09.** `code/status.js`, `code/test-status.js` (24 assertions), in
   CI. It now reports the kill switch, the ollama daemon, the models the tier
   table actually routes to, each remote provider's key and remaining quota,
   the audit log, and per-tier answerability — and **exits non-zero** when any
   of it fails, which is the part that makes it usable from a script. Three
   things it deliberately does not do: duplicate `scripts/status.sh` (that
   audits the *machine*; this answers "can Jarvis answer right now, and on
   which tiers"), treat a missing cloud key as a failure (booting keyless is a
   hard rule, so that is INFO), or copy any fact that lives elsewhere — the
   kill-switch path comes from `guard.js`'s `STOP_FILE` export, the required
   models are derived by walking `TIERS`, and the endpoint comes from
   `PROVIDERS.ollama.url`. 12 mutations, 12 caught; **one escaped the first
   run** and was worth more than the other eleven — disabling the probe's abort
   timer did not turn the suite red, it made it *truncate and exit 0*, the
   vacuous-pass shape `sweep.js` exists to catch, in `sweep.js`'s own
   neighbour. Fixed with a `process.exitCode = 1` fuse plus a watchdog on the
   one test that can hang. Run against this container, where no ollama exists,
   it correctly reports four dead tiers and exits 1 where the old command said
   "ready".
8. ~~Reconcile `CLAUDE.md` with the code~~ — **DONE 2026-09-09/10.** Both
   halves closed, by opposite routes. `hermes3:3b` was documented architecture
   that appeared nowhere in the code, and was removed from `CLAUDE.md` as
   never-built. `nomic-embed-text` was the same kind of claim until item 10's
   layer 3 made it true: `code/memory-embed.js` now calls it, so that line was
   corrected *forward* rather than deleted. A third drift was found in the
   same pass and fixed with a grep as evidence — `CLAUDE.md` called the
   unauthenticated Gemini CLI "a real, currently-blocking gap" when nothing in
   this codebase invokes the `gemini` binary at all.
9. ~~**Weekly sweep**~~ (§3 item 3) — **DONE 2026-09-09.**
   `code/weekly-sweep.js`, `code/test-weekly-sweep.js` (53 assertions), in CI,
   plus `.github/workflows/weekly-sweep.yml` on a Monday 07:00 UTC cron. Five
   detectors, all pure lookups, no model calls: suite health (delegated to
   `sweep.js`, so the two cannot disagree about the CI list), doc references to
   files that no longer exist, assertion-count claims re-checked against what
   the suites now report, **test files no CI list runs**, and **the kill
   switch documented at a path that is not it**.

   **The fifth detector was added 2026-09-10 because this document was
   wrong about the kill switch, in two places, while being edited all
   session.** `docs/PLAN_5.md` named it ~/.jarvis-x/STOP — a file that
   halts nothing — including in a row of the safety table above, and the
   agent editing this file had already corrected the identical claim in
   `CLAUDE.md` earlier the same session. Detector 1 could not see it: that
   one matches paths by file extension, and the switch has none.

   It matters more than ordinary doc drift. Most stale docs cost a reader a
   minute; this one tells someone trying to *stop* Jarvis to create a file
   that does nothing, at the moment they most need to be right. The real
   path is read from `guard.js`'s own `STOP_FILE` export and never written
   in the detector — a check carrying its own copy of the value it checks
   is one rename away from confidently enforcing the wrong answer.
   (Note this paragraph writes the stale path *without* backticks. That is
   the convention detector 1 already documents: backticks are precisely what
   marks a token as a live path claim, so a write-up that uses them becomes
   a finding about itself. This one did — and failed its own suite — before
   the backticks came off.)

   The one judgement call in it is mechanical rather than interpretive:
   several docs name the stale path deliberately, to say it is stale, and
   flagging those would punish exactly the correction the detector wants.
   So if the *correct* path appears within 300 characters of the wrong one,
   the mention counts as a contrast rather than a claim — no reading of the
   surrounding prose, and no list of blessed phrasings to keep up to date.
   The window excludes the matched token itself, or a path that merely
   contained the right basename would excuse itself.

   That fourth detector covers a blind spot in `sweep.js` itself: `sweep.js`
   asks whether each suite *in* the CI list can report a pass, so a file
   outside the list is invisible to it by construction — and dropping a suite
   from the list is the failure `test.yml`'s own comment says this repo keeps
   correcting. It found **12 such files**, and all twelve are now resolved.

   Two of them — `test-accessibility` and `test-full-accessibility` — were not
   merely unrun but **could not fail**: both ended in `.catch(console.error)`,
   so an AssertionError was caught, printed, and the process exited 0. Proven
   by breaking the module under test and watching the suite print "ALL TESTS
   PASSED" beside the AssertionError. That is the same line `test.yml` already
   documents in `test-data-layer.js`, making these instances **seven and
   eight** of that defect. Both are converted to `test-helper`, both now exit
   non-zero on a real break, and both are in CI.

   The other ten are correctly excluded — Piper, Kokoro, ollama, live APIs, and
   `test-net`, which is a *gate* for network tests rather than a suite at all —
   and `test.yml` now records why for each. **The detector objects to silence,
   not to exclusion**: a suite the workflow names anywhere, including in a
   comment explaining the exclusion, is a documented decision; one it never
   mentions is the finding. That is not a second allowlist — it reads the
   workflow itself, so the decision and its record cannot drift apart, and
   documenting an exclusion is exactly the action the finding asks for, which
   makes it self-clearing. With the backlog cleared the sweep is **green from
   a clean inbox**, so the Monday job is green and its pass/fail rule never
   needed changing.

   It parks findings in an append-only inbox and
   **never fixes** — the exit code is non-zero only for *new* findings, because
   re-reporting last week's parked item every week is how a control trains you
   to ignore it. **It found real rot on its first run:** `docs/architecture.md`
   line 52 claims a file named code/gateway-adapter.js exists; it does not
   exist anywhere in the repo. (Named without backticks here on purpose:
   backticks are exactly what the detector reads as "a path in this repo", so
   a doc reporting an absence would otherwise report itself.) Parked, not fixed — deciding what that sentence should now say is
   a judgement, and this module's contract is that it does not make those.
   14 mutations, 14 caught.

   The design point worth carrying elsewhere: it reports **its own blind spot**
   on every run. A prose scraper either misses claims or invents them, and for
   a control the second is far worse, because "no drift found" then means
   "found nothing" rather than "checked everything". So a claim counts as
   *checked* only when its sentence names exactly one suite and carries exactly
   one count; everything else increments a printed `claimsUnchecked`. Currently
   5 checked, 5 unchecked.

10. **Bitemporal memory** (§3 item 4) — **all seven layers built,
    2026-09-09; deliberately not wired in.** `code/memory-bitemporal.js`,
    `code/test-memory-bitemporal.js` (28 assertions, 14/14 mutations caught),
    in CI. The template's §8 build order is bottom-up and says each layer must
    be usable on its own before the next starts, so this is the clock
    abstraction and the store — the two axes (`valid_from`/`valid_to` and
    derived transaction time), the four lifecycle transitions (born, replaced,
    ages, ends), the volatility classes with their half-lives, freshness
    measured from `last_verified_at`, and the two-threshold confidence gate.
    **Layer 4 (policy) is also built**: `code/memory-policy.js` +
    `code/test-memory-policy.js` (26 assertions, 14/14 mutations caught).
    It decides what a new fact does to an old one — born / reaffirm / replace /
    coexist / park — and writes nothing; a test asserts it imports only the
    gate and cannot reach the store, because applying a decision is layer 5's
    job. The judgement most likely to be silently wrong is coexist-vs-replace,
    which turns on topic-vs-scope: get it wrong and a store that should
    remember two jobs instead thinks you keep changing jobs. Extraction is an
    injected argument with **no default**, since a default extractor would
    become the implementation nobody replaced.

    **Layer 3 was recorded as blocked, and that was half wrong.**
    `code/memory-embed.js` + `code/test-memory-embed.js` (44 assertions,
    25/25 mutations caught), in CI. The reasoning that blocked it: semantic
    retrieval needs `nomic-embed-text` through ollama, and this container has
    none. True of the *live embedder*; not true of the *layer*, because the
    embedder is an argument exactly like the clock in layer 1 and the
    `repairFn` in layer 6. Every embedder in the suite is a plain function
    over a lookup table and `ollamaEmbedder` is driven by an injected
    `fetchFn`, so the suite opens no socket and runs identically with or
    without a daemon. What still needs the Chromebook is the live round trip —
    that `nomic-embed-text` returns a vector of the shape this expects — not
    the layer.

    **The design decision that matters here is that ranking is not by
    similarity.** The template's §1 says the dangerous memory is the one that
    *was* true: "it embedded perfectly, retrieves with the highest score" and
    is then stated with total confidence. So a similarity-only semantic recall
    is not a neutral baseline in this system — it is the mechanism of the
    failure, and it would make retrieval strictly worse than the exact-match
    `recall()` it sits beside. Score is `similarity × freshness`, multiplicative
    rather than a weighted sum, because a sum lets a perfect embedding carry a
    dead fact to the top on similarity alone. Both inputs are returned
    separately so a caller can disagree with the combination without
    re-deriving it. Two tests exist only to make a regression to
    similarity-only impossible, and the mutation that performs exactly that
    regression is caught.

    Three further rules, each pinned: **nothing stale is dropped** (demoted and
    flagged, never silent — silence reads as "I never knew that", a different
    and worse claim than "I knew that and it may be out of date"); **the
    similarity floor applies to raw similarity, before freshness demotes it**,
    or an old-but-correct answer vanishes through the back door; and **the
    staleness threshold is `THRESHOLDS.freshnessFloor`, imported**, the same
    number `recall()` and the sweep use, per the template's §9 checklist item
    about retrieval and the sweep contradicting each other in front of a user.

    **A dead embedder is reported, never swallowed.** It falls back to the
    lexical path and returns `degraded`/`reason`; it does not return `[]`
    (which reads as "no such memory") and does not throw (which would take the
    chat down over a ranking improvement). Same rule as `jj status` and the v5
    gate. `code/memory-sweep.js` must not import this module — detection stays
    free of model calls per template §6 — and a test asserts it doesn't.

    **Layer 5 (the repair writer) is built**: `code/memory-repair.js` +
    `code/test-memory-repair.js` (21 assertions, 12/12 mutations caught). It is
    the template's "one writer" — the only thing that turns a decision into a
    stored fact — and everything passes three gates on the way. It closes a
    real gap while doing so: `memory-bitemporal.js` writes with
    `fs.appendFileSync` and does not import `guard.js`, so the kill switch did
    not reach a store write. Correct for a data structure, wrong for an action,
    so the gating lives here — a pulled switch now blocks the write *and*
    records the block, as §VI requires. Every applied repair writes a schema v5
    audit row carrying its `confidence` and `approved_by`, which makes this the
    v5 gate's first production caller. A `parked` decision is never applied, at
    any confidence, by any caller.

    Its hardest case is the stale decision: layer 4 decides every candidate
    against ONE snapshot, so by the time one arrives here its target may
    already be superseded. Applying it anyway would leave two successors to one
    predecessor — the self-contradiction layer 4 refuses to add a third opinion
    to — so every application re-validates against the store as it is now and
    refuses rather than guessing.

    **Layer 6 (the sweep) is built**: `code/memory-sweep.js` +
    `code/test-memory-sweep.js` (20 assertions, 12/12 mutations caught). It is
    the answer to the case the whole architecture exists for — a fact that
    *was* true, that nobody has mentioned, and that therefore no event will
    ever fire about. Detection is pure lookups: no model calls, no sockets, so
    it is affordable to run continuously.

    **It never retires on age**, and several tests exist only to keep that
    true. Age weakens belief; it does not falsify. A sweep that retired old
    facts would destroy information on a timer, and would do it precisely to
    the facts nobody mentioned lately rather than to the wrong ones. Its only
    two proposals are `flag` (needs_verification, **still retrieved**) and
    `end` (a fact whose own `valid_to` has already passed — arithmetic, not
    judgement). Both route through layer 5, so the kill switch and the v5 audit
    row cover the timer-driven path with no second door to keep locked.

    **Layer 7 (the human inbox) is built**: `code/memory-inbox.js` +
    `code/test-memory-inbox.js` (17 assertions, 12/12 mutations caught). List
    what is open, resolve one item, see what was decided. The property that
    would have been easiest to lose at the very last step is that **approving
    goes back through the writer rather than round it**: `resolve('approve')`
    re-submits the parked decision to layer 5 with `approved_by: 'human'`, so
    the staleness check, the kill switch and the audit row all still apply. A
    proposal parked in March and approved in June, whose target moved in April,
    is **refused** — and that refusal is the feature, because it is precisely
    the case a review queue creates and a naive one ignores. Append-only: a
    resolution is a new row referencing the proposal's id, and "what is open"
    is a fold rather than a stored state.

    So the architecture is complete, and `code/memory.js` keeps its one
    consumer, `code/scheduler.js`, untouched —
    swapping that over needs layers 4–5, which decide what a new fact does to
    an old one. "Not wired in" is pinned by a test rather than left as a
    promise in a commit message.

    Two things worth recording. **One deliberate deviation from the template's
    schema:** it lists `expired_at` as a stored column, but in an append-only
    file closing version N would mean editing a row already written, which is
    the one thing this store must never do — so transaction time is *derived*
    on read (version N closes exactly where N+1 opens). Same queries, no
    mutation. **And one design bug its own test caught:** an earlier draft
    filtered valid-time queries by `status`, excluding `superseded` rows. That
    made the store answer "nothing" when asked what was true on a date before
    a fact was replaced — "I live in Pune" on June 2nd is not retroactively
    false because they moved on the 3rd. The interval is the only criterion;
    status is a lifecycle label and plays no part.

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
- The kill switch (`.jarvis-x-STOP`, at the repo root) halts everything.
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

## 9. Local session findings, 2026-09-09 (Chromebook, hardware-only evidence)

Requested in `HANDOFF.md`'s inbox — reporting back rather than duplicating a
plan doc. Full detail in `AS_BUILT.md` §8, not repeated here.

**The five hardware suites (§7 Tier 1 item 3): all pass, 8/8 test files
green** — `test-kokoro` (5/5), `test-vision` (3/3), `test-voice` (3/3),
`test-voice-interaction`, `test-voice-router` (8/8). One environment gotcha
worth recording so it isn't mistaken for a regression next time: they fail
with `spawn piper ENOENT`/`ModuleNotFoundError: soundfile` unless `~/venv-ai/
bin` is on `$PATH` first — not a code defect, a shell-setup step.

**`llmfit` (`AlexsJones/llmfit`, installed this session) adds a throughput
axis §5's table doesn't have** (that table measures routing *accuracy*; this
measures *speed* against this exact CPU):

| Model | Fit @ 14GB | Baseline est. | Min RAM |
|---|---|---|---|
| `Qwen/Qwen2.5-3B-Instruct` | 100/100 | ~6.0 tok/s | 1.6 GB |
| `Qwen/Qwen2.5-7B-Instruct` | 100/100 | ~2.4 tok/s | 3.9 GB |

Both fit against the full 14GB total — but real free RAM under normal working
load (this session plus one other concurrent local session plus a browser)
measured **3.7GB, not 14GB**. `qwen2.5:7b`'s 3.9GB requirement is essentially
all of that. Doesn't change §5's model choice; does mean "fits" should be
read against ~3.7GB free, not the on-paper total, before adding any more
always-on local-model load (the §3 sweep included).

**`test-guard`/`test-shell` confirmed already fixed** (37/22+ assertions,
matching `docs/RECONCILE_v4.md`) — re-verified directly, no further action
needed there.
