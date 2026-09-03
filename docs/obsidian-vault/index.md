---
title: Jarvis X Vault
---

# Jarvis X — Documentation Vault

Open this `docs/obsidian-vault/` folder as an Obsidian vault to browse with wikilinks and (if you install the community plugin) [Dataview](https://github.com/blacksmithgu/obsidian-dataview) queries. It's git-tracked in the same repo as the code — committing normally to `master` *is* the sync, no separate mechanism needed.

This vault is a navigable companion to the canonical docs, which stay the source of truth for anything code-level:
- [[system-overview]] — start here for the architecture
- `../architecture.md` and `../DEVELOPMENT.md` (outside this vault, in `docs/`) — the fuller, prose versions this vault's architecture notes summarize
- `../../REMAINING_WORK.md`, `../../SESSION_FINAL_REPORT.md` — the working backlog and session history this vault draws from

## Quick links

- **Architecture:** [[system-overview]]
- **Decisions:** [[model-gateway-not-wired]] · [[api-ask-kill-switch-gating]] · [[docker-single-container]] · [[elevenlabs-removed]] · [[deepagents-not-wired]] · [[chatterbox-egyptian-voice-clone]] · [[ollama-signing-key-permission-fix]] · [[hermes-agent-integration]]
- **Phase B verticals:** [[letters]] · [[economic-facts]] · [[commodities-macro]] · [[geopolitical-risk]]
- **Runbooks:** [[add-a-phase-b-vertical]] · [[debug-the-kill-switch]] · [[troubleshooting]]
- **Changelog:** [[2026-08]]
- **Glossary:** [[terms]]

## If you install Dataview

An example query — every decision record in this vault, newest first (needs each decision page's frontmatter `date` field, already set on the ones below):

```dataview
TABLE date, status
FROM "decisions"
SORT date DESC
```
