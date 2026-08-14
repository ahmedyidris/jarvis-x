# Jarvis X

Autonomous agent running on ASUS Chromebook CX5500FE (Crostini/Debian 12).

## Architecture

- `code/local.js` — inference via Ollama (qwen2.5:1.5b, local, offline, unlimited)
- `code/query.js` — loads Guidelines.md into every prompt, logs to decisions.jsonl
- `code/models.js` — model routing. Local first; APIs are fallbacks
- `code/guard.js` — **kill switch + action log. Nothing acts without passing through this**
- `code/exec.js` — file operations, jailed to ~/jarvis-x/
- `code/stop.js` — `node code/stop.js [|off|status]`

## Rules

1. **Every action that touches the filesystem, network, or money goes through `guard()`.**
   guard() is a convention, not a sandbox — direct `fs` calls bypass it entirely.
   That convention holding is the only thing that makes the kill switch real.
2. **`guard.js` and `Guidelines.md` are off-limits to self-modification.**
   Whatever edits itself must not be able to edit its own constraints.
3. **Paper trading only** until decisions.jsonl shows a long run of calls I agree with.
   A file bug costs a git revert. A trade bug costs money and can't be reverted.

## Logs

- `logs/decisions.jsonl` — what it thought (prompt + answer + model)
- `logs/actions.jsonl` — what it did, and what it was blocked from doing

## Kill switch

Flag file at `~/.jarvis-x/STOP`. Present = everything halts.
Verified: run → blocked → run, and jail refuses `../` and absolute-path escapes.

## Other subprojects

- `sentinel/` — a separate portfolio project (AI incident-response copilot).
  Not part of the jarvis-x agent; doesn't go through `guard.js` or the kill
  switch. See `sentinel/README.md`.

## Rebuilding on a new machine

`bootstrap/` has a one-command installer that restores everything from this
repo — system packages, Ollama models, the Python/Node environments, **all
installed Claude Code skills and plugins**, the guardrail settings, and the
systemd supervisor unit. See `bootstrap/README.md`.

```bash
git clone https://github.com/ahmedyidris/jarvis-x.git && cd jarvis-x
bash bootstrap/install.sh
```
