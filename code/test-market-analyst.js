// The analyst's whole value is that it refuses to overclaim. These tests are
// therefore as much about what it does NOT say as what it does: no verdict may
// assert a future price, and no verdict at all is issued until enough history
// exists to have a range to speak about.
//
// Fully offline: record() takes prices as an argument, so nothing here can
// reach an exchange even if the network were up.
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

const A = require('./market-analyst.js');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jx-mkt-')), 'history.jsonl');
const NOW = new Date('2026-09-04T12:00:00Z');
const now = () => NOW;

// N observations of `symbol`, one hour apart, ending at NOW.
function rows(symbol, prices, endsAt = NOW) {
  return prices.map((price, i) => ({
    at: new Date(endsAt.getTime() - (prices.length - 1 - i) * 3600000).toISOString(),
    symbol, price,
  }));
}
// A ramp of n prices from lo to hi, so `last` lands exactly at hi.
const ramp = (lo, hi, n) => Array.from({ length: n }, (_, i) => lo + (hi - lo) * (i / (n - 1)));

(async () => {

// ── recording ─────────────────────────────────────────────────────────────
await test('record appends one line per symbol', () => {
  const f = tmp();
  assert.strictEqual(A.record({ gold: 2000, btc: 60000 }, { historyPath: f, now }), 2);
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].symbol, 'gold');
  assert.strictEqual(lines[0].price, 2000);
  assert.strictEqual(lines[0].at, NOW.toISOString());
});

await test('record is append-only across calls', () => {
  const f = tmp();
  A.record({ gold: 2000 }, { historyPath: f, now });
  A.record({ gold: 2010 }, { historyPath: f, now });
  assert.strictEqual(A.load(f).length, 2, 'the second call must not overwrite the first');
});

await test('a garbage price is dropped, not recorded as a number', () => {
  const f = tmp();
  const written = A.record(
    { gold: 2000, btc: 0, eth: -5, oil: NaN, sp500: Infinity, nasdaq: 'cheap' },
    { historyPath: f, now });
  assert.strictEqual(written, 1, 'only gold is a usable price');
  assert.deepStrictEqual(A.load(f).map(r => r.symbol), ['gold']);
});

await test('an all-garbage batch writes no file at all', () => {
  const f = tmp();
  assert.strictEqual(A.record({ gold: NaN, btc: -1 }, { historyPath: f, now }), 0);
  assert.strictEqual(fs.existsSync(f), false, 'nothing valid means nothing on disk');
});

await test('load survives a truncated or corrupt line', () => {
  const f = tmp();
  A.record({ gold: 2000 }, { historyPath: f, now });
  fs.appendFileSync(f, '{"at":"2026-09-04T11:00:00Z","symbol":"gol\n\n{}\n');
  const loaded = A.load(f);
  assert.strictEqual(loaded.length, 1, 'the good row survives, the bad ones are skipped');
});

await test('load of a missing file is empty, not an exception', () => {
  assert.deepStrictEqual(A.load(path.join(os.tmpdir(), 'jx-does-not-exist.jsonl')), []);
});

// ── windowing ─────────────────────────────────────────────────────────────
await test('series is filtered by symbol and returned oldest-first', () => {
  const data = [...rows('gold', [1, 2, 3]), ...rows('btc', [9, 9, 9])];
  const s = A.series(data.slice().reverse(), 'gold', 30, now);
  assert.deepStrictEqual(s.map(r => r.price), [1, 2, 3]);
});

await test('observations older than the window are excluded', () => {
  const old = rows('gold', ramp(100, 200, 25), new Date('2026-06-01T12:00:00Z'));
  assert.strictEqual(A.series(old, 'gold', 30, now).length, 0, '3 months back is outside a 30-day window');
  assert.strictEqual(A.stats(old, 'gold', 30, now).insufficient, true);
});

// ── the honesty floor ─────────────────────────────────────────────────────
await test(`fewer than ${A.MIN_OBSERVATIONS} observations yields no statistics`, () => {
  const st = A.stats(rows('gold', ramp(100, 200, A.MIN_OBSERVATIONS - 1)), 'gold', 30, now);
  assert.strictEqual(st.insufficient, true);
  assert.strictEqual(st.have, A.MIN_OBSERVATIONS - 1);
  assert.strictEqual(st.need, A.MIN_OBSERVATIONS);
  assert.strictEqual(st.position, undefined, 'no position may be reported without a range');
});

await test('the insufficient verdict says how short it is rather than guessing', () => {
  const sig = A.signal(rows('gold', ramp(100, 200, 3)), 'gold', { days: 30, now });
  assert.strictEqual(sig.verdict, 'insufficient');
  assert.ok(/3 of 20 observations/.test(sig.because[0]), sig.because[0]);
});

await test('exactly the minimum is enough', () => {
  const st = A.stats(rows('gold', ramp(100, 200, A.MIN_OBSERVATIONS)), 'gold', 30, now);
  assert.strictEqual(st.insufficient, false);
  assert.strictEqual(st.have, A.MIN_OBSERVATIONS);
});

// ── the arithmetic ────────────────────────────────────────────────────────
await test('min, max, last and position are the plain arithmetic of the window', () => {
  const st = A.stats(rows('gold', ramp(100, 200, 21)), 'gold', 30, now);
  assert.strictEqual(st.min, 100);
  assert.strictEqual(st.max, 200);
  assert.strictEqual(st.last, 200, 'last is the chronologically newest, not the largest');
  assert.ok(Math.abs(st.position - 1) < 1e-12);
  assert.ok(Math.abs(st.mean - 150) < 1e-12);
});

await test('last is the newest observation even when it is the lowest', () => {
  const st = A.stats(rows('gold', ramp(200, 100, 21)), 'gold', 30, now);
  assert.strictEqual(st.last, 100);
  assert.ok(Math.abs(st.position) < 1e-12);
});

await test('a perfectly flat series reports mid-range, never NaN', () => {
  const st = A.stats(rows('gold', Array(21).fill(50)), 'gold', 30, now);
  assert.strictEqual(st.position, 0.5, 'no range means no opinion, not a divide-by-zero');
  assert.strictEqual(st.volatility, 0);
  assert.ok(Number.isFinite(st.position) && Number.isFinite(st.volatility));
});

await test('volatility is relative, so gold and btc are comparable', () => {
  const steady = A.stats(rows('gold', ramp(1980, 2020, 21)), 'gold', 30, now);
  const wild = A.stats(rows('btc', ramp(40000, 80000, 21)), 'btc', 30, now);
  assert.ok(wild.volatility > steady.volatility,
    `btc ${wild.volatility} should exceed gold ${steady.volatility}`);
});

// ── verdicts ──────────────────────────────────────────────────────────────
await test('a price at the bottom of its recorded range reads near-low', () => {
  const sig = A.signal(rows('gold', ramp(200, 100, 21)), 'gold', { days: 30, now });
  assert.strictEqual(sig.verdict, 'near-low');
});

await test('a price at the top of its recorded range reads near-high', () => {
  const sig = A.signal(rows('gold', ramp(100, 200, 21)), 'gold', { days: 30, now });
  assert.strictEqual(sig.verdict, 'near-high');
});

await test('a price in the middle reads hold', () => {
  const prices = [...ramp(100, 200, 20), 150];
  const sig = A.signal(rows('gold', prices), 'gold', { days: 30, now });
  assert.strictEqual(sig.verdict, 'hold');
});

await test('the band edges are inclusive on both sides', () => {
  const lo = A.signal(rows('gold', [...ramp(100, 200, 20), 120]), 'gold', { days: 30, now });
  const hi = A.signal(rows('gold', [...ramp(100, 200, 20), 180]), 'gold', { days: 30, now });
  assert.strictEqual(lo.verdict, 'near-low', 'position 0.20 is at the LOW_BAND edge');
  assert.strictEqual(hi.verdict, 'near-high', 'position 0.80 is at the HIGH_BAND edge');
});

await test('every verdict shows the arithmetic behind it', () => {
  const sig = A.signal(rows('gold', ramp(100, 200, 21)), 'gold', { days: 30, now });
  assert.ok(sig.because.some(b => /100\.00–200\.00/.test(b)), JSON.stringify(sig.because));
  assert.ok(sig.because.some(b => /21 observations/.test(b)), JSON.stringify(sig.because));
});

await test('no verdict is ever a claim about the future', () => {
  const cases = [
    rows('gold', ramp(100, 200, 21)),
    rows('gold', ramp(200, 100, 21)),
    rows('gold', Array(21).fill(50)),
    rows('gold', ramp(100, 200, 4)),
  ];
  const allowed = new Set(['insufficient', 'near-low', 'near-high', 'hold']);
  for (const data of cases) {
    const sig = A.signal(data, 'gold', { days: 30, now });
    assert.ok(allowed.has(sig.verdict), `unexpected verdict ${sig.verdict}`);
    assert.ok(!/\b(will|expect|forecast|predict|target)\b/i.test(sig.because.join(' ')),
      `forward-looking language in: ${sig.because.join(' ')}`);
  }
});

await test('a decided verdict carries the not-a-forecast caveat with it', () => {
  const sig = A.signal(rows('gold', ramp(100, 200, 21)), 'gold', { days: 30, now });
  assert.ok(sig.because.some(b => /not the future/.test(b)),
    'the caveat must travel with the verdict, not sit only in the report footer');
});

// ── the report ────────────────────────────────────────────────────────────
await test('the report covers exactly the six instruments in the shipped config', () => {
  const r = A.report([], { days: 30, now });
  assert.deepStrictEqual(r.map(s => s.symbol).sort(),
    ['btc', 'eth', 'gold', 'nasdaq', 'oil', 'sp500']);
});

await test('an empty history reports six insufficients, not six holds', () => {
  const r = A.report([], { days: 30, now });
  assert.strictEqual(r.filter(s => s.verdict === 'insufficient').length, 6);
});

await test('format states how many instruments it can actually judge', () => {
  const out = A.format(A.report(rows('gold', ramp(100, 200, 21)), { days: 30, now }));
  assert.ok(/1 of 6 instruments have enough history/.test(out), out);
  assert.ok(/not forecasts/.test(out), 'the footer must disclaim forecasting');
  assert.ok(/none of them opens a position/.test(out), 'and must disclaim execution');
});

// ── the boundary this module must not cross ───────────────────────────────
await test('the analyst has no path to the network and none to a position', () => {
  const src = fs.readFileSync(path.join(__dirname, 'market-analyst.js'), 'utf8');
  for (const forbidden of ["require('http", 'require("http', 'fetch(', 'XMLHttpRequest']) {
    assert.ok(!src.includes(forbidden), `market-analyst.js must not contain ${forbidden}`);
  }
  assert.ok(!/require\(['"]\.\/paper-trading/.test(src),
    'the analyst must not be able to open a trade; a human routes its output');
  assert.strictEqual(typeof A.record, 'function');
  assert.strictEqual(A.open, undefined);
  assert.strictEqual(A.trade, undefined);
});

finish();
})();
