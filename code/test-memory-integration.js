// THE SEVEN LAYERS AS ONE SYSTEM.
//
// Every layer has its own suite and each passes in isolation. That is exactly
// the condition under which integration bugs survive: each module is correct
// about its own contract and wrong about its neighbour's. This file runs the
// whole thing as one story instead — a fact is learned, restated, contradicted
// hesitantly, parked, reviewed, approved, left alone until it rots, swept,
// flagged, and finally re-confirmed — and asserts the store after each step.
//
// It is deliberately NOT a rerun of the unit tests at a higher level. It only
// asserts things that no single layer can be responsible for:
//
//   * a decision made by layer 4 is applied by layer 5 with the right effect
//   * the sweep (6) and the arrival path (4) never disagree about what is stale
//   * a proposal parked by 5 is resolvable by 7 and lands back in 5
//   * the audit log tells the whole story afterwards, in order, with the right
//     approver on each row — because that log is the only artefact a human
//     actually reads later
//   * nothing anywhere is deleted
//
// One clock drives all of it, so "eight months pass" is three lines.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');

const { openStore, makeClock, STATUS } = require('./memory-bitemporal.js');
const { decideFact } = require('./memory-policy.js');
const { repair } = require('./memory-repair.js');
const { sweep } = require('./memory-sweep.js');
const inbox = require('./memory-inbox.js');
const G = require('./guard.js');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-integ-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

const auditRows = () => (fs.existsSync(G.currentLogFile())
  ? fs.readFileSync(G.currentLogFile(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : []);

(async () => {

await test('the whole arrival -> sweep -> review cycle, as one story', () => {
  const clock = makeClock('2026-01-01T00:00:00.000Z');
  const store = openStore({ file: path.join(TMP, 'facts.jsonl'), clock });
  const inboxFile = path.join(TMP, 'inbox.jsonl');
  const auditStart = auditRows().length;
  const live = () => store.validAt(clock.iso());
  const apply = (candidate, approvedBy = 'jarvis') => {
    const decision = decideFact(candidate, store.recall());
    return { decision, result: repair({ decision, candidate, store, inboxFile, approvedBy, now: () => clock.now() }) };
  };

  // --- 1. A fact is learned. Nothing comparable is stored, so it is born.
  const first = apply({ topic: 'city', text: 'Pune', value: 'Pune', volatility: 'slow', confidence: 0.9 });
  assert.strictEqual(first.decision.action, 'born');
  assert.strictEqual(first.result.outcome, 'applied');
  assert.strictEqual(live().length, 1);

  // --- 2. Three months on it is restated. That is EVIDENCE, not news: the
  //        store must not gain a second Pune.
  clock.advanceDays(90);
  const again = apply({ topic: 'city', text: 'Pune', value: 'Pune', volatility: 'slow', confidence: 0.9 });
  assert.strictEqual(again.decision.action, 'reaffirm');
  assert.strictEqual(live().length, 1, 'a restatement must not duplicate the fact');
  assert.strictEqual(store.recall()[0].freshness, 1, 'and it must reset freshness');

  // --- 3. A hesitant contradiction. Retiring costs more than adding, so this
  //        parks rather than applying — and the store is untouched.
  clock.advanceDays(30);
  const hesitant = apply({ topic: 'city', text: 'Bengaluru', value: 'Bengaluru',
                           volatility: 'slow', confidence: 0.65 });
  assert.strictEqual(hesitant.decision.routing, 'parked');
  assert.strictEqual(hesitant.decision.action, 'replace',
    'the proposal must remember WHAT it proposed, or step 4 cannot approve it');
  assert.strictEqual(hesitant.result.outcome, 'parked');
  assert.strictEqual(live()[0].value, 'Pune', 'a parked proposal changes nothing');

  // --- 4. A human reviews it. Approving goes back through the writer.
  const open = inbox.list({ file: inboxFile, now: () => clock.now() }).open;
  assert.strictEqual(open.length, 1);
  const approved = inbox.resolve({ id: open[0].id, verdict: 'approve', store,
                                   file: inboxFile, now: () => clock.now(), note: 'yes, I moved' });
  assert.strictEqual(approved.outcome, 'applied');
  assert.strictEqual(live()[0].value, 'Bengaluru');
  assert.strictEqual(live().length, 1, 'exactly one city is true at a time');
  assert.strictEqual(inbox.list({ file: inboxFile }).open.length, 0, 'and the queue is clear');

  // --- 5. Thirteen months of silence. Nobody says anything at all — the case
  //        every event-driven design is blind to.
  //        400 days, not 240: `slow` has a 365-day half-life, so 240 days
  //        leaves freshness at ~0.64, comfortably above the 0.5 floor. An
  //        earlier version of this fixture asserted staleness at 240 and the
  //        test was right to refuse it.
  clock.advanceDays(400);
  assert.ok(store.recall()[0].stale, 'recall says this has gone stale');

  const swept = sweep({ store, repairFn: repair, now: () => clock.now(), inboxFile });
  assert.strictEqual(swept.findings, 1, 'and the sweep must agree — one floor, not two');
  assert.strictEqual(swept.flagged, 1);
  assert.strictEqual(swept.ended, 0, 'age never retires');
  // NOT current()[0]: current() returns the latest version per id, and after
  // the replace there are two ids — index 0 is the superseded predecessor.
  const flagged = store.current().find((f) => f.value === 'Bengaluru');
  assert.strictEqual(flagged.status, STATUS.NEEDS_VERIFICATION);
  assert.strictEqual(live().length, 1, 'a flagged fact is STILL TRUE and still retrieved');

  // --- 6. A second sweep the next day must not re-flag it.
  clock.advanceDays(1);
  assert.strictEqual(sweep({ store, repairFn: repair, now: () => clock.now(), inboxFile }).findings, 0,
    're-flagging every night is how a signal becomes wallpaper');

  // --- 7. It is re-confirmed, which clears the flag and resets the decay.
  const reconfirmed = apply({ topic: 'city', text: 'Bengaluru', value: 'Bengaluru',
                              volatility: 'slow', confidence: 0.9 });
  assert.strictEqual(reconfirmed.decision.action, 'reaffirm');
  assert.strictEqual(store.current().find((f) => f.value === 'Bengaluru').status, STATUS.ACTIVE,
    'confirmation clears the flag');
  assert.strictEqual(store.recall()[0].stale, false);

  // --- what the two time axes say about all of it -------------------------
  // In the world, Pune was true in February and Bengaluru is true now...
  assert.strictEqual(store.validAt('2026-02-01T00:00:00.000Z')[0].value, 'Pune');
  assert.strictEqual(live()[0].value, 'Bengaluru');
  // ...and asked what it BELIEVED in February, the store still says Pune,
  // because the correction did not arrive until May.
  assert.strictEqual(store.asOf('2026-02-01T00:00:00.000Z')[0].value, 'Pune');

  // --- nothing was deleted ------------------------------------------------
  const everything = store.all();
  assert.ok(everything.some((r) => r.value === 'Pune'), 'the retired fact is still on disk');
  assert.strictEqual(new Set(everything.map((r) => r.id)).size, 2, 'two facts, many versions');
  assert.ok(everything.length >= 6, `expected a version per change, got ${everything.length}`);

  // --- the audit log tells the story, which is the artefact a human reads --
  const rows = auditRows().slice(auditStart).filter((r) => r.action.startsWith('memory-repair-'));
  assert.deepStrictEqual(rows.map((r) => r.action), [
    'memory-repair-born',       // 1. learned
    'memory-repair-reaffirm',   // 2. restated
    // 3. parked — deliberately NO row: the audit log records actions taken,
    //    and parking is the absence of one.
    'memory-repair-replace',    // 4. approved by a human
    'memory-repair-flag',       // 5. swept
    'memory-repair-reaffirm',   // 7. re-confirmed
  ]);
  assert.strictEqual(rows[2].approved_by, 'human',
    'the one change a human authorised must be the one row that says so');
  assert.ok(rows.filter((_, i) => i !== 2).every((r) => r.approved_by === 'jarvis'),
    'and every other row must say jarvis, not human');
  assert.ok(rows.every((r) => r.schema === 'v5'));
  assert.ok(rows.every((r) => G.gateVerdict(r) !== 'unknown'),
    'every row this pipeline writes carries a real claim');
});

await test('the kill switch stops the whole pipeline, not just one layer', () => {
  const clock = makeClock('2026-01-01T00:00:00.000Z');
  const store = openStore({ file: path.join(TMP, 'ks.jsonl'), clock });
  const inboxFile = path.join(TMP, 'ks-inbox.jsonl');
  const candidate = { topic: 'city', text: 'Pune', value: 'Pune', volatility: 'fast', confidence: 0.9 };

  repair({ decision: decideFact(candidate, []), candidate, store, inboxFile, now: () => clock.now() });
  clock.advanceDays(200);

  fs.writeFileSync(G.STOP_FILE, '');
  try {
    // Arrival path.
    const c2 = { ...candidate, text: 'Delhi', value: 'Delhi', confidence: 0.95 };
    assert.throws(() => repair({ decision: decideFact(c2, store.recall()), candidate: c2,
                                 store, inboxFile, now: () => clock.now() }), /Kill switch/);
    // Timer path.
    assert.throws(() => sweep({ store, repairFn: repair, now: () => clock.now(), inboxFile }),
      /Kill switch/);
    // Human path — a person approving does not get to bypass the switch either.
    repairForPark(store, inboxFile, clock);
    const open = inbox.list({ file: inboxFile, now: () => clock.now() }).open;
    if (open.length) {
      assert.throws(() => inbox.resolve({ id: open[0].id, verdict: 'approve', store,
                                          file: inboxFile, now: () => clock.now() }), /Kill switch/);
    }
    assert.strictEqual(store.current()[0].value, 'Pune', 'nothing changed while halted');
  } finally {
    fs.unlinkSync(G.STOP_FILE);
  }
});

/** Park one proposal directly, so the human path has something to approve. */
function repairForPark(store, inboxFile, clock) {
  repair({
    decision: { action: 'replace', targetId: store.current()[0].id, routing: 'parked', why: ['fixture'] },
    candidate: { topic: 'city', text: 'Delhi', value: 'Delhi', volatility: 'fast', confidence: 0.65 },
    store, inboxFile, now: () => clock.now(),
  });
}

finish();
})();
