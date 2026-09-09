// BITEMPORAL MEMORY LAYER 7 — the human inbox.
//
// The template's §7: park what the agent is not confident enough to do alone,
// and let a human clear the queue. The property that matters most here is the
// one it would be easiest to get wrong at the very last step:
//
//   APPROVING GOES BACK THROUGH THE WRITER, NOT ROUND IT.
//
// A review surface that wrote directly to the store would undo the whole
// design in its final component — no staleness check, no kill switch, no audit
// row. So `resolve('approve')` re-submits the parked decision to layer 5 with
// approved_by 'human', and a proposal parked in March whose target moved in
// April is REFUSED in June rather than forced. That refusal is the feature:
// it is exactly the case a review queue creates and a naive one ignores.
//
// Second: append-only. A resolution is a new row referencing the proposal's
// id; the proposal is never rewritten. "What is open" is a fold, not a stored
// state, so the queue can always answer what was decided and why.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const I = require('./memory-inbox.js');
const { repair } = require('./memory-repair.js');
const { openStore, makeClock, STATUS } = require('./memory-bitemporal.js');
const G = require('./guard.js');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-inbox-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

let seq = 0;
function fresh(startISO = '2026-06-01T00:00:00.000Z') {
  const clock = makeClock(startISO);
  return {
    store: openStore({ file: path.join(TMP, `s-${seq++}.jsonl`), clock }),
    clock,
    file: path.join(TMP, `inbox-${seq++}.jsonl`),
  };
}

const cand = (over = {}) => ({
  topic: 'city', scope: '', text: 'Bengaluru', value: 'Bengaluru',
  volatility: 'slow', confidence: 0.9, ...over,
});

/** Park one proposal through the real writer and return its id. */
function parkOne({ store, file, clock }, decision, candidate = cand()) {
  repair({ decision, candidate, store, inboxFile: file, now: () => clock.now() });
  const rows = I.fold(require('./memory-repair.js').readInbox(file));
  return rows.open[rows.open.length - 1].id;
}

const PARKED = (action, targetId = null) =>
  ({ action, targetId, routing: 'parked', why: ['below the retire bar'] });

(async () => {

// --- listing ----------------------------------------------------------------

await test('an empty inbox lists nothing rather than failing', () => {
  const l = I.list({ file: path.join(TMP, 'never-written.jsonl') });
  assert.deepStrictEqual(l.open, []);
  assert.strictEqual(l.resolvedCount, 0);
  assert.match(I.format(l), /nothing open/);
});

await test('a parked proposal appears, with an id and an age', () => {
  const ctx = fresh();
  const id = parkOne(ctx, PARKED('replace', 'f1'));
  const l = I.list({ file: ctx.file, now: () => new Date('2026-06-11T00:00:00.000Z') });
  assert.strictEqual(l.open.length, 1);
  assert.strictEqual(l.open[0].id, id);
  assert.strictEqual(l.open[0].ageDays, 10, 'a queue needs to show what is going stale in it');
  assert.strictEqual(l.open[0].action, 'replace');
});

await test('the queue is oldest first, so nothing sits at the bottom forever', () => {
  const ctx = fresh();
  const first = parkOne(ctx, PARKED('born'));
  ctx.clock.advanceDays(5);
  const second = parkOne(ctx, PARKED('born'), cand({ value: 'Delhi' }));
  const l = I.list({ file: ctx.file, now: () => ctx.clock.now() });
  assert.deepStrictEqual(l.open.map((p) => p.id), [first, second]);
});

// --- reject -------------------------------------------------------------------

await test('rejecting records the refusal and changes nothing', () => {
  const ctx = fresh();
  ctx.store.born(cand({ value: 'Pune', text: 'Pune' }));
  const id = parkOne(ctx, PARKED('replace', ctx.store.current()[0].id));
  const before = ctx.store.all().length;
  // The store is PASSED here on purpose. An earlier version of this test
  // asserted "the store is untouched" without handing resolve() a store at
  // all, so a reject that wrote to one could not have been detected.
  const r = I.resolve({ id, verdict: 'reject', store: ctx.store, file: ctx.file,
                        note: 'I did not move', now: () => ctx.clock.now() });
  assert.strictEqual(r.outcome, 'rejected');
  assert.strictEqual(ctx.store.validAt(ctx.clock.iso())[0].value, 'Pune', 'the store is untouched');
  assert.strictEqual(ctx.store.all().length, before, 'not one row may be written by a rejection');
  assert.strictEqual(I.list({ file: ctx.file }).open.length, 0, 'and it leaves the queue');
});

await test('rejecting needs no store — nothing is written to one', () => {
  const ctx = fresh();
  const id = parkOne(ctx, PARKED('born'));
  assert.strictEqual(I.resolve({ id, verdict: 'reject', file: ctx.file }).outcome, 'rejected');
});

// --- approve: through the writer, never round it ------------------------------

await test('approving applies through layer 5 and records approved_by human', () => {
  const ctx = fresh();
  const audit = () => (fs.existsSync(G.currentLogFile())
    ? fs.readFileSync(G.currentLogFile(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []);
  const id = parkOne(ctx, PARKED('born'));
  const before = audit().length;

  const r = I.resolve({ id, verdict: 'approve', store: ctx.store, file: ctx.file,
                        now: () => ctx.clock.now(), note: 'yes, I moved' });
  assert.strictEqual(r.outcome, 'applied');
  assert.strictEqual(ctx.store.current().length, 1);

  const row = audit()[before];
  assert.strictEqual(row.approved_by, 'human',
    'the whole point of the gate is that the audit row says a human said yes');
  assert.strictEqual(G.gateVerdict(row), 'approved');
});

await test('a proposal whose target MOVED since parking is refused, not forced', () => {
  // The case a review queue creates: parked in March, approved in June, and
  // the world changed in April. Re-validating is what catches it.
  const ctx = fresh();
  const original = ctx.store.born(cand({ value: 'Pune', text: 'Pune' }));
  const id = parkOne(ctx, PARKED('replace', original.id));

  ctx.clock.advanceDays(30);
  ctx.store.replace(original.id, cand({ value: 'Delhi', text: 'Delhi' }));   // someone got there first

  const r = I.resolve({ id, verdict: 'approve', store: ctx.store, file: ctx.file,
                        now: () => ctx.clock.now() });
  assert.strictEqual(r.outcome, 'refused');
  assert.match(r.why, /already superseded/);
  assert.strictEqual(ctx.store.validAt(ctx.clock.iso()).length, 1,
    'forcing it would leave two successors to one predecessor');
});

await test('the kill switch stops an approval, exactly as it stops the agent', () => {
  const ctx = fresh();
  const id = parkOne(ctx, PARKED('born'));
  fs.writeFileSync(G.STOP_FILE, '');
  try {
    assert.throws(() => I.resolve({ id, verdict: 'approve', store: ctx.store, file: ctx.file,
                                    now: () => ctx.clock.now() }), /Kill switch/);
    assert.strictEqual(ctx.store.current().length, 0);
  } finally {
    fs.unlinkSync(G.STOP_FILE);
  }
});

await test('approving without a store is refused rather than silently recorded', () => {
  const ctx = fresh();
  const id = parkOne(ctx, PARKED('born'));
  const r = I.resolve({ id, verdict: 'approve', file: ctx.file });
  assert.strictEqual(r.outcome, 'refused');
  assert.match(r.why, /through the writer, not round it/);
  assert.strictEqual(I.list({ file: ctx.file }).open.length, 1, 'and it stays open');
});

// --- append-only, and resolving once ------------------------------------------

await test('a proposal is never rewritten — the resolution is a new row', () => {
  const ctx = fresh();
  const id = parkOne(ctx, PARKED('born'));
  const before = fs.readFileSync(ctx.file, 'utf8');
  I.resolve({ id, verdict: 'reject', file: ctx.file, now: () => ctx.clock.now() });
  const after = fs.readFileSync(ctx.file, 'utf8');
  assert.ok(after.startsWith(before), 'the proposal row must survive byte-for-byte');
  assert.ok(after.length > before.length);
});

await test('resolving twice is refused, and says which way it went the first time', () => {
  const ctx = fresh();
  const id = parkOne(ctx, PARKED('born'));
  I.resolve({ id, verdict: 'reject', file: ctx.file, now: () => ctx.clock.now() });
  const second = I.resolve({ id, verdict: 'approve', store: ctx.store, file: ctx.file,
                             now: () => ctx.clock.now() });
  assert.strictEqual(second.outcome, 'refused');
  assert.match(second.why, /already rejectd|already reject/);
  assert.strictEqual(ctx.store.current().length, 0, 'the second verdict changed nothing');
});

await test('a second resolution row for one proposal does not override the first', () => {
  // Append-only: a later line disagreeing with a recorded decision is
  // suspect, not a correction — the same rule the trading journal uses.
  const ctx = fresh();
  const id = parkOne(ctx, PARKED('born'));
  fs.appendFileSync(ctx.file, `${JSON.stringify({ kind: 'resolution', id: 'r1', proposalId: id, verdict: 'reject', at: '2026-06-02T00:00:00.000Z' })}\n`);
  fs.appendFileSync(ctx.file, `${JSON.stringify({ kind: 'resolution', id: 'r2', proposalId: id, verdict: 'approve', at: '2026-06-03T00:00:00.000Z' })}\n`);
  const { resolved } = I.fold(require('./memory-repair.js').readInbox(ctx.file));
  assert.strictEqual(resolved.length, 1);
  assert.strictEqual(resolved[0].resolution.verdict, 'reject', 'the first resolution stands');
});

await test('an unknown id is distinguished from an already-resolved one', () => {
  const ctx = fresh();
  const id = parkOne(ctx, PARKED('born'));
  assert.match(I.resolve({ id: 'nope', verdict: 'reject', file: ctx.file }).why, /no open proposal/);
  I.resolve({ id, verdict: 'reject', file: ctx.file, now: () => ctx.clock.now() });
  assert.match(I.resolve({ id, verdict: 'reject', file: ctx.file }).why, /already/);
});

await test('an unknown verdict is refused', () => {
  const ctx = fresh();
  const id = parkOne(ctx, PARKED('born'));
  for (const bad of ['maybe', 'APPROVE', '', null]) {
    // Assert the REASON, not just the outcome: without the verdict check an
    // unknown verdict falls through to the approve path and is refused for
    // wanting a store, which looks identical from the outcome alone.
    const r = I.resolve({ id, verdict: bad, store: ctx.store, file: ctx.file,
                          now: () => ctx.clock.now() });
    assert.strictEqual(r.outcome, 'refused', `${String(bad)} should be refused`);
    assert.match(r.why, /verdict must be one of/, `${String(bad)} refused for the wrong reason`);
  }
  assert.strictEqual(ctx.store.current().length, 0, 'no bad verdict may write');
  assert.deepStrictEqual(I.VERDICTS, ['approve', 'reject']);
});

await test('a corrupt line is skipped rather than losing the whole queue', () => {
  const ctx = fresh();
  parkOne(ctx, PARKED('born'));
  fs.appendFileSync(ctx.file, '{ not json\n');
  assert.strictEqual(I.list({ file: ctx.file }).open.length, 1);
});

// --- the full loop -------------------------------------------------------------

await test('sweep parks, human approves, and the store changes exactly once', () => {
  const ctx = fresh();
  const original = ctx.store.born(cand({ value: 'Pune', text: 'Pune' }));

  // A hesitant contradiction: layer 4 would park it, so park it.
  const id = parkOne(ctx, PARKED('replace', original.id), cand({ confidence: 0.65 }));
  assert.strictEqual(ctx.store.validAt(ctx.clock.iso())[0].value, 'Pune', 'parking changed nothing');

  const r = I.resolve({ id, verdict: 'approve', store: ctx.store, file: ctx.file,
                        now: () => ctx.clock.now(), note: 'confirmed' });
  assert.strictEqual(r.outcome, 'applied');
  assert.strictEqual(ctx.store.validAt(ctx.clock.iso())[0].value, 'Bengaluru');
  assert.strictEqual(ctx.store.history(original.id).at(-1).status, STATUS.SUPERSEDED);
  assert.strictEqual(I.list({ file: ctx.file }).open.length, 0);
});

await test('the rendered queue explains that approval is re-validated', () => {
  const ctx = fresh();
  parkOne(ctx, PARKED('replace', 'f1'));
  const text = I.format(I.list({ file: ctx.file, now: () => ctx.clock.now() }));
  assert.match(text, /1 open/);
  assert.match(text, /re-submits through the writer/);
  assert.match(text, /refused rather than forced/);
});

finish();
})();
