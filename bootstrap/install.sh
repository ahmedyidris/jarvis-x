#!/usr/bin/env bash
# Jarvis-X bootstrap installer.
#
# Brings a fresh ASUS Chromebook (Crostini/Debian 12) container up to the same
# state as the development machine: system packages, Node, Ollama + models,
# the venv-ai Python environment, npm deps, Claude Code skills (restored from
# skills-lock.json) and plugins (from the official marketplace), the global
# Claude Code guardrails, and the systemd supervisor unit.
#
# Usage:
#   git clone https://github.com/ahmedyidris/jarvis-x.git
#   cd jarvis-x && bash bootstrap/install.sh
#
# Idempotent — safe to re-run after a partial failure or to pick up changes
# (see bootstrap/update.sh for the lighter "just sync what changed" path).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "==> [1/9] System packages"
sudo apt-get update -y
sudo apt-get install -y \
  python3 python3-venv python3-pip \
  ffmpeg build-essential curl git jq \
  supervisor \
  zstd
# zstd is not optional: since 2026-09 Ollama's installer extracts a .tar.zst
# and aborts with "This version requires zstd for extraction" without it.
# Step 3 then leaves no `ollama` binary, every `ollama pull` below prints
# "command not found", and the box comes up looking installed with no models.
# Observed on Ahmed's Chromebook 2026-09-07 after Crostini's containerless
# switch reset the container.

echo "==> [2/9] Node.js 20.x"
if ! command -v node >/dev/null 2>&1 || [[ "$(node --version)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> [3/9] Ollama + models"
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh || true
fi
# Check rather than assume. The installer can print ERROR and still leave the
# pipeline's exit status at 0 (it is `curl | sh`), so without this the script
# sails on and every pull below fails with "command not found" -- which reads
# like four separate model problems instead of one missing binary.
if ! command -v ollama >/dev/null 2>&1; then
  echo "FATAL: ollama did not install." >&2
  echo "  Most likely cause: missing zstd. Run 'sudo apt-get install -y zstd'" >&2
  echo "  and re-run this script -- it is idempotent." >&2
  exit 1
fi

# A BINARY IS NOT A RUNNING SERVER, and the first version of this check
# conflated them. On 2026-09-08 the installer said "Enabling and starting
# ollama service", the binary existed, the check above passed -- and all four
# pulls failed with:
#
#   Error: could not connect to ollama server, run 'ollama serve' to start it
#
# reported as four skipped models rather than one daemon that had not come up.
# Crostini's systemd starts the unit asynchronously (and under the
# containerless design it sometimes does not take at all), so wait for the API
# to actually answer, and start it ourselves if it does not.
wait_for_ollama() {
  local tries=${1:-30}
  while [ "$tries" -gt 0 ]; do
    curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && return 0
    sleep 1; tries=$((tries - 1))
  done
  return 1
}

if ! wait_for_ollama 20; then
  echo "  ollama API not up yet; starting the service"
  sudo systemctl start ollama 2>/dev/null || true
  if ! wait_for_ollama 20; then
    echo "  systemd did not bring it up; starting 'ollama serve' in the background"
    mkdir -p "$HOME/.jarvis-x"
    nohup ollama serve > "$HOME/.jarvis-x/ollama-serve.log" 2>&1 &
    wait_for_ollama 30 || true
  fi
fi

if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "FATAL: the ollama server is not answering on 127.0.0.1:11434." >&2
  echo "  Pulling models now would fail four times over and report it as four" >&2
  echo "  model problems, so this stops here instead. Try:" >&2
  echo "    ollama serve            # in another terminal, watch what it says" >&2
  echo "    sudo systemctl status ollama" >&2
  echo "    cat ~/.jarvis-x/ollama-serve.log" >&2
  echo "  Then re-run this script -- it is idempotent." >&2
  exit 1
fi
echo "  ollama API is answering"
# supervisord (below) owns the ollama process on this box, not ollama's own
# systemd unit. Do NOT stop it here — the pulls below need the server up;
# it is disabled right after the pull loop (2026-09-21 rebuild fix: stopping
# it here made every pull fail with "could not connect to ollama server").
export OLLAMA_MODELS=/usr/share/ollama/.ollama/models
PULL_FAILED=""
for m in qwen2.5:3b qwen2.5:7b moondream nomic-embed-text; do
  ollama pull "$m" || PULL_FAILED="$PULL_FAILED $m"
done
if [ -n "$PULL_FAILED" ]; then
  # Named together at the end rather than one shrug per model. The routing eval
  # needs qwen2.5:3b specifically, so say which are missing and what it costs.
  echo "  MODELS NOT PULLED:$PULL_FAILED"
  echo "  Re-run this script, or: ollama pull <model>"
  case "$PULL_FAILED" in
    *qwen2.5:3b*) echo "  NOTE: qwen2.5:3b is the one code/eval-agent.js needs." ;;
  esac
fi
# pulls are done — hand the ollama process to supervisord (step 9) by
# stopping ollama's own systemd unit now.
sudo systemctl disable --now ollama 2>/dev/null || true

echo "==> [3b/9] Claude Code CLI (user-owned npm prefix)"
# Installed to a prefix this user owns, NOT with `sudo npm install -g`.
# sudo works, but then the CLI cannot update itself and every session opens
# with "Auto-update failed: no write permission to npm prefix" -- seen on
# Ahmed's box 2026-09-07. A user-owned prefix fixes the install and the
# updates together.
NPM_PREFIX="$HOME/.npm-global"
mkdir -p "$NPM_PREFIX"
npm config set prefix "$NPM_PREFIX"
case ":$PATH:" in
  *":$NPM_PREFIX/bin:"*) ;;
  *)
    export PATH="$NPM_PREFIX/bin:$PATH"
    # Idempotent: only append if the line is not already there.
    grep -qsF "$NPM_PREFIX/bin" "$HOME/.bashrc" \
      || echo "export PATH=\"$NPM_PREFIX/bin:\$PATH\"" >> "$HOME/.bashrc"
    ;;
esac
npm install -g @anthropic-ai/claude-code
command -v claude >/dev/null 2>&1 \
  && echo "  claude: $(claude --version 2>&1 | head -1)" \
  || echo "  (claude not on PATH yet — open a new shell, or: source ~/.bashrc)"

# jj ON PATH. Added 2026-09-25 after Ahmed pasted `jj content new ...` from the
# docs and got "bash: jj: command not found". Six documents and several months
# of instructions have written it as a bare command; the repo has only ever had
# a ./jj symlink usable from the repo root, and nothing ever linked it anywhere
# on PATH. So every one of those instructions was wrong as written, which is
# worse than not documenting the command at all -- a reader follows it, it
# fails, and the failure looks like a broken install rather than a broken doc.
#
# Linked into NPM_PREFIX/bin because this script already owns that directory
# and has just put it on PATH above, so this needs no second PATH entry and no
# second .bashrc line to keep idempotent. Symlink rather than a copy: bin/jj
# changes with the repo and a stale copy would be its own class of confusion.
ln -sfn "$REPO_DIR/bin/jj" "$NPM_PREFIX/bin/jj"
command -v jj >/dev/null 2>&1 \
  && echo "  jj: on PATH ($(command -v jj))" \
  || echo "  (jj not on PATH yet — open a new shell, or: source ~/.bashrc)"

echo "==> [4/9] Python venv (venv-ai)"
if [ ! -d "$HOME/venv-ai" ]; then
  python3 -m venv "$HOME/venv-ai"
fi
"$HOME/venv-ai/bin/pip" install --upgrade pip
"$HOME/venv-ai/bin/pip" install \
  --extra-index-url https://download.pytorch.org/whl/cpu \
  -r "$REPO_DIR/bootstrap/requirements-venv-ai.txt"
# kokoro-onnx/-tts install separately, --no-deps: kokoro-onnx's metadata
# declares numpy>=2.0.2, conflicting with numpy==1.26.4 above -- but that's
# stricter than what it actually needs at runtime (see the comment in
# requirements-venv-ai.txt). Their real deps are all satisfied by the
# install above already.
"$HOME/venv-ai/bin/pip" install --no-deps kokoro-onnx==0.3.9 kokoro-tts==2.3.1

# bootstrap/requirements-egtts.txt (coqui XTTS, Egyptian Arabic) is NOT
# installed here. It needs Python < 3.12 and Debian 13 ships 3.13; installed
# from the main requirements file it failed the wheel build and took the whole
# venv with it on 2026-09-08. Nothing imports it at module load, so skipping it
# costs one voice. See that file for how to add it if you want it.

echo "==> [5/9] Node deps (root + web/) + frontend build"
npm install --prefix "$REPO_DIR"
npm install --prefix "$REPO_DIR/web"
npm run build --prefix "$REPO_DIR/web"

echo "==> [6/9] Claude Code skills (restored from skills-lock.json)"
npx --yes skills experimental_install

# Belt-and-suspenders: make sure every locked skill has a .claude/skills
# symlink into .agents/skills, regardless of what the CLI's per-agent copy
# step did on this run.
mkdir -p "$REPO_DIR/.claude/skills"
for name in $(jq -r '.skills | keys[]' "$REPO_DIR/skills-lock.json"); do
  link="$REPO_DIR/.claude/skills/$name"
  [ -e "$link" ] || ln -s "../../.agents/skills/$name" "$link"
done

echo "==> [7/9] Claude Code plugins (official marketplace)"
claude plugin marketplace add anthropics/claude-plugins-official || true
for p in frontend-design superpowers code-review skill-creator code-simplifier \
         github playwright claude-md-management feature-dev typescript-lsp \
         claude-code-setup commit-commands; do
  claude plugin install "$p@claude-plugins-official" || true
done
# context7 was installed at project (not user) scope originally
claude plugin install "context7@claude-plugins-official" || true

echo "==> [8/9] Global Claude Code settings (guardrails/overrides/plugins)"
bash "$REPO_DIR/bootstrap/merge-claude-settings.sh"

echo "==> [9/9] systemd supervisor unit (ollama + hermes-api)"
sudo cp "$REPO_DIR/config/jarvis-supervisord.service" /etc/systemd/system/jarvis-supervisord.service
sudo systemctl daemon-reload
sudo systemctl enable --now jarvis-supervisord.service

cat <<'EOF'

==> Install script done. Still needs a human:
  1. Fill in secrets: mkdir -p ~/.jarvis-x && cp bootstrap/env.template ~/.jarvis-x/.env
     then edit ~/.jarvis-x/.env by hand (never committed/backed up on purpose).
  2. models/ (340MB, gitignored) is NOT restored by this script — regenerate
     per whatever pipeline produced it.
  3. Verify: curl -s localhost:8000/api/killswitch
             supervisorctl -c config/supervisord.conf status
  4. Review installed skills before real use — they run with full agent
     permissions (`skills` CLI printed a risk assessment per skill above).
EOF
