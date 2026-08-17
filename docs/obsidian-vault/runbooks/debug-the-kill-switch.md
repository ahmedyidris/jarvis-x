---
title: How to debug the kill switch
---

# How to debug the kill switch

The file is `.jarvis-x-STOP` at the repo root (`code/guard.js`'s `STOP_FILE` constant) — **not** `~/.jarvis-x/STOP`. That stale path still appears in some historical session logs and in `knowledge/Guidelines.md` (Edit-denied, can't be fixed directly — see [[system-overview]]).

## Live test, don't just trust the unit tests

Unit tests passing doesn't guarantee real end-to-end wiring — see [[api-ask-kill-switch-gating]], where the gap was in production code (`app.py`) that had no test coverage at all for this specific behavior.

```bash
# 1. Confirm guard.js fires
node -e "
const { guard, isStopped, STOP_FILE } = require('./code/guard.js');
const fs = require('fs');
fs.writeFileSync(STOP_FILE, 'test');
try { guard('test', 'quick', () => { throw new Error('SHOULD NOT RUN'); }); }
catch (e) { console.log('OK:', e.message); }
fs.unlinkSync(STOP_FILE);
"

# 2. Confirm the web-chat path (app.py) — needs hermes-api running
curl -s -X POST localhost:8000/api/killswitch -H "Content-Type: application/json" -d '{"stopped":true}'
curl -s -w "\n%{http_code}\n" -X POST localhost:8000/api/ask -H "Content-Type: application/json" -d '{"question":"test"}'
# expect 503
curl -s -X POST localhost:8000/api/killswitch -H "Content-Type: application/json" -d '{"stopped":false}'
```

## Two independent enforcement points, same file

- `code/guard.js` / `code/lib.js`'s `execute()` — the JS agent-autonomy path
- `app.py`'s own `STOP_FILE.exists()` check — now on both `/api/killswitch` and `/api/ask` ([[api-ask-kill-switch-gating]])

Remember: `guard()` is convention-only, not a sandbox — a raw `fs`/`subprocess` call anywhere that bypasses it wouldn't be stopped by anything. See [[terms]] for what this actually means in practice.
