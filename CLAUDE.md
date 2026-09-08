# Jarvis X — Operating Architecture & Context

## Hardware & Environment
- Host: Asus Chromebook, Debian Crostini, 14 GB RAM, CPU-only (no GPU acceleration).
- Target constraint: Lightweight CPU inference only; avoid 70B+ local models to prevent system lockouts.

## Multi-Agent Architecture
1. Local Inference (Ollama @ localhost:11434):
   - Fast Router & Chat: qwen2.5:3b / hermes3:3b (CPU-safe, 5-10s response).
   - Vision & Multimodal: moondream.
   - Memory Embeddings: nomic-embed-text for ChromaDB vector search.
2. Builder & Reviewer:
   - Claude Code CLI for development passes, diff generation, and test verification.
3. Free Cloud Offloading:
   - Gemini CLI: 1M token context for repository analysis and heavy docs.
   - DeepSeek Harness / OpenRouter: Inexpensive agent loops.
4. Remote Access & Workspaces:
   - remote.futrx: External VPS gateway for isolated LXD agent workspaces and iPhone dashboard access via DuckDNS.
   - Sync Layer: GitHub repository (ahmedyidris/jarvis-x) acts as the single source of truth.

## Safety & Governance
- Kill switch: Presence of ~/.jarvis-x/STOP halts all automated actions immediately.
- Audit trail: All executions and tool verdicts log to logs/actions.jsonl.
- Trading policy: Testnet / paper trading only; real-money execution is strictly forbidden.

## Delivery Standard
When implementing a feature, favor the complete version over the partial one when the
extra cost is small: real tests over none, docs over a bare diff, the actual fix over a
workaround when the real fix is in reach. This is a default to lean on, not a rule that
overrides judgment — still scope down, pause to check in, or flag a workaround explicitly
when the situation calls for it (unclear requirements, a change that's hard to reverse,
genuine time/complexity tradeoffs worth surfacing to the user).

## Installed Plugins
- ECC (affaan-m/ECC): agent/skill/command marketplace, installed via `claude plugin
  marketplace add` + `claude plugin install ecc@ecc`. Run `/plugin configure ecc@ecc` to
  finish its 2 pending config options.
- gstack (garrytan/gstack): cloned into ~/.claude/skills/gstack, set up via its own
  `./setup` script (requires the `bun` runtime, installed alongside it). Builds a
  Playwright-based browser-automation binary — heavier footprint than a typical plugin,
  worth knowing about on a 14 GB CPU-only host.
