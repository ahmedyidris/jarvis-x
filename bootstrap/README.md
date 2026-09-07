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

## Recovering from a wiped container (2026-09-07)

ChromeOS 143 switched Crostini to a **containerless** design, and on Ahmed's
machine that reset the container: `node`, `git`, `ollama` and `claude` all
gone, `/` showing 1.5G used of 72G. Nothing was lost — everything is in this
repo, and `logs/` is gitignored anyway.

Three things broke during the manual rebuild, and `install.sh` now handles all
three:

| symptom | cause | fixed by |
|---|---|---|
| `ERROR: This version requires zstd for extraction` | Ollama's installer extracts a `.tar.zst` | `zstd` added to step 1's apt list |
| `ollama: command not found` × 5 | step 3 continued after the install failed | step 3 now verifies the binary and exits naming `zstd` |
| `Auto-update failed: no write permission to npm prefix` | `sudo npm install -g` | step 3b uses a user-owned `~/.npm-global` prefix |

**Full recovery from nothing:**

```bash
sudo apt-get update -y && sudo apt-get install -y git
# token from github.com/settings/tokens (classic, `repo` scope) —
# GitHub no longer accepts a password for HTTPS clone
git clone https://YOUR_TOKEN@github.com/ahmedyidris/jarvis-x.git ~/jarvis-x
cd ~/jarvis-x && bash bootstrap/install.sh
```

Then verify:

```bash
node code/selfdebug.js            # expect 0 findings on a fresh log
node code/eval-agent.js --runs 1  # expect 41/41 held-out
bash scripts/status.sh
```

Note: `/mnt/chromeos/MyFiles/Downloads` may not be mounted under the
containerless design, so a `.tar.gz` backup there can be unreachable. The
GitHub remote is the reliable restore path; `scripts/backup.sh` is the
belt-and-braces one.

## Disk space, and what may live on Google Drive

```bash
bash scripts/reclaim-space.sh              # report only, deletes nothing
bash scripts/reclaim-space.sh --clean      # reclaim
bash scripts/reclaim-space.sh --clean --offload   # ...and move archives to Drive
```

**Check the report before cleaning.** On 2026-09-07 the container had 70G free
of 72G (3% used) while the machine was reported short on space — the pressure
was on the ChromeOS side. Deleting inside the container would have freed
nothing. ChromeOS storage: *Settings → About ChromeOS → Storage management*.
The Linux disk is separately capped under *Settings → Advanced → Developers →
Linux development environment → Disk size*.

### What must NOT go on Drive

| | why |
|---|---|
| the git working tree | Drive is a FUSE mount; git does thousands of small locked file operations per command. Slow, and the locking is not what git assumes — a known way to corrupt a repo |
| the Ollama models (~8.6G) | Ollama memory-maps model files during inference. Over FUSE every answer takes minutes |

Both are also the wrong target: they're the two things that rebuild for free
(`ollama pull`, and `bootstrap/install.sh` step 4 from the backup manifest).

**Backup archives are the right thing to offload** — `scripts/backup.sh`
already keeps them small by excluding `venv-ai` (3.8G) and the models (8.6G).
The offload copies, verifies with `cmp`, and only then deletes the local
original. Never a move: a truncated copy over FUSE with the original already
gone turns a backup strategy into a data-loss strategy.

Drive isn't shared with Linux by default under containerless Crostini — *Files
app → right-click Google Drive → Share with Linux*. Same reason a `.tar.gz` in
`~/Downloads` was unreachable after the reset.
