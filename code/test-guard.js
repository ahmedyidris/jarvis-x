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
// FUSE. A hung await drains the event loop and exits 0 having printed no
// tally -- a vacuous pass that reads as green, and the exact shape sweep.js
// exists to catch. finish() calls process.exit() explicitly, so this default
// only survives when finish() was never reached. Found by mutation-testing
// code/status.js; see code/test-status.js for the full account.
process.exitCode = 1;

const { guard, isStopped, logAction, STOP_FILE, LOG_FILE,
        ORIGIN, detectOrigin, ACTOR, detectActor,
        setLogFile, currentLogFile } = require('./guard.js');

// Every assertion below diffs the audit log, and until 2026-09-07 that was
// the REAL logs/actions.jsonl. That is how it collected 599 fixture failure
// rows, and how mutation-testing this very file permanently mislabelled seven
// of them as origin:'app' -- selfdebug.js still reports those as real
// application failures. So the suite writes to a temp file now.
//
// The diff-the-real-file instinct was right about one thing: a test that
// mocks the writer proves nothing about whether appending works. This still
// diffs a real file on a real disk through the real fs.appendFileSync -- just
// not the one the machine's audit trail lives in. And the first test below
// asserts the DEFAULT is unchanged, so the seam cannot quietly redirect
// production.
const TMP_LOG = path.join(require('os').tmpdir(),
  `jx-test-guard-${process.pid}-${Date.now()}.jsonl`);
setLogFile(TMP_LOG);
process.on('exit', () => { try { fs.unlinkSync(TMP_LOG); } catch { /* fine */ } });

/** Newest audit rows written while `fn` ran. The log path is a module
 *  constant, so the honest way to assert on it is to diff the real file. */
function rowsWritten(fn) {
  const f = currentLogFile();
  const before = fs.existsSync(f)
    ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0;
  let threw = null, value;
  try { value = fn(); } catch (e) { threw = e; }
  const after = fs.existsSync(f)
    ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
  return { rows: after.slice(before).map(l => JSON.parse(l)), threw, value };
}

async function rowsWrittenAsync(fn) {
  const f = currentLogFile();
  const before = fs.existsSync(f)
    ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0;
  let threw = null, value;
  try { value = await fn(); } catch (e) { threw = e; }
  const after = fs.existsSync(f)
    ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
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

// ── the seam itself ───────────────────────────────────────────────────────
await test('the DEFAULT audit log is the repo\'s real one', () => {
  // The seam's whole risk. If the default drifted, production would audit to
  // wherever the last test pointed it -- and nothing else would notice.
  const expected = path.join(__dirname, '..', 'logs', 'actions.jsonl');
  assert.strictEqual(LOG_FILE, expected, 'LOG_FILE must be the repo audit log');
});

await test('this suite is NOT writing to the real audit log', () => {
  // The reason the seam exists. Until 2026-09-07 it was, which is how the log
  // gathered 599 fixture failure rows.
  assert.notStrictEqual(currentLogFile(), LOG_FILE);
  assert.ok(currentLogFile().includes('jx-test-guard-'), currentLogFile());
});

await test('setLogFile returns the previous path so it can be restored', () => {
  const previous = setLogFile('/tmp/jx-guard-seam-probe.jsonl');
  assert.strictEqual(currentLogFile(), '/tmp/jx-guard-seam-probe.jsonl');
  const back = setLogFile(previous);
  assert.strictEqual(back, '/tmp/jx-guard-seam-probe.jsonl');
  assert.strictEqual(currentLogFile(), previous, 'restored');
});

await test('every CI test file gets the redirect, or says why not', () => {
  // The property that keeps the audit log clean is "needs no cooperation":
  // importing test-helper.js is enough. This asserts it, because a new
  // code/test-*.js written without it would quietly start collecting fixtures
  // in logs/actions.jsonl again -- which is the thing that made selfdebug.js
  // unbuildable for months.
  //
  // Read from the workflow, not a list kept here, so adding a file to CI
  // without the redirect fails HERE rather than showing up as noise in a
  // report weeks later.
  const wf = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'test.yml'), 'utf8');
  // From the `for f in ... ; do` list ONLY. Scanning the whole file matched
  // test-kokoro, test-vision and test-voice out of the COMMENT that explains
  // why they are excluded -- files that need local Piper/Kokoro/Ollama and
  // are deliberately not in CI. A guard that flags the exclusions it was
  // told about is a guard nobody will keep.
  const loop = wf.match(/for f in ([\s\S]*?);\s*do/);
  assert.ok(loop, 'could not find the js-suite loop — did the workflow change shape?');
  const listed = loop[1].split(/[\s\\]+/).map(t => t.trim()).filter(Boolean);
  assert.ok(listed.length >= 15, `only found ${listed.length} test files in the loop`);
  for (const n of listed) {
    assert.ok(fs.existsSync(path.join(__dirname, `${n}.js`)),
      `CI runs code/${n}.js and it does not exist`);
  }

  // test-scheduler.js predates test-helper.js and rolls its own counters. It
  // is exempt because it calls no gated action -- verified by the delta
  // assertion below, not by assumption.
  const EXEMPT = new Set(['test-scheduler', 'test-helper']);
  const missing = [];
  for (const n of listed) {
    if (EXEMPT.has(n)) continue;
    const src = fs.readFileSync(path.join(__dirname, `${n}.js`), 'utf8');
    const redirected = /require\('\.\/test-helper\.js'\)/.test(src)
      || /setLogFile\(/.test(src);
    if (!redirected) missing.push(n);
  }
  assert.deepStrictEqual(missing, [],
    'these audit to the real logs/actions.jsonl — import test-helper.js');
});

await test('a file relying ONLY on test-helper still does not pollute', () => {
  // This file redirects the log itself, so its own "not writing to the real
  // log" assertion passes even if test-helper.js's redirect is broken --
  // verified by mutation: gutting that redirect left this suite fully green
  // while test-paper-trading, test-watcher, test-market-collect,
  // test-market-analyst and test-trade-advisor went back to appending 65 rows
  // a run to the machine's audit trail.
  //
  // So this spawns one of those files and watches the real log. Chosen
  // because it wrote 21 rows per run before the fix and imports no seam of
  // its own -- if test-helper.js stops redirecting, this is what notices.
  const before = fs.existsSync(LOG_FILE)
    ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).length : 0;
  require('child_process').execFileSync(process.execPath,
    [path.join(__dirname, 'test-paper-trading.js')], { stdio: 'ignore' });
  const after = fs.existsSync(LOG_FILE)
    ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).length : 0;
  assert.strictEqual(after, before,
    `test-paper-trading.js appended ${after - before} rows to the REAL audit ` +
    'log — test-helper.js is no longer redirecting it');
});

await test('the exempt file really does write nothing to the audit log', () => {
  // The exemption above is only honest if checked. If test-scheduler.js ever
  // starts calling a gated action, this fails and the exemption has to go.
  const before = fs.existsSync(LOG_FILE)
    ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).length : 0;
  require('child_process').execFileSync(process.execPath,
    [path.join(__dirname, 'test-scheduler.js')], { stdio: 'ignore' });
  const after = fs.existsSync(LOG_FILE)
    ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).length : 0;
  assert.strictEqual(after, before,
    'test-scheduler.js appended to the real audit log — it is no longer exempt');
});

await test('the seam is not reachable through an environment variable', () => {
  // Deliberate. The agent cannot call a function, but an env var is a wider
  // surface than the threat model wants for a control that can silence
  // auditing entirely.
  const src = fs.readFileSync(path.join(__dirname, 'guard.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/process\.env/.test(code), 'guard.js must not read the environment');
});

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
  assert.strictEqual(r.schema, 'v5', 'readers branch on schema; older rows lack a verdict');
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

// ── provenance, added 2026-09-07 ──────────────────────────────────────────
// v3 exists because selfdebug.js could not otherwise tell a real failure
// from a test fixture. This log had 599 failure rows and almost all were
// fixtures -- `boom`/"inner failure", `slow-fail`/"gemini 429",
// `odd-fail`/"a bare string", 333 `refused-cmd` -- because tests call guard()
// and it appends to the real LOG_FILE. A tool reading it would have reported
// "gemini 429 occurred 29 times, investigate the Gemini integration".
await test('every row records where it came from', () => {
  const { rows } = rowsWritten(() => guard('provenance', 'quick', () => 1));
  assert.ok(['test', 'app'].includes(rows[0].origin), `bad origin: ${rows[0].origin}`);
});

await test('and this suite is recorded as a test, not as the app', () => {
  // The whole point. If this ever reads 'app', selfdebug starts counting the
  // fixtures in this very file as real incidents.
  const { rows } = rowsWritten(() => guard('provenance-2', 'quick', () => 1));
  assert.strictEqual(rows[0].origin, 'test',
    'a test run must not be indistinguishable from a real one');
});

await test('origin is derived from the entry script, needing no cooperation', () => {
  // Not an environment variable: a new code/test-*.js is tagged correctly
  // without its author knowing this mechanism exists. And the agent cannot
  // set it -- it runs through agent.js or scheduler.js, and rewriting argv
  // is not one of its action types.
  const original = process.argv[1];
  try {
    process.argv[1] = '/anywhere/code/test-something-new.js';
    assert.strictEqual(detectOrigin(), 'test');
    process.argv[1] = '/anywhere/code/agent.js';
    assert.strictEqual(detectOrigin(), 'app');
    process.argv[1] = '/anywhere/code/scheduler.js';
    assert.strictEqual(detectOrigin(), 'app');
    process.argv[1] = '/anywhere/jest-runner.js';
    assert.strictEqual(detectOrigin(), 'test');
  } finally {
    process.argv[1] = original;
  }
});

await test('a missing argv[1] is app, not a crash', () => {
  const original = process.argv[1];
  try {
    delete process.argv[1];
    assert.strictEqual(detectOrigin(), 'app');
  } finally {
    process.argv[1] = original;
  }
});

await test('the origin is fixed at load, so it cannot change mid-run', () => {
  // Recomputing per append would let a long-running process be half tagged
  // if something reassigned argv. ORIGIN is captured once.
  const before = ORIGIN;
  const original = process.argv[1];
  try {
    process.argv[1] = '/anywhere/code/agent.js';
    const { rows } = rowsWritten(() => guard('still-a-test', 'quick', () => 1));
    assert.strictEqual(rows[0].origin, before, 'the row must use the load-time origin');
    assert.strictEqual(rows[0].origin, 'test');
  } finally {
    process.argv[1] = original;
  }
});

await test('logAction records origin too, not only guard', () => {
  const { rows } = rowsWritten(() => logAction('la-origin', 'quick', { allowed: true }));
  assert.strictEqual(rows[0].origin, 'test');
  assert.strictEqual(rows[0].schema, 'v5');
});

await test('a killswitch row is attributed like any other', () => {
  // The row most worth auditing must also be the one you can tell apart from
  // a test that flipped the switch on purpose -- which this suite does.
  withKillSwitch(() => {
    const { rows } = rowsWritten(() => guard('blocked-attributed', 'hard', () => 1));
    assert.strictEqual(rows[0].outcome, 'killswitch');
    assert.strictEqual(rows[0].origin, 'test');
  });
});

// -- v4: WHICH entry point, not just whether it was a test --------------------
await test('every row names the entry point that produced it', () => {
  // v3 could say "a test did this". It could not say WHICH of the eight
  // writers did, so a scheduler failing nightly and an interactive agent
  // failing once looked like the same incident with a bigger count.
  const { rows } = rowsWritten(() => guard('actored', 'quick', () => 1));
  assert.strictEqual(rows[0].actor, 'test-guard',
    'the actor is this file, because this file is what node was pointed at');
  assert.strictEqual(rows[0].actor, ACTOR, 'the row must use the load-time actor');
});

await test('actor and origin answer different questions', () => {
  // Two different test files share origin 'test' and differ in actor; two
  // different app entry points share origin 'app' and differ in actor.
  // Neither field is derivable from the other, which is why both are stored.
  const original = process.argv[1];
  try {
    process.argv[1] = '/x/code/test-paper-trading.js';
    assert.strictEqual(detectOrigin(), 'test');
    assert.strictEqual(detectActor(), 'test-paper-trading');
    process.argv[1] = '/x/code/test-guard.js';
    assert.strictEqual(detectOrigin(), 'test');
    assert.strictEqual(detectActor(), 'test-guard');
    process.argv[1] = '/x/code/scheduler.js';
    assert.strictEqual(detectOrigin(), 'app');
    assert.strictEqual(detectActor(), 'scheduler');
    process.argv[1] = '/x/code/agent.js';
    assert.strictEqual(detectOrigin(), 'app');
    assert.strictEqual(detectActor(), 'agent');
  } finally {
    process.argv[1] = original;
  }
});

await test('the actor is the script name with the extension stripped', () => {
  // hermes.py and a hypothetical hermes.js are the same entry point wearing
  // two runtimes; grouping a report by 'hermes.py' and 'hermes' separately
  // would split one story in half.
  const original = process.argv[1];
  try {
    const cases = [
      ['/x/hermes.py', 'hermes'],
      ['/x/code/selfdebug.js', 'selfdebug'],
      ['/x/code/tool.mjs', 'tool'],
      ['/x/code/tool.cjs', 'tool'],
      ['/x/code/market-collect.js', 'market-collect'],
      ['scheduler.js', 'scheduler'],
    ];
    for (const [argv, expected] of cases) {
      process.argv[1] = argv;
      assert.strictEqual(detectActor(), expected, `${argv} -> ${expected}`);
    }
  } finally {
    process.argv[1] = original;
  }
});

await test('an extension this repo does not use is left alone, not half-eaten', () => {
  // The strip is an explicit list. A .sh or .ts entry point keeps its suffix
  // rather than being silently renamed into a collision with a .js sibling.
  const original = process.argv[1];
  try {
    process.argv[1] = '/x/scripts/status.sh';
    assert.strictEqual(detectActor(), 'status.sh');
  } finally {
    process.argv[1] = original;
  }
});

await test('an unattributable entry point reads as unknown, never as a guess', () => {
  // origin defaults to 'app' because "not a test" is the safe reading there.
  // actor has no safe default: naming the wrong script is worse than naming
  // none, so it says so.
  const original = process.argv[1];
  try {
    delete process.argv[1];
    assert.strictEqual(detectActor(), 'unknown');
    process.argv[1] = '';
    assert.strictEqual(detectActor(), 'unknown');
    process.argv[1] = '/x/code/.js';
    assert.strictEqual(detectActor(), 'unknown', 'a name that is only an extension is no name');
  } finally {
    process.argv[1] = original;
  }
});

await test('the actor is fixed at load, so it cannot change mid-run', () => {
  const before = ACTOR;
  const original = process.argv[1];
  try {
    process.argv[1] = '/anywhere/code/scheduler.js';
    const { rows } = rowsWritten(() => guard('still-test-guard', 'quick', () => 1));
    assert.strictEqual(rows[0].actor, before);
    assert.strictEqual(rows[0].actor, 'test-guard');
  } finally {
    process.argv[1] = original;
  }
});

await test('logAction records actor too, not only guard', () => {
  const { rows } = rowsWritten(() => logAction('la-actor', 'quick', { allowed: true }));
  assert.strictEqual(rows[0].actor, 'test-guard');
});

await test('a killswitch row names its actor', () => {
  // "something tried to act while stopped" is only actionable if you know
  // which something.
  withKillSwitch(() => {
    const { rows } = rowsWritten(() => guard('blocked-actor', 'hard', () => 1));
    assert.strictEqual(rows[0].outcome, 'killswitch');
    assert.strictEqual(rows[0].actor, 'test-guard');
  });
});

await test('an error row names its actor, because that is the row worth reading', () => {
  const { rows } = rowsWritten(
    () => guard('actor-boom', 'quick', () => { throw new Error('x'); }));
  assert.strictEqual(rows[0].outcome, 'error');
  assert.strictEqual(rows[0].actor, 'test-guard');
  assert.strictEqual(rows[0].schema, 'v5');
});

finish();
})();
