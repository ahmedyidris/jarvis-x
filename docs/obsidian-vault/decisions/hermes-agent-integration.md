---
title: hermes-agent integration status
date: 2026-08-31
status: in progress — owned by a parallel session
---

# hermes-agent (Hermes Agent CLI) integration

**Not the same thing as this repo's own `hermes.py`/`HermesCore`** — that
naming collision already confused one install attempt (see below). This
page tracks the third-party `hermes-agent` CLI being wired up as an
additional tool, being done by a parallel Claude Code session
(`ahmedyidris-57`), coordinated via cross-session messages rather than
directly in this vault's own history.

## Settled so far (confirmed against live files, not assumed)

- Lives in its own `~/.venvs/hermes`, deliberately separate from `venv-ai`
  (which had real version conflicts — pillow/websockets/packaging/Markdown/
  certifi/rich/requests had to be force-reinstalled back to pinned versions
  there after a stray install attempt).
- **Local-only, confirmed twice:** an `OPENROUTER_API_KEY` was tried in
  `~/.hermes/.env` and explicitly removed. No cloud key.
- Provider wiring: `~/.hermes/config.yaml`'s `custom_providers:` block
  points at local Ollama (`http://127.0.0.1:11434/v1`) directly — not
  hermes-agent's own built-in Ollama provider path.
- **Context-window requirement:** hermes-agent hard-requires the primary
  model to report `>=64,000` tokens, no override. `qwen2.5-3b-64k` (a
  `Modelfile` context bump) was tried and confirmed dead —
  `~/.hermes/context_length_cache.yaml` never exceeded 32768. Superseded by
  pulling `phi3.5` (128K native context) instead — see
  [[ollama-signing-key-permission-fix]] for what had to be fixed first to
  make that pull possible at all.

## Next steps (owned by `ahmedyidris-57`, confirmed untouched here)

1. Wire hermes-agent as an MCP server for Claude Code.
2. Add it to `code/providers/registry.js` as an alt backend.

## Standing rule for future sessions

Don't re-derive the `qwen2.5-3b-64k` dead end or re-litigate local-only —
both are settled. Check with whichever session owns this work before
touching `~/.hermes/`, `~/.venvs/hermes/`, or `registry.js`, to avoid
colliding with in-flight changes.

## Related, but a false lead — checked and ruled out

`.claude/agents/` (the 273-persona `agency-agents` roster, see
[[2026-08-31-tool-inventory]]) also offers a `hermes` integration target
(a lazy-router plugin at `~/.hermes/plugins/`) — checked `~/.hermes/`
first and found it's this repo's own `hermes.py` state directory
(`state.db` + generated TTS audio), not the real hermes-agent CLI install
(no `plugins.enabled` config schema present there). Installing that target
would have written a plugin nothing loads. Skipped.
