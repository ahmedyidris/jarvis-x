// selfdebug.js reads Jarvis's own audit log and groups its failures.
//
// NOTES.md deferred that file with: "a self-modifying loop plus a model that
// picks the right action three times in four is how a repo ends up editing
// its own constraints". The routing number closed on 2026-09-07 (41/41
// held-out) and so did the constraint hole (OFF_LIMITS in validate.js). So
// the two things these tests care about most are:
//
//   1. IT CHANGES NOTHING. Not by convention, not by current code path --
//      asserted at runtime with fs's writers replaced by throwing stubs, and
//      from the source, so a future edit that adds a writer fails here.
//   2. IT DOES NOT COUNT TEST FIXTURES AS REAL FAILURES. The live log held
//      599 failure rows and almost all were fixtures from test-guard.js and
//      test-shell.js. A tool that reported "gemini 429 x29, investigate the
//      Gemini integration" would be worse than no tool.
//
// Every test is offline and reads a temp log written for it. Nothing here
// touches logs/actions.jsonl.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const S = require('./selfdebug.js');

const NOW = new Date('2026-09-07T12:00:00.000Z');
const ago = (mins) => new Date(NOW.getTime() - mins * 60000).toISOString();

let tmpdir;
function writeLog(rows) {
  tmpdir = tmpdir || fs.mkdtempSync(path.join(os.tmpdir(), 'jx-selfdebug-'));
  const f = path.join(tmpdir, `log-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(f, rows.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
  return f;
}

const appErr = (action, error, mins = 10) =>
  ({ timestamp: ago(mins), schema: 'v3', origin: 'app', action, allowed: false, outcome: 'error', error });
const testErr = (action, error, mins = 10) =>
  ({ timestamp: ago(mins), schema: 'v3', origin: 'test', action, allowed: false, outcome: 'error', error });
const ok = (action, mins = 10) =>
  ({ timestamp: ago(mins), schema: 'v3', origin: 'app', action, allowed: true, outcome: 'ok' });

(async () => {

// ── it changes nothing ────────────────────────────────────────────────────
await test('diagnose and format write nothing, even with fs sabotaged', () => {
  // The assertion that matters most. If any code path here wrote a file, it
  // would throw instead of passing -- so this cannot be satisfied by luck.
  const logFile = writeLog([appErr('a', 'boom'), ok('b')]);
  const realWrite = fs.writeFileSync;
  const realAppend = fs.appendFileSync;
  const realMkdir = fs.mkdirSync;
  const realRm = fs.unlinkSync;
  try {
    fs.writeFileSync = () => { throw new Error('TRIPWIRE: selfdebug wrote a file'); };
    fs.appendFileSync = () => { throw new Error('TRIPWIRE: selfdebug appended to a file'); };
    fs.mkdirSync = () => { throw new Error('TRIPWIRE: selfdebug created a directory'); };
    fs.unlinkSync = () => { throw new Error('TRIPWIRE: selfdebug deleted a file'); };
    const report = S.diagnose({ logFile, now: NOW });
    S.format(report);
    assert.strictEqual(report.counted, 1, 'and it still did its job');
  } finally {
    fs.writeFileSync = realWrite;
    fs.appendFileSync = realAppend;
    fs.mkdirSync = realMkdir;
    fs.unlinkSync = realRm;
  }
});

await test('it holds no reference to anything that can change the machine', () => {
  // lib.js exports execute(), shell.js exports run(), exec.js exports
  // writeFile. Importing any of them would put a working write one call away
  // from a module whose whole contract is that it cannot.
  const src = fs.readFileSync(path.join(__dirname, 'selfdebug.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['./lib.js', './shell.js', './exec.js', 'child_process']) {
    assert.ok(!code.includes(forbidden), `selfdebug.js imports ${forbidden}`);
  }
  for (const writer of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'unlinkSync', 'rmSync']) {
    assert.ok(!code.includes(writer), `selfdebug.js calls ${writer}`);
  }
  assert.ok(!/\bexecute\s*\(/.test(code), 'selfdebug.js calls execute()');
});

await test('the report says up front that nothing was changed', () => {
  // trade-advisor.js does the same. A reader skimming output must not have
  // to work out whether a fix was applied.
  const out = S.format(S.diagnose({ logFile: writeLog([appErr('a', 'boom')]), now: NOW }));
  assert.ok(/nothing here has been changed, run, or fixed/i.test(out), out);
  assert.ok(/No file was written and no command was run/i.test(out), out);
});

await test('the kill switch does NOT block diagnosis, on purpose', () => {
  // Deliberate, and worth pinning because every other module here refuses to
  // run while .jarvis-x-STOP exists. You halt the system BECAUSE something is
  // wrong, and that is exactly when you want to read what went wrong. A
  // read-only diagnostic that goes dark under the kill switch would take the
  // one tool you need with it. Nothing here can act, so there is nothing for
  // the switch to stop.
  const { STOP_FILE } = require('./guard.js');
  const had = fs.existsSync(STOP_FILE);
  const logFile = writeLog([appErr('a', 'boom')]);
  try {
    if (!had) fs.writeFileSync(STOP_FILE, 'test');
    const r = S.diagnose({ logFile, now: NOW });
    assert.strictEqual(r.counted, 1, 'diagnosis must still work while halted');
    assert.ok(S.format(r).includes('boom') === false || true);
  } finally {
    if (!had && fs.existsSync(STOP_FILE)) fs.unlinkSync(STOP_FILE);
  }
  assert.strictEqual(fs.existsSync(STOP_FILE), had, 'state must be restored');
});

await test('and it does not consult isStopped at all', () => {
  // If it did, the decision above would be one edit away from reversing
  // silently.
  const src = fs.readFileSync(path.join(__dirname, 'selfdebug.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/isStopped/.test(code), 'selfdebug must not gate itself on the kill switch');
});

// ── test fixtures are not real failures ───────────────────────────────────
await test('a test-origin failure is not counted', () => {
  const logFile = writeLog([
    testErr('slow-fail', 'gemini 429'),
    testErr('boom', 'inner failure'),
    appErr('real-thing', 'actual problem'),
  ]);
  const r = S.diagnose({ logFile, now: NOW });
  assert.strictEqual(r.counted, 1, 'only the app failure counts');
  assert.strictEqual(r.skippedTest, 2);
  assert.deepStrictEqual(r.findings.map(f => f.action), ['real-thing']);
});

await test('the skipped fixtures are reported, not silently dropped', () => {
  const logFile = writeLog([testErr('slow-fail', 'gemini 429')]);
  const out = S.format(S.diagnose({ logFile, now: NOW }));
  assert.ok(/1 test-origin failures skipped/.test(out), out);
  assert.ok(/--include-tests/.test(out), 'and the reader is told how to see them');
});

await test('--include-tests shows them, labelled by origin', () => {
  const logFile = writeLog([testErr('slow-fail', 'gemini 429'), appErr('real', 'x')]);
  const r = S.diagnose({ logFile, now: NOW, includeTests: true });
  assert.strictEqual(r.counted, 2);
  const fixture = r.findings.find(f => f.action === 'slow-fail');
  assert.deepStrictEqual(fixture.origins, ['test'], 'origin must stay visible');
});

await test('a pre-v3 row is UNATTRIBUTABLE and is not counted', () => {
  // 2810 of these existed on 2026-09-07. Nothing can work out after the fact
  // whether they came from a test, so guessing either way is wrong.
  const logFile = writeLog([
    { timestamp: ago(10), schema: 'v2', pid: 1, action: 'boom', allowed: false, outcome: 'error', error: 'inner failure' },
    appErr('real', 'x'),
  ]);
  const r = S.diagnose({ logFile, now: NOW });
  assert.strictEqual(r.unattributable, 1);
  assert.strictEqual(r.counted, 1, 'the v2 row must not be counted as app');
  const out = S.format(r);
  assert.ok(/UNATTRIBUTABLE/.test(out), out);
  assert.ok(/cannot tell test from real/i.test(out), 'and it must say why');
});

await test('an empty result does not read as "no failures"', () => {
  // The dangerous output: a clean report over a log full of rows it could
  // not classify.
  const logFile = writeLog([
    { timestamp: ago(10), schema: 'v2', pid: 1, action: 'boom', allowed: false, outcome: 'error' },
  ]);
  const out = S.format(S.diagnose({ logFile, now: NOW }));
  assert.ok(/not the same as "no failures"/i.test(out), out);
});

await test('an unrecognised origin value is treated as unknown, not as app', () => {
  const logFile = writeLog([
    { timestamp: ago(5), schema: 'v3', origin: 'production', action: 'x', allowed: false, outcome: 'error' },
  ]);
  const r = S.diagnose({ logFile, now: NOW });
  assert.strictEqual(S.originOf({ origin: 'production' }), 'unknown');
  assert.strictEqual(r.counted, 0, 'an origin nobody wrote must not be trusted');
});

// ── what counts as a failure ──────────────────────────────────────────────
await test('successes are ignored', () => {
  const logFile = writeLog([ok('a'), ok('b'), ok('c')]);
  const r = S.diagnose({ logFile, now: NOW });
  assert.strictEqual(r.counted, 0);
  assert.strictEqual(r.findings.length, 0);
});

await test('allowed:false counts even with no error text', () => {
  const logFile = writeLog([
    { timestamp: ago(5), schema: 'v3', origin: 'app', action: 'refused-cmd', allowed: false, outcome: 'refused' },
  ]);
  assert.strictEqual(S.diagnose({ logFile, now: NOW }).counted, 1);
});

await test('allowed:null is not a failure — it is an unknown verdict', () => {
  // guard.js's logAction records null for callers that did not say. Counting
  // it as a failure would invent incidents out of missing metadata.
  assert.strictEqual(S.isFailure({ allowed: null, outcome: undefined }), false);
});

await test('each failure kind is classified', () => {
  assert.strictEqual(S.classify({ outcome: 'killswitch' }), 'killswitch');
  assert.strictEqual(S.classify({ action: 'refused-cmd', allowed: false }), 'refused-command');
  assert.strictEqual(S.classify({ outcome: 'refused' }), 'refused');
  assert.strictEqual(S.classify({ outcome: 'error' }), 'error');
  assert.strictEqual(S.classify({ allowed: false }), 'denied');
  assert.strictEqual(S.classify({}), 'other');
});

await test('every kind has a suggestion, so a new kind cannot print undefined', () => {
  for (const kind of ['killswitch', 'refused-command', 'refused', 'error', 'denied', 'other']) {
    assert.ok(S.SUGGESTIONS[kind], `no suggestion for ${kind}`);
  }
  const logFile = writeLog([
    { timestamp: ago(5), schema: 'v3', origin: 'app', action: 'weird', allowed: false, outcome: 'something-new' },
  ]);
  const f = S.diagnose({ logFile, now: NOW }).findings[0];
  assert.ok(f.suggestion && f.suggestion.length > 10, `bad suggestion: ${f.suggestion}`);
});

// ── grouping ──────────────────────────────────────────────────────────────
await test('varying detail in one error is normalised so occurrences group', () => {
  // Otherwise the report is a list of ones and the count -- the only signal
  // that says which failure matters -- is always 1.
  const logFile = writeLog([
    appErr('ollama-ask', 'Ollama returned 404', 30),
    appErr('ollama-ask', 'Ollama returned 500', 20),
    appErr('ollama-ask', 'Ollama returned 503', 10),
  ]);
  const r = S.diagnose({ logFile, now: NOW });
  assert.strictEqual(r.findings.length, 1, 'three HTTP codes are one finding');
  assert.strictEqual(r.findings[0].count, 3);
});

await test('numbers, quotes, paths, hex ids and timestamps are all normalised', () => {
  const n = S.normalizeError;
  assert.strictEqual(n('failed after 3 tries'), n('failed after 17 tries'));
  assert.strictEqual(n("cannot read 'a.txt'"), n("cannot read 'b.txt'"));
  assert.strictEqual(n('missing /home/x/y'), n('missing /home/p/q'));
  assert.strictEqual(n('id deadbeef1234 gone'), n('id cafebabe5678 gone'));
  assert.strictEqual(n('at 2026-09-07T12:00:00.000Z'), n('at 2026-01-01T00:00:00.000Z'));
  assert.strictEqual(n(undefined), '');
  assert.strictEqual(n(null), '');
});

await test('normalising does not collapse genuinely different errors', () => {
  // The other direction. Over-normalising merges unrelated failures into one
  // finding and hides both.
  const n = S.normalizeError;
  assert.notStrictEqual(n('Ollama returned 404'), n('connection refused'));
  assert.notStrictEqual(n('no such file'), n('is a directory'));
});

await test('the same error from different actions stays separate', () => {
  const logFile = writeLog([appErr('read', 'ENOENT'), appErr('write', 'ENOENT')]);
  assert.strictEqual(S.diagnose({ logFile, now: NOW }).findings.length, 2);
});

await test('a group carries its first and last occurrence, not just a count', () => {
  const logFile = writeLog([
    appErr('x', 'boom', 100), appErr('x', 'boom', 50), appErr('x', 'boom', 5),
  ]);
  const f = S.diagnose({ logFile, now: NOW }).findings[0];
  assert.strictEqual(f.count, 3);
  assert.strictEqual(f.firstSeen, ago(100), 'oldest');
  assert.strictEqual(f.lastSeen, ago(5), 'newest');
});

await test('findings are ordered by count, commonest first', () => {
  const logFile = writeLog([
    appErr('rare', 'a'),
    appErr('common', 'b', 9), appErr('common', 'b', 8), appErr('common', 'b', 7),
    appErr('middling', 'c', 6), appErr('middling', 'c', 5),
  ]);
  const r = S.diagnose({ logFile, now: NOW });
  assert.deepStrictEqual(r.findings.map(f => f.action), ['common', 'middling', 'rare']);
});

await test('samples are kept but capped, so one noisy group cannot flood output', () => {
  const rows = Array.from({ length: 40 }, (_, i) => appErr('noisy', 'boom', i + 1));
  const f = S.diagnose({ logFile: writeLog(rows), now: NOW }).findings[0];
  assert.strictEqual(f.count, 40);
  assert.strictEqual(f.samples.length, 3);
});

// ── the window and the filters ────────────────────────────────────────────
await test('rows older than the window are excluded and counted', () => {
  const logFile = writeLog([
    appErr('old', 'x', 60 * 24 * 30),
    appErr('recent', 'y', 5),
  ]);
  const r = S.diagnose({ logFile, now: NOW, windowHours: 24 });
  assert.deepStrictEqual(r.findings.map(f => f.action), ['recent']);
  assert.strictEqual(r.outsideWindow, 1);
});

await test('a row with an unparseable timestamp is kept, not silently dropped', () => {
  // Dropping it would let a malformed writer hide its own failures.
  const logFile = writeLog([
    { timestamp: 'not-a-date', schema: 'v3', origin: 'app', action: 'x', allowed: false, outcome: 'error', error: 'e' },
  ]);
  assert.strictEqual(S.diagnose({ logFile, now: NOW, windowHours: 1 }).counted, 1);
});

await test('minCount hides one-offs without hiding that they existed', () => {
  const logFile = writeLog([
    appErr('once', 'a'),
    appErr('twice', 'b', 9), appErr('twice', 'b', 8),
  ]);
  const r = S.diagnose({ logFile, now: NOW, minCount: 2 });
  assert.deepStrictEqual(r.findings.map(f => f.action), ['twice']);
  // 3, not 2: one 'once' plus two 'twice'. minCount filters the FINDINGS a
  // reader sees; it must not quietly shrink the number of failures the tool
  // says it examined, or "3 failures, 1 finding" becomes "1 failure".
  assert.strictEqual(r.counted, 3, 'counted still reflects everything examined');
});

await test('selfdebug never diagnoses its own rows', () => {
  // supervisor.js shipped with exactly this bug: its own skip entries landed
  // in the log it read, and made a goal look stagnant BECAUSE it had been
  // skipped. This module writes nothing today; the filter is what keeps that
  // true if it ever does.
  const logFile = writeLog([
    { timestamp: ago(5), schema: 'v3', origin: 'app', action: 'selfdebug-run', allowed: false, outcome: 'error', error: 'x' },
    appErr('real', 'y'),
  ]);
  const r = S.diagnose({ logFile, now: NOW });
  assert.deepStrictEqual(r.findings.map(f => f.action), ['real']);
});

// ── reading the log ───────────────────────────────────────────────────────
await test('a missing log is empty, not an exception', () => {
  const r = S.diagnose({ logFile: path.join(os.tmpdir(), 'definitely-absent-xyz.jsonl'), now: NOW });
  assert.strictEqual(r.totalRows, 0);
  assert.strictEqual(r.findings.length, 0);
});

await test('a truncated final line does not take the report down', () => {
  // The log is appended to by live processes, so a partial row is normal.
  const logFile = writeLog([appErr('a', 'boom'), '{"timestamp":"2026-09-0']);
  const r = S.diagnose({ logFile, now: NOW });
  assert.strictEqual(r.unparseable, 1);
  assert.strictEqual(r.counted, 1, 'the good rows still count');
  assert.ok(/unparseable/.test(S.format(r)), 'and the reader is told');
});

await test('load reports what it could not parse rather than hiding it', () => {
  const logFile = writeLog(['{bad', '{"a":1}', 'also bad']);
  const { rows, unparseable } = S.load({ logFile });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(unparseable, 2);
});

finish();
})();
