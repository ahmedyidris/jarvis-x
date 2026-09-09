# Jarvis X — Context for Gemini CLI

This file is the Gemini CLI (`@google/gemini-cli`) equivalent of `CLAUDE.md`.
Gemini CLI loads `GEMINI.md` hierarchically (global `~/.gemini/GEMINI.md`,
then this project file, then any subdirectory ones near the files it's
touching) and concatenates them into every prompt. If you're reading this
as a human: `CLAUDE.md` is the fuller, more actively maintained reference —
this file exists so Gemini CLI sessions get the same grounding, not a
competing description. When the two disagree, `CLAUDE.md` is authoritative;
fix this file to match, not the other way around.

**Created 2026-09-09**, alongside installing `@google/gemini-cli` (0.59.0)
into this project's toolchain. Not yet authenticated on this machine — see
"Auth status" below before assuming any Gemini CLI command here can reach
the network.

## What Jarvis X is

Three separate systems sharing one repo, one kill switch, and (for two of
three) one local Ollama instance:

1. **Web chat** — `app.py` (FastAPI) + `web/` (React/Vite PWA). 100% local
   by default: Ollama `qwen2.5:3b`/`qwen2.5:7b` via `hermes.py` →
   `code/router.py`. Voice in (`code/stt_engine.py`, faster-whisper) and
   out (`code/tts_engine.py` — Piper, Kokoro; Egyptian Arabic voice-cloning
   via a separate `tts_worker.py` service, currently down on this box —
   missing the `chatterbox` package and ~5GB of model/reference-audio
   assets that aren't restored by `bootstrap/install.sh`).
2. **JS agent-autonomy loop** — `code/agent.js` (human-present, proposes
   one action at a time) and `code/scheduler.js` (unattended, read-only
   only). Every action is structurally validated, gated by the kill
   switch, and logged append-only. Governed by `CONSTITUTION.md`. This is
   the path that calls Gemini/Groq/OpenRouter remotely
   (`code/providers/registry.js`), gated through `guard()`.
3. **Phase B** — `automation/phase-b/`, a batch pipeline turning sourced
   facts into short vertical MP4s across four verticals (`letters`,
   `economic_facts`, `commodities_macro`, `geopolitical_risk`). Three of
   the four (not `letters`, which has no sourced fact to be unfaithful to)
   run a Gemini-judge semantic-fidelity gate
   (`content_generator.py`'s `check_semantic_fidelity()`/
   `enforce_semantic_fidelity()`) before writing output — majority-voting
   across 3 calls, Groq as fallback when Gemini's free tier is exhausted.

**Not part of Jarvis X**, despite sharing this repo: `sentinel/` (a
separate AI incident-response portfolio project) and `automation/n8n/`.

## Where Gemini already fits into this system (before this CLI existed)

Don't assume "Gemini" means "the Gemini CLI you're running as." This
codebase called the Gemini API directly, months before the CLI was
installed here:
- `code/gemini.js` — `ask()`/`askFallback()` against `gemini-3.6-flash`
  (quick tier) and `gemini-3.5-flash` (hard tier), key from
  `~/.jarvis-x/.env`, gated through `guard()`.
- `content_generator.py`'s `_call_gemini_judge()` — the P4 semantic-
  fidelity judge described above.

Both of those are Jarvis's own code calling the Gemini API as a remote
model provider. The Gemini CLI is a separate, independent tool — an
interactive coding assistant analogous to Claude Code, not a component
Jarvis's runtime calls into. If you're a Gemini CLI session reading this
file, you are the "Builder & Reviewer" role here (same category as Claude
Code), not part of the "Free Cloud Offloading" tier described above — that
tier is Jarvis's own code hitting the Gemini API directly, independent of
whether this CLI is installed or authenticated.

## Hardware & real constraints

Physical machine inside Crostini, not the "Chromebook" name alone: 11th
Gen Intel Core i5-1135G7 @ 2.40GHz, 8 threads, no GPU, 14.1 GB total RAM
(confirmed via `llmfit doctor`, installed 2026-09-09). CPU-only inference
only — `qwen2.5:3b` benchmarks ~6 tok/s, `qwen2.5:7b` ~2.4 tok/s on this
hardware (`llmfit --ram 14G info "Qwen/Qwen2.5-<N>B-Instruct"`). Real free
RAM under normal dev load (this CLI plus Claude Code plus a browser) runs
3-4 GB, not the full 14 GB — don't recommend adding local model weight
without checking `llmfit fit` against that real headroom, not the
on-paper total.

## Safety & governance (same rules apply to you as to Claude Code)

- Kill switch: `.jarvis-x-STOP` at repo root (not `~/.jarvis-x/STOP`).
  `guard.js`'s `isStopped()` is the actual enforcement point.
- Audit trail: `logs/actions.jsonl`, append-only, written by
  `guard.js`'s `logAction()`.
- `code/guard.js`, `code/validate.js`, `knowledge/Guidelines.md`,
  `memory/rules.md` are off-limits to self-modification. Whatever can
  edit this codebase must not be able to edit its own constraints —
  that includes you.
- Real-money trading: forbidden, always (`CONSTITUTION.md` §IV).
  Simulation (`code/paper-trading.js`) is live and enforced, not
  forbidden — see `DECISION_RECORD_paper-trading.md` before touching
  either claim.
- `~/.jarvis-x/.env` holds secrets (Gemini/Groq/OpenRouter API keys). It
  is Read+Edit-denied to Claude Code by policy
  (`bootstrap/claude-settings.template.json`); apply the same restraint
  here even if your own tool permissions don't structurally enforce it —
  don't read, print, or edit that file.

## Auth status (2026-09-09)

`gemini -p "..."` currently fails with: *"Please set an Auth method in
your ~/.gemini/settings.json or specify one of the following environment
variables... GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI,
GOOGLE_GENAI_USE_GCA."* Not authenticated yet. Two paths, both requiring
Ahmed directly:
1. Interactive OAuth (`gemini` → "Sign in with Google") — can't be done
   from an unattended/headless session.
2. `GEMINI_API_KEY` in `~/.jarvis-x/.env` — same file Jarvis's own
   `code/gemini.js` reads. A Claude Code session can't fill this in (see
   above); a Gemini CLI session reading this file shouldn't either.

## Delivery standard (same as `CLAUDE.md`)

Favor the complete version over the partial one when the extra cost is
small: real tests over none, docs over a bare diff, the actual fix over a
workaround when the real fix is in reach. Still scope down and flag a
tradeoff explicitly when the situation calls for it — this is a default,
not a rule that overrides judgment.
