// sweep.js is the zero-assertion sweep: it answers "can each CI suite report
// whether it passed?" for every suite in .github/workflows/test.yml.
//
// This file matters more than most, because the sweep is a control and a
// broken control is worse than no control -- it converts "nobody is checking"
// into "something is checking", which is the more dangerous of the two.
//
// The single most important pair of assertions here is the one that pins the
// trap the obvious implementation falls into:
//
//   test-scheduler.js prints "8/8 passed" and is FINE  (8 real checks, exits 1
//                                                       when scheduler.js is
//                                                       mutated)
//   test-helper.js    prints nothing and is BROKEN     (a library in the CI
//                                                       list, 0 assertions,
//                                                       exits 0 always)
//
// A sweep keyed on grep "Passed:" clears the broken one and flags the working
// one. Both directions are asserted below.
//
// Everything here is offline. sweep() takes its runner, its code directory and
// its workflow file as arguments, so no test in this file spawns a real suite
// or reads the real workflow -- except the two that deliberately do, to prove
// the real wiring is intact.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
// FUSE. A hung await drains the event loop and exits 0 having printed no
// tally -- a vacuous pass that reads as green, and the exact shape sweep.js
// exists to catch. finish() calls process.exit() explicitly, so this default
// only survives when finish() was never reached. Found by mutation-testing
// code/status.js; see code/test-status.js for the full account.
process.exitCode = 1;

const S = require('./sweep.js');

// A runner built from a {name: {exitCode, output}} table. This is the seam
// that makes the whole file offline.
function fakeRunner(table) {
  return (file) => {
    const name = path.basename(file, '.js');
    return table[name] || { exitCode: 0, output: '' };
  };
}

// A temp code/ containing empty files for the named suites, so existsSync is
// exercised against a real filesystem rather than stubbed.
let tmpdirs = [];
function fakeCodeDir(names) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-sweep-'));
  tmpdirs.push(d);
  for (const n of names) fs.writeFileSync(path.join(d, `${n}.js`), '');
  return d;
}
function writeWorkflow(body) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-sweep-yml-'));
  tmpdirs.push(d);
  const f = path.join(d, 'test.yml');
  fs.writeFileSync(f, body);
  return f;
}
process.on('exit', () => {
  for (const d of tmpdirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
});

(async () => {

// -- the trap, both directions ----------------------------------------------
await test('a suite reporting "N/N passed" is fine, one printing nothing is not', () => {
  // THE test in this file. Reverse either half and the sweep is worse than
  // useless: it would send someone to fix a working test and sign off on a
  // file that cannot fail.
  const codeDir = fakeCodeDir(['test-scheduler', 'test-helper']);
  const r = S.sweep({
    suites: ['test-scheduler', 'test-helper'],
    codeDir,
    runner: fakeRunner({
      'test-scheduler': { exitCode: 0, output: 'ok  a\nok  b\n\n8/8 passed\n' },
      'test-helper': { exitCode: 0, output: '' },
    }),
  });
  const by = Object.fromEntries(r.results.map(x => [x.name, x]));
  assert.strictEqual(by['test-scheduler'].verdict, 'ok',
    '"8/8 passed" is a real count in a different format, not an absence');
  assert.strictEqual(by['test-scheduler'].count, 8);
  assert.strictEqual(by['test-helper'].verdict, 'no-count');
  assert.deepStrictEqual(r.findings.map(f => f.name), ['test-helper'],
    'exactly one finding, and it is the library');
});

// -- parseCount --------------------------------------------------------------
await test('parseCount reads the test-helper format, counting failures too', () => {
  // Passed+Failed, not Passed alone: a suite with 0 passed and 30 failed
  // asserted 30 times. It is failing, not silent, and those are different.
  assert.deepStrictEqual(S.parseCount('Passed: 37, Failed: 0'),
    { count: 37, format: 'passed-failed' });
  assert.deepStrictEqual(S.parseCount('Passed: 0, Failed: 30'),
    { count: 30, format: 'passed-failed' });
});

await test('parseCount reads the n-of-n format, taking the DENOMINATOR', () => {
  // "6/8 passed" means 8 assertions ran and 2 failed. Taking 6 would report a
  // partially-failing suite as having fewer assertions than it has.
  assert.deepStrictEqual(S.parseCount('8/8 passed'), { count: 8, format: 'n-of-n' });
  assert.deepStrictEqual(S.parseCount('6/8 passed'), { count: 8, format: 'n-of-n' });
});

await test('no count means null, which is the finding and not an error', () => {
  assert.strictEqual(S.parseCount(''), null);
  assert.strictEqual(S.parseCount('Result: ACTION RAN'), null,
    'the exact string test-guard.js used to print while asserting nothing');
  assert.strictEqual(S.parseCount(undefined), null);
  assert.strictEqual(S.parseCount(null), null);
  assert.strictEqual(S.parseCount(12), null);
});

await test('counts are anchored to line start, so prose cannot fake one', () => {
  // selfdebug.js's own report contains lines like "actor: scheduler 2x" and
  // "market-collect — 3x". A loose regex would harvest numbers out of any
  // suite that prints a report and call an empty file well-tested.
  assert.strictEqual(S.parseCount('  look: 3/4 passed the check'), null,
    'indented prose is not a count line');
  assert.strictEqual(S.parseCount('  log: Passed: 99, Failed: 1 from a previous run'), null,
    'a full count pattern mid-line is still not a count line — this string ' +
    'DOES match once the ^ anchor is removed, which the earlier version of ' +
    'this assertion failed to notice');
  assert.deepStrictEqual(S.parseCount('preamble\nPassed: 5, Failed: 1\ntail'),
    { count: 6, format: 'passed-failed' }, 'but a real count line mid-output counts');
});

// -- classify ----------------------------------------------------------------
await test('classify separates "cannot fail" from "did fail"', () => {
  // The distinction the whole file rests on. CI already shouts about a suite
  // that fails; nothing shouted about one that could not.
  assert.strictEqual(S.classify({ exists: true, exitCode: 0, parsed: { count: 5 } }), 'ok');
  assert.strictEqual(S.classify({ exists: true, exitCode: 1, parsed: { count: 5 } }), 'failed');
  assert.strictEqual(S.classify({ exists: true, exitCode: 0, parsed: null }), 'no-count');
  assert.strictEqual(S.classify({ exists: true, exitCode: 0, parsed: { count: 0 } }), 'zero-count');
  assert.strictEqual(S.classify({ exists: false, exitCode: -1, parsed: null }), 'missing');
});

await test('a suite that asserted and failed is NOT a sweep finding', () => {
  // It is working correctly and reporting bad news. Folding it in here would
  // make the sweep fire on every ordinary red build and get muted.
  const codeDir = fakeCodeDir(['test-a']);
  const r = S.sweep({
    suites: ['test-a'], codeDir,
    runner: fakeRunner({ 'test-a': { exitCode: 1, output: 'Passed: 3, Failed: 2' } }),
  });
  assert.strictEqual(r.results[0].verdict, 'failed');
  assert.strictEqual(r.findings.length, 0, 'a real failure is CI\'s business, not the sweep\'s');
  assert.deepStrictEqual(r.failures.map(f => f.name), ['test-a'], 'but it is still reported');
});

await test('a suite asserting zero times is a finding even when it exits 0', () => {
  const codeDir = fakeCodeDir(['test-empty']);
  const r = S.sweep({
    suites: ['test-empty'], codeDir,
    runner: fakeRunner({ 'test-empty': { exitCode: 0, output: 'Passed: 0, Failed: 0' } }),
  });
  assert.strictEqual(r.results[0].verdict, 'zero-count');
  assert.strictEqual(r.findings.length, 1);
});

await test('a name in the CI list with no file behind it is a finding', () => {
  // test-data-layer.js was in the list with its module deleted. The inverse --
  // a listed suite whose own file is gone -- reads as a pass to `node x.js ||`
  // only if the shell swallows it, so name it explicitly.
  const r = S.sweep({ suites: ['test-ghost'], codeDir: fakeCodeDir([]) });
  assert.strictEqual(r.results[0].verdict, 'missing');
  assert.strictEqual(r.findings.length, 1);
});

// -- the runner seam ---------------------------------------------------------
await test('a suite killed by the timeout is not counted as a pass', () => {
  // spawnSync sets status null when it kills the child. `status === 0` is
  // false for null, but `!status` is true -- so a naive check would read a
  // hung suite as green.
  const codeDir = fakeCodeDir(['test-hang']);
  const r = S.sweep({
    suites: ['test-hang'], codeDir,
    runner: () => ({ exitCode: -1, output: 'Passed: 4, Failed: 0' }),
  });
  assert.strictEqual(r.results[0].verdict, 'failed',
    'a timeout is a failure, never an ok');
});

await test('a killed child (null status) normalizes to -1, never to 0', () => {
  // spawnSync uses null for "I killed it" -- timeout or signal. `status || 0`
  // and `!status` both turn that into a pass. Found by mutation: the inline
  // version of this escaped every other assertion in the file.
  assert.strictEqual(S.normalizeExit(null), -1);
  assert.strictEqual(S.normalizeExit(undefined), -1);
  assert.strictEqual(S.normalizeExit(0), 0);
  assert.strictEqual(S.normalizeExit(1), 1);
  assert.strictEqual(S.normalizeExit(137), 137, 'SIGKILL exit is not a timeout');
});

await test('defaultRunner really spawns node and reports its exit and output', () => {
  // The seam every other test stubs. If this is wrong, the sweep reports
  // fiction about every suite while its unit tests stay green.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-sweep-run-'));
  tmpdirs.push(d);
  const ok = path.join(d, 'ok.js');
  const bad = path.join(d, 'bad.js');
  fs.writeFileSync(ok, 'console.log("Passed: 3, Failed: 0");');
  fs.writeFileSync(bad, 'console.error("boom"); process.exit(2);');
  const a = S.defaultRunner(ok);
  assert.strictEqual(a.exitCode, 0);
  assert.ok(/Passed: 3, Failed: 0/.test(a.output), a.output);
  const b = S.defaultRunner(bad);
  assert.strictEqual(b.exitCode, 2, 'a real non-zero exit must come through');
  assert.ok(/boom/.test(b.output), 'stderr must be captured too, not only stdout');
});

await test('the assertion total sums across formats, not just one', () => {
  const codeDir = fakeCodeDir(['test-a', 'test-b']);
  const r = S.sweep({
    suites: ['test-a', 'test-b'], codeDir,
    runner: fakeRunner({
      'test-a': { exitCode: 0, output: 'Passed: 10, Failed: 0' },
      'test-b': { exitCode: 0, output: '8/8 passed' },
    }),
  });
  assert.strictEqual(r.assertions, 18,
    'the n-of-n suite was invisible to the old hand count -- that is why it was 396 not 404');
});

// -- ciSuites: one list, not two --------------------------------------------
await test('the suite list comes from the workflow, across line continuations', () => {
  const f = writeWorkflow([
    'jobs:', '  js:', '    steps:', '      - run: |',
    '          for f in test-one test-two \\',
    '                   test-three test-four \\',
    '                   test-five; do',
    '            node "code/$f.js"',
    '          done',
  ].join('\n'));
  assert.deepStrictEqual(S.ciSuites({ workflowFile: f }),
    ['test-one', 'test-two', 'test-three', 'test-four', 'test-five']);
});

await test('a workflow with no suite list throws instead of sweeping nothing', () => {
  // Silently returning [] would print "0 suites, every one fine" and exit 0 --
  // a green tick meaning the sweep found nothing to look at. That is precisely
  // the failure mode being swept for, reproduced inside the sweep.
  const f = writeWorkflow('jobs:\n  js:\n    steps:\n      - run: npm test\n');
  assert.throws(() => S.ciSuites({ workflowFile: f }), /no "for f in/);
});

await test('the REAL workflow still parses, so the wiring is not theoretical', () => {
  // The one test here that touches the real file. Every assertion above proves
  // the parser works on a fixture; this proves it works on the thing shipped.
  const names = S.ciSuites();
  assert.ok(names.length >= 15, `expected the real CI list, got ${names.length}`);
  assert.ok(names.includes('test-guard'), 'test-guard is in CI and must be swept');
  assert.ok(names.every(n => /^test-[a-z0-9-]+$/.test(n)),
    `every entry should be a test name, got: ${names.join(' ')}`);
});

// -- the report --------------------------------------------------------------
await test('the report names the finding and says what to do about it', () => {
  const codeDir = fakeCodeDir(['test-lib-not-a-test']);
  const out = S.format(S.sweep({
    suites: ['test-lib-not-a-test'], codeDir,
    runner: fakeRunner({ 'test-lib-not-a-test': { exitCode: 0, output: '' } }),
  }));
  assert.ok(/NO ASSERTION COUNT/.test(out), out);
  assert.ok(/test-lib-not-a-test/.test(out), out);
  assert.ok(/CANNOT REPORT WHETHER THEY PASSED/.test(out), out);
  assert.ok(/workflows\/test\.yml/.test(out), 'it must say where the list lives');
});

await test('a clean sweep says so without claiming more than it checked', () => {
  const codeDir = fakeCodeDir(['test-a']);
  const out = S.format(S.sweep({
    suites: ['test-a'], codeDir,
    runner: fakeRunner({ 'test-a': { exitCode: 0, output: 'Passed: 9, Failed: 0' } }),
  }));
  assert.ok(/Every listed suite reports a non-zero assertion count/.test(out), out);
  assert.ok(!/CANNOT REPORT/.test(out), out);
  assert.ok(/1 suites, 9 assertions/.test(out), out);
});

await test('findings exit non-zero, because a warning would be ignored', () => {
  // Asserted from the source, not by spawning: running the CLI would run all
  // 20 real suites. The property is that a finding FAILS the build -- a sweep
  // that printed a warning and exited 0 would itself be a check that quietly
  // stopped checking.
  const src = fs.readFileSync(path.join(__dirname, 'sweep.js'), 'utf8');
  assert.ok(/process\.exit\(\s*report\.findings\.length\s*\?\s*1\s*:\s*0\s*\)/.test(src),
    'the CLI must exit 1 when there are findings');
  assert.ok(!/console\.warn/.test(src), 'findings are failures here, not warnings');
});

await test('the sweep reads the workflow rather than keeping its own copy', () => {
  // A second hardcoded list would drift from CI silently -- the exact class of
  // defect this file exists to catch, reproduced inside the catcher.
  const src = fs.readFileSync(path.join(__dirname, 'sweep.js'), 'utf8');
  const suiteNames = (src.match(/'test-[a-z0-9-]+'/g) || [])
    .filter(n => !/(test-guard|test-shell|test-helper|test-scheduler|test-data-layer|test-agent-data-integration)/.test(n));
  assert.deepStrictEqual(suiteNames, [],
    `sweep.js must not name suites outside comments; found ${suiteNames.join(' ')}`);
});

finish();
})();
