// guard.js is the kill switch and the audit log. Every gated action in this
// repo routes through it.
//
// WHAT WAS HERE BEFORE: a file with zero assertions that printed
// "Result: ACTION RAN" and exited 0 unconditionally. It was in the CI list, so
// CI ran a file that could not fail, guarding the module that stops everything
// else. docs/triage/2026-09-repo-triage.md flagged it as "zero assertions,
// always exits 0, counted as PASS" and no action was taken. Demonstrated
// 2026-09-04: emptying shell.js's allowlist entirely still left both this and
// test-shell.js exiting 0.
//
// The old file is in git history; this replaces it rather than sitting beside
// it, because CI runs it under this name.
//
// Two of guard.js's own comments record bugs that these tests now pin, because
// both were the kind that leave no trace when they regress:
//
//   - the kill-switch throw once sat ABOVE the append, so a blocked action --
//     the single event most worth auditing -- was never written down.
//   - async callers were logged the moment the promise was CREATED, so a
//     failing Gemini call was recorded as a success.
const fs = require('fs');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const { guard, isStopped, logAction, STOP_FILE, LOG_FILE } = require('./guard.js');

/** Newest audit rows written while `fn` ran. The log path is a module
 *  constant, so the honest way to assert on it is to diff the real file. */
function rowsWritten(fn) {
  const before = fs.existsSync(LOG_FILE)
    ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).length : 0;
  let threw = null, value;
  try { value = fn(); } catch (e) { threw = e; }
  const after = fs.existsSync(LOG_FILE)
    ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean) : [];
  return { rows: after.slice(before).map(l => JSON.parse(l)), threw, value };
}

async function rowsWrittenAsync(fn) {
  const before = fs.existsSync(LOG_FILE)
    ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).length : 0;
  let threw = null, value;
  try { value = await fn(); } catch (e) { threw = e; }
  const after = fs.existsSync(LOG_FILE)
    ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean) : [];
  return { rows: after.slice(before).map(l => JSON.parse(l)), threw, value };
}

/** Run `fn` with the kill switch on, always restoring the previous state. */
function withKillSwitch(fn) {
  const had = fs.existsSync(STOP_FILE);
  try {
    if (!had) fs.writeFileSync(STOP_FILE, 'test');
    return fn();
  } finally {
    if (!had && fs.existsSync(STOP_FILE)) fs.unlinkSync(STOP_FILE);
  }
}

(async () => {

// ── the kill switch ───────────────────────────────────────────────────────
await test('the kill switch blocks the action', () => {
  withKillSwitch(() => {
    let ran = false;
    assert.throws(() => guard('t', 'quick', () => { ran = true; }), /Kill switch/i);
    assert.strictEqual(ran, false, 'the function must never be called');
  });
});

await test('a blocked action is written to the audit log before the throw', () => {
  // The bug guard.js documents: the throw sat above the append, so the one
  // event most worth auditing left no trace.
  withKillSwitch(() => {
    const { rows, threw } = rowsWritten(() => guard('blocked-thing', 'hard', () => 1));
    assert.ok(threw, 'it must still throw');
    assert.strictEqual(rows.length, 1, 'exactly one row, and it must exist');
    assert.strictEqual(rows[0].action, 'blocked-thing');
    assert.strictEqual(rows[0].allowed, false);
    assert.strictEqual(rows[0].outcome, 'killswitch');
  });
});

await test('isStopped tracks the file both ways', () => {
  const had = fs.existsSync(STOP_FILE);
  try {
    if (!had) {
      assert.strictEqual(isStopped(), false);
      fs.writeFileSync(STOP_FILE, 'test');
      assert.strictEqual(isStopped(), true);
      fs.unlinkSync(STOP_FILE);
      assert.strictEqual(isStopped(), false);
    } else {
      assert.strictEqual(isStopped(), true);
    }
  } finally {
    if (!had && fs.existsSync(STOP_FILE)) fs.unlinkSync(STOP_FILE);
  }
  assert.strictEqual(fs.existsSync(STOP_FILE), had, 'state must be restored');
});

// ── the happy path ────────────────────────────────────────────────────────
await test('a permitted action runs and its value is returned', () => {
  const { rows, value, threw } = rowsWritten(() => guard('ok-thing', 'quick', () => 42));
  assert.strictEqual(threw, null);
  assert.strictEqual(value, 42);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].allowed, true);
  assert.strictEqual(rows[0].outcome, 'ok');
});

await test('guard with no function logs a no-op rather than nothing', () => {
  const { rows, value } = rowsWritten(() => guard('bare', 'quick'));
  assert.deepStrictEqual(value, { executed: true, action: 'bare' });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].outcome, 'no-op');
  assert.strictEqual(rows[0].allowed, true);
});

await test('a synchronous failure is logged as an error and rethrown', () => {
  const { rows, threw } = rowsWritten(
    () => guard('boom', 'quick', () => { throw new Error('inner failure'); }));
  assert.ok(threw && /inner failure/.test(threw.message), 'the caller must still see it');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].allowed, false);
  assert.strictEqual(rows[0].outcome, 'error');
  assert.ok(/inner failure/.test(rows[0].error), rows[0].error);
});

// ── the async bug, pinned ─────────────────────────────────────────────────
await test('an async success is logged on settlement, not on promise creation', async () => {
  const { rows, value } = await rowsWrittenAsync(
    () => guard('slow-ok', 'hard', async () => { await new Promise(r => setTimeout(r, 5)); return 'done'; }));
  assert.strictEqual(value, 'done');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].outcome, 'ok');
  assert.strictEqual(rows[0].async, true, 'the async path must mark itself');
});

await test('an async FAILURE is logged as an error, not as a success', async () => {
  // The documented bug: a plain sync try/catch logs ok the moment the promise
  // is created, so a failing Gemini call was recorded as having worked.
  const { rows, threw } = await rowsWrittenAsync(
    () => guard('slow-fail', 'hard', async () => { throw new Error('gemini 429'); }));
  assert.ok(threw && /gemini 429/.test(threw.message), 'the rejection must reach the caller');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].outcome, 'error', 'a rejected promise is not a success');
  assert.strictEqual(rows[0].allowed, false);
  assert.strictEqual(rows[0].async, true);
  assert.ok(/gemini 429/.test(rows[0].error), rows[0].error);
});

await test('a non-Error rejection still produces a readable log line', async () => {
  const { rows } = await rowsWrittenAsync(
    () => guard('odd-fail', 'hard', async () => { throw 'a bare string'; }));
  assert.strictEqual(rows[0].outcome, 'error');
  assert.ok(/a bare string/.test(rows[0].error), rows[0].error);
});

// ── the log's own shape ───────────────────────────────────────────────────
await test('every row carries the fields a reader needs to interpret it', () => {
  const { rows } = rowsWritten(() => guard('shaped', 'quick', () => null));
  const r = rows[0];
  assert.strictEqual(r.schema, 'v2', 'readers branch on schema; older rows lack a verdict');
  assert.strictEqual(r.pid, process.pid);
  assert.ok(!Number.isNaN(Date.parse(r.timestamp)), r.timestamp);
  assert.strictEqual(r.level, 'quick');
});

await test('the log is append-only across calls', () => {
  const { rows } = rowsWritten(() => {
    guard('one', 'quick', () => 1);
    guard('two', 'quick', () => 2);
  });
  assert.deepStrictEqual(rows.map(r => r.action), ['one', 'two'],
    'the second call must not overwrite the first');
});

await test('logAction records an unknown verdict as unknown, never as permission', () => {
  const { rows } = rowsWritten(() => logAction('two-arg-call', 'quick'));
  assert.strictEqual(rows[0].allowed, null,
    'a caller that did not say must not read as allowed');
});

await test('logAction carries through an explicit verdict', () => {
  const { rows } = rowsWritten(
    () => logAction('explicit', 'quick', { allowed: false, outcome: 'refused' }));
  assert.strictEqual(rows[0].allowed, false);
  assert.strictEqual(rows[0].outcome, 'refused');
});

// ── auditing must never break the caller ──────────────────────────────────
await test('an unwritable log does not take the action down with it', () => {
  // guard.js swallows append errors on purpose: losing an audit line is bad,
  // failing the action because of it is worse.
  const original = fs.appendFileSync;
  let value;
  try {
    fs.appendFileSync = () => { throw new Error('EACCES'); };
    value = guard('unloggable', 'quick', () => 'still ran');
  } finally {
    fs.appendFileSync = original;
  }
  assert.strictEqual(value, 'still ran');
});

finish();
})();
