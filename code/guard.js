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

// WHAT v5 ADDS, AND THE ONE RULE THAT MATTERS MORE THAN THE FIELDS.
//
// PLAN_5 §3 item 2: `confidence` + `approved_by` are "what turn the log from a
// record into a gate". A gate needs to answer "was this action authorised, and
// how sure was whoever authorised it?" -- v4 rows carry neither, so the answer
// for them is genuinely unknown.
//
// THE RULE: a v4 row must read as ABSENT, never as a default. The plan states
// it directly -- "a guessed 1.0 on old rows is a lie the gate would then
// trust" -- and it is the whole reason the readers below return {known:false}
// instead of a number. Every safe default is wrong here: default high and the
// gate waves through 2810 rows nobody ever approved; default low and it
// refuses history it has no business judging. The honest third answer is
// "this log could not record that", which is what pre-v5 rows get.
//
// The same rule applies WITHIN v5, one step finer. A v5 row where the caller
// claimed nothing is also unknown -- but for a different reason, and the
// readers say which: `pre-v5` means the log could not record it, `not-claimed`
// means the call site did not say. The first is a schema limit and can never
// be fixed; the second is a caller that should be passing the field and is a
// real thing to go fix. Collapsing them into one "unknown" would hide the
// actionable half behind the permanent half.
const SCHEMA = 'v5';

/** 'v5' -> 5, 'v2' -> 2, undefined/'type-v2'/garbage -> 0. Defensive on
 *  purpose: agent.js writes a `type-v2` schema to a DIFFERENT log, and a
 *  reader that mistook it for this one's v2 would be quietly wrong. */
function schemaVersion(s) {
  const m = /^v(\d+)$/.exec(typeof s === 'string' ? s : '');
  return m ? Number(m[1]) : 0;
}

/**
 * Who authorised an action. A closed set: an open one degrades into free text,
 * and a gate cannot compare free text.
 *
 * THESE TWO VALUES COME FROM CONSTITUTION.md §V, which specifies the audit
 * row's `"approved_by": "human|jarvis"`. An earlier draft of this used
 * ['human', 'agent', 'oracle'], taken from
 * docs/incoming/MEMORY_TEMPLATE.txt's §5. That was wrong twice over: the
 * template is reference material that PLAN_5 §0 says explicitly does NOT set
 * scope, and CONSTITUTION.md is the written law this file exists to enforce.
 * A gate whose vocabulary disagrees with the constitution it enforces is the
 * quietest possible way for the two to drift apart -- and `guard.js` is named
 * in §III as a file whose modification is itself gated, so it is the last
 * place that drift should start.
 *
 * 'oracle' is dropped rather than kept as an extension: a third approver the
 * law does not name is exactly the sort of quiet widening this codebase keeps
 * correcting. If one is wanted, it is a §VII amendment, not a constant.
 */
const APPROVERS = Object.freeze(['human', 'jarvis']);

/**
 * A confidence claim is only recorded if it is a real number in [0,1].
 *
 * A rejected claim is NOT silently dropped and NOT silently stored. Dropping
 * it loses the fact that a call site is passing nonsense; storing it lets the
 * gate compare against garbage. So the row keeps `confidence_rejected` with
 * the raw value and no `confidence`, which reads as unknown to the gate and
 * as a bug to whoever greps for it.
 */
function normalizeClaim(entry) {
  const out = { ...entry };
  if ('confidence' in out) {
    const c = out.confidence;
    if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) {
      delete out.confidence;
      out.confidence_rejected = c === undefined ? null : String(c).slice(0, 40);
    }
  }
  if ('approved_by' in out) {
    if (!APPROVERS.includes(out.approved_by)) {
      const raw = out.approved_by;
      delete out.approved_by;
      out.approved_by_rejected = raw === undefined ? null : String(raw).slice(0, 40);
    }
  }
  return out;
}

function append(entry) {
  try {
    fs.appendFileSync(logFile, JSON.stringify({
      timestamp: new Date().toISOString(), schema: SCHEMA,
      pid: process.pid, origin: ORIGIN, actor: ACTOR, ...normalizeClaim(entry)
    }) + '\n');
  } catch (_e) { /* auditing must never break the caller */ }
}

/**
 * @returns {{known: boolean, value?: number, reason?: string}}
 *   reason 'pre-v5'      the log could not record it — permanent, not a bug
 *   reason 'not-claimed' a v5 call site said nothing — a real thing to fix
 *   reason 'rejected'    a claim was made and refused as malformed
 */
function readConfidence(row) {
  if (!row || typeof row !== 'object') return { known: false, reason: 'no-row' };
  if (schemaVersion(row.schema) < 5) return { known: false, reason: 'pre-v5' };
  if (typeof row.confidence === 'number') return { known: true, value: row.confidence };
  if ('confidence_rejected' in row) return { known: false, reason: 'rejected' };
  return { known: false, reason: 'not-claimed' };
}

/** Same contract as readConfidence, for `approved_by`. */
function readApproval(row) {
  if (!row || typeof row !== 'object') return { known: false, reason: 'no-row' };
  if (schemaVersion(row.schema) < 5) return { known: false, reason: 'pre-v5' };
  if (APPROVERS.includes(row.approved_by)) return { known: true, value: row.approved_by };
  if ('approved_by_rejected' in row) return { known: false, reason: 'rejected' };
  return { known: false, reason: 'not-claimed' };
}

/**
 * The gate itself: 'approved' | 'refused' | 'unknown'.
 *
 * THE ONE PROPERTY THIS MUST NEVER LOSE: absence reads as 'unknown', never as
 * 'approved'. Every pre-v5 row in the log — 2810 of them on the machine where
 * v3 was written — goes to 'unknown', and a caller that treats 'unknown' as a
 * pass has re-introduced exactly the lie the plan warned about. Three values
 * rather than a boolean, so a caller cannot write `if (approved)` and have
 * absence fall through as false OR true without noticing which.
 *
 * Defaults are deliberately strict: human approval, and the retire-grade 0.80
 * from the memory template's two-threshold rule. A caller wanting the lower
 * add-grade bar passes it explicitly, which puts that decision in the calling
 * code where it can be read, rather than in this default.
 */
/** Pull only the two v5 fields out of a caller's claim object, so passing a
 *  whole options bag cannot smuggle arbitrary keys into an audit row. */
function claimFields(claim) {
  if (!claim || typeof claim !== 'object') return {};
  const out = {};
  if ('confidence' in claim) out.confidence = claim.confidence;
  if ('approved_by' in claim) out.approved_by = claim.approved_by;
  return out;
}

function gateVerdict(row, { minConfidence = 0.80, allow = ['human'] } = {}) {
  const approval = readApproval(row);
  const confidence = readConfidence(row);
  if (!approval.known || !confidence.known) return 'unknown';
  if (!allow.includes(approval.value)) return 'refused';
  return confidence.value >= minConfidence ? 'approved' : 'refused';
}

/**
 * @param {object} [claim] v5's `{confidence, approved_by}`, optional. A fourth
 *   positional rather than a new required argument: every existing three-arg
 *   call site keeps working and simply records no claim, which reads as
 *   `not-claimed` rather than as a fabricated default.
 */
function guard(action, level = 'quick', fn, claim = {}) {
  const c = claimFields(claim);
  // Was logged BEFORE fn() ran, so the outcome could never be recorded --
  // 331 of 414 shell rows have no allow/deny verdict. The kill-switch throw
  // also sat above the append, so blocked actions left no trace at all:
  // the single event most worth auditing was the one never written.
  if (fs.existsSync(STOP_FILE)) {
    append({ action, level, allowed: false, outcome: 'killswitch', ...c });
    throw new Error('⛔ Kill switch active – action blocked');
  }

  if (!fn) {
    append({ action, level, allowed: true, outcome: 'no-op', ...c });
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
    append({ action, level, allowed: false, outcome: 'error', error: err.message, ...c });
    throw err;
  }

  if (result && typeof result.then === 'function') {
    return result.then(
      value => { append({ action, level, allowed: true, outcome: 'ok', async: true, ...c }); return value; },
      err => {
        append({ action, level, allowed: false, outcome: 'error', async: true,
                 error: err && err.message ? err.message : String(err), ...c });
        throw err;
      }
    );
  }

  append({ action, level, allowed: true, outcome: 'ok', ...c });
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
                   setLogFile, currentLogFile,
                   // v5: the gate. See the block comment above append().
                   SCHEMA, APPROVERS, schemaVersion, normalizeClaim,
                   readConfidence, readApproval, gateVerdict, claimFields };
