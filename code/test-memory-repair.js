// BITEMPORAL MEMORY LAYER 5 — the one writer.
//
// Everything before this proposes; only this applies. So the assertions that
// matter are about what it REFUSES:
//
//   a parked decision is never applied, at any confidence, by any caller
//   a decision made against an older snapshot is refused, not guessed at
//   an unrecognised approver is refused rather than defaulted to 'jarvis'
//   the kill switch blocks the write AND records the block
//
// The stale-decision case is the subtle one and gets the most coverage. Layer
// 4 decides every candidate against ONE snapshot — deliberately, since
// deciding against a store it was mutating would make it a writer. So by the
// time a decision arrives here the target may already be superseded, and
// applying it anyway would leave TWO successors to one predecessor: exactly
// the self-contradiction layer 4 refuses to add a third opinion to.
//
// Offline: temp store file, temp inbox, injected clock. test-helper redirects
// the audit log, so no test writes to the real logs/actions.jsonl.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const R = require('./memory-repair.js');
const { openStore, makeClock } = require('./memory-bitemporal.js');
const { decideFact } = require('./memory-policy.js');
const G = require('./guard.js');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-repair-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

let seq = 0;
function fresh() {
  const clock = makeClock('2026-06-01T00:00:00.000Z');
  const store = openStore({ file: path.join(TMP, `s-${seq++}.jsonl`), clock });
  return { store, clock, inboxFile: path.join(TMP, `inbox-${seq++}.jsonl`) };
}

const cand = (over = {}) => ({
  topic: 'city', scope: '', text: 'Bengaluru', value: 'Bengaluru',
  volatility: 'slow', confidence: 0.9, ...over,
});

const AUTO = (action, targetId = null) => ({ action, targetId, routing: 'auto', why: ['test'] });
const PARKED = (action, targetId = null) => ({ action, targetId, routing: 'parked', why: ['below the bar'] });

const audit = () => (fs.existsSync(G.currentLogFile())
  ? fs.readFileSync(G.currentLogFile(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : []);

(async () => {

// --- gate 3: parked is never applied ---------------------------------------

await test('a parked decision is NEVER applied, however confident the candidate', () => {
  const { store, inboxFile } = fresh();
  const r = R.repair({ decision: PARKED('replace', 'x'), candidate: cand({ confidence: 1 }),
                       store, inboxFile });
  assert.strictEqual(r.outcome, 'parked');
  assert.strictEqual(store.current().length, 0, 'nothing may reach the store');
  assert.strictEqual(R.readInbox(inboxFile).length, 1);
});

await test('a parked proposal keeps its target and reasoning, or it is unreviewable', () => {
  const { store, inboxFile } = fresh();
  R.repair({ decision: PARKED('replace', 'f9'), candidate: cand(), store, inboxFile });
  const [row] = R.readInbox(inboxFile);
  assert.strictEqual(row.targetId, 'f9');
  assert.deepStrictEqual(row.why, ['below the bar']);
  assert.strictEqual(row.candidate.value, 'Bengaluru');
  assert.ok(row.parked_at, 'a proposal with no timestamp cannot be aged');
});

await test('the inbox is append-only', () => {
  const { store, inboxFile } = fresh();
  R.repair({ decision: PARKED('born'), candidate: cand(), store, inboxFile });
  const before = fs.readFileSync(inboxFile, 'utf8');
  R.repair({ decision: PARKED('born'), candidate: cand({ value: 'Delhi' }), store, inboxFile });
  assert.ok(fs.readFileSync(inboxFile, 'utf8').startsWith(before));
  assert.strictEqual(R.readInbox(inboxFile).length, 2);
});

// --- the ordinary applications ---------------------------------------------

await test('born opens an interval and returns its id', () => {
  const { store, inboxFile } = fresh();
  const r = R.repair({ decision: AUTO('born'), candidate: cand(), store, inboxFile });
  assert.strictEqual(r.outcome, 'applied');
  assert.strictEqual(store.current().length, 1);
  assert.strictEqual(store.current()[0].id, r.factId);
});

await test('reaffirm resets freshness without creating a second fact', () => {
  const { store, clock, inboxFile } = fresh();
  const f = store.born(cand({ value: 'Pune', text: 'Pune' }));
  clock.advanceDays(200);
  assert.ok(store.recall()[0].freshness < 1);
  const r = R.repair({ decision: AUTO('reaffirm', f.id), candidate: cand(), store, inboxFile });
  assert.strictEqual(r.outcome, 'applied');
  assert.strictEqual(store.current().length, 1, 'still one fact, not two');
  assert.strictEqual(store.recall()[0].freshness, 1);
});

await test('replace supersedes the target and opens the successor', () => {
  const { store, inboxFile } = fresh();
  const old = store.born(cand({ value: 'Pune', text: 'Pune' }));
  const r = R.repair({ decision: AUTO('replace', old.id), candidate: cand(), store, inboxFile });
  assert.strictEqual(r.outcome, 'applied');
  const live = store.validAt(store.clock.iso());
  assert.strictEqual(live.length, 1);
  assert.strictEqual(live[0].value, 'Bengaluru');
  assert.strictEqual(store.history(old.id).at(-1).superseded_by, r.factId);
});

// --- the stale-decision problem --------------------------------------------

await test('a decision against an already-superseded target is REFUSED', () => {
  const { store, inboxFile } = fresh();
  const old = store.born(cand({ value: 'Pune', text: 'Pune' }));
  store.replace(old.id, cand({ value: 'Delhi', text: 'Delhi' }));   // someone got there first
  const r = R.repair({ decision: AUTO('replace', old.id), candidate: cand(), store, inboxFile });
  assert.strictEqual(r.outcome, 'refused');
  assert.match(r.why, /already superseded/);
  assert.match(r.why, /older snapshot/);
  assert.strictEqual(store.validAt(store.clock.iso()).length, 1,
    'applying it would leave TWO successors to one predecessor');
});

await test('a decision naming a target that no longer exists is refused', () => {
  const { store, inboxFile } = fresh();
  const r = R.repair({ decision: AUTO('replace', 'ghost'), candidate: cand(), store, inboxFile });
  assert.strictEqual(r.outcome, 'refused');
  assert.match(r.why, /not in the store/);
});

await test('a born whose slot filled since the decision is refused, not duplicated', () => {
  // Two callers racing: both decided "nothing is stored here" against the same
  // empty snapshot. The second must lose.
  const { store, inboxFile } = fresh();
  R.repair({ decision: AUTO('born'), candidate: cand(), store, inboxFile });
  const r = R.repair({ decision: AUTO('born'), candidate: cand({ value: 'Delhi' }), store, inboxFile });
  assert.strictEqual(r.outcome, 'refused');
  assert.match(r.why, /already exists at topic/);
  assert.strictEqual(store.current().length, 1);
});

await test('a batch applies in order and refuses the ones the earlier ones invalidated', () => {
  // The counterpart to layer 4 deciding everything against one snapshot: two
  // candidates contradicting the same fact means the first wins and the second
  // is stale, rather than both "succeeding".
  const { store, inboxFile } = fresh();
  const old = store.born(cand({ value: 'Pune', text: 'Pune' }));
  const snapshot = store.recall();
  const a = cand({ value: 'Delhi', text: 'Delhi', confidence: 0.9 });
  const b = cand({ value: 'Mumbai', text: 'Mumbai', confidence: 0.9 });
  const results = [
    { candidate: a, decision: decideFact(a, snapshot) },
    { candidate: b, decision: decideFact(b, snapshot) },
  ];
  assert.strictEqual(results[0].decision.targetId, old.id);
  assert.strictEqual(results[1].decision.targetId, old.id, 'both were decided against the same snapshot');

  const out = R.repairAll(results, { store, inboxFile });
  assert.strictEqual(out[0].result.outcome, 'applied');
  assert.strictEqual(out[1].result.outcome, 'refused');
  assert.strictEqual(store.validAt(store.clock.iso()).length, 1, 'exactly one city remains true');
});

// --- gate 1: the kill switch ------------------------------------------------

await test('the kill switch blocks the write AND records the block', () => {
  // CONSTITUTION.md §VI. memory-bitemporal.js does not import guard, so
  // without this layer a pulled switch would not reach a store write at all.
  const { store, inboxFile } = fresh();
  fs.writeFileSync(G.STOP_FILE, '');
  try {
    const before = audit().length;
    assert.throws(() => R.repair({ decision: AUTO('born'), candidate: cand(), store, inboxFile }),
      /Kill switch/);
    assert.strictEqual(store.current().length, 0, 'nothing was written');
    const row = audit()[before];
    assert.strictEqual(row.outcome, 'killswitch');
    assert.strictEqual(row.action, 'memory-repair-born');
    assert.strictEqual(row.approved_by, 'jarvis',
      'the blocked action must still record who authorised it');
  } finally {
    fs.unlinkSync(G.STOP_FILE);
  }
});

// --- gate 2: the audit row ---------------------------------------------------

await test('every applied repair writes a schema v5 audit row with its claim', () => {
  const { store, inboxFile } = fresh();
  const before = audit().length;
  R.repair({ decision: AUTO('born'), candidate: cand({ confidence: 0.95 }),
             store, inboxFile, approvedBy: 'human' });
  const row = audit()[before];
  assert.strictEqual(row.schema, 'v5');
  assert.strictEqual(row.action, 'memory-repair-born');
  assert.strictEqual(row.confidence, 0.95);
  assert.strictEqual(row.approved_by, 'human');
  assert.strictEqual(G.gateVerdict(row), 'approved');
});

await test('a repair with no confidence claim reads as not-claimed, never as 1.0', () => {
  const { store, inboxFile } = fresh();
  const c = cand(); delete c.confidence;
  const before = audit().length;
  R.repair({ decision: AUTO('born'), candidate: c, store, inboxFile });
  const row = audit()[before];
  assert.strictEqual(G.readConfidence(row).reason, 'not-claimed');
  assert.strictEqual(G.gateVerdict(row), 'unknown');
});

await test('a parked proposal writes NO audit row — nothing happened', () => {
  const { store, inboxFile } = fresh();
  const before = audit().length;
  R.repair({ decision: PARKED('born'), candidate: cand(), store, inboxFile });
  assert.strictEqual(audit().length, before,
    'the audit log records actions taken, and parking is the absence of one');
});

// --- the approver ------------------------------------------------------------

await test('an unrecognised approver is refused, not defaulted', () => {
  // Defaulting to 'jarvis' would invent an answer to "who authorised this".
  const { store, inboxFile } = fresh();
  for (const bad of ['ahmed', 'agent', 'oracle', '', null, 42]) {
    const r = R.repair({ decision: AUTO('born'), candidate: cand(), store, inboxFile, approvedBy: bad });
    assert.strictEqual(r.outcome, 'refused', `${String(bad)} should be refused`);
    assert.match(r.why, /CONSTITUTION\.md §V/);
  }
  assert.strictEqual(store.current().length, 0);
});

await test('both constitutional approvers are accepted', () => {
  for (const who of G.APPROVERS) {
    const { store, inboxFile } = fresh();
    const r = R.repair({ decision: AUTO('born'), candidate: cand(), store, inboxFile, approvedBy: who });
    assert.strictEqual(r.outcome, 'applied', `${who} should be accepted`);
  }
});

// --- refusals ----------------------------------------------------------------

await test('an action this layer cannot apply is refused loudly, not interpreted', () => {
  const { store, inboxFile } = fresh();
  const r = R.repair({ decision: AUTO('coexist'), candidate: cand(), store, inboxFile });
  assert.strictEqual(r.outcome, 'refused');
  assert.match(r.why, /cannot apply action "coexist"/);
});

await test('missing arguments are refused rather than crashing', () => {
  assert.strictEqual(R.repair({}).outcome, 'refused');
  assert.strictEqual(R.repair({ decision: AUTO('born') }).outcome, 'refused');
});

await test('every outcome is in the closed set', () => {
  const { store, inboxFile } = fresh();
  const cases = [
    { decision: AUTO('born'), candidate: cand() },
    { decision: PARKED('born'), candidate: cand() },
    { decision: AUTO('replace', 'ghost'), candidate: cand() },
    { decision: AUTO('nonsense'), candidate: cand() },
  ];
  for (const c of cases) {
    const r = R.repair({ ...c, store, inboxFile });
    assert.ok(R.OUTCOMES.includes(r.outcome), `${r.outcome} is not a declared outcome`);
    assert.ok(r.why && r.why.length, 'every outcome must say why');
  }
});

// --- end to end ---------------------------------------------------------------

await test('layer 4 decides and layer 5 applies, with the store the only thing that changed', () => {
  const { store, inboxFile } = fresh();
  store.born(cand({ value: 'Pune', text: 'Pune' }));

  // A confident contradiction: decided, then applied.
  const c = cand({ confidence: 0.95 });
  const d = decideFact(c, store.recall());
  assert.strictEqual(d.action, 'replace');
  const r = R.repair({ decision: d, candidate: c, store, inboxFile, approvedBy: 'human' });
  assert.strictEqual(r.outcome, 'applied');
  assert.strictEqual(store.validAt(store.clock.iso())[0].value, 'Bengaluru');

  // A hesitant one: decided as a park, and it stays a park.
  const weak = cand({ value: 'Delhi', text: 'Delhi', confidence: 0.65 });
  const d2 = decideFact(weak, store.recall());
  assert.strictEqual(d2.action, 'park');
  const r2 = R.repair({ decision: d2, candidate: weak, store, inboxFile });
  assert.strictEqual(r2.outcome, 'parked');
  assert.strictEqual(store.validAt(store.clock.iso())[0].value, 'Bengaluru', 'unchanged');
  assert.strictEqual(R.readInbox(inboxFile).length, 1);
});

await test('the rendered summary says how many proposals were parked', () => {
  const { store, inboxFile } = fresh();
  const out = R.repairAll([
    { candidate: cand(), decision: AUTO('born') },
    { candidate: cand({ topic: 'pet', value: 'cat' }), decision: PARKED('born') },
  ], { store, inboxFile });
  const text = R.format(out);
  assert.match(text, /APPLIED/);
  assert.match(text, /PARKED/);
  assert.match(text, /1 proposal\(s\) parked/);
});

finish();
})();
