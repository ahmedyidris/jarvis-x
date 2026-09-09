---
description: Merge MASTER_BLUEPRINT_v4 and the memory template into the repo, asking Ahmed to rule on each open decision
---

Merge the two documents in `docs/incoming/` into this repo's active plan.

You are doing this **on the real Chromebook**, which matters: several claims in
these documents can only be settled here, not in a container.

## Rule zero: verify before you adopt

`docs/RECONCILE_v4.md` already checked these documents against the repo and
found the blueprint is 80 commits stale — five of its claims were false and two
of its priority tasks were already done. **Do not trust that file either.** It
was written on 2026-09-09 and you are running later. Re-derive every number
before you act on it.

Run this first and read the output before anything else:

```bash
git log --oneline -1
for f in code/test-*.js; do
  n=$(node "$f" 2>&1 | grep -oE '^Passed: [0-9]+' | grep -oE '[0-9]+')
  printf '%-45s %s\n' "$f" "${n:-NO ASSERTION COUNT}"
done
bash scripts/status.sh | tail -3
```

Anything that prints `NO ASSERTION COUNT` is a file that cannot report whether
it passed. That is the failure mode this whole exercise exists to catch — say so
explicitly rather than skipping past it.

If a claim in `RECONCILE_v4.md` no longer matches what you just measured,
correct the file as part of this task and say which line changed.

## Then ask, do not decide

There are open decisions in these documents. **Ask Ahmed each one with
`AskUserQuestion`. Do not pick for him, and do not batch them into a summary he
has to unpick.** Where you have a recommendation, put it first and say it is a
recommendation.

Ask in two rounds, four then three.

### Round 1 — scope and priorities

1. **Market Intelligence / paper trading.** The blueprint's §3 cut list says no
   trading. `CONSTITUTION.md` and `memory/rules.md` forbid only *real-money*
   trading, which this is not. But it is no longer the unwired stub the
   blueprint describes: verify with
   `node code/test-paper-trading.js | tail -1` and
   `ls code/*market* code/*trade*`, then present the real size of it.
   Options: formally re-admit to scope / keep parked and tested but unwired /
   delete. **Do not recommend one** — this is his own cut list and it is
   stricter than the constitution on purpose.

2. **The zero-assertion sweep** (blueprint §4.2 item 2). Nothing in this repo
   detects a test that stopped asserting. That exact failure hit four files in
   one session — `test-data-layer.js`, `test-shell.js`, `test-guard.js`,
   `test-agent-data-integration.js` — each found by hand. Recommend building
   it: it is the cheapest permanent defence here, roughly an hour, and it fails
   CI rather than printing a warning nobody reads.

3. **`confidence` and `approved_by` on the audit log.** `logs/actions.jsonl` is
   already the append-only repairs table §4.2 item 1 asks for — schema v4 rows
   carry `origin` and `actor`. The two missing fields are what turn it into the
   gate §4.2 item 3 describes. Recommend adding them, with the same discipline
   as v4: bump to v5, treat a v4 row as *absent*, never as a default value.

4. **Bitemporal memory** (the whole second document). `code/memory.js` is a flat
   JSONL observer today; there is no `valid_from`/`valid_to`, no volatility
   class, no confidence. Building it properly is days, not hours. Recommend
   deferring until Tier 1 of §6 is closed, and ask whether he wants the design
   written down now as a decision record even if unbuilt.

### Round 2 — the things only this machine can settle

5. **The TTS engine conflict** (§2.4). Three engines are named for one role
   across his documents: Piper, Kokoro-82M, and a "Chatterbox Egyptian worker /
   SILMA-9B" pairing. Before asking, check what is actually on this machine:
   `ls ~/.jarvis-x/models/ 2>/dev/null; ollama list`. Ask which is current and
   what the other two refer to.

6. **The five unmeasured suites.** `test-kokoro.js`, `test-vision.js`,
   `test-voice.js`, `test-voice-interaction.js`, `test-voice-router.js` are
   excluded from CI by name because they need hardware. You are on that
   hardware now. Recommend running them and asking whether he wants the results
   folded into `AS_BUILT.md` in this session.

7. **`jj status`.** `bin/jj:34-38` prints `✅ Jarvis X ready` unconditionally
   and checks nothing — a status command that cannot report a problem. Options:
   make it real (query live provider quota and the daemon) or delete the
   subcommand. Recommend making it real; a status command that always says yes
   is worse than no status command.

## Constraints that hold regardless of his answers

- `code/guard.js`, `code/validate.js`, `code/exec.js`, `code/shell.js`,
  `knowledge/Guidelines.md`, `memory/rules.md` and `CONSTITUTION.md` are
  off-limits to agent self-modification, enforced by `OFF_LIMITS` in
  `validate.js`. You are Claude Code, not the agent, so you *can* edit them —
  but if a decision above would change one, say so out loud and get an explicit
  yes for that file.
- No real-money trading, no broker connection, no autonomous trade execution.
  Not up for discussion in this task, whatever he rules on paper trading.
- Nothing binds to `0.0.0.0`. Git stays the sync layer.
- **Never write a test that depends on the control it is testing.** A test that
  wrote `'PWNED'` to the protected paths and relied on the gate under test to
  stop it destroyed six constraint files, twice, when the gate was mutated.

## Finish

- One commit per decision he actually rules on, not one commit for the batch.
- Update `docs/RECONCILE_v4.md` with what he decided and what you measured.
- Add a `superseded by <this file>, <date>` line to the top of any status doc
  the merge makes stale — that is the blueprint's own §4.2 item 4.
- Report what he chose and what you did NOT do because he said no.
