// The supervisor is the one piece of NVIDIA's AVO architecture that is safe to
// adopt here, and it is safe for one reason: its only possible effect is to do
// less. These tests hold it to that. It must skip a genuinely stuck goal, must
// not skip a working one, must not mistake the kill switch for a malfunction,
// must not judge a goal stagnant because it skipped it, and must never make a
// skip permanent.
//
// Fully offline: rows are arguments; the log path is injectable.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const S = require('./supervisor.js');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jx-sup-')), 'scheduled.jsonl');
const write = (rows) => { const f = tmp(); fs.writeFileSync(f, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); return f; };

const GOAL = 'summarise today\'s changes';
const run = (outcome, proposed = { action: 'git_log', n: 5 }) => ({
  timestamp: '2026-09-04T12:00:00Z', goal: GOAL, model: 'gemini:quick', proposed, outcome,
});
const many = (n, ...args) => Array.from({ length: n }, () => run(...args));

(async () => {

// ── it withholds judgement before it has evidence ─────────────────────────
await test(`fewer than ${S.WINDOW} runs yields no verdict and no skip`, () => {
  const a = S.assess(many(S.WINDOW - 1, 'output a'), GOAL);
  assert.strictEqual(a.verdict, 'insufficient');
  assert.strictEqual(a.skip, false);
  assert.ok(/only 4 of 5/.test(a.because[0]), a.because[0]);
});

await test('an unknown goal is insufficient, never stagnant', () => {
  assert.strictEqual(S.assess([], 'never seen').verdict, 'insufficient');
});

// ── the four verdicts ─────────────────────────────────────────────────────
await test('identical proposal and identical outcome class is stagnant', () => {
  const a = S.assess(many(S.WINDOW, 'the same output every time'), GOAL);
  assert.strictEqual(a.verdict, 'stagnant');
  assert.strictEqual(a.skip, true);
  assert.ok(/nothing new is being learned/.test(a.because.join(' ')));
});

await test('varying outcomes are productive and are never skipped', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map(o => run('output ' + o));
  const a = S.assess(rows, GOAL);
  assert.strictEqual(a.verdict, 'productive');
  assert.strictEqual(a.skip, false);
});

await test('an all-error window is failing', () => {
  const a = S.assess(many(S.WINDOW, 'error: fetch failed'), GOAL);
  assert.strictEqual(a.verdict, 'failing');
  assert.strictEqual(a.skip, true);
  assert.ok(/fetch failed/.test(a.because.join(' ')));
});

await test('errors and rejections together still count as failing', () => {
  const rows = ['error: x', 'rejected: bad schema', 'error: y', 'rejected: z', 'error: w'].map(run);
  assert.strictEqual(S.assess(rows, GOAL).verdict, 'failing');
});

await test('a goal that only ever queues is queue-flooding', () => {
  const rows = many(S.WINDOW, 'queued for review', { action: 'write', path: 'logs/n.txt' });
  const a = S.assess(rows, GOAL);
  assert.strictEqual(a.verdict, 'queue-flooding');
  assert.strictEqual(a.skip, true);
  assert.ok(/read-only/.test(a.because.join(' ')), 'the fix must be stated, not just the fault');
});

// ── the kill switch is not a malfunction ──────────────────────────────────
await test('an all-halted window is the kill switch working, not a stuck goal', () => {
  const a = S.assess(many(S.WINDOW, 'halted'), GOAL);
  assert.strictEqual(a.verdict, 'productive');
  assert.strictEqual(a.skip, false, 'a stopped system must not have its goals disabled behind its back');
});

// ── the self-fulfilling verdict this must not produce ─────────────────────
await test('the supervisor does not judge a goal stagnant because it skipped it', () => {
  const rows = [
    ...['a', 'b', 'c', 'd', 'e'].map(o => run('output ' + o)),   // clearly productive
    ...many(10, 'supervisor skip: stagnant — whatever'),
  ];
  const a = S.assess(rows, GOAL);
  assert.strictEqual(a.verdict, 'productive', 'its own entries must not enter the window');
  assert.strictEqual(S.recent(rows, GOAL).length, S.WINDOW);
  assert.ok(S.recent(rows, GOAL).every(r => S.outcomeClass(r.outcome) !== 'supervised'));
});

// ── a skip is never permanent ─────────────────────────────────────────────
await test('a stuck goal is skipped', () => {
  const f = write(many(S.WINDOW, 'output identical'));
  assert.ok(S.shouldSkip(GOAL, { logPath: f }), 'this goal is going nowhere');
});

await test(`after ${S.PROBE_AFTER} skips one run is let through`, () => {
  const f = write([...many(S.WINDOW, 'output identical'),
                   ...many(S.PROBE_AFTER, 'supervisor skip: stagnant — x')]);
  assert.strictEqual(S.shouldSkip(GOAL, { logPath: f }), null,
    'a skip that never lifts is a deletion nobody agreed to');
});

await test('one short of the probe threshold it is still skipped', () => {
  const f = write([...many(S.WINDOW, 'output identical'),
                   ...many(S.PROBE_AFTER - 1, 'supervisor skip: stagnant — x')]);
  assert.ok(S.shouldSkip(GOAL, { logPath: f }));
});

await test('the streak resets once a real run happens', () => {
  const rows = [...many(10, 'supervisor skip: x'), run('output fresh')];
  assert.strictEqual(S.skipStreak(rows, GOAL), 0);
});

await test('a productive goal is never skipped, however long its history', () => {
  const rows = Array.from({ length: 200 }, (_, i) => run('output ' + i));
  assert.strictEqual(S.shouldSkip(GOAL, { logPath: write(rows) }), null);
});

// ── reading the log ───────────────────────────────────────────────────────
await test('a corrupt line does not take the log down', () => {
  const f = write(many(S.WINDOW, 'output x'));
  fs.appendFileSync(f, '{not json\n\n');
  assert.strictEqual(S.load(f).length, S.WINDOW);
});

await test('a missing log is empty, not an exception', () => {
  assert.deepStrictEqual(S.load(path.join(os.tmpdir(), 'jx-no-such-sched.jsonl')), []);
});

await test('goals are assessed independently', () => {
  const other = many(S.WINDOW, 'output x').map(r => ({ ...r, goal: 'other goal' }));
  const rows = [...many(S.WINDOW, 'output identical'), ...other.map((r, i) => ({ ...r, outcome: 'output ' + i }))];
  const rev = S.review(rows);
  assert.strictEqual(rev.length, 2);
  assert.strictEqual(rev.find(a => a.goal === GOAL).verdict, 'stagnant');
  assert.strictEqual(rev.find(a => a.goal === 'other goal').verdict, 'productive');
});

// ── the boundary ──────────────────────────────────────────────────────────
await test('the supervisor writes nothing and executes nothing', () => {
  const src = fs.readFileSync(path.join(__dirname, 'supervisor.js'), 'utf8');
  for (const forbidden of ['writeFileSync', 'appendFileSync', 'spawnSync', 'execSync', 'unlinkSync']) {
    assert.ok(!src.includes(forbidden), `supervisor.js must not contain ${forbidden}`);
  }
  // schedules.json appears in its printed advice; what matters is that it
  // never builds a path to it, which is the only way it could edit one.
  assert.ok(!/path\.join\([^)]*schedules/.test(src),
    'it must never construct a path to schedules.json');
  assert.ok(!/require\(['\"]\.\/(scheduler|paper-trading|exec)/.test(src),
    'it must not import anything that acts');
});

await test('every verdict is one of the declared five, and only skips are actionable', () => {
  const cases = [many(2, 'x'), many(5, 'output same'), ['a','b','c','d','e'].map(o => run(o)),
                 many(5, 'error: x'), many(5, 'queued for review'), many(5, 'halted')];
  for (const rows of cases) {
    const a = S.assess(rows, GOAL);
    assert.ok(S.VERDICTS.includes(a.verdict), a.verdict);
    assert.strictEqual(typeof a.skip, 'boolean');
    if (a.skip) assert.ok(['stagnant', 'failing', 'queue-flooding'].includes(a.verdict));
  }
});

await test('the printed output states it changed nothing', () => {
  const out = S.format(S.review(many(S.WINDOW, 'output identical')));
  assert.ok(/Nothing was edited/.test(out), out);
  assert.ok(/never add one/.test(out), out);
});

finish();
})();
