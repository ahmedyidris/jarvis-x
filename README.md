# Jarvis X

A locally-first, autonomous personal AI assistant, built and run on Ahmed's ASUS Chromebook (Crostini/Debian 12). See `CONSTITUTION.md` for the governing rules and `docs/architecture.md` for the full system design this README summarizes.

## What it is

Jarvis X is actually three separate systems sharing one repo, one kill switch, and (for two of the three) a local Ollama instance:

1. **Web chat** — a FastAPI backend (`app.py`) + React/Vite PWA frontend (`web/`) for talking to Jarvis directly. 100% local (Ollama `qwen2.5:3b`/`7b`), with local voice in (`code/stt_engine.py`, faster-whisper) and out (`code/tts_engine.py` — Piper, Kokoro, or EGTTS-V0.1 for Egyptian Arabic).
2. **JS agent-autonomy loop** — `code/agent.js` (a human present, proposes one action at a time) and `code/scheduler.js` (unattended, read-only actions only; anything else queues for human review). Every action is structurally validated, gated by a kill switch, and logged append-only. Governed by `CONSTITUTION.md`.
3. **Phase B** — a batch video-generation pipeline (`automation/phase-b/`) that turns real, WebSearch-sourced facts (or, for one kids'-content vertical, LLM-invented content) into short-form vertical MP4s. Four verticals today: `letters`, `economic_facts`, `commodities_macro`, `geopolitical_risk`.

**Not part of Jarvis X**, despite sharing this git repo: `sentinel/` (a separate AI incident-response portfolio project — see `sentinel/README.md`), `automation/n8n/`.

## Quick start

### Fresh install on a new machine

```bash
git clone https://github.com/ahmedyidris/jarvis-x.git && cd jarvis-x
bash bootstrap/install.sh
```

Provisions system packages, Node 20, Ollama + models, the Python venv, both npm workspaces, all Claude Code skills/plugins, the guardrail settings, and the systemd supervisor unit. See `bootstrap/README.md` for exactly what each step does and what it deliberately does *not* restore (secrets — you fill those in by hand afterward).

### Using it

Once running (`supervisorctl -c config/supervisord.conf status` shows `ollama` + `hermes-api` both `RUNNING`):

- **Chat:** open the web UI the frontend serves — text in, optional voice out.
- **One-off JS agent action:** `node code/agent.js "your goal"` — proposes one action, asks you to approve anything beyond read-only.
- **Check system health:** `bash scripts/status.sh` — runtime versions, Ollama reachability, full test suite, git integrity, safety invariants, milestone percentage. Add `--net` to also hit live Gemini + the local model.
- **Kill switch:** `touch .jarvis-x-STOP` at the repo root halts the JS agent-autonomy path within 10 seconds. `rm .jarvis-x-STOP && supervisorctl -c config/supervisord.conf restart hermes-api` resumes. (Note: this currently does **not** stop web chat itself — see `docs/architecture.md`'s kill-switch section for why that's a real open decision, not an oversight.)

## Architecture (summary — full detail in `docs/architecture.md`)

```
Browser (PWA) ──> app.py (FastAPI) ──> hermes.py ──> code/router.py ──> Ollama (local)
                                    └─> tts_engine.py / stt_engine.py (voice)

code/agent.js ────┐
code/scheduler.js ─┤──> validate.js ──> guard.js (kill switch + audit log) ──> lib.js execute()
                                                                                  ├─> exec.js (jailed FS)
                                                                                  ├─> shell.js (allowlisted)
                                                                                  └─> router.js ──> gemini.js (Gemini, gated)

automation/phase-b/*_generator.py ──> Ollama (narration only, never the fact source)
                                   └─> video_renderer.py ──> tts_engine.py + MoviePy ──> MP4
```

Built but deliberately **not** wired into the agent loop: `packages/model-gateway` — a fully tested, standalone multi-provider routing/circuit-breaker/budget package. See `DECISION_RECORD_model-gateway.md`.

## Rules (see `CONSTITUTION.md` for the full, authoritative version)

1. Every action that touches the filesystem, network, or money goes through `guard()`. This is a convention the caller must cooperate with, not a sandbox — a stray raw `fs`/`subprocess` call bypasses it entirely.
2. `code/guard.js`, `code/validate.js`, `knowledge/Guidelines.md`, `memory/rules.md` are off-limits to self-modification (enforced via Claude Code's own deny-list, not a repo mechanism) — whatever can edit its own code must not be able to edit its own constraints.
3. No trading, simulated or real. Ruled out 2026-09-04 and the module deleted — `CONSTITUTION.md` §IV forbids it outright rather than permitting a testnet carve-out.
4. Unattended (`scheduler.js`) means read-only. `write`/`shell` proposals always queue for a human, never auto-execute, even structurally-valid ones.
5. A degraded model backend must never skip the human-approval gate. Gating is decided by action *level*, never by which model ultimately answered.

## Logs

- `logs/decisions.jsonl` — what the JS agent thought (prompt + answer + model)
- `logs/actions.jsonl` — what it did, and what it was blocked from doing
- `~/.hermes/state.db` (SQLite) — the web-chat conversation history

## Current status

See `scripts/status.sh`'s live output for the authoritative number — as of this writing, 23/24 milestones, 65+/67 checks passing. The one open milestone (`self-debug loop`) is **deliberately deferred**, not missing: see `NOTES.md`'s stated condition ("revisit when the accuracy number is boring") and `REMAINING_WORK.md` for the current backlog.

## Development

See `docs/DEVELOPMENT.md` for how to add a new Phase B vertical, how to test locally before pushing, and known issues with workarounds.

## Rebuilding on a new machine

See "Quick start" above and `bootstrap/README.md`.
