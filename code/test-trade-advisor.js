// The advisor's contract is negative as much as positive: it must recommend
// sensibly, and it must never act. The last test in this file is the important
// one -- it hands advise() a book that throws if open() or close() is touched.
//
// Fully offline: history and prices are both arguments.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
// FUSE. A hung await drains the event loop and exits 0 having printed no
// tally -- a vacuous pass that reads as green, and the exact shape sweep.js
// exists to catch. finish() calls process.exit() explicitly, so this default
// only survives when finish() was never reached. Found by mutation-testing
// code/status.js; see code/test-status.js for the full account.
process.exitCode = 1;

const { advise, format, KINDS } = require('./trade-advisor.js');
const { PaperBook } = require('./paper-trading.js');
const { MIN_OBSERVATIONS } = require('./market-analyst.js');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jx-adv-')), 'journal.jsonl');
const NOW = new Date('2026-09-04T12:00:00Z');
const now = () => NOW;

function rows(symbol, prices) {
  return prices.map((price, i) => ({
    at: new Date(NOW.getTime() - (prices.length - 1 - i) * 3600000).toISOString(),
    symbol, price,
  }));
}
const ramp = (lo, hi, n) => Array.from({ length: n }, (_, i) => lo + (hi - lo) * (i / (n - 1)));
const N = MIN_OBSERVATIONS + 1;

const book = (over = {}) => new PaperBook({ journal: tmp(), now, ...over });
const pick = (recs, symbol) => recs.find(r => r.symbol === symbol);

// btc history that ends near the BOTTOM of its range, and one that ends near the top.
const LOW = rows('btc', ramp(80000, 40000, N));
const HIGH = rows('btc', ramp(40000, 80000, N));

(async () => {

// ── the positive half ─────────────────────────────────────────────────────
await test('a price near the bottom of the recorded range yields an OPEN proposal', () => {
  const r = pick(advise({ book: book(), rows: LOW, prices: { btc: 40000 }, now }), 'btc');
  assert.strictEqual(r.kind, 'OPEN');
  assert.strictEqual(r.proposal.side, 'BUY');
  assert.strictEqual(r.proposal.ok, true);
});

await test('the proposal carries the book\'s sizing, not the advisor\'s own', () => {
  const b = book();
  const r = pick(advise({ book: b, rows: LOW, prices: { btc: 40000 }, now }), 'btc');
  assert.ok(Math.abs(r.proposal.positionFraction - b.maxPositionFraction('btc')) < 1e-12);
  assert.ok(Math.abs(r.proposal.riskIfStopped - b.capital * 0.006) < 1e-6,
    'risk on any recommended trade is the configured riskPerTrade');
});

await test('the written reason on the proposal is the analyst\'s arithmetic', () => {
  const r = pick(advise({ book: book(), rows: LOW, prices: { btc: 40000 }, now }), 'btc');
  assert.ok(/range/.test(r.proposal.reason), r.proposal.reason);
  assert.ok(/not the future/.test(r.proposal.reason),
    'the caveat must survive into the trade journal, not just the console');
});

await test('a price near the top with no position is a WAIT, not a short', () => {
  const r = pick(advise({ book: book(), rows: HIGH, prices: { btc: 80000 }, now }), 'btc');
  assert.strictEqual(r.kind, 'WAIT');
});

await test('a held long near the top of the range is a CLOSE', () => {
  const b = book();
  b.open(b.propose({ symbol: 'btc', side: 'BUY', price: 45000, reason: 'entered low' }));
  const r = pick(advise({ book: b, rows: HIGH, prices: { btc: 80000 }, now }), 'btc');
  assert.strictEqual(r.kind, 'CLOSE');
});

await test('a held position mid-range is a HOLD', () => {
  const b = book();
  b.open(b.propose({ symbol: 'btc', side: 'BUY', price: 45000, reason: 'entered' }));
  const mid = rows('btc', [...ramp(40000, 80000, N - 1), 60000]);
  assert.strictEqual(pick(advise({ book: b, rows: mid, prices: { btc: 60000 }, now }), 'btc').kind, 'HOLD');
});

await test('a breached stop is a CLOSE even when the range says otherwise', () => {
  const b = book();
  b.open(b.propose({ symbol: 'btc', side: 'BUY', price: 80000, reason: 'entered high' }));
  // 40000 is -50% on a 20% stop: breached. It is also the range LOW.
  const r = pick(advise({ book: b, rows: LOW, prices: { btc: 40000 }, now }), 'btc');
  assert.strictEqual(r.kind, 'CLOSE', 'the agreed stop outranks the "looks cheap" reading');
  assert.ok(/past the agreed stop/.test(r.because[0]), r.because[0]);
});

// ── the honesty floor carries through ─────────────────────────────────────
await test('with no history every instrument is WAIT, never OPEN', () => {
  const recs = advise({ book: book(), rows: [], prices: { btc: 40000, gold: 2000 }, now });
  assert.strictEqual(recs.length, 6);
  assert.ok(recs.every(r => r.kind === 'WAIT'), JSON.stringify(recs.map(r => r.kind)));
  assert.ok(/observations/.test(pick(recs, 'btc').because[0]));
});

await test('an instrument with history but no current price is WAIT', () => {
  const r = pick(advise({ book: book(), rows: LOW, prices: {}, now }), 'btc');
  assert.strictEqual(r.kind, 'WAIT');
  assert.ok(/no current price/.test(r.because[0]), r.because[0]);
});

// ── the book's limits are the advisor's limits ────────────────────────────
await test('when the book refuses, the recommendation is BLOCKED with its reason', () => {
  const b = new PaperBook({
    journal: tmp(), now,
    config: { ...require('./paper-trading.js').loadConfig(), maxOpenPositions: 1 },
  });
  b.open(b.propose({ symbol: 'gold', side: 'BUY', price: 2000, reason: 'takes the slot' }));
  const r = pick(advise({ book: b, rows: LOW, prices: { btc: 40000 }, now }), 'btc');
  assert.strictEqual(r.kind, 'BLOCKED');
  assert.ok(/max open positions/.test(r.because[0]), r.because[0]);
});

await test('a daily-loss lockout blocks recommendations too', () => {
  const b = book();
  b.open(b.propose({ symbol: 'gold', side: 'BUY', price: 2000, reason: 'x' }));
  b.close('gold', 2000 * (1 - 0.40));
  const r = pick(advise({ book: b, rows: LOW, prices: { btc: 40000 }, now }), 'btc');
  assert.strictEqual(r.kind, 'BLOCKED');
  assert.ok(/daily loss limit/.test(r.because[0]), r.because[0]);
});

await test('every recommendation kind is one of the declared five', () => {
  const recs = advise({ book: book(), rows: LOW, prices: { btc: 40000, eth: 3000 }, now });
  assert.ok(recs.every(r => KINDS.includes(r.kind)));
});

// ── the line it must not cross ────────────────────────────────────────────
await test('advise() never executes a trade', () => {
  const b = book();
  b.open(b.propose({ symbol: 'btc', side: 'BUY', price: 45000, reason: 'entered' }));
  const tripwire = new Proxy(b, {
    get(target, prop, recv) {
      if (prop === 'open' || prop === 'close') {
        return () => { throw new Error(`advisor called book.${String(prop)}() — it must not`); };
      }
      const v = Reflect.get(target, prop, recv);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  // Every branch: breached stop, near-high exit, near-low entry.
  for (const [data, price] of [[LOW, 40000], [HIGH, 80000], [rows('btc', ramp(40000, 80000, N)), 60000]]) {
    assert.doesNotThrow(() => advise({ book: tripwire, rows: data, prices: { btc: price }, now }));
  }
});

await test('the advisor holds no import of its own to the trade book', () => {
  const src = fs.readFileSync(path.join(__dirname, 'trade-advisor.js'), 'utf8');
  assert.ok(!/require\(['"]\.\/paper-trading/.test(src),
    'the book is passed in, so the advisor cannot construct one and act on it');
});

await test('the printed output says up front that nothing has been executed', () => {
  const out = format(advise({ book: book(), rows: LOW, prices: { btc: 40000 }, now }));
  assert.ok(/NOTHING BELOW HAS BEEN EXECUTED/.test(out), out);
  assert.ok(/needs your approval/.test(out), out);
});

finish();
})();
