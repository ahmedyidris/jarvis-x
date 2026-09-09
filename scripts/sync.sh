#!/usr/bin/env bash
# TWO-WAY SYNC between the Chromebook session and the remote cloud session.
#
# WHY THIS EXISTS AND NOT SOMETHING CLEVERER. Peer messaging does not work
# between the two: ListAgents reports nothing reachable from either side, the
# local session's sends to jarvis-x-19 failed, addressing the Chromebook
# session by name returns "no agent reachable", and the remote session's MCP
# server exposes no send_message. Live messaging needs Remote Control connected
# on BOTH ends. Git is the only channel that actually works today, and it
# already has the primitive that matters -- a push either fast-forwards or it
# is rejected -- so a collision surfaces instead of becoming a lost commit.
#
# THE FAILURE IT PREVENTS, which already happened once: on 2026-09-09 the
# remote session wrote docs/PLAN_5.md while the local session was independently
# composing MASTER_PLAN_v5.md. Neither knew. Nothing was lost only because the
# local work was unpushed. HANDOFF.md is the protocol; this is the thing that
# runs it so it does not depend on either side remembering.
#
# WHAT IT WILL NOT DO, deliberately:
#   - never push to the other side's branch namespace
#   - never force-push, rebase, or amend
#   - never merge into a dirty working tree
#   - never commit on your behalf
# Read-only by default. Pass --push to actually push your own branch.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

PUSH=0
for a in "$@"; do [ "$a" = "--push" ] && PUSH=1; done

# Which side am I? Decided by branch namespace, per HANDOFF.md. Anything else
# is "unknown" and gets read-only treatment -- guessing wrong is how you push
# to someone else's branch.
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
case "$BRANCH" in
  claude/local-*)                     SIDE=local ;;
  claude/remote-*|claude/new-session-*) SIDE=remote ;;
  master)                             SIDE=master ;;
  *)                                  SIDE=unknown ;;
esac

# Where we last synced from, so "what changed" means something. Kept in .git/
# on purpose: it is per-checkout state, and versioning it would make the two
# sides fight over one file.
MARK=".git/jx-last-sync"

say() { printf '%s\n' "$*"; }
hr()  { printf '%s\n' "────────────────────────────────────────────────────────"; }

hr
say "JARVIS-X SYNC   side=$SIDE   branch=${BRANCH:-<detached>}"
hr

# 1. Fetch. Retry on network flake rather than reporting a false "no changes".
ok=0
for i in 1 2 3 4; do
  if git fetch --quiet origin 2>/dev/null; then ok=1; break; fi
  say "  fetch failed (attempt $i) — retrying"
  sleep $((2 ** i))
done
[ "$ok" = 1 ] || { say "  FETCH FAILED after 4 attempts. Nothing below is current — stopping."; exit 1; }

REMOTE_MASTER=$(git rev-parse --short origin/master)
say "  origin/master  $REMOTE_MASTER  $(git log -1 --format=%s origin/master | cut -c1-58)"

# 2. What the other side did since you last looked.
LAST=$(cat "$MARK" 2>/dev/null || echo "")
if [ -n "$LAST" ] && git cat-file -e "$LAST^{commit}" 2>/dev/null; then
  N=$(git rev-list --count "$LAST..origin/master" 2>/dev/null || echo 0)
  if [ "$N" -gt 0 ]; then
    say ""
    say "  $N new commit(s) on master since your last sync:"
    git log --oneline "$LAST..origin/master" | sed 's/^/    /'
    # The inbox is how the two sides talk. Say so only when it actually moved.
    if ! git diff --quiet "$LAST" origin/master -- HANDOFF.md 2>/dev/null; then
      say ""
      say "  >>> HANDOFF.md CHANGED — read the Inbox section before you write anything."
    fi
  else
    say "  nothing new on master since your last sync"
  fi
else
  say "  (first sync on this checkout — no baseline to diff against)"
fi

# 3. Your own unpushed work.
say ""
if [ "$SIDE" = "master" ]; then
  # Not "claude/${SIDE}-*" -- that interpolated to claude/master-*, a namespace
  # HANDOFF.md does not define. Naming a lane that does not exist is worse than
  # naming none.
  say "  You are on master. Work belongs on claude/local-* (Chromebook) or"
  say "  claude/remote-* (cloud); master is written only by a merged PR. Not pushing."
elif [ "$SIDE" = "unknown" ]; then
  say "  Branch '$BRANCH' is outside both namespaces in HANDOFF.md. Read-only:"
  say "  pushing it could land in the other side's lane. Rename to"
  say "  claude/local-* or claude/remote-* first."
else
  UP=$(git rev-list --count "origin/master..HEAD" 2>/dev/null || echo 0)
  if [ "$UP" = 0 ]; then
    say "  your branch has nothing master does not already have"
  else
    say "  $UP commit(s) on $BRANCH not yet on master:"
    git log --oneline origin/master..HEAD | sed 's/^/    /'
    if [ "$PUSH" = 1 ]; then
      if [ -n "$(git status --porcelain)" ]; then
        say ""
        say "  NOT pushing: working tree is dirty. Commit or stash first —"
        say "  pushing half a change is how the other side gets a broken tree."
      else
        say ""
        say "  pushing $BRANCH ..."
        pok=0
        for i in 1 2 3 4; do
          if git push --quiet -u origin "$BRANCH" 2>/dev/null; then pok=1; break; fi
          say "    push failed (attempt $i) — retrying"
          sleep $((2 ** i))
        done
        [ "$pok" = 1 ] && say "  pushed." || say "  PUSH FAILED after 4 attempts."
      fi
    else
      say "  (re-run with --push to push it)"
    fi
  fi
fi

# 4. Is master ahead of you? Report; never merge into a dirty tree, and never
#    silently. A merge is a decision, and it can conflict.
say ""
BEHIND=$(git rev-list --count "HEAD..origin/master" 2>/dev/null || echo 0)
if [ "$BEHIND" -gt 0 ]; then
  say "  master is $BEHIND commit(s) ahead of your branch."
  if [ -n "$(git status --porcelain)" ]; then
    say "  Working tree is dirty — not merging. Commit or stash, then:"
  else
    say "  To bring it in:"
  fi
  say "    git merge origin/master        # merge, never rebase: the other side's checkout stays valid"
else
  say "  your branch contains everything on master"
fi

# 5. Record where we looked, so the next run can diff against it.
echo "$REMOTE_MASTER" > "$MARK"

say ""
hr
say "Next: append a claim row to HANDOFF.md before you start work, and push it"
say "immediately — the other side can only see what has been pushed."
hr
