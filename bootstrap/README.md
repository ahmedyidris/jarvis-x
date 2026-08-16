# Bootstrap — rebuild Jarvis-X on a new Chromebook

Everything needed to go from a bare Crostini/Debian 12 container to a running
Jarvis-X, in one command, plus a lighter update path for after that.

## Fresh install

```bash
git clone https://github.com/ahmedyidris/jarvis-x.git
cd jarvis-x
bash bootstrap/install.sh
```

`install.sh` is idempotent — safe to re-run if it fails partway (e.g. a flaky
`ollama pull`). It provisions, in order:

1. System packages (`python3-venv`, `ffmpeg`, `build-essential`, `supervisor`, `jq`, …)
2. Node.js 20.x (nodesource)
3. Ollama + pulls `qwen2.5:3b`, `qwen2.5:7b`, `moondream`, `nomic-embed-text`
4. `~/venv-ai` Python venv, `pip install -r bootstrap/requirements-venv-ai.txt`
   (a frozen snapshot of the real working environment — heavy, includes the
   CPU torch wheel, transformers, spaCy, Coqui TTS; expect 15-30+ min and
   several GB on first run)
5. `npm install` for both the root and `web/`, then builds the production frontend
6. **All 15 Claude Code skills**, restored from `skills-lock.json` via
   `npx skills experimental_install` (re-clones each skill's source repo —
   `Leonxlnx/taste-skill`, `alchaincyf/huashu-design`, `pbakaus/impeccable` —
   and re-symlinks `.claude/skills/*` → `.agents/skills/*`)
7. **All 12 Claude Code plugins** from the official `anthropics/claude-plugins-official`
   marketplace (frontend-design, superpowers, code-review, skill-creator,
   code-simplifier, github, playwright, claude-md-management, feature-dev,
   typescript-lsp, claude-code-setup, commit-commands), plus the project-scoped
   `context7` plugin
8. The global `~/.claude/settings.json` guardrails — the `permissions.deny`
   list protecting `guard.js`/`validate.js`/`Guidelines.md`/`rules.md`/`.env`,
   the `skillOverrides` (demoted/disabled duplicate design skills), and the
   `enabledPlugins` block — merged in via `bootstrap/merge-claude-settings.sh`
   (won't clobber unrelated keys a fresh Claude Code install already wrote)
9. The `jarvis-supervisord.service` systemd unit (manages `ollama` + `hermes-api`
   under `supervisord`), enabled and started

## Update (already-installed machine)

```bash
bash bootstrap/update.sh
```

Pulls latest `git`, re-syncs skills + plugins + Node/Python deps, re-applies
the guardrail settings, rebuilds the frontend, and restarts the supervisor
unit. Skips the system-package/Ollama-model-pull steps in `install.sh` since
those don't usually drift.

## What this does NOT restore (by design)

- **Secrets** — `~/.jarvis-x/.env` is never committed or backed up anywhere.
  Copy `bootstrap/env.template` to `~/.jarvis-x/.env` and fill in real values
  by hand. (`.jarvis-x/.env` is also Read+Edit-denied for Claude Code
  sessions, per the guardrails re-applied in step 8 — an agent can't read
  these back out even after you fill them in.)
- **`models/`** (340MB, gitignored) — whatever pipeline generated these needs
  to be re-run; not captured here.
- **`node_modules/`** (root + `web/`) — reinstalled fresh by `npm install`,
  not restored byte-for-byte.

## Verifying it worked

```bash
supervisorctl -c config/supervisord.conf status   # both ollama + hermes-api RUNNING
curl -s localhost:8000/api/killswitch             # should return JSON, not connection-refused
systemctl is-enabled jarvis-supervisord.service   # enabled
```
