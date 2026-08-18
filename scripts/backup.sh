#!/usr/bin/env bash
# Creates ~/jarvis-x-backup-<timestamp>.tar.gz + a .sha256 checksum.
# Design: docs/superpowers/specs/2026-08-15-backup-restore-design.md
#
# Contents:
#   1. The jarvis-x working tree (including .git, so history travels with
#      the backup) -- excludes what .gitignore already excludes plus
#      .claude/settings.local.json, so this captures uncommitted work too,
#      not just what's pushed.
#   2. .env explicitly (gitignored, the one real secret file here).
#   3. ~/.hermes/ (hermes-api's runtime state: state.db, audio, audio_cache).
#   4. The live systemd unit, plus a diff against the repo's reference copy
#      written into MANIFEST.txt (so drift is visible at backup time, not
#      discovered during a crisis restore).
#   5. MANIFEST.txt -- reproducibility manifest (pip freeze, ollama list,
#      git commit + status, hostname/timestamp/dir size, the systemd diff).
#      venv-ai (3.8GB) and the Ollama models (8.6GB) are NOT archived raw --
#      reproducible from this manifest on restore, on a machine with
#      internet access (the expected case).
#
# Fails hard only if the jarvis-x working tree itself can't be read; warns
# (not aborts) if an optional piece (~/.hermes, the systemd unit) is
# missing. Writes to a temp path and renames atomically into place so a
# failed run never leaves a half-written archive at the expected filename.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TS="$(date +%Y%m%d_%H%M%S)"
DEST="$HOME/jarvis-x-backup-${TS}.tar.gz"
TMP_ROOT="$(mktemp -d)"
STAGE="$TMP_ROOT/stage"
trap 'rm -rf "$TMP_ROOT"' EXIT

mkdir -p "$STAGE"

echo "==> [1/5] Working tree (including .git, uncommitted work included)"
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "FATAL: $REPO_DIR is not a git working tree -- aborting" >&2
  exit 1
fi
tar -C "$(dirname "$REPO_DIR")" -cf "$STAGE/jarvis-x-tree.tar" \
  --exclude='jarvis-x/node_modules' \
  --exclude='jarvis-x/logs' \
  --exclude='jarvis-x/__pycache__' \
  --exclude='**/__pycache__' \
  --exclude='jarvis-x/models' \
  --exclude='jarvis-x/sentinel/.venv' \
  --exclude='jarvis-x/.claude/worktrees' \
  --exclude='jarvis-x/.claude/settings.local.json' \
  --exclude='jarvis-x/.claude/skills' \
  --exclude='jarvis-x/.agents' \
  "$(basename "$REPO_DIR")"

echo "==> [2/5] .env"
if [ -f "$REPO_DIR/.env" ]; then
  cp "$REPO_DIR/.env" "$STAGE/env.backup"
else
  echo "WARN: $REPO_DIR/.env not found -- skipping (not fatal)" >&2
fi

echo "==> [3/5] ~/.hermes/ (hermes-api runtime state)"
if [ -d "$HOME/.hermes" ]; then
  tar -C "$HOME" -cf "$STAGE/hermes-state.tar" .hermes
else
  echo "WARN: ~/.hermes not found -- skipping (not fatal)" >&2
fi

echo "==> [4/5] systemd unit + drift check"
UNIT_LIVE=/etc/systemd/system/jarvis-supervisord.service
UNIT_REF="$REPO_DIR/config/jarvis-supervisord.service"
SYSTEMD_DIFF="(no live unit found at $UNIT_LIVE)"
if [ -f "$UNIT_LIVE" ]; then
  cp "$UNIT_LIVE" "$STAGE/jarvis-supervisord.service.live"
  if [ -f "$UNIT_REF" ]; then
    SYSTEMD_DIFF="$(diff -u "$UNIT_REF" "$UNIT_LIVE" || true)"
    [ -z "$SYSTEMD_DIFF" ] && SYSTEMD_DIFF="(no drift -- live unit matches repo's reference copy)"
  else
    SYSTEMD_DIFF="(repo has no reference copy at $UNIT_REF to diff against)"
  fi
else
  echo "WARN: no live systemd unit at $UNIT_LIVE -- skipping (not fatal)" >&2
fi

echo "==> [5/5] MANIFEST.txt"
{
  echo "jarvis-x backup manifest"
  echo "generated: $(date -Iseconds)"
  echo "hostname: $(hostname)"
  echo "jarvis-x directory size: $(du -sh "$REPO_DIR" 2>/dev/null | cut -f1)"
  echo
  echo "--- git ---"
  git -C "$REPO_DIR" rev-parse HEAD
  echo "git status --short (should be empty; flagged if not):"
  git -C "$REPO_DIR" status --short || true
  echo
  echo "--- ollama models ---"
  ollama list 2>/dev/null || echo "(ollama not reachable)"
  echo
  echo "--- systemd unit drift ---"
  echo "$SYSTEMD_DIFF"
  echo
  echo "--- venv-ai pip freeze ---"
  if [ -x "$HOME/venv-ai/bin/pip" ]; then
    "$HOME/venv-ai/bin/pip" freeze
  else
    echo "(venv-ai not found at ~/venv-ai)"
  fi
} > "$STAGE/MANIFEST.txt"

echo "==> Packing final archive"
TMP_ARCHIVE="$(mktemp "${DEST}.XXXXXX")"
tar -C "$STAGE" -czf "$TMP_ARCHIVE" .
mv "$TMP_ARCHIVE" "$DEST"
sha256sum "$DEST" | awk '{print $1}' > "${DEST}.sha256"

echo
echo "==> Backup complete: $DEST ($(du -h "$DEST" | cut -f1))"
echo "    checksum: $(cat "${DEST}.sha256")"
