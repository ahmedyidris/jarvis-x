# Jarvis X — Operating Architecture & Context

**Corrected 2026-09-09** — this section previously listed several things
that were never built (`hermes3:3b`, `remote.futrx`/DuckDNS/LXD) and one
wrong path (the kill switch). Corrected against the actual codebase, not
retroactively softened — see `git log -p -- CLAUDE.md` for what changed
and why, or `AS_BUILT.md`'s 2026-09-09 entry for the fuller session record.

## Hardware & Environment
- Host: a physical machine running Debian 13 (trixie) inside Crostini —
  `llmfit doctor` (see below) identifies the real CPU as an **11th Gen
  Intel Core i5-1135G7 @ 2.40GHz, 8 threads, no GPU**, 14.1 GB total RAM.
  "Asus Chromebook" describes the host device; the CPU above is what
  local inference actually runs on.
- Target constraint: CPU-only inference. `llmfit` (see below) puts real
  numbers on this: `qwen2.5:3b` benchmarks at ~6 tok/s baseline,
  `qwen2.5:7b` at ~2.4 tok/s on this hardware — both "fit" at 14 GB
  total, but `qwen2.5:7b` needs ~3.9 GB free, and this box regularly
  runs with only 3-4 GB actually free once dev sessions/browser
  processes are up. 70B+ models are not just slow here, they're a
  different-order mistake.

## Multi-Agent Architecture
1. Local Inference (Ollama @ localhost:11434), models pulled per
   `bootstrap/install.sh` step 3 — verified present 2026-09-09:
   - Fast Router & Chat: `qwen2.5:3b` (local tier) / `qwen2.5:7b`
     (quality tier) — see `code/router.py`'s `TIERS`. There is no
     `hermes3:3b` anywhere in this codebase; "Hermes" in this project
     means `hermes.py`'s `HermesCore` (the Python conversation/routing
     layer), not an Ollama model of that name. Don't pull one expecting
     it to be load-bearing here.
   - Vision & Multimodal: `moondream`.
   - Memory Embeddings: `nomic-embed-text` — pulled and present, but as
     of 2026-09-09 nothing in `code/` or `hermes.py` actually calls it
     yet (no ChromaDB integration found). Available, not wired in.
   - `llmfit` (`pip install llmfit` into `venv-ai`, installed 2026-09-09)
     — right-sizes model choices against this hardware's real RAM/CPU
     profile. Run `llmfit --ram 14G fit --json` or `llmfit doctor` before
     adding any new local model to the architecture, not after.
2. Builder & Reviewer:
   - Claude Code CLI for development passes, diff generation, and test
     verification. Plugins: `ecc@ecc` (marketplace-installed) plus, as
     of 2026-09-09, the official marketplace's `frontend-design`,
     `superpowers`, `code-review`, `skill-creator`, `code-simplifier`,
     `github`, `playwright`, `claude-md-management`, `feature-dev`,
     `typescript-lsp`, `claude-code-setup`, `commit-commands`,
     `context7` (see `bootstrap/install.sh` step 7 for the canonical
     list this was installed from).
3. Free Cloud Offloading — two genuinely separate things, don't conflate
   them:
   - **Gemini CLI** (`@google/gemini-cli`, installed globally
     2026-09-09, `gemini --version` → 0.59.0) — an interactive/agentic
     coding assistant in its own right, analogous to Claude Code, with
     its own context file (`GEMINI.md`, see that file at repo root).
     **Not yet authenticated** — needs either an interactive Google
     OAuth login or a `GEMINI_API_KEY`/`GOOGLE_API_KEY` env var, neither
     of which a Claude Code session can do on Ahmed's behalf (OAuth is
     interactive; the key lives in `~/.jarvis-x/.env`, which is
     Read+Edit-denied to Claude Code by design). All of that is still
     true. **What was overstated, and is corrected here 2026-09-09: this
     is not "currently-blocking".** Grepped — *nothing in this codebase
     invokes the `gemini` binary*. Every `gemini` hit in `code/`,
     `automation/` and `bootstrap/` is either the registry's HTTPS path
     (next bullet) or a test fixture string in `code/test-guard.js`. So
     an unauthenticated CLI blocks Ahmed from using a second interactive
     assistant on his own machine — real, and worth two minutes of his
     time — and blocks no build, test, or runtime path in Jarvis. It is
     a workstation setup task, not a deployment blocker, and it was
     listed as the latter in a blocker review before anyone checked what
     depended on it.
   - **`code/gemini.js` / `code/providers/registry.js`** — the
     always-has-been remote-tier path used *inside* Jarvis's own JS
     agent-autonomy loop (`code/agent.js`, `code/scheduler.js`,
     the P4 semantic-fidelity judge in
     `automation/phase-b/content_generator.py`). Registered providers
     there, each self-disabling without its key: **Gemini**
     (`gemini-3.6-flash`, quality tier), **Groq**
     (`openai/gpt-oss-120b`, fallback/smart tier), **OpenRouter**
     (fallback). There is no DeepSeek integration anywhere in this
     codebase — if DeepSeek access is wanted, it isn't built yet, it's
     backlog.
4. Remote Access & Workspaces:
   - **Not built.** No `futrx`, DuckDNS, or LXD reference exists
     anywhere in this repo outside this file's own prior (now corrected)
     claim — grepped 2026-09-09, zero hits. Treat this as a future
     idea, not current architecture, until it has actual code behind it.
   - Sync Layer: GitHub repository (ahmedyidris/jarvis-x) acts as the
     single source of truth. This part is real and in daily use.

## Safety & Governance
- Kill switch: `code/guard.js`'s real `STOP_FILE` is **`.jarvis-x-STOP`
  at the repo root**, not `~/.jarvis-x/STOP` — the path this section
  used to state. `~/.jarvis-x/` does exist, but it holds `.env` (secrets)
  and per `bootstrap/claude-settings.template.json` is Read+Edit-denied
  to Claude Code; it is not where the switch lives. `touch .jarvis-x-STOP`
  at repo root halts the JS agent-autonomy path within 10 seconds (does
  **not** currently stop web chat itself — see `docs/architecture.md`
  for why that's an open decision, not an oversight).
- Audit trail: every gated action logs to `logs/actions.jsonl`
  (`code/guard.js`'s `logAction()`), append-only. As of 2026-09-09 this
  file doesn't exist yet on this machine — meaning no gated action has
  run here in production yet, not that logging is broken; it's created
  on first write.
- Trading policy: **Real-money trading of any kind is forbidden, always**
  (`CONSTITUTION.md` §IV). Simulation is a different matter and is
  currently **live and enforced**: `code/paper-trading.js` +
  `config/trading.json`'s six-instrument limit, proven by
  `code/test-paper-trading.js`. The module takes prices as arguments and
  opens no sockets, so there is no code path to a broker to disable —
  see `DECISION_RECORD_paper-trading.md` for the full history (reversed
  twice in one evening before landing here) and what would reverse it
  again. **`README.md`'s Rules §3 ("module deleted") is stale on this
  point** — flagged, not yet fixed there as of this edit.

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
