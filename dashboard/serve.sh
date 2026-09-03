#!/usr/bin/env bash
# Serves this folder at http://localhost:8787 and opens the dashboard.
cd "$(dirname "$0")" && (python3 -m http.server 8787 --bind 127.0.0.1 &) && sleep 1 && \
  (xdg-open http://localhost:8787/dashboard.html 2>/dev/null || open http://localhost:8787/dashboard.html 2>/dev/null || \
   echo "Open http://localhost:8787/dashboard.html in your browser")
