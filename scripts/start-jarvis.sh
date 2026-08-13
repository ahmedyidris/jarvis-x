#!/usr/bin/env bash
# /home/ahmedyidris/jarvis-x/scripts/start-jarvis.sh
set -euo pipefail
CONF="/home/ahmedyidris/jarvis-x/config/supervisord.conf"
SOCK="/tmp/jarvis-supervisor.sock"

if [[ -S "$SOCK" ]] && supervisorctl -c "$CONF" status >/dev/null 2>&1; then
  echo "jarvis: supervisord already running"
else
  echo "jarvis: starting supervisord"
  supervisord -c "$CONF"
fi
supervisorctl -c "$CONF" status
