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
// retroactively tell which of the existing 2810 were tests. v3 rows likewise
// carry no `actor`, and a v3 row is not a v4 row with the actor missing --
// readers must branch on `schema`, which is why it is bumped rather than the
// field quietly appearing.
function detectOrigin() {
  const entry = (process.argv && process.argv[1]) || '';
  const base = path.basename(entry);
  if (base.startsWith('test-') || base.startsWith('jest') || base === 'jest-runner.js') return 'test';
  return 'app';
}

const ORIGIN = detectOrigin();

// WHICH ENTRY POINT PRODUCED THIS ROW. v4 adds `actor`.
//
// v3's `origin` answers "was this a test?" and that was enough to stop
// selfdebug.js reporting test fixtures as incidents. It is not enough to act
// on a real one. Eight entry points write here -- agent.js, scheduler.js,
// gemini.js, market-collect.js, paper-trading.js, selfdebug.js, memory.js,
// lib.js -- and today they merge into one undifferentiated "app". A scheduler
// failing every night while the interactive agent is fine looks identical to
// the reverse, and both look identical to a human running a script by hand.
//
// Detected the same way as origin, from argv[1], for the same reason: it needs
// no cooperation from the caller, so a new entry point is attributed correctly
// without its author knowing this exists, and the agent cannot set it -- it
// emits actions, and rewriting argv is not one of them.
//
// NOT the model. "Claude vs Hermes" is a fair question and this does not answer
// it: guard() is called from modules that do not know which tier served a
// request, so recording that means threading it through every call site. This
// records WHERE the action came from, which is the half that needs no new
// plumbing. See REMAINING_WORK.md P0.9.
function detectActor() {
  const entry = (process.argv && process.argv[1]) || '';
  const base = path.basename(entry).replace(/\.(js|py|mjs|cjs)$/, '');
  if (!base) return 'unknown';
  // A test's actor is the test file; origin already says it was a test.
  return base;
}

const ACTOR = detectActor();

// WHERE THE AUDIT LOG GOES, and why this is a function rather than a constant.
//
// It was a constant, and .github/workflows/test.yml states the principle it
// broke: "A test qualifies when its inputs are arguments rather than the
// environment: test-watcher takes an injectable fetcher, test-paper-trading
// takes prices ... and the rest take rows and paths." guard.js was the one
// module that took neither. Every test run appended to the real
// logs/actions.jsonl, which is how it accumulated 599 fixture failure rows
// and made selfdebug.js impossible to build until `origin` existed.
//
// Worse, and this is what forced the change: mutation-testing guard.js
// corrupts a log's provenance permanently. On 2026-09-07 the "always tag app"
// mutation ran test-guard.js against the live file, and seven fixture rows --
// `boom`/"inner failure", `slow-fail`/"gemini 429", `odd-fail`/"a bare
// string", three killswitch rows, `explicit` -- ended up tagged origin:'app'
// in an append-only log, where selfdebug.js reports them as real application
// failures. They cannot be corrected without rewriting the audit trail, which
// is worse than the blemish.
//
// That happened in the container the change was developed in, not on Ahmed's
// machine: logs/ is gitignored, so every machine has its own log and none of
// them is shared. The numbers quoted above are that container's. The PROBLEM
// they demonstrate is not local -- any machine running the suite accumulates
// the same fixtures, for the same reason -- which is what this seam fixes.
//
// THIS IS NOT AN ENVIRONMENT VARIABLE AND NOT AN ARGUMENT TO guard(). The
// agent emits actions -- list, read, write, shell, query, answer,
// list_models -- so it cannot call a JS function or set an env var, which
// makes this seam unreachable from its side. A redirectable audit log WOULD
// be a real weakening if the agent could reach it: pointing auditing at
// /dev/null disables every trace of what it did.
let logFile = LOG_FILE;

/** Point the audit log somewhere else. Returns the previous path, so callers
 *  can restore it. Tests only -- see the note above on why this is safe. */
function setLogFile(p) {
  const previous = logFile;
  logFile = p;
  return previous;
}

/** The path append() will actually write to. */
function currentLogFile() {
  return logFile;
}

function append(entry) {
  try {
    fs.appendFileSync(logFile, JSON.stringify({
      timestamp: new Date().toISOString(), schema: 'v4',
      pid: process.pid, origin: ORIGIN, actor: ACTOR, ...entry
    }) + '\n');
  } catch (_e) { /* auditing must never break the caller */ }
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
                   ORIGIN, detectOrigin, ACTOR, detectActor,
                   setLogFile, currentLogFile };
