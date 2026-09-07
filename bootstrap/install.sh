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
# supervisord (below) owns the ollama process on this box, not ollama's own
# systemd unit — stop/disable it if the installer enabled one.
sudo systemctl disable --now ollama 2>/dev/null || true
export OLLAMA_MODELS=/usr/share/ollama/.ollama/models
for m in qwen2.5:3b qwen2.5:7b moondream nomic-embed-text; do
  ollama pull "$m" || echo "  (skipped $m — pull failed, retry manually later)"
done

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
