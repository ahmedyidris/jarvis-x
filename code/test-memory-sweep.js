// BITEMPORAL MEMORY LAYER 6 — the sweep over facts nobody mentioned.
//
// The template's §1: a memory that was never true is easy to catch; a memory
// that WAS true is the dangerous one, because it retrieves with the highest
// score and gets stated with total confidence. Facts go stale two ways, and
// every event-driven design is blind to the second — nobody says anything at
// all — because there is no event to fire on.
//
// THE RULE THIS SUITE GUARDS ABOVE ALL OTHERS: the sweep never retires on age.
// Age weakens belief; it does not falsify. A sweep that retired old facts
// would destroy information on a timer, and it would do it precisely to the
// facts nobody has mentioned lately rather than to the wrong ones. Several
// tests below exist only to make that impossible to regress.
//
// Second rule: it writes nothing itself. Every proposal goes through layer 5,
// so the kill switch and the v5 audit row cover the timer-driven path with no
// second door to keep locked. repairFn is injected, which is what lets a test
// prove no other write route exists.
//
// Offline and deterministic: injected clock, temp store, fake repair.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const S = require('./memory-sweep.js');
const { openStore, makeClock, THRESHOLDS, OPEN, STATUS } = require('./memory-bitemporal.js');
const { repair } = require('./memory-repair.js');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-msweep-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

let seq = 0;
function fresh(startISO = '2026-06-01T00:00:00.000Z') {
  const clock = makeClock(startISO);
  return {
    store: openStore({ file: path.join(TMP, `s-${seq++}.jsonl`), clock }),
    clock,
    inboxFile: path.join(TMP, `inbox-${seq++}.jsonl`),
  };
}

/** A stored row as store.current() returns it. */
const row = (over = {}) => ({
  id: 'f1', topic: 'project', scope: '', text: 'x', value: 'x',
  volatility: 'fast', status: STATUS.ACTIVE, valid_from: '2026-01-01T00:00:00.000Z',
  valid_to: OPEN, last_verified_at: '2026-01-01T00:00:00.000Z', ...over,
});

/** Records calls instead of writing. */
function spyRepair(outcome = 'applied') {
  const calls = [];
  const fn = (args) => { calls.push(args); return { outcome, factId: 'new', why: 'spy' }; };
  fn.calls = calls;
  return fn;
}

(async () => {

// --- THE rule: never retire on age -----------------------------------------

await test('the sweep can only ever propose flag or end — never a retirement', () => {
  assert.deepStrictEqual(S.SWEEP_ACTIONS, ['flag', 'end']);
  for (const bad of ['replace', 'retire', 'delete', 'supersede']) {
    assert.ok(!S.SWEEP_ACTIONS.includes(bad), `${bad} must not be reachable from a timer`);
  }
});

await test('a fact past its shelf life is FLAGGED, not retired, and stays retrievable', () => {
  const { store, clock, inboxFile } = fresh();
  store.born({ topic: 'project', text: 'building Jarvis', volatility: 'fast' });
  clock.advanceDays(120);                                    // four `fast` half-lives
  const r = S.sweep({ store, repairFn: repair, now: () => clock.now(), inboxFile });

  assert.strictEqual(r.flagged, 1);
  assert.strictEqual(r.ended, 0, 'nothing may be closed for merely being old');
  assert.strictEqual(store.current()[0].status, STATUS.NEEDS_VERIFICATION);
  assert.strictEqual(store.recall().length, 1, 'a flagged fact is STILL RETRIEVED');
  assert.strictEqual(store.validAt(clock.iso()).length, 1, 'and still true');
});

await test('every proposal the sweep emits is flag or end, over many shapes', () => {
  const facts = [
    row({ id: 'a', volatility: 'fast' }),
    row({ id: 'b', volatility: 'stable', last_verified_at: '1990-01-01T00:00:00.000Z' }),
    row({ id: 'c', valid_to: '2026-02-01T00:00:00.000Z' }),
  ];
  for (const { decision } of S.propose(S.detect(facts, '2026-06-01T00:00:00.000Z'))) {
    assert.ok(S.SWEEP_ACTIONS.includes(decision.action), `${decision.action} is not a sweep action`);
  }
});

// --- detection --------------------------------------------------------------

await test('a fresh fact is not a finding', () => {
  assert.deepStrictEqual(
    S.detect([row({ last_verified_at: '2026-05-30T00:00:00.000Z' })], '2026-06-01T00:00:00.000Z'), []);
});

await test('a closed window is ended, and is checked BEFORE staleness', () => {
  // A fact whose valid_to has passed is not stale, it is over. Flagging it
  // would ask a human to re-confirm something that has already ended.
  const f = row({ valid_to: '2026-03-01T00:00:00.000Z', last_verified_at: '2026-01-01T00:00:00.000Z' });
  const found = S.detect([f], '2026-06-01T00:00:00.000Z');
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].kind, 'window-closed', 'stale would be the wrong diagnosis here');
  assert.strictEqual(S.propose(found)[0].decision.action, 'end');
  assert.strictEqual(S.propose(found)[0].decision.at, '2026-03-01T00:00:00.000Z',
    'it closes where its own interval said, not at now');
});

await test('an already-flagged fact is not flagged again', () => {
  // Re-flagging every night is how a signal becomes wallpaper.
  const f = row({ status: STATUS.NEEDS_VERIFICATION });
  assert.deepStrictEqual(S.detect([f], '2026-06-01T00:00:00.000Z'), []);
});

await test('superseded and expired facts are left alone', () => {
  for (const status of [STATUS.SUPERSEDED, STATUS.EXPIRED]) {
    assert.deepStrictEqual(S.detect([row({ status })], '2026-06-01T00:00:00.000Z'), [],
      `${status} facts are already resolved`);
  }
});

await test('an expired fact with a past valid_to is not re-ended', () => {
  const f = row({ status: STATUS.EXPIRED, valid_to: '2026-02-01T00:00:00.000Z' });
  assert.deepStrictEqual(S.detect([f], '2026-06-01T00:00:00.000Z'), []);
});

await test('each volatility class goes stale on its own horizon', () => {
  const at = '2026-03-01T00:00:00.000Z';   // 59 days after last verification
  const mk = (volatility) => row({ volatility, last_verified_at: '2026-01-01T00:00:00.000Z' });
  assert.strictEqual(S.detect([mk('fast')], at).length, 1, 'fast is stale after two months');
  assert.strictEqual(S.detect([mk('slow')], at).length, 0, 'slow is not');
  assert.strictEqual(S.detect([mk('stable')], at).length, 0, 'stable certainly is not');
  assert.strictEqual(S.detect([mk('scheduled')], at).length, 0, 'scheduled does not decay at all');
});

await test('a stable fact DOES eventually go stale — it is not a silent exemption', () => {
  // The template is explicit that stable facts stay visible to the sweep.
  const f = row({ volatility: 'stable', last_verified_at: '2000-01-01T00:00:00.000Z' });
  assert.strictEqual(S.detect([f], '2026-06-01T00:00:00.000Z').length, 1);
});

await test('the floor is the SAME number recall() uses', () => {
  // Two thresholds for one word contradict each other in front of a user.
  const { store, clock, inboxFile } = fresh();
  store.born({ topic: 'project', text: 'x', volatility: 'fast' });
  clock.advanceDays(45);
  assert.strictEqual(store.recall()[0].stale, true);
  const r = S.sweep({ store, repairFn: repair, now: () => clock.now(), inboxFile });
  assert.strictEqual(r.findings, 1, 'recall says stale, so the sweep must agree');
  assert.strictEqual(S.detect(store.current(), clock.iso(), { floor: THRESHOLDS.freshnessFloor }).length, 0,
    'and once flagged it stops being a finding');
});

await test('a malformed row is skipped rather than crashing the sweep', () => {
  assert.deepStrictEqual(S.detect([null, {}, { id: null }], '2026-06-01T00:00:00.000Z'), []);
  assert.deepStrictEqual(S.detect(null, '2026-06-01T00:00:00.000Z'), []);
});

// --- it writes nothing itself ----------------------------------------------

await test('every write goes through the injected repair function', () => {
  const { store, clock, inboxFile } = fresh();
  store.born({ topic: 'project', text: 'x', volatility: 'fast' });
  clock.advanceDays(120);
  const spy = spyRepair();
  const r = S.sweep({ store, repairFn: spy, now: () => clock.now(), inboxFile });
  assert.strictEqual(spy.calls.length, 1);
  assert.strictEqual(spy.calls[0].decision.action, 'flag');
  assert.strictEqual(r.flagged, 1);
  // The spy wrote nothing, so the store must be untouched — proving the sweep
  // has no second write route.
  assert.strictEqual(store.current()[0].status, STATUS.ACTIVE);
});

await test('the sweep refuses to run without a writer', () => {
  const { store } = fresh();
  assert.throws(() => S.sweep({ store }), /must not write by any other route/);
  assert.throws(() => S.sweep({ repairFn: repair }), /needs a store/);
});

await test('the sweep imports nothing that could write', () => {
  // STRIP COMMENTS FIRST. This is the third time a source-text scan has
  // flagged a module's own documentation: weekly-sweep.js's write-up of the
  // gateway-adapter finding, trading-performance.js naming paper-trading.js to
  // say what it is not, and here the JSDoc for `repairFn` quoting
  // require('./memory-repair.js') to tell a caller what to pass. A grep cannot
  // tell code from prose about code, so remove the prose before grepping
  // rather than weakening the assertion.
  const raw = fs.readFileSync(require.resolve('./memory-sweep.js'), 'utf8');
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')          // block comments
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  const requires = [...code.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(requires, ['./memory-bitemporal.js'],
    'the sweep may read the store module for its constants and nothing else');
  // ...and the prose really did mention the writer, so the strip is load-bearing
  // rather than incidental.
  assert.ok(raw.includes("require('./memory-repair.js')"),
    'the header should still document what to pass as repairFn');

  for (const forbidden of ['appendFileSync', 'writeFileSync', 'fetch(']) {
    assert.ok(!code.includes(forbidden), `detection must spend nothing; found "${forbidden}"`);
  }
});

await test('a refusal from the writer is reported, not swallowed', () => {
  const { store, clock, inboxFile } = fresh();
  store.born({ topic: 'project', text: 'x', volatility: 'fast' });
  clock.advanceDays(120);
  const r = S.sweep({ store, repairFn: spyRepair('refused'), now: () => clock.now(), inboxFile });
  assert.strictEqual(r.refused.length, 1);
  assert.strictEqual(r.flagged, 0, 'a refused proposal is not a flagged fact');
});

// --- through the real writer -------------------------------------------------

await test('the kill switch stops the sweep writing, via layer 5', () => {
  const G = require('./guard.js');
  const { store, clock, inboxFile } = fresh();
  store.born({ topic: 'project', text: 'x', volatility: 'fast' });
  clock.advanceDays(120);
  fs.writeFileSync(G.STOP_FILE, '');
  try {
    assert.throws(() => S.sweep({ store, repairFn: repair, now: () => clock.now(), inboxFile }),
      /Kill switch/);
    assert.strictEqual(store.current()[0].status, STATUS.ACTIVE, 'nothing was written');
  } finally {
    fs.unlinkSync(G.STOP_FILE);
  }
});

await test('an ended window really closes the fact, through the real writer', () => {
  const { store, clock, inboxFile } = fresh();
  const f = store.born({ topic: 'appointment', text: 'dentist', volatility: 'scheduled' });
  store.replace(f.id, { topic: 'appointment', text: 'dentist', volatility: 'scheduled' });
  // Give the successor a window that has since closed.
  const successor = store.current().find((x) => x.status === STATUS.ACTIVE);
  store.end(successor.id, { at: '2026-06-02T00:00:00.000Z' });
  clock.advanceDays(10);
  const r = S.sweep({ store, repairFn: repair, now: () => clock.now(), inboxFile });
  assert.strictEqual(r.findings, 0, 'an already-ended fact is not swept again');
});

await test('a run with nothing stale reports so without claiming more', () => {
  const { store, clock, inboxFile } = fresh();
  store.born({ topic: 'city', text: 'Pune', volatility: 'slow' });
  const r = S.sweep({ store, repairFn: repair, now: () => clock.now(), inboxFile });
  assert.strictEqual(r.findings, 0);
  assert.strictEqual(r.scanned, 1);
  assert.match(S.format(r), /nothing has gone stale/);
});

await test('the rendered report always says nothing was retired', () => {
  const { store, clock, inboxFile } = fresh();
  store.born({ topic: 'project', text: 'x', volatility: 'fast' });
  clock.advanceDays(120);
  const text = S.format(S.sweep({ store, repairFn: repair, now: () => clock.now(), inboxFile }));
  assert.match(text, /Nothing was retired/);
  assert.match(text, /still returned by recall/);
});

finish();
})();
