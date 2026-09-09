// PHASE 1's measurement layer — PLAN_5 §6.1.
//
// This report is the input to a REAL-MONEY decision, so the assertions that
// matter are the ones stopping it from flattering itself. Each maps to a named
// rule in the module header:
//
//   1. seven trades is not a win rate    -> `insufficient-evidence` is the
//                                           default and the hardest to escape
//   2. realized-only flatters a book     -> open exposure is never netted in
//      that never closes losers
//   3. a profit inside the noise         -> expectancy is reported beside its
//                                           dispersion, and caveated when swamped
//   4. zero stop-outs = untested risk    -> caveated, and a caveat NEVER
//      model, not a working one             upgrades the verdict
//   5. an unstated window is a           -> the window is in the report
//      cherry-pick
//
// And the one that outranks all five: the strongest verdict is `promising`.
// There is no 'ready' or 'approved' value, because authorising real money is
// a CONSTITUTION.md §IV amendment only Ahmed can make. A test below asserts
// that no such value can come out of this module at all.
//
// Offline: every case passes journal rows and prices as arguments; nothing
// reads logs/trading-journal.jsonl.
const { test, finish, assert } = require('./test-helper.js');
const P = require('./trading-performance.js');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

const DAY = 86400000;
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const at = (d) => new Date(T0 + d * DAY).toISOString();

/** One opened-and-closed trade, `pnl` realized on day `close`. */
function closedTrade(id, pnl, { openDay = 0, closeDay = 1, symbol = 'btc', stoppedOut = false } = {}) {
  const base = {
    id, symbol, side: 'BUY', price: 100, quantity: 1, stopPrice: 80,
    openedAt: at(openDay), reason: 'test',
  };
  return [
    { event: 'open', ...base },
    { event: 'close', ...base, closePrice: 100 + pnl, closedAt: at(closeDay), pnl, stoppedOut },
  ];
}

function openTrade(id, { symbol = 'eth', price = 100, quantity = 1, side = 'BUY', openDay = 0 } = {}) {
  return [{ event: 'open', id, symbol, side, price, quantity, stopPrice: 80, openedAt: at(openDay), reason: 'test' }];
}

/** A run that clears every evidence bar: 40 trades over 60 days, net positive. */
function goodRun({ stoppedOut = 3 } = {}) {
  const rows = [];
  let stopsLeft = stoppedOut;
  for (let i = 0; i < 40; i++) {
    // 24 wins of +30, 16 losses of -20 => +400 net, and a real dispersion.
    const pnl = i % 5 < 3 ? 30 : -20;
    // Count DOWN over losing trades. An earlier version marked `i < stoppedOut`,
    // and every one of those indices is a winner -- so the fixture claimed
    // stop-outs and produced none, and the test that checks the stop-out path
    // was passing without exercising it.
    const stopped = pnl < 0 && stopsLeft > 0;
    if (stopped) stopsLeft--;
    rows.push(...closedTrade(`t${i}`, pnl, { openDay: i, closeDay: i + 1.5, stoppedOut: stopped }));
  }
  return rows;
}

(async () => {

// --- rule 1: the default is "not enough evidence" --------------------------

await test('an empty journal is insufficient evidence, never a clean result', () => {
  const r = P.measure([]);
  assert.strictEqual(r.verdict, 'insufficient-evidence');
  assert.strictEqual(r.counts.closed, 0);
  assert.strictEqual(r.realized.winRate, null, 'a win rate over zero trades must be null, not 0 or 1');
});

await test('seven trades at 71% is STILL insufficient evidence', () => {
  // The headline case. Five wins out of seven is a number a spreadsheet will
  // happily print as 71.4% and it means nothing.
  const rows = [];
  for (let i = 0; i < 7; i++) rows.push(...closedTrade(`t${i}`, i < 5 ? 50 : -50, { openDay: i, closeDay: i + 1 }));
  const r = P.measure(rows);
  assert.strictEqual(r.realized.winRate, 0.7143, 'the number is still computed and shown');
  assert.strictEqual(r.verdict, 'insufficient-evidence', 'but it must not be believed');
  assert.ok(r.why.some((w) => /only 7 closed trade/.test(w)), `why should name the bar: ${r.why}`);
});

await test('enough trades in too short a window is still insufficient', () => {
  // 40 trades in two days is one market condition sampled 40 times.
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(...closedTrade(`t${i}`, 30, { openDay: 0, closeDay: 2 }));
  const r = P.measure(rows);
  assert.strictEqual(r.verdict, 'insufficient-evidence');
  assert.ok(r.why.some((w) => /day\(s\)/.test(w) && /market condition/.test(w)));
});

await test('a run clearing every bar and making money is promising', () => {
  const r = P.measure(goodRun());
  assert.strictEqual(r.verdict, 'promising');
  assert.deepStrictEqual(r.why.length, 1);
  assert.ok(r.realized.pnl > 0);
});

await test('a run clearing every bar and losing money is unprofitable, not insufficient', () => {
  // Distinct answers: this run HAS the evidence, and the evidence is bad.
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(...closedTrade(`t${i}`, i % 5 < 3 ? 10 : -40, { openDay: i, closeDay: i + 1.5 }));
  const r = P.measure(rows);
  assert.strictEqual(r.verdict, 'unprofitable');
  assert.ok(r.realized.pnl < 0);
});

await test('a break-even run is NOT promising — zero is not a profit', () => {
  // Every bar cleared, realized exactly 0. The boundary that separates
  // `unprofitable` from `promising` has to sit on the correct side of zero.
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(...closedTrade(`t${i}`, i % 2 ? 25 : -25, { openDay: i, closeDay: i + 1.5 }));
  const r = P.measure(rows);
  assert.strictEqual(r.realized.pnl, 0);
  assert.strictEqual(r.verdict, 'unprofitable');
});

await test('exactly at the bars is enough — they are floors, not gaps', () => {
  const rows = [];
  for (let i = 0; i < P.EVIDENCE.minClosed; i++) {
    rows.push(...closedTrade(`t${i}`, 20, { openDay: i, closeDay: i + 1 }));
  }
  const r = P.measure(rows);
  assert.strictEqual(r.counts.closed, P.EVIDENCE.minClosed);
  assert.ok(r.window.days >= P.EVIDENCE.minDays);
  assert.strictEqual(r.verdict, 'promising');
});

// --- rule 2: open positions never flatter the headline ---------------------

await test('unrealized P&L is never netted into realized', () => {
  const rows = [...goodRun(), ...openTrade('o1', { price: 100 })];
  const alone = P.measure(goodRun()).realized.pnl;
  const r = P.measure(rows, { prices: { eth: 40 } });      // a -60 open loser
  assert.strictEqual(r.unrealized.pnl, -60);
  // EXACT, not `> 0`: netting -60 into +400 still leaves 340, which a
  // greater-than check waves through. The figure must not move at all.
  assert.strictEqual(r.realized.pnl, alone,
    'realized must be identical with and without an open position');
  assert.ok(!('unrealized' in r.realized), 'the two must not merge');
});

await test('a book whose open exposure dwarfs realized cannot be judged', () => {
  // The "hold every loser, bank every winner" shape: lovely realized curve,
  // portfolio full of wreckage.
  const rows = [...goodRun(), ...openTrade('o1', { price: 1000, quantity: 10 })];
  const r = P.measure(rows, { prices: { eth: 900 } });     // -1000 unrealized vs +400 realized
  assert.strictEqual(r.verdict, 'insufficient-evidence');
  assert.ok(r.why.some((w) => /open exposure/.test(w)), `why: ${r.why}`);
});

await test('an open position with no price makes the book unvaluable, and says so', () => {
  const r = P.measure([...goodRun(), ...openTrade('o1')], { prices: {} });
  assert.strictEqual(r.unrealized.unpriced, 1);
  assert.strictEqual(r.verdict, 'insufficient-evidence');
  assert.ok(r.why.some((w) => /no price/.test(w)));
});

await test('a SELL position marks to market in the right direction', () => {
  const rows = openTrade('o1', { side: 'SELL', price: 100, quantity: 2 });
  const { pnl } = P.markToMarket(P.reconstruct(rows).open, { eth: 90 });
  assert.strictEqual(pnl, 20, 'a short gains when the price falls');
});

// --- rule 3 and 4: caveats that never upgrade a verdict ---------------------

await test('zero stop-outs is caveated as an UNVALIDATED risk model', () => {
  const r = P.measure(goodRun({ stoppedOut: 0 }));
  assert.ok(r.caveats.some((c) => /UNVALIDATED/.test(c)),
    'position sizing is derived from the stop distance; an unhit stop means untested');
  assert.strictEqual(r.verdict, 'promising', 'a caveat annotates, it does not decide');
});

await test('a stopped-out run drops that caveat', () => {
  const r = P.measure(goodRun({ stoppedOut: 3 }));
  assert.strictEqual(r.counts.stoppedOut, 3);
  assert.ok(!r.caveats.some((c) => /UNVALIDATED/.test(c)));
});

await test('an edge smaller than its own dispersion is caveated as noise', () => {
  // +10/-9 alternating: reliably positive, and utterly inside the variance.
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(...closedTrade(`t${i}`, i % 2 ? 10 : -9, { openDay: i, closeDay: i + 1 }));
  const r = P.measure(rows);
  assert.ok(r.realized.pnl > 0);
  assert.ok(r.caveats.some((c) => /inside the noise/.test(c)), `caveats: ${r.caveats}`);
  assert.ok(r.realized.dispersion > Math.abs(r.realized.expectancy));
});

await test('a caveat can never turn insufficient evidence into a verdict', () => {
  const r = P.measure([...closedTrade('t1', 100)]);
  assert.strictEqual(r.verdict, 'insufficient-evidence');
  assert.ok(r.caveats.length > 0, 'it should still caveat');
});

// --- the ceiling: this module cannot authorise anything --------------------

await test('there is no verdict stronger than "promising"', () => {
  // Authorising real money is a CONSTITUTION.md §IV amendment. A report that
  // could print its own approval would be doing Ahmed's job for him.
  assert.deepStrictEqual(P.VERDICTS, ['insufficient-evidence', 'unprofitable', 'promising']);
  for (const bad of ['ready', 'approved', 'go', 'live', 'authorised']) {
    assert.ok(!P.VERDICTS.includes(bad), `${bad} must not be a reachable verdict`);
  }
  const r = P.measure(goodRun());
  assert.ok(P.VERDICTS.includes(r.verdict));
});

await test('the formatted report always says promising is not authorisation', () => {
  const text = P.format(P.measure(goodRun()));
  assert.match(text, /PROMISING/);
  assert.match(text, /not\s+authorisation/, 'the disclaimer wraps across lines in the report');
  assert.match(text, /CONSTITUTION\.md §IV/);
});

await test('the report always states its window', () => {
  const text = P.format(P.measure(goodRun()));
  assert.match(text, /window/);
  assert.match(text, /2026-01-01/);
});

// --- reconstruction --------------------------------------------------------

await test('a replayed journal line does not become a second trade', () => {
  // Counting one close twice doubles its contribution to every statistic
  // below it — the quietest way this report could be wrong.
  const one = closedTrade('t1', 100);
  const r = P.measure([...one, ...one, ...one]);
  assert.strictEqual(r.counts.closed, 1);
  assert.strictEqual(r.realized.pnl, 100, 'not 300');

  // A duplicate that CONTRADICTS the original: the first close is the truth,
  // because this journal is append-only and a later line disagreeing with a
  // recorded outcome is suspect, not a correction. Identical duplicates cannot
  // tell "keep first" from "keep last" apart — a Map dedupes either way.
  const contradicting = closedTrade('t1', -500);
  const r2 = P.measure([...one, ...contradicting]);
  assert.strictEqual(r2.realized.pnl, 100, 'the first recorded close wins');
  assert.ok(r.counts.duplicatesIgnored > 0);
  assert.ok(r.caveats.some((c) => /duplicate journal line/.test(c)));
});

await test('an open with no matching close is an open position, not a closed one', () => {
  const { closed, open } = P.reconstruct([...closedTrade('t1', 10), ...openTrade('o1')]);
  assert.strictEqual(closed.length, 1);
  assert.strictEqual(open.length, 1);
  assert.strictEqual(open[0].id, 'o1');
});

await test('closed trades are ordered by close time regardless of journal order', () => {
  const rows = [
    ...closedTrade('late', 10, { openDay: 5, closeDay: 9 }),
    ...closedTrade('early', 20, { openDay: 0, closeDay: 1 }),
  ];
  assert.deepStrictEqual(P.reconstruct(rows).closed.map((t) => t.id), ['early', 'late']);
});

await test('a corrupt journal line is skipped, not fatal', () => {
  const rows = P.reconstruct([null, { no: 'id' }, ...closedTrade('t1', 5)]);
  assert.strictEqual(rows.closed.length, 1);
});

// --- statistics ------------------------------------------------------------

await test('max drawdown measures the worst peak-to-trough, not the final result', () => {
  // Ends up +10, but fell 100 on the way. Those are different propositions
  // when the next step is risking real money.
  const closed = [{ pnl: 50 }, { pnl: -100 }, { pnl: 60 }];
  assert.strictEqual(P.maxDrawdown(closed, 1000), 100);
  // A monotonically rising curve has no drawdown at all.
  assert.strictEqual(P.maxDrawdown([{ pnl: 10 }, { pnl: 10 }], 1000), 0);
});

await test('drawdown is measured from the running peak, not from the start', () => {
  const closed = [{ pnl: 500 }, { pnl: -200 }];
  assert.strictEqual(P.maxDrawdown(closed, 1000), 200, 'equity never went below its start, but it fell 200');
});

await test('dispersion is zero for one trade and real for many', () => {
  assert.strictEqual(P.stdev([5]), 0);
  assert.strictEqual(P.stdev([]), 0);
  assert.ok(P.stdev([10, -10]) > 0);
});

await test('win rate excludes break-even trades from the win count', () => {
  const rows = [...closedTrade('a', 10), ...closedTrade('b', -10), ...closedTrade('c', 0)];
  const r = P.measure(rows);
  assert.strictEqual(r.counts.wins, 1);
  assert.strictEqual(r.counts.losses, 1);
  assert.strictEqual(r.counts.breakEven, 1);
});

await test('a non-numeric pnl is excluded rather than coerced to zero', () => {
  const bad = closedTrade('t1', 10);
  bad[1].pnl = 'lots';
  const r = P.measure([...bad, ...closedTrade('t2', 20)]);
  assert.strictEqual(r.realized.pnl, 20);
  // The sum alone cannot catch this: a corrupt pnl coerced to 0 adds 0. It
  // shows up as a phantom break-even trade padding the win-rate denominator.
  assert.strictEqual(r.counts.breakEven, 0, 'a corrupt pnl is not a break-even trade');
  assert.strictEqual(r.realized.winRate, 1, 'the one real trade won; the corrupt row must not dilute it');
});

// --- it reads, and only reads ----------------------------------------------

await test('the module imports nothing that could place an order', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('./trading-performance.js'), 'utf8');
  // Match a REQUIRE, not a mention: the header names code/paper-trading.js in
  // prose to say what this module is not, and a substring check flags its own
  // documentation.
  const requires = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(requires.sort(), ['fs', 'path'],
    `a read-only report may import only fs and path; got ${requires}`);
  for (const forbidden of ['fetch(', 'axios', 'http.request', 'https.request', '.open(', '.close(']) {
    assert.ok(!src.includes(forbidden),
      `trading-performance.js must stay read-only; found "${forbidden}"`);
  }
});

finish();
})();
