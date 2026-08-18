#!/usr/bin/env bash
set -euo pipefail
ARCHIVE=""
DEST_DIR=""
SKIP_VERIFY=0
FORCE=0
while (( $# )); do
  case "$1" in
    --dest) DEST_DIR="$2"; shift 2 ;;
    --skip-verify) SKIP_VERIFY=1; shift ;;
    --force) FORCE=1; shift ;;
    *) ARCHIVE="$1"; shift ;;
  esac
done
[[ -z "$ARCHIVE" ]] && ARCHIVE=$(ls -t ~/jarvis-x-backup-*.tar.gz 2>/dev/null | head -1)
[[ -z "$ARCHIVE" ]] && { echo "❌ No backup found"; exit 1; }
[[ -f "$ARCHIVE" ]] || { echo "❌ Archive not found: $ARCHIVE"; exit 1; }
if [[ $SKIP_VERIFY -eq 0 ]]; then
  CHECKSUM_FILE="${ARCHIVE}.sha256"
  [[ -f "$CHECKSUM_FILE" ]] || { echo "❌ Checksum file not found"; exit 1; }
  EXPECTED=$(cat "$CHECKSUM_FILE")
  ACTUAL=$(sha256sum "$ARCHIVE" | awk '{print $1}')
  [[ "$EXPECTED" == "$ACTUAL" ]] || { echo "❌ Checksum mismatch"; exit 1; }
  echo "✅ Checksum verified"
fi
RESTORE_HOME="${DEST_DIR:=$HOME}"
JARVIS_DIR="$RESTORE_HOME/jarvis-x"
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT
tar -xzf "$ARCHIVE" -C "$TMPDIR"
[[ -z "$DEST_DIR" && $FORCE -eq 0 ]] && for d in "$JARVIS_DIR" "$RESTORE_HOME/.env" "$RESTORE_HOME/.hermes"; do [[ -e "$d" && -s "$d" ]] && mv "$d" "${d}.pre-restore.bak"; done
mkdir -p "$RESTORE_HOME"
tar -xf "$TMPDIR/jarvis-x-tree.tar" -C "$RESTORE_HOME"
[[ -f "$TMPDIR/env.backup" ]] && cp "$TMPDIR/env.backup" "$RESTORE_HOME/.env"
[[ -f "$TMPDIR/hermes-state.tar" ]] && tar -xf "$TMPDIR/hermes-state.tar" -C "$RESTORE_HOME" 2>/dev/null || true
echo "✅ Extracted"
[[ -n "$DEST_DIR" ]] && exit 0
sleep 2
curl -s http://127.0.0.1:8000/api/status 2>/dev/null | grep -q status && echo "✅ PASS" || echo "⚠️  FAIL"
