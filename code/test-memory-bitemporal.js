// Layers 1-2 of docs/incoming/MEMORY_TEMPLATE.txt: the clock and the
// bitemporal store.
//
// The assertion that justifies the whole design is "the two axes come apart"
// below. Everything else in this file is scaffolding around that one property:
// if valid time and transaction time cannot disagree, this is an ordinary
// versioned log with extra columns, and the complexity is not paid for.
//
// The other properties worth pinning, each the failure the template warns
// about by name:
//   nothing is deleted or edited  -- the file only ever grows, byte-prefixed
//   a successor closes its predecessor EXACTLY where it opens, not at "now"
//   age is measured from last_verified_at, never from recorded_at
//   recall() and stale() share ONE freshness number, or they contradict each
//     other in front of a user
//   retiring a fact needs more confidence than adding one
//   a contradiction on a stable fact parks at ANY confidence
//
// Offline and deterministic: every test drives an injected frozen clock, so
// "six months of decay" runs in microseconds, and every store writes to a temp
// path. Nothing here touches memory/facts.jsonl.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const M = require('./memory-bitemporal.js');

// See test-status.js: a suite that truncates instead of failing exits 0 and
// prints no tally, which reads as green.
process.exitCode = 1;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-bitemp-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

let seq = 0;
function newStore(startISO = '2026-06-01T00:00:00.000Z') {
  const clock = M.makeClock(startISO);
  return { store: M.openStore({ file: path.join(TMP, `f-${seq++}.jsonl`), clock }), clock };
}

// --- layer 1: the clock -----------------------------------------------------

test('the clock is injected and frozen — six months of decay in one run', () => {
  const c = M.makeClock('2026-01-01T00:00:00.000Z');
  assert.strictEqual(c.iso(), '2026-01-01T00:00:00.000Z');
  c.advanceDays(180);
  assert.strictEqual(c.iso(), '2026-06-30T00:00:00.000Z');
  assert.strictEqual(c.iso(), '2026-06-30T00:00:00.000Z', 'reading the clock must not advance it');
});

test('an unparseable start time throws rather than silently becoming NaN', () => {
  assert.throws(() => M.makeClock('not a date'), /unparseable/);
});

// --- the four things that can happen to a memory (template §2) --------------

test('BORN: opens an interval with no end', () => {
  const { store } = newStore();
  const f = store.born({ topic: 'city', text: 'I live in Pune', volatility: 'slow' });
  assert.strictEqual(f.valid_to, M.OPEN);
  assert.strictEqual(f.status, 'active');
  assert.strictEqual(f.version, 1);
  assert.strictEqual(f.valid_from, '2026-06-01T00:00:00.000Z');
  assert.strictEqual(store.recall().length, 1);
});

test('REPLACED: the predecessor closes EXACTLY where its successor opens', () => {
  // The template's own example, and the reason this is not "close it at now":
  // you learn on the 10th that the move happened on the 3rd. Closing the old
  // fact at the 10th would leave a week where the store reports both as true.
  const { store, clock } = newStore('2026-06-01T00:00:00.000Z');
  const pune = store.born({ topic: 'city', text: 'I live in Pune', volatility: 'slow' });
  clock.advanceDays(9);                                  // it is now the 10th
  const blr = store.replace(pune.id, {
    topic: 'city', text: 'I live in Bengaluru', volatility: 'slow',
    valid_from: '2026-06-03T00:00:00.000Z',              // ...but the move was the 3rd
  });

  const closed = store.history(pune.id).at(-1);
  assert.strictEqual(closed.valid_to, blr.valid_from);
  assert.strictEqual(closed.valid_to, '2026-06-03T00:00:00.000Z',
    'closed at the successor\'s start, not at the moment we found out');
  assert.strictEqual(closed.status, 'superseded');
  assert.strictEqual(closed.superseded_by, blr.id);

  // No overlap: exactly one city is true on any given day.
  for (const day of ['2026-06-02', '2026-06-03', '2026-06-05']) {
    const live = store.validAt(`${day}T12:00:00.000Z`).filter((r) => r.topic === 'city');
    assert.strictEqual(live.length, 1, `${day} should have exactly one city, got ${live.length}`);
  }
});

test('AGES: belief weakens with time, and reaffirming restores it', () => {
  const { store, clock } = newStore();
  const f = store.born({ topic: 'project', text: 'building Jarvis', volatility: 'fast' });
  assert.strictEqual(M.freshness(f, clock.iso()), 1);

  clock.advanceDays(30);                                  // one `fast` half-life
  assert.ok(Math.abs(M.freshness(store.current()[0], clock.iso()) - 0.5) < 1e-9,
    'freshness must be exactly 0.5 after one half-life');

  clock.advanceDays(60);
  assert.ok(store.stale().length === 1, 'well past the floor, it should be stale');

  store.reaffirm(f.id);
  assert.strictEqual(M.freshness(store.current()[0], clock.iso()), 1);
  assert.deepStrictEqual(store.stale(), [], 'fresh evidence clears it');
});

test('ENDS: closes with nothing succeeding it', () => {
  const { store, clock } = newStore();
  const f = store.born({ topic: 'appointment', text: 'dentist', volatility: 'scheduled' });
  clock.advanceDays(1);
  store.end(f.id);
  const last = store.history(f.id).at(-1);
  assert.strictEqual(last.status, 'expired');
  assert.strictEqual(last.superseded_by, null, 'nothing succeeds an ended fact');
  assert.strictEqual(last.valid_to, clock.iso());
  assert.deepStrictEqual(store.recall(), [], 'an ended fact is no longer retrieved');
});

// --- THE property the whole design exists for -------------------------------

test('the two axes come apart: what is true now vs. what I believed then', () => {
  const { store, clock } = newStore('2026-06-01T00:00:00.000Z');
  store.born({ topic: 'city', text: 'Pune', volatility: 'slow' });
  clock.advanceDays(9);                                   // the 10th
  store.replace(store.current()[0].id, {
    topic: 'city', text: 'Bengaluru', volatility: 'slow',
    valid_from: '2026-06-03T00:00:00.000Z',
  });

  // Valid time: on June 5th the world already had them in Bengaluru...
  const truthOnThe5th = store.validAt('2026-06-05T00:00:00.000Z');
  assert.strictEqual(truthOnThe5th.length, 1);
  assert.strictEqual(truthOnThe5th[0].text, 'Bengaluru');

  // ...but transaction time: on June 5th this system still believed Pune,
  // because it did not find out until the 10th. Both answers are correct and
  // they are different, which is exactly what one timestamp cannot express.
  const beliefOnThe5th = store.asOf('2026-06-05T00:00:00.000Z');
  assert.strictEqual(beliefOnThe5th.length, 1);
  assert.strictEqual(beliefOnThe5th[0].text, 'Pune');

  // And asked about the same instant with the beliefs of that instant, the
  // store says Pune -- the honest answer to "what would you have told me then".
  const asKnownThen = store.validAt('2026-06-05T00:00:00.000Z',
    { asOf: '2026-06-05T00:00:00.000Z' });
  assert.strictEqual(asKnownThen[0].text, 'Pune');
});

// --- nothing is ever deleted or edited --------------------------------------

test('every operation appends; the file only ever grows, byte for byte', () => {
  const { store, clock } = newStore();
  const f = store.born({ topic: 'city', text: 'Pune', volatility: 'slow' });
  const afterBorn = fs.readFileSync(store.file, 'utf8');

  clock.advanceDays(1); store.reaffirm(f.id);
  const afterReaffirm = fs.readFileSync(store.file, 'utf8');
  assert.ok(afterReaffirm.startsWith(afterBorn), 'reaffirm rewrote earlier bytes');

  clock.advanceDays(1); store.replace(f.id, { topic: 'city', text: 'Bengaluru', volatility: 'slow' });
  const afterReplace = fs.readFileSync(store.file, 'utf8');
  assert.ok(afterReplace.startsWith(afterReaffirm), 'replace rewrote earlier bytes');

  // The original v1 row is still there in full, which is what makes "what did
  // I believe in March" answerable at all.
  assert.strictEqual(store.history(f.id)[0].text, 'Pune');
  assert.strictEqual(store.history(f.id)[0].version, 1);
});

test('transaction time is DERIVED, so closing a version never edits it', () => {
  const { store, clock } = newStore('2026-06-01T00:00:00.000Z');
  const f = store.born({ topic: 'city', text: 'Pune', volatility: 'slow' });
  clock.advanceDays(5);
  store.reaffirm(f.id);

  const h = store.history(f.id);
  assert.strictEqual(h.length, 2);
  assert.strictEqual(h[0].expired_at, h[1].recorded_at,
    'v1 must close exactly where v2 opens');
  assert.strictEqual(h[1].expired_at, M.OPEN, 'the newest version is still open');

  // And the derivation is not stored: the raw line on disk has no expired_at.
  const raw = JSON.parse(fs.readFileSync(store.file, 'utf8').split('\n')[0]);
  assert.ok(!('expired_at' in raw),
    'expired_at must be derived — storing it would mean editing a written row');
});

test('the open sentinel is a far-future timestamp, never null', () => {
  const { store } = newStore();
  const f = store.born({ topic: 'city', text: 'Pune', volatility: 'slow' });
  assert.strictEqual(f.valid_to, M.OPEN);
  assert.notStrictEqual(f.valid_to, null);
  // The point of the sentinel: every comparison is a plain `<`, with no
  // IS NULL branch that a second query could forget.
  assert.ok('2027-01-01T00:00:00.000Z' < f.valid_to);
  assert.ok(M.OPEN > '9998-01-01T00:00:00.000Z');
});

// --- volatility and freshness -----------------------------------------------

test('each volatility class ages on its own horizon', () => {
  const born = (volatility) => ({ volatility, last_verified_at: '2026-01-01T00:00:00.000Z' });
  const after = (d) => new Date(Date.parse('2026-01-01T00:00:00.000Z') + d * 86400000).toISOString();

  assert.ok(M.freshness(born('fast'), after(60)) < M.THRESHOLDS.freshnessFloor,
    'a fast fact is stale after two months');
  assert.ok(M.freshness(born('slow'), after(60)) > M.THRESHOLDS.freshnessFloor,
    'a slow fact is not');
  assert.ok(M.freshness(born('stable'), after(3650)) <= 0.5 + 1e-9,
    'stable still ages, on a decade — it must stay visible to the sweep, not be a silent exemption');
});

test('a scheduled fact does not decay — it ends by date instead', () => {
  const born = { volatility: 'scheduled', last_verified_at: '2026-01-01T00:00:00.000Z' };
  assert.strictEqual(M.freshness(born, '2030-01-01T00:00:00.000Z'), 1);
});

test('age runs from last_verified_at, not recorded_at', () => {
  // The template's sharpest point: a fact learned two years ago and reconfirmed
  // last week is FRESH; one learned last week and never mentioned again is
  // already rotting. Measuring from recorded_at inverts both.
  const old_but_confirmed = {
    volatility: 'fast',
    recorded_at: '2024-01-01T00:00:00.000Z',
    last_verified_at: '2026-05-28T00:00:00.000Z',
  };
  assert.ok(M.freshness(old_but_confirmed, '2026-06-01T00:00:00.000Z') > 0.9);
});

test('recall() and stale() share ONE freshness number', () => {
  // Two thresholds for the same word contradict each other in front of a user:
  // retrieval says "may be out of date" while the sweep says it is fine.
  const { store, clock } = newStore();
  store.born({ topic: 'project', text: 'x', volatility: 'fast' });
  clock.advanceDays(45);                                  // past the 0.5 floor
  const [r] = store.recall();
  assert.strictEqual(r.stale, true);
  assert.strictEqual(store.stale().length, 1);
  assert.ok(r.freshness < M.THRESHOLDS.freshnessFloor);

  clock.advanceDays(-30);                                 // back inside the floor
  assert.strictEqual(store.recall()[0].stale, false);
  assert.strictEqual(store.stale().length, 0);
});

test('recall returns freshest first and can filter by topic', () => {
  const { store, clock } = newStore();
  store.born({ topic: 'city', text: 'Pune', volatility: 'slow' });
  clock.advanceDays(100);
  store.born({ topic: 'project', text: 'Jarvis', volatility: 'slow' });
  const all = store.recall();
  assert.strictEqual(all[0].text, 'Jarvis', 'the more recently verified fact ranks first');
  assert.deepStrictEqual(store.recall({ topic: 'city' }).map((r) => r.text), ['Pune']);
});

test('flagging for verification does not retire the fact', () => {
  const { store } = newStore();
  const f = store.born({ topic: 'city', text: 'Pune', volatility: 'slow' });
  store.flagForVerification(f.id);
  assert.strictEqual(store.current()[0].status, 'needs_verification');
  assert.strictEqual(store.validAt(store.clock.iso()).length, 1,
    'a flagged fact is still true until something says otherwise');
});

// --- the confidence gate (template §4) --------------------------------------

test('retiring a fact needs more confidence than adding one', () => {
  // The asymmetry is the point: being wrong on a retire loses information,
  // being wrong on an add just leaves a duplicate.
  assert.strictEqual(M.decide({ action: 'add', confidence: 0.7, volatility: 'slow' }), 'auto');
  assert.strictEqual(M.decide({ action: 'retire', confidence: 0.7, volatility: 'slow' }), 'parked');
  assert.strictEqual(M.decide({ action: 'retire', confidence: 0.85, volatility: 'slow' }), 'auto');
  assert.ok(M.THRESHOLDS.retire > M.THRESHOLDS.add, 'the two thresholds must not collapse into one');
});

test('below the add bar, even adding parks', () => {
  assert.strictEqual(M.decide({ action: 'add', confidence: 0.4, volatility: 'fast' }), 'parked');
});

test('a contradiction on a STABLE fact parks at any confidence', () => {
  // A contradiction on a name or birthday is more often an extraction error
  // than a real change — and high model confidence is what such an error
  // looks like from the inside, so confidence cannot be the escape hatch.
  assert.strictEqual(
    M.decide({ action: 'retire', confidence: 0.99, volatility: 'stable', contradicts: true }),
    'parked');
  assert.strictEqual(
    M.decide({ action: 'add', confidence: 1, volatility: 'stable', contradicts: true }),
    'parked');
  // ...while a contradiction on a volatile fact is ordinary and may proceed.
  assert.strictEqual(
    M.decide({ action: 'retire', confidence: 0.9, volatility: 'fast', contradicts: true }),
    'auto');
});

test('the gate returns a routing name, never a boolean', () => {
  // 'parked' must not be usable as a soft no that a caller shrugs off, and it
  // is the value the audit row records.
  const d = M.decide({ action: 'add', confidence: 0.9, volatility: 'slow' });
  assert.strictEqual(typeof d, 'string');
  assert.ok(['auto', 'parked'].includes(d));
});

// --- robustness --------------------------------------------------------------

test('an unknown volatility class is refused at write time', () => {
  const { store } = newStore();
  assert.throws(() => store.born({ topic: 't', text: 'x', volatility: 'occasionally' }),
    /unknown volatility class/);
});

test('a fact with no topic is refused — topic is the retrieval key', () => {
  const { store } = newStore();
  assert.throws(() => store.born({ text: 'x', volatility: 'slow' }), /needs a topic/);
});

test('a corrupt line is skipped rather than killing every read', () => {
  const { store } = newStore();
  store.born({ topic: 'city', text: 'Pune', volatility: 'slow' });
  fs.appendFileSync(store.file, '{ this is not json\n');
  assert.strictEqual(store.current().length, 1);
});

test('operating on an unknown id throws instead of silently doing nothing', () => {
  const { store } = newStore();
  assert.throws(() => store.reaffirm('nope'), /no such fact/);
});

test('the source snapshot is hashed, so source drift is detectable at all', () => {
  const { store } = newStore();
  const a = store.born({ topic: 't', text: 'x', volatility: 'slow', source_text: 'original' });
  assert.strictEqual(a.source_hash, M.hashSource('original'));
  assert.notStrictEqual(M.hashSource('original'), M.hashSource('edited'));
});

test('a fresh store reads as empty rather than throwing', () => {
  const s = M.openStore({ file: path.join(TMP, 'never-written.jsonl'), clock: M.makeClock('2026-01-01T00:00:00.000Z') });
  assert.deepStrictEqual(s.current(), []);
  assert.deepStrictEqual(s.recall(), []);
  assert.deepStrictEqual(s.stale(), []);
});

test('the store writes nowhere until something is actually stored', () => {
  const file = path.join(TMP, 'untouched.jsonl');
  const s = M.openStore({ file, clock: M.makeClock('2026-01-01T00:00:00.000Z') });
  s.current(); s.recall(); s.stale();
  assert.ok(!fs.existsSync(file), 'reading must not create the store');
});

// --- wiring: this layer is deliberately not connected yet -------------------

test('memory.js is untouched and still owns its one consumer', () => {
  // The template says each layer must be usable on its own before the next
  // starts, and swapping scheduler.js over needs layers 4-5 (extract/classify/
  // policy, then repair) which decide what a new fact does to an old one.
  // Pinned as a test so "not wired in" is a checked claim, not a promise in a
  // commit message that quietly stops being true.
  const scheduler = fs.readFileSync(path.join(__dirname, 'scheduler.js'), 'utf8');
  assert.match(scheduler, /require\('\.\/memory\.js'\)/,
    'scheduler.js should still use the flat observer');
  assert.ok(!scheduler.includes('memory-bitemporal'),
    'wiring this in needs layers 4-5 first — see the header of memory-bitemporal.js');
});

finish();
