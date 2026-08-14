#!/usr/bin/env bash
# Merges bootstrap/claude-settings.template.json into ~/.claude/settings.json
# (the guardrail deny-list, skillOverrides, and enabledPlugins block) without
# clobbering unrelated keys a fresh Claude Code install may already have
# written there. Safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/claude-settings.template.json"
SETTINGS="$HOME/.claude/settings.json"

mkdir -p "$HOME/.claude"

if [ -f "$SETTINGS" ]; then
  jq -s '.[0] * .[1]' "$SETTINGS" "$TEMPLATE" > "$SETTINGS.tmp"
  mv "$SETTINGS.tmp" "$SETTINGS"
  echo "Merged guardrails/skillOverrides/enabledPlugins into existing $SETTINGS"
else
  cp "$TEMPLATE" "$SETTINGS"
  echo "Wrote fresh $SETTINGS from template"
fi
