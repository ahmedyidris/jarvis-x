# Jarvis-X Tool Integration Run

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans to run this phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking. **Stop at any line marked GATE — do not continue past it without Ahmed's explicit go-ahead in the next message.**

**Goal:** Decide, deliberately and one item at a time, which of the ~40 tools vetted and cloned into `~/repos/` this session actually get wired into Jarvis-X (or stay as standalone reference clones) — without repeating the mistake this project already made once and reversed (`docs/obsidian-vault/decisions/model-gateway-not-wired.md`, `deepagents-not-wired.md`): pulling in a new architectural layer to do something the existing code already does.

**Architecture:** Jarvis-X is not a blank slate. It is a live, ~95%-complete system with a real kill-switch (`.jarvis-x-STOP`, checked by `code/guard.js` and `app.py`), a self-amendment-gated `CONSTITUTION.md`, and two separate agent paths (`code/agent.js` — JS autonomy loop, remote Gemini tiers; `hermes.py`/`code/router.py` — Python chat backend, 100% local Ollama). It runs under `jarvis-supervisord.service`. Nothing in this run touches `code/guard.js`, `code/validate.js`, `knowledge/Guidelines.md`, or `memory/rules.md` — those are Edit-denied globally.

**Tech stack:** Node/Python (existing jarvis-x stack). No new framework gets adopted without clearing Phase 0's architecture-fit check.

**Spec:** No separate spec doc — the "requirements" are the vetting verdicts reached over this session's conversation (repo legitimacy, security caveats, GPU/OS compatibility, ChromeOS/Crostini fit). This file is the first artifact organizing them into a decision surface; there was nothing to link to before this.

## Global Constraints

- Never `Edit`/`Write`: `code/guard.js`, `code/validate.js`, `knowledge/Guidelines.md`, `memory/rules.md`, `~/.jarvis-x/.env` (enforced via global `~/.claude/settings.json` deny list, not this repo).
- Kill switch: `/home/ahmedyidris/jarvis-x/.jarvis-x-STOP` — check `code/guard.js`'s `isStopped()` before assuming it's safe to proceed if this file ever exists.
- Test command: `npm test` from `/home/ahmedyidris/jarvis-x` (runs `code/test-*.js` via `jest-runner.js`). Python suite has no single documented command; see `CONTEXT.md`.
- No paid APIs in this repo's own code paths — any new integration that requires one is a human-gated, off-by-default toggle, never automatic (per `CONTEXT.md`'s "No paid APIs" section).
- Operating rule from `DECISION_RECORD_model-gateway.md`: **extend existing patterns, don't invent new ones.** Any candidate that would replace/duplicate `code/agent.js`, `code/router.js`/`.py`, or `hermes.py` needs an explicit justification, not just "the code exists."
- Small verified fixes go directly to `master`; larger work gets a feature branch, independent verification, then merge (per `CONTEXT.md`'s "Git convention" section).

---

### Task 0.1: Re-verify environment health (nothing assumed carried over)

**Files:** none modified — read-only checks.

- [ ] **Step 1:** Confirm kill switch is not engaged: `ls /home/ahmedyidris/jarvis-x/.jarvis-x-STOP` should report "No such file or directory". If it exists, STOP this entire run and report to Ahmed — do not proceed to any later step.
- [ ] **Step 2:** Confirm the live service is actually up: `supervisorctl -c /home/ahmedyidris/jarvis-x/config/supervisord.conf status` — expect `hermes-api` and `ollama` both `RUNNING`. If either is down, note it but do not restart anything in Phase 0.
- [ ] **Step 3:** Run the JS test suite: `cd /home/ahmedyidris/jarvis-x && npm test`. Expect all files to report `✅ PASS`, summary `N passed, 0 failed`. Record the actual N — do not assume it's still 19.
- [ ] **Step 4:** Check disk headroom: `df -h ~ | tail -1`. If available space is under 5GB, stop and flag before cloning/installing anything further in later phases.
- [ ] **Step 5:** Check working-tree status: `cd /home/ahmedyidris/jarvis-x && git status --short`. Expect only pre-existing, not-mine changes (as of this writing: `automation/phase-b/stages/01_source_content/output/letters/letter_A.json` modified, `.token-optimizer/` untracked — both predate this run). Do not commit either as part of this integration work; if new unexpected changes appear, stop and report them rather than committing over them.
- [ ] **Step 6:** Add `.token-optimizer/` to `.gitignore` if still untracked-and-unignored (it's the token-optimizer-mcp plugin's local cache, created by a global tool, not jarvis-x's own code) — one-line addition, commit by itself with message `chore: gitignore token-optimizer-mcp local cache dir`.
- [ ] **Step 7:** Check for OOM kills: `dmesg 2>&1 | grep -i -E "out of memory|oom.kill" | tail -20` (falls back to empty output, not an error, if `dmesg` needs privileges it doesn't have — note that plainly rather than treating silence as "no OOM events"). Also run `journalctl -k --since "-7 days" 2>&1 | grep -i oom | tail -20` and `free -h`. If any jarvis-x process (`ollama`, `node`, `uvicorn`/`hermes-api`) shows up in an OOM kill, or `free -h` shows near-zero available memory with no swap configured, record it — this is diagnostic only in Phase 0, no fix applied here.

### Task 0.2: Build the categorized inventory

**Files:**
- Create: `docs/obsidian-vault/decisions/2026-08-31-tool-inventory.md`

List every entry currently in `/home/ahmedyidris/repos/` (run `ls /home/ahmedyidris/repos` — do not trust the list below if it's stale) into four buckets, one line each with a one-clause reason:

1. **Dev-tooling (for working ON jarvis-x via Claude Code, not something Jarvis-X itself runs):** `code-review-graph`, `claude-code-router`, `claude-task-master`, `claude-code-templates`, `SuperClaude_Framework`, `caveman`, `free-claude-code`, `claude-token-optimizer`, `claude-token-efficient`, `token-optimizer` (alexgreensh), `claude-context`, `claude-usage`, `superpowers-lab`, `superpowers-developing-for-claude-code`.
2. **Standalone personal tools (useful to Ahmed directly, not a Jarvis-X capability):** `Jarvis-Desktop-Voice-Assistant`, `ai-job-search`, `strix`, `book-to-skill`, `opencut`, `open-seo`, `postiz-app`, `hyperframes`, `MoneyPrinterTurbo`, `FinceptTerminal`, `Open-Generative-AI`, `Vibe-Trading` (note: latter two carry real caveats — no-content-filter risk and open security findings + crypto-impersonation, respectively — surface those caveats again in the inventory, don't drop them).
3. **Jarvis-X runtime candidates (plausibly a capability Jarvis-X itself could use):** `browser-use`, `firecrawl`, `camofox-browser` (web browsing/scraping), `anything-llm`, `open-notebook` (RAG/knowledge — check overlap with Jarvis-X's own Ollama chat first), `pipecat`, `OmniVoice` (voice — check overlap/replacement risk against the existing Piper/Kokoro/faster-whisper pipeline before assuming additive), `ai-memory` (cross-session memory — check overlap with `knowledge/`/`memory/` before assuming additive), `crewai`, `cordis` (agent/plugin frameworks — apply the model-gateway/deepagents precedent hard here; default assumption is NO-GO unless a real gap is identified), `OmniRoute` (multi-provider LLM gateway — carries a hardcoded-default-JWT-secret vulnerability; any integration must include changing `JWT_SECRET`/setting `STORAGE_ENCRYPTION_KEY` as a precondition, not an afterthought), `claude-ads` (only relevant if Jarvis-X is ever given ad-account management scope — carries live-credential-write-access caveat), `jarvis-dashboard` (voice-control companion — already deep-dived and cleared, but deployment itself is a separate decision needing your phone/Obsidian/TLS cert setup).
4. **Not integrating (already decided this session):** `deepagents` (NO-GO, documented in `deepagents-not-wired.md`), `agency-agents` (already integrated — 273 personas at `.claude/agents/`, done, not a pending candidate), `PixelRAG`/`claude-watch` (already installed as global Claude Code plugins, not Jarvis-X-runtime candidates), `token-optimizer-mcp`, `skills`, `cline` (a separate coding-assistant product, not a Jarvis-X capability), `i-have-adhd`, `no-ai-slop` (already active as global skills, not in `~/repos/`).

- [ ] Write this categorization into the new file, verifying the actual current `~/repos/` listing first rather than trusting the snapshot above.
- [ ] Commit: `git add docs/obsidian-vault/decisions/2026-08-31-tool-inventory.md && git commit -m "docs: categorize this session's vetted tool clones (dev-tooling vs standalone vs Jarvis-X runtime candidate vs already-decided)"`.

### Task 0.3: Flag architecture-fit risk on every "runtime candidate"

**Files:** append to the same `2026-08-31-tool-inventory.md` from Task 0.2.

For each of the 12 items in bucket 3 above, add one line answering: *does adopting this replace or duplicate something `code/agent.js`, `code/router.js`/`.py`, or `hermes.py` already does, or is it additive (a genuinely new capability)?* Mark each `ADDITIVE` or `OVERLAPS-EXISTING`. Anything marked `OVERLAPS-EXISTING` needs an explicit reason to proceed past the gate below, per the model-gateway precedent — absence of a reason means default to NO-GO, matching how `deepagents` was handled.

- [ ] Commit this addendum: `git commit -am "docs: flag architecture-fit risk per candidate against model-gateway precedent"`.

---

## GATE — STOP HERE

Do not select, wire in, install dependencies for, or configure any Phase-1-candidate tool past this point. Report back to Ahmed with:
1. The verified test-suite pass count and any Task 0.1 findings that deviated from what this doc assumed.
2. The finished four-bucket inventory with architecture-fit flags.
3. A recommendation on priority order within bucket 3 only (which `ADDITIVE` candidates look highest-value), explicitly not a decision.

**Phase 1 onward** (actual wiring: dependency install, config, code changes, tests, commits — one tool per phase) gets written as a follow-up to this file once Ahmed picks which bucket-3 candidates to pursue and in what order. Writing those tasks now, before that choice is made, would mean guessing which integration is wanted — exactly what this file exists to avoid.
