const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'actions.jsonl');
const STOP_FILE = path.join(__dirname, '..', '.jarvis-x-STOP');

// Ensure logs directory exists
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// v2 adds `allowed` and `schema`. Rows before 2026-08-24 have neither:
// 407 early rows carry {action,detail,allowed}, 737 carry {action,level,pid}
// with no verdict at all. Readers must branch on `schema`.
function append(entry) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify({
      timestamp: new Date().toISOString(), schema: 'v2',
      pid: process.pid, ...entry
    }) + '\n');
  } catch (e) { /* auditing must never break the caller */ }
}

function guard(action, level = 'quick', fn) {
  // Was logged BEFORE fn() ran, so the outcome could never be recorded --
  // 331 of 414 shell rows have no allow/deny verdict. The kill-switch throw
  // also sat above the append, so blocked actions left no trace at all:
  // the single event most worth auditing was the one never written.
  if (fs.existsSync(STOP_FILE)) {
    append({ action, level, allowed: false, outcome: 'killswitch' });
    throw new Error('⛔ Kill switch active – action blocked');
  }

  if (!fn) {
    append({ action, level, allowed: true, outcome: 'no-op' });
    return { executed: true, action };
  }

  // gemini.js and scheduler.js pass async fns. A plain sync try/catch would
  // log outcome:'ok' the moment the promise is created -- i.e. a failing
  // Gemini call recorded as a success. Detect a thenable and attach the
  // append to its settlement instead. Sync callers keep sync behavior.
  let result;
  try {
    result = fn();
  } catch (err) {
    append({ action, level, allowed: false, outcome: 'error', error: err.message });
    throw err;
  }

  if (result && typeof result.then === 'function') {
    return result.then(
      value => { append({ action, level, allowed: true, outcome: 'ok', async: true }); return value; },
      err => {
        append({ action, level, allowed: false, outcome: 'error', async: true,
                 error: err && err.message ? err.message : String(err) });
        throw err;
      }
    );
  }

  append({ action, level, allowed: true, outcome: 'ok' });
  return result;
}

function isStopped() {
  return fs.existsSync(STOP_FILE);
}

// Callers were passing the command string into the `level` slot, which is
// why the log shows {"action":"shell","level":"ls ; rm -rf ~"}. Third arg
// carries the verdict; two-arg calls still work and record allowed:null
// (unknown) rather than silently implying permission.
function logAction(action, level = 'quick', meta = {}) {
  append({ action, level, allowed: meta.allowed ?? null, ...meta });
}

module.exports = { guard, isStopped, logAction, STOP_FILE, LOG_FILE };
