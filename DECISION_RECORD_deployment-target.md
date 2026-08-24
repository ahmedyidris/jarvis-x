# Decision Record — canonical deployment target

**Date:** 2026-08-24
**Question:** Delivery phase is at 70% with the .deb (Electron) install and the Docker image on ghcr both existing but no stated relationship between them. Which is canonical?

**Decision: Dual-target, explicitly.** Electron `.deb` is the interactive/desktop path; the ghcr Docker image is the headless path, positioned for the eventual robot deployment goal recorded in project memory. Neither supersedes the other.

## Rationale

- The desktop `.deb` is already installed and launcher-registered — it's the right shape for Ahmed's own day-to-day Chromebook/Crostini use (interactive chat, dashboard).
- The long-term stated goal (see `~/.claude` memory `jarvis-x-project`) is eventual robot deployment, which will not run an Electron desktop shell — a container is the natural target there.
- Building one and deprecating the other would throw away already-working, tested delivery surface for no immediate gain.

## What "dual-target" requires going forward (not yet built — tracked here, not assumed done)

1. **State/config sharing contract.** Both paths currently assume `~/.jarvis-x/` (env, kill-switch `STOP` file per `code/guard.js`'s actual enforced path) and `~/jarvis-x/` (file-jail root per `knowledge/Guidelines.md`) as fixed host paths. The container needs an explicit decision on whether it bind-mounts these from the host (shares state with the desktop install) or owns its own copy (fully independent instance) — **not decided yet, follow-up**.
2. **Guard/kill-switch parity.** `code/guard.js` is Edit-denied and self-protection-critical (see `jarvis-x-project` memory). Whatever the container does, it must not get an independent, unguarded code path around the same kill switch — needs verification the container image includes the guard as-is, not a stripped build.
3. **Single source of truth for "which one is running."** No conflict-detection today if both the desktop app and a container are live against the same `~/.jarvis-x/` state simultaneously — flagged, not solved.

## Net

Both delivery paths stay in active use. Item 1–3 above are the real remaining Delivery-phase work (this is *why* Delivery was sitting at 70%, not just "needs a checkbox") — not closed by this record, just no longer ambiguous about direction.
