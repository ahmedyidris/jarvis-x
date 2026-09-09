# HANDOFF — two Claude Codes, one repo

Two agents work this repo: a **remote** cloud session (claude.ai/code) and the
**local** one on the Chromebook. Plus Ahmed. The failure mode this file prevents
is not disagreement — it is two agents pushing to the same branch and silently
overwriting each other's work.

## The protocol

**1. Branch namespaces never overlap.**

| Who | Branch prefix |
|---|---|
| Remote cloud session | `claude/remote-*` (also the older `claude/new-session-*`) |
| Chromebook, local | `claude/local-*` |
| `master` | written **only** by a merged PR |

Never push to the other side's namespace. Never force-push anything but your own
branch.

**2. Read before you write.** Every session, before touching a file:

```bash
git pull origin master && cat HANDOFF.md
```

**3. Claim, then push the claim immediately** — before doing the work, so the
other side sees it before it starts. Append a row to the log below, commit it
alone, push it.

**4. Append-only.** Add rows. Never rewrite or delete someone else's. Same
discipline as `logs/actions.jsonl`, for the same reason.

**5. Release when done** by appending a `DONE` row naming the PR.

## Why not something cleverer

A lock server or coordination daemon is more machinery than two agents and one
human can justify, and it is one more thing that can be down. Git already has
the only primitive that matters: a push either fast-forwards or it is rejected.
If two claims collide, the second push is refused and that agent re-pulls — the
conflict surfaces immediately instead of becoming a lost commit.

## Standing division of labour

Not a rule, a default — it follows from what each side can actually reach.

| The Chromebook is the only place that can | The remote session is better at |
|---|---|
| Run the five hardware suites (`test-kokoro`, `test-vision`, `test-voice`, `test-voice-interaction`, `test-voice-router`) | Long refactors and full-suite mutation testing |
| Anything needing `ollama`, a real GPU-less inference run, audio out, or a camera | Reading the whole repo at once |
| Anything needing `~/.jarvis-x/` — the real `.env`, the real `STOP` file, the real audit log | Opening and driving PRs to green |
| Confirming what is actually installed | Work that would tie up the machine Ahmed is using |

When in doubt: **if it needs the hardware, it belongs to local.** If it needs
patience, it belongs to remote.

## Live ownership — files with a known owner

Registered because it already went wrong once: on 2026-09-09 the remote session
wrote `docs/PLAN_5.md` while the local session was independently composing
`MASTER_PLAN_v5.md`. Neither knew. Nothing was lost only because the local work
was unpushed.

| Path | Owner | Note |
|---|---|---|
| `app.py` | **local** | Do not touch from remote. |
| `code/verticals/**` | **local** | The clipper work. Do not touch from remote. |
| `MASTER_PLAN_v4.md`, `MASTER_PLAN_v5.md` | **local** | Local-only, unpushed as of 2026-09-09. |
| `docs/PLAN_5.md` | **remote** | The ruled mission + evidence. **Merge into, do not duplicate.** |
| `HANDOFF.md` | shared | Append-only. Everyone writes, nobody rewrites. |
| `docs/RECONCILE_v4.md` | remote | Evidence pass on the blueprint. |
| `memory/rules.md`, `CONSTITUTION.md` | **Ahmed only** | Neither agent amends these without an explicit approval from him, in his own words, for that specific file. |

**If you are the local session and about to write a Plan 5:** `docs/PLAN_5.md`
already exists on `master` and carries Ahmed's 2026-09-09 rulings on trading
(two-phase, switchable) and content (his voice, Jarvis's production line). Merge
your `MASTER_PLAN_v4.md` content into it rather than creating a third plan
document — the whole point of this file is that there is one.

## Claim log

Newest at the bottom. Format:

```
<UTC timestamp> | <remote|local> | <CLAIM|DONE> | <branch> | <what>
```

---

2026-09-09T00:30Z | remote | CLAIM | claude/new-session-ojg9ah | PLAN_5 + this file + RECONCILE_v4 update
2026-09-09T00:30Z | remote | DONE  | claude/new-session-ojg9ah | see PR — PLAN_5.md, HANDOFF.md, RECONCILE_v4.md
2026-09-09T00:45Z | remote | CLAIM | claude/new-session-ojg9ah | PLAN_5 §6.1 + §6.2 rulings applied; ownership table added
