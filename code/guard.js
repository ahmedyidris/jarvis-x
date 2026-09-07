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
//
// v3 adds `origin`, and exists because of what selfdebug.js found on
// 2026-09-07. This log had 2810 rows and 599 of them looked like failures.
// Almost all were TEST FIXTURES: `boom` (30) with error "inner failure",
// `slow-fail` (29) with "gemini 429", `odd-fail` (29) with "a bare string",
// `refused-cmd` (333) from the allowlist tests, `paper-trade-open` (22).
// Tests call guard() directly and it writes to the real LOG_FILE, so a tool
// reading this file would confidently report "gemini 429 occurred 29 times,
// investigate the Gemini integration" about a string that exists only in
// test-guard.js.
//
// So every new row says where it came from. Detected from the entry script
// rather than an environment variable, because that needs no cooperation
// from whoever writes the next test file -- a new code/test-*.js is tagged
// automatically -- and the agent cannot reach it: the agent runs through
// agent.js or scheduler.js, and setting argv[1] is not an action it has.
//
// Rows stay v2 => unattributable. That is the honest reading: nothing can
// retroactively tell which of the existing 2810 were tests.
function detectOrigin() {
  const entry = (process.argv && process.argv[1]) || '';
  const base = path.basename(entry);
  if (/^test-/.test(base) || /^jest/.test(base) || base === 'jest-runner.js') return 'test';
  return 'app';
}

const ORIGIN = detectOrigin();

function append(entry) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify({
      timestamp: new Date().toISOString(), schema: 'v3',
      pid: process.pid, origin: ORIGIN, ...entry
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

module.exports = { guard, isStopped, logAction, STOP_FILE, LOG_FILE,
                   ORIGIN, detectOrigin };
