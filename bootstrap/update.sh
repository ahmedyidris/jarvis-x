#!/usr/bin/env bash
# Lighter-weight sibling of install.sh: pulls the latest code and re-syncs
# whatever's likely to have drifted (skills, plugins, Node/Python deps,
# guardrail settings, supervisor unit) without redoing full system-package
# provisioning. Run this on a machine that's already been through install.sh.
#
# Usage: bash bootstrap/update.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "==> Pulling latest code"
git pull --ff-only

echo "==> Re-syncing Claude Code skills from skills-lock.json"
npx --yes skills experimental_install
mkdir -p "$REPO_DIR/.claude/skills"
for name in $(jq -r '.skills | keys[]' "$REPO_DIR/skills-lock.json"); do
  link="$REPO_DIR/.claude/skills/$name"
  [ -e "$link" ] || ln -s "../../.agents/skills/$name" "$link"
done

echo "==> Updating Claude Code plugins"
claude plugin marketplace update anthropics/claude-plugins-official || true
for p in frontend-design superpowers code-review skill-creator code-simplifier \
         github playwright claude-md-management feature-dev typescript-lsp \
         claude-code-setup commit-commands context7; do
  claude plugin update "$p@claude-plugins-official" || true
done

echo "==> Re-applying global Claude Code guardrail settings"
bash "$REPO_DIR/bootstrap/merge-claude-settings.sh"

echo "==> Re-syncing Node deps + rebuilding frontend"
npm install --prefix "$REPO_DIR"
npm install --prefix "$REPO_DIR/web"
npm run build --prefix "$REPO_DIR/web"

echo "==> Re-syncing Python deps (venv-ai)"
"$HOME/venv-ai/bin/pip" install \
  --extra-index-url https://download.pytorch.org/whl/cpu \
  -r "$REPO_DIR/bootstrap/requirements-venv-ai.txt"

echo "==> Re-installing systemd unit (in case config/*.service changed) + restarting"
sudo cp "$REPO_DIR/config/jarvis-supervisord.service" /etc/systemd/system/jarvis-supervisord.service
sudo systemctl daemon-reload
sudo systemctl restart jarvis-supervisord.service

echo "==> Done. supervisorctl status:"
supervisorctl -c "$REPO_DIR/config/supervisord.conf" status || true
