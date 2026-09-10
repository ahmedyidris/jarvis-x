// weekly-sweep.js is the time-driven half of PLAN_5 §3. Like sweep.js it is a
// CONTROL, so the assertions that matter are the ones pinning what it must NOT
// do as much as what it must:
//
//   invent a finding      -> a doc naming a suite that was never re-run must
//                            produce silence, not "drift" from a number nobody
//                            measured.
//   cry wolf weekly       -> a gitignored path (logs/.judge-cache.json) is
//                            absent by design and must never be flagged.
//   guess at an ambiguity -> "test-guard and test-shell have 37 and 22
//                            assertions" must go to the UNCHECKED count, not
//                            be paired left-to-right.
//   overstate coverage    -> "no findings" must always print alongside the
//                            number of claims it could not verify.
//
// The last one is the whole reason the module reports its own blind spot, so
// it gets an assertion rather than being left to the reader of the output.
//
// Offline throughout: run() takes its clock, its repo root, its doc list, its
// ignore oracle and its suite runner as arguments, so nothing here spawns a
// suite, shells out to git, or touches the real logs/sweep-inbox.jsonl. The two
// tests that deliberately hit the real repo are marked, and they assert wiring
// (the real .gitignore excludes logs/) rather than any particular finding.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const W = require('./weekly-sweep.js');

// See test-status.js for why: a suite that truncates instead of failing exits 0
// and prints no tally, which reads as green. finish() calls process.exit()
// explicitly, so this default only survives if finish() was never reached.
process.exitCode = 1;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-weekly-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

let seq = 0;
/** A throwaway repo root containing the named docs. */
function fakeRepo(files = {}) {
  const root = path.join(TMP, `repo-${seq++}`);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  fs.mkdirSync(root, { recursive: true });
  return root;
}

const inboxPath = () => path.join(TMP, `inbox-${seq++}.jsonl`);
const NEVER_IGNORED = () => false;
const CLOCK = new Date('2026-03-01T12:00:00.000Z');

/** A sweep.js-shaped report. */
function fakeSweep({ results = [], findings = [], failures = [] } = {}) {
  return {
    results, findings, failures,
    total: results.length,
    assertions: results.reduce((n, r) => n + (r.count || 0), 0),
  };
}

// --- detector 1: stale references ------------------------------------------

test('a doc referencing a file that does not exist is a finding', () => {
  const root = fakeRepo({ 'D.md': 'see `code/gone.js` for details' });
  const out = W.staleRefs({ repoRoot: root, docs: ['D.md'], isIgnored: NEVER_IGNORED });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].kind, 'stale-ref');
  assert.strictEqual(out[0].ref, 'code/gone.js');
  assert.match(out[0].detail, /does not exist/);
});

test('a reference that does exist is not a finding', () => {
  const root = fakeRepo({ 'D.md': 'see `code/here.js`', 'code/here.js': '' });
  assert.deepStrictEqual(
    W.staleRefs({ repoRoot: root, docs: ['D.md'], isIgnored: NEVER_IGNORED }), []);
});

test('a bare filename is prose about a module, not a path — never flagged', () => {
  // Every doc in this repo discusses `guard.js` by name. Resolving bare names
  // against the repo root would invent a finding for each one.
  const root = fakeRepo({ 'D.md': '`guard.js` gates it, and `validate.js` checks it' });
  assert.deepStrictEqual(
    W.staleRefs({ repoRoot: root, docs: ['D.md'], isIgnored: NEVER_IGNORED }), []);
});

test('a gitignored path is absent BY DESIGN and must never be flagged', () => {
  // logs/.judge-cache.json is created at runtime. Flagging it would fire on
  // every run forever, and a control that cries wolf weekly gets ignored.
  const root = fakeRepo({ 'D.md': 'cache lives in `logs/.judge-cache.json`' });
  const asIgnored = (ref) => ref.startsWith('logs/');
  assert.deepStrictEqual(
    W.staleRefs({ repoRoot: root, docs: ['D.md'], isIgnored: asIgnored }), []);
  // ...and it WOULD be flagged without the exclusion, so the test above is
  // pinning the exclusion rather than an accident of the fixture.
  assert.strictEqual(
    W.staleRefs({ repoRoot: root, docs: ['D.md'], isIgnored: NEVER_IGNORED }).length, 1);
});

test('the same missing path named twice in one doc is reported once', () => {
  const root = fakeRepo({ 'D.md': '`a/x.js` and again `a/x.js`' });
  assert.strictEqual(
    W.staleRefs({ repoRoot: root, docs: ['D.md'], isIgnored: NEVER_IGNORED }).length, 1);
});

test('a doc in the list that does not exist is skipped, not crashed on', () => {
  const root = fakeRepo({ 'D.md': 'fine' });
  assert.deepStrictEqual(
    W.staleRefs({ repoRoot: root, docs: ['D.md', 'NOPE.md'], isIgnored: NEVER_IGNORED }), []);
});

// --- detector 2: assertion-count claims ------------------------------------

test('one suite and one count in a sentence is a checkable claim', () => {
  const root = fakeRepo({ 'D.md': 'The file `code/test-foo.js` has 12 assertions today.' });
  const { claims, unchecked } = W.assertionClaims({ repoRoot: root, docs: ['D.md'] });
  assert.deepStrictEqual(claims, [{ doc: 'D.md', suite: 'test-foo', claimed: 12 }]);
  assert.strictEqual(unchecked, 0);
});

test('two suites and two counts is UNCHECKED, never paired by position', () => {
  // The real sentence, from docs/RECONCILE_v4.md. Pairing left-to-right is
  // right often enough to be trusted and wrong often enough to be dangerous.
  const root = fakeRepo({
    'D.md': 'test-guard and test-shell already have 37 and 22 assertions.',
  });
  const { claims, unchecked } = W.assertionClaims({ repoRoot: root, docs: ['D.md'] });
  assert.deepStrictEqual(claims, [], 'must not guess which count belongs to which suite');
  // One, not two: COUNT_RE only perceives a number adjacent to the word
  // "assertions", so the bare "37" is never seen as a claim in the first place.
  // Worth pinning explicitly rather than leaving as a surprise -- it means the
  // blind-spot counter can itself under-report on a sentence shaped like this.
  // The property that matters is intact (nothing was paired by position), and
  // widening the regex to chase "37 and 22" would buy a more accurate coverage
  // number at the cost of a detector that guesses more.
  assert.strictEqual(unchecked, 1);
});

test('a count with no suite named in its sentence is unchecked, not dropped', () => {
  // "The provider and its 19 assertions" — real, from AS_BUILT.md. Invisible
  // to the checker, but it must still show up in the coverage number.
  const root = fakeRepo({ 'D.md': 'The provider and its 19 assertions hold.' });
  const { claims, unchecked } = W.assertionClaims({ repoRoot: root, docs: ['D.md'] });
  assert.strictEqual(claims.length, 0);
  assert.strictEqual(unchecked, 1);
});

test('a sentence with no count at all contributes nothing either way', () => {
  const root = fakeRepo({ 'D.md': '`code/test-foo.js` is green and fully offline.' });
  const { claims, unchecked } = W.assertionClaims({ repoRoot: root, docs: ['D.md'] });
  assert.strictEqual(claims.length, 0);
  assert.strictEqual(unchecked, 0);
});

test('claims are scoped per sentence, so a neighbour cannot supply the subject', () => {
  const root = fakeRepo({
    'D.md': '`code/test-foo.js` is offline. Something unrelated has 99 assertions.',
  });
  const { claims, unchecked } = W.assertionClaims({ repoRoot: root, docs: ['D.md'] });
  assert.strictEqual(claims.length, 0, 'the 99 belongs to the second sentence, which names no suite');
  assert.strictEqual(unchecked, 1);
});

test('both `test-foo` and `code/test-foo.js` spellings resolve to one suite', () => {
  const root = fakeRepo({ 'D.md': 'test-foo, i.e. `code/test-foo.js`, has 7 assertions.' });
  const { claims } = W.assertionClaims({ repoRoot: root, docs: ['D.md'] });
  assert.deepStrictEqual(claims, [{ doc: 'D.md', suite: 'test-foo', claimed: 7 }],
    'the two spellings must dedupe, or the sentence looks ambiguous and is skipped');
});

// --- drift -----------------------------------------------------------------

test('a claim whose number no longer matches is drift', () => {
  const drift = W.assertionDrift(
    [{ doc: 'D.md', suite: 'test-foo', claimed: 12 }],
    [{ name: 'test-foo', count: 15 }]);
  assert.strictEqual(drift.length, 1);
  assert.match(drift[0].detail, /says test-foo has 12 assertions; it reports 15/);
});

test('a matching claim is silent', () => {
  assert.deepStrictEqual(W.assertionDrift(
    [{ doc: 'D.md', suite: 'test-foo', claimed: 12 }],
    [{ name: 'test-foo', count: 12 }]), []);
});

test('a suite that was never re-run produces silence, not an invented finding', () => {
  // test-helper is named with a count in PLAN_5 but is not in the CI list, so
  // there is no fresh number to compare against. Reporting "drift" from a
  // count nobody measured is the worst thing a control can do.
  assert.deepStrictEqual(W.assertionDrift(
    [{ doc: 'D.md', suite: 'test-helper', claimed: 0 }],
    [{ name: 'test-foo', count: 12 }]), []);
});

test('a suite that reported no count at all is not drift either', () => {
  assert.deepStrictEqual(W.assertionDrift(
    [{ doc: 'D.md', suite: 'test-foo', claimed: 12 }],
    [{ name: 'test-foo', count: null }]), []);
});

// --- detector 3: test files nothing runs ------------------------------------

test('a test file no CI list runs is a finding', () => {
  // sweep.js asks whether each suite IN the list can report a pass, so a file
  // outside the list is invisible to it by construction. That is the blind
  // spot this detector covers.
  const root = fakeRepo({ 'code/test-orphan.js': 'assert.ok(1);' });
  const out = W.orphanSuites({ repoRoot: root, listed: ['test-other'] });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].kind, 'suite-not-in-ci');
  assert.strictEqual(out[0].ref, 'test-orphan');
});

test('a listed suite is not a finding', () => {
  const root = fakeRepo({ 'code/test-listed.js': 'assert.ok(1);' });
  assert.deepStrictEqual(W.orphanSuites({ repoRoot: root, listed: ['test-listed'] }), []);
});

test('an orphan that asserts NOTHING says so — it is the worse case', () => {
  // Unlisted is bad; unlisted AND vacuous means nothing anywhere can tell you
  // it stopped working.
  const root = fakeRepo({ 'code/test-hollow.js': 'console.log("hi");' });
  const [f] = W.orphanSuites({ repoRoot: root, listed: [] });
  assert.match(f.detail, /asserts nothing/);
  assert.match(f.detail, /invisible to sweep\.js/);

  const root2 = fakeRepo({ 'code/test-real.js': 'assert.ok(1); assert.ok(2);' });
  assert.match(W.orphanSuites({ repoRoot: root2, listed: [] })[0].detail, /2 assertion\(s\)/);
});

test('test-helper is never an orphan — it is the harness, not a suite', () => {
  const root = fakeRepo({ 'code/test-helper.js': 'module.exports = {};' });
  assert.deepStrictEqual(W.orphanSuites({ repoRoot: root, listed: [] }), []);
});

test('non-test files in code/ are not suites', () => {
  const root = fakeRepo({ 'code/guard.js': 'x', 'code/testing-utils.js': 'y', 'code/test-a.js.bak': 'z' });
  assert.deepStrictEqual(W.orphanSuites({ repoRoot: root, listed: [] }), []);
});

test('no workflow to compare against means silence, not a false alarm', () => {
  // Better to say nothing than to report every suite in the repo as orphaned
  // because the workflow could not be read.
  const root = fakeRepo({ 'code/test-a.js': 'assert.ok(1);' });
  assert.deepStrictEqual(W.orphanSuites({ repoRoot: root }), [],
    'with no .github/workflows/test.yml, the detector must abstain');
});

test('a suite the workflow explains in a COMMENT is documented, not orphaned', () => {
  // The rule is about silence, not exclusion. Excluding test-kokoro because it
  // needs real audio is correct; excluding it without saying so is the finding.
  // Documenting it is therefore the action the finding asks for, which makes
  // the finding self-clearing.
  const wf = 'jobs:\n  x:\n    steps:\n      # test-hardware needs a GPU, so it is not in the list\n'
           + '      - run: |\n          for f in test-listed; do\n            node "code/$f.js"\n          done\n';
  const root = fakeRepo({
    '.github/workflows/test.yml': wf,
    'code/test-listed.js': 'assert.ok(1);',
    'code/test-hardware.js': 'assert.ok(1);',
    'code/test-silent.js': 'assert.ok(1);',
  });
  const found = W.orphanSuites({ repoRoot: root });
  assert.deepStrictEqual(found.map((f) => f.ref), ['test-silent'],
    'only the suite the workflow never mentions at all is a finding');
});

test('REAL repo: nothing it reports is mentioned by the real workflow', () => {
  // Deliberately NOT "this repo has orphans" — an earlier version asserted
  // that, and it broke the moment the twelve were documented, which is the
  // detector succeeding. Assert the invariant instead, which holds at any
  // count including zero.
  const repoRoot = path.join(__dirname, '..');
  const wfText = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'test.yml'), 'utf8');
  const listed = new Set(require('./sweep.js').ciSuites());
  for (const f of W.orphanSuites({ repoRoot })) {
    assert.ok(!listed.has(f.ref), `${f.ref} was reported as an orphan but IS in the CI list`);
    assert.ok(!wfText.includes(f.ref), `${f.ref} was reported but the workflow does mention it`);
    assert.ok(fs.existsSync(path.join(repoRoot, 'code', `${f.ref}.js`)), `${f.ref}.js does not exist`);
  }
  // Every listed suite must be absent from the findings, at any count.
  const found = W.orphanSuites({ repoRoot });
  for (const name of listed) {
    assert.ok(!found.some((f) => f.ref === name), `${name} is in CI but was reported as an orphan`);
  }
});

// --- detector 4: the kill switch documented at a path that is not it -------
//
// The detector that matters most, because the claim it checks is the one
// someone reads when they are trying to STOP Jarvis. It was added after
// docs/PLAN_5.md -- the living plan -- was found naming the switch at
// `~/.jarvis-x/STOP` in two places, through a whole session of edits to that
// same file, by an agent that had already corrected the identical claim in
// CLAUDE.md. Detector 1 could not see it: that one matches paths by
// extension and the switch file has none.

const STOP = '.jarvis-x-STOP';

test('a doc naming the kill switch at the wrong path is a finding', () => {
  const root = fakeRepo({ 'D.md': 'The kill switch (`~/.jarvis-x/STOP`) halts everything.' });
  const out = W.killSwitchDrift({ repoRoot: root, docs: ['D.md'], stopFile: STOP });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].kind, 'kill-switch-path');
  assert.strictEqual(out[0].ref, '~/.jarvis-x/STOP');
  assert.match(out[0].detail, /guard\.js uses \.jarvis-x-STOP/);
});

test('the correct path is not a finding', () => {
  const root = fakeRepo({ 'D.md': 'Kill switch: `.jarvis-x-STOP` at the repo root.' });
  assert.deepStrictEqual(
    W.killSwitchDrift({ repoRoot: root, docs: ['D.md'], stopFile: STOP }), []);
});

test('the same basename under a different directory is accepted', () => {
  // The switch is identified by name; a doc writing the absolute path is
  // stating the same file, not a different one.
  const root = fakeRepo({ 'D.md': 'touch `/home/ahmed/jarvis-x/.jarvis-x-STOP`' });
  assert.deepStrictEqual(
    W.killSwitchDrift({ repoRoot: root, docs: ['D.md'], stopFile: STOP }), []);
});

test('naming the stale path IN CONTRAST with the real one is not a finding', () => {
  // Several docs name the old path deliberately, to say it is stale. Flagging
  // those would punish exactly the correction this detector wants.
  const root = fakeRepo({
    'D.md': 'Kill switch: `.jarvis-x-STOP` at repo root (not `~/.jarvis-x/STOP`).',
  });
  assert.deepStrictEqual(
    W.killSwitchDrift({ repoRoot: root, docs: ['D.md'], stopFile: STOP }), []);
});

test('the contrast may come before or after the stale mention', () => {
  const after = fakeRepo({ 'D.md': 'Do not use `~/.jarvis-x/STOP`; the real file is `.jarvis-x-STOP`.' });
  assert.deepStrictEqual(W.killSwitchDrift({ repoRoot: after, docs: ['D.md'], stopFile: STOP }), []);
});

test('a contrast too far away does NOT excuse the claim', () => {
  // The window is what keeps this mechanical rather than a reading of the
  // prose. A correct mention in a different section is not a correction of
  // this one, and a reader of this paragraph never sees it.
  const root = fakeRepo({
    'D.md': `Kill switch: \`~/.jarvis-x/STOP\`.\n${'filler. '.repeat(80)}\nElsewhere: \`.jarvis-x-STOP\`.`,
  });
  assert.strictEqual(W.killSwitchDrift({ repoRoot: root, docs: ['D.md'], stopFile: STOP }).length, 1);
});

test('a code expression naming the constant is not a path claim', () => {
  // `STOP_FILE.exists()` in docs/architecture.md is correct prose about
  // guard.js's constant. The detector produced four such findings on its
  // first real run, before it required the token to look like a path.
  const root = fakeRepo({ 'D.md': 'guard() checks `STOP_FILE.exists()` before acting.' });
  assert.deepStrictEqual(
    W.killSwitchDrift({ repoRoot: root, docs: ['D.md'], stopFile: STOP }), []);
});

test('unbackticked prose is not scanned', () => {
  // Backticks are what mark a token as a live path, the same convention
  // detector 1 relies on.
  const root = fakeRepo({ 'D.md': 'People sometimes think it is ~/.jarvis-x/STOP.' });
  assert.deepStrictEqual(
    W.killSwitchDrift({ repoRoot: root, docs: ['D.md'], stopFile: STOP }), []);
});

test('every wrong mention in a doc is reported, not just the first', () => {
  // The real finding was TWO occurrences in one file. A detector reporting
  // one would have let the second survive the fix.
  const root = fakeRepo({
    'D.md': `\`~/.jarvis-x/STOP\`\n${'x '.repeat(400)}\n\`~/jarvis/STOP\``,
  });
  assert.strictEqual(W.killSwitchDrift({ repoRoot: root, docs: ['D.md'], stopFile: STOP }).length, 2);
});

test('a missing doc is skipped rather than throwing', () => {
  const root = fakeRepo({ 'D.md': 'x' });
  assert.deepStrictEqual(
    W.killSwitchDrift({ repoRoot: root, docs: ['gone.md'], stopFile: STOP }), []);
});

test('the real path is read from guard.js, not written here', () => {
  // A detector carrying its own copy of the value it checks is one rename
  // away from confidently enforcing the wrong answer — and this is the one
  // value in the repo that must not be wrong.
  const src = fs.readFileSync(path.join(__dirname, 'weekly-sweep.js'), 'utf8');
  const body = src.slice(src.indexOf('function killSwitchDrift'));
  const fn = body.slice(0, body.indexOf('\n}'));
  assert.ok(/require\('\.\/guard\.js'\)\.STOP_FILE/.test(fn),
    'killSwitchDrift no longer reads guard.js STOP_FILE');
  assert.ok(!/'\.jarvis-x-STOP'/.test(fn), 'the path is hardcoded in the detector');
});

test('the live repo has no kill-switch drift', () => {
  // Pins the fix, not just the detector. docs/PLAN_5.md carried this in two
  // places until 2026-09-10.
  assert.deepStrictEqual(W.killSwitchDrift({}), []);
});

// --- the inbox --------------------------------------------------------------

test('park appends new findings and stamps them with the INJECTED clock', () => {
  const file = inboxPath();
  const r = W.park([{ kind: 'stale-ref', doc: 'D.md', ref: 'a/x.js' }], { file, now: CLOCK });
  assert.strictEqual(r.fresh.length, 1);
  const rows = W.readInbox(file);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].parked_at, '2026-03-01T12:00:00.000Z',
    'the clock must come from the caller, never from Date.now()');
  assert.strictEqual(rows[0].fingerprint, 'stale-ref:D.md:a/x.js');
});

test('a finding parked last week is not parked again this week', () => {
  const file = inboxPath();
  const f = [{ kind: 'stale-ref', doc: 'D.md', ref: 'a/x.js' }];
  W.park(f, { file, now: CLOCK });
  const second = W.park(f, { file, now: CLOCK });
  assert.strictEqual(second.fresh.length, 0);
  assert.strictEqual(second.repeat, 1);
  assert.strictEqual(W.readInbox(file).length, 1, 'the inbox must not grow on a repeat');
});

test('the inbox is append-only — an existing row is never rewritten', () => {
  const file = inboxPath();
  W.park([{ kind: 'stale-ref', doc: 'D.md', ref: 'a/x.js' }], { file, now: CLOCK });
  const before = fs.readFileSync(file, 'utf8');
  W.park([{ kind: 'suite-failing', ref: 'test-foo' }], { file, now: CLOCK });
  const after = fs.readFileSync(file, 'utf8');
  assert.ok(after.startsWith(before), 'earlier rows must survive byte-for-byte');
  assert.strictEqual(W.readInbox(file).length, 2);
});

test('a corrupt line in the inbox is skipped rather than killing the run', () => {
  const file = inboxPath();
  fs.writeFileSync(file, '{not json\n{"fingerprint":"a:b:c"}\n');
  assert.strictEqual(W.readInbox(file).length, 1);
});

test('parking creates logs/ only when there is something to write', () => {
  const file = path.join(TMP, `unborn-${seq++}`, 'inbox.jsonl');
  W.park([], { file, now: CLOCK });
  assert.ok(!fs.existsSync(path.dirname(file)),
    'an empty run must not leave a directory behind as its only trace');
});

// --- the whole run ----------------------------------------------------------

test('suite findings and failures both surface as findings', () => {
  const root = fakeRepo({ 'D.md': 'nothing to see' });
  const r = W.run({
    repoRoot: root, docs: ['D.md'], now: CLOCK, inboxFile: inboxPath(),
    isIgnored: NEVER_IGNORED,
    runSweep: () => fakeSweep({
      results: [{ name: 'test-a', count: 5 }, { name: 'test-b', count: null }],
      findings: [{ name: 'test-b', verdict: 'no-count' }],
      failures: [{ name: 'test-a', verdict: 'failed', exitCode: 1 }],
    }),
  });
  const kinds = r.findings.map((f) => f.kind).sort();
  assert.deepStrictEqual(kinds, ['suite-cannot-report', 'suite-failing']);
  assert.strictEqual(r.suite.total, 2);
  assert.strictEqual(r.suite.assertions, 5);
});

test('run() actually INCLUDES kill-switch drift in its findings', () => {
  // Two mutations escaped without this: unwiring the detector from run(), and
  // computing its findings then dropping them from the array. Every
  // unit-level test above calls killSwitchDrift() directly, so neither showed.
  const root = fakeRepo({ 'D.md': 'Kill switch: `~/.jarvis-x/STOP`.' });
  const r = W.run({
    repoRoot: root, docs: ['D.md'], now: CLOCK, inboxFile: inboxPath(),
    isIgnored: NEVER_IGNORED, runSweep: () => fakeSweep({ results: [{ name: 'test-a', count: 1 }] }),
  });
  const ks = r.findings.filter((f) => f.kind === 'kill-switch-path');
  assert.strictEqual(ks.length, 1, 'run() dropped the kill-switch finding');
  assert.strictEqual(ks[0].ref, '~/.jarvis-x/STOP');
});

test('a kill-switch finding parks and so fails the weekly job', () => {
  // It is only a control if a red run follows from it.
  const root = fakeRepo({ 'D.md': 'Kill switch: `~/.jarvis-x/STOP`.' });
  const r = W.run({
    repoRoot: root, docs: ['D.md'], now: CLOCK, inboxFile: inboxPath(),
    isIgnored: NEVER_IGNORED, runSweep: () => fakeSweep({ results: [{ name: 'test-a', count: 1 }] }),
  });
  assert.strictEqual(W.exitCode(r), 1);
});

test('a path containing the real basename does not excuse itself', () => {
  // The contrast window must exclude the matched token, or a token that
  // merely contains the right name passes its own test and the basename
  // comparison becomes unfalsifiable.
  const root = fakeRepo({ 'D.md': 'Kill switch: `~/wrong/.jarvis-x-STOP-old`.' });
  const out = W.killSwitchDrift({ repoRoot: root, docs: ['D.md'], stopFile: STOP });
  assert.strictEqual(out.length, 1, 'a token excused itself via its own contrast window');
});

test('run() actually INCLUDES orphans in its findings', () => {
  // Both mutations that escaped the first pass exploited the same gap: every
  // other test calls orphanSuites() directly, so the detector could have been
  // perfect and unwired — "built but not wired in", the failure this repo
  // keeps finding. This goes through run().
  const root = fakeRepo({
    'D.md': 'nothing to see',
    'code/test-orphaned.js': 'assert.ok(1);',
    '.github/workflows/test.yml': 'jobs:\n  x:\n    steps:\n      - run: |\n          for f in test-listed; do\n            node "code/$f.js"\n          done\n',
    'code/test-listed.js': 'assert.ok(1);',
  });
  const r = W.run({
    repoRoot: root, docs: ['D.md'], now: CLOCK, inboxFile: inboxPath(),
    isIgnored: NEVER_IGNORED, runSweep: () => fakeSweep(),
  });
  const orphans = r.findings.filter((f) => f.kind === 'suite-not-in-ci');
  assert.strictEqual(orphans.length, 1, `expected exactly one orphan, got ${JSON.stringify(r.findings)}`);
  assert.strictEqual(orphans[0].ref, 'test-orphaned');
  assert.strictEqual(W.exitCode(r), 1, 'a new orphan must notify');
});

test('run() reports coverage even when it finds nothing', () => {
  const root = fakeRepo({ 'D.md': 'test-guard and test-shell have 37 and 22 assertions.' });
  const r = W.run({
    repoRoot: root, docs: ['D.md'], now: CLOCK, inboxFile: inboxPath(),
    isIgnored: NEVER_IGNORED, runSweep: () => fakeSweep(),
  });
  assert.strictEqual(r.findings.length, 0);
  assert.strictEqual(r.coverage.claimsUnchecked, 1,
    '"no findings" must never be reported without the blind spot beside it');
  assert.match(W.format(r), /no findings/);
  assert.match(W.format(r), /1 numeric claim\(s\) seen but too ambiguous/);
});

test('a red run says in one line whether any CONTROL broke', () => {
  // In CI the inbox starts empty every run, so a standing backlog keeps the
  // job red. The count by kind is what stops that being unreadable: "did
  // something newly break?" must be answerable without reading the list.
  const root = fakeRepo({ 'D.md': 'see `code/gone.js`' });
  const opts = {
    repoRoot: root, docs: ['D.md'], now: CLOCK, isIgnored: NEVER_IGNORED,
  };

  const backlogOnly = W.format(W.run({ ...opts, inboxFile: inboxPath(), runSweep: () => fakeSweep() }));
  assert.match(backlogOnly, /by kind: stale-ref=1/);
  assert.match(backlogOnly, /no control is broken/,
    'a backlog-only run must say so, or it reads like an incident');

  const broken = W.format(W.run({
    ...opts, inboxFile: inboxPath(),
    runSweep: () => fakeSweep({
      results: [{ name: 'test-a', count: null }],
      findings: [{ name: 'test-a', verdict: 'no-count' }],
    }),
  }));
  assert.match(broken, /1 CONTROL\(S\) BROKEN/);
  assert.match(broken, /by kind: .*suite-cannot-report=1/);
});

test('exit code is non-zero for NEW findings and zero for already-parked ones', () => {
  const root = fakeRepo({ 'D.md': 'see `code/gone.js`' });
  const file = inboxPath();
  const opts = {
    repoRoot: root, docs: ['D.md'], now: CLOCK, inboxFile: file,
    isIgnored: NEVER_IGNORED, runSweep: () => fakeSweep(),
  };
  const first = W.run(opts);
  assert.strictEqual(W.exitCode(first), 1, 'a new finding must notify');
  const second = W.run(opts);
  assert.strictEqual(second.findings.length, 1, 'the finding is still true');
  assert.strictEqual(second.parked.length, 0);
  assert.strictEqual(W.exitCode(second), 0,
    're-notifying every week is how a control trains you to ignore it');
  assert.match(W.format(second), /already parked/);
});

test('run() never edits the docs it inspects', () => {
  const body = 'see `code/gone.js` — 12 assertions in `code/test-foo.js`.';
  const root = fakeRepo({ 'D.md': body });
  W.run({
    repoRoot: root, docs: ['D.md'], now: CLOCK, inboxFile: inboxPath(),
    isIgnored: NEVER_IGNORED,
    runSweep: () => fakeSweep({ results: [{ name: 'test-foo', count: 99 }] }),
  });
  assert.strictEqual(fs.readFileSync(path.join(root, 'D.md'), 'utf8'), body,
    'this sweep proposes; it must never repair');
});

test('drift found through run() names the doc and both numbers', () => {
  // test-foo.js must EXIST here, or staleRefs fires too and this stops being a
  // test about drift.
  const root = fakeRepo({ 'D.md': '`code/test-foo.js` has 12 assertions.', 'code/test-foo.js': '' });
  const r = W.run({
    repoRoot: root, docs: ['D.md'], now: CLOCK, inboxFile: inboxPath(),
    isIgnored: NEVER_IGNORED,
    runSweep: () => fakeSweep({ results: [{ name: 'test-foo', count: 99 }] }),
  });
  assert.strictEqual(r.findings.length, 1);
  assert.strictEqual(r.findings[0].kind, 'assertion-drift');
  assert.match(r.findings[0].detail, /12 assertions; it reports 99/);
});

// --- real wiring, so this cannot pass while the real run is broken ----------

test('REAL git: logs/ is ignored, so the runtime-file exclusion actually works', () => {
  assert.strictEqual(W.gitIgnored('logs/.judge-cache.json', path.join(__dirname, '..')), true);
  assert.strictEqual(W.gitIgnored('code/guard.js', path.join(__dirname, '..')), false);
});

test('REAL docs: the default doc list exists and parses without inventing findings', () => {
  const repoRoot = path.join(__dirname, '..');
  for (const d of W.DEFAULT_DOCS) {
    assert.ok(fs.existsSync(path.join(repoRoot, d)), `${d} is in DEFAULT_DOCS but missing`);
  }
  // Every real stale-ref finding must be a path that genuinely is not there --
  // this is the assertion that would fail if the detector started guessing.
  for (const f of W.staleRefs({ repoRoot })) {
    assert.ok(!fs.existsSync(path.join(repoRoot, f.ref)),
      `reported ${f.ref} as missing, but it exists`);
    assert.strictEqual(W.gitIgnored(f.ref, repoRoot), false,
      `reported ${f.ref}, which git ignores`);
  }
});

finish();
