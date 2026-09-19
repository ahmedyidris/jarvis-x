// Every limit in config/trading.json must be enforced in code, not described.
// The previous version of these rules lived in knowledge/Guidelines.md under
// "Intended but NOT yet enforced" — this file is the difference.
//
// Fully offline: PaperBook takes prices as arguments and opens no sockets.
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

const { PaperBook, loadConfig, CONFIG } = require('./paper-trading.js');
const { STOP_FILE } = require('./guard.js');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jx-trade-')), 'journal.jsonl');

const CFG = {
  mode: 'paper', startingCapital: 10000, riskPerTrade: 0.006,
  dailyLossLimit: 0.02, maxOpenPositions: 4,
  instruments: {
    gold: { dataKey: 'energy:gold', stopLoss: 0.08 },
    btc:  { dataKey: 'crypto:btc',  stopLoss: 0.20 },
    oil:  { dataKey: 'energy:crude-oil-wti', stopLoss: 0.15 },
    eth:  { dataKey: 'crypto:eth',  stopLoss: 0.20 },
    sp500:{ dataKey: 'market:sp500', stopLoss: 0.08 },
  },
};
const book = (over = {}) => new PaperBook({
  config: { ...CFG, ...over }, journal: tmp(),
  now: over.now || (() => new Date('2026-09-04T12:00:00Z')),
});

(async () => {

// ── the shipped config is the real contract ───────────────────────────────
await test('the committed config is paper mode with exactly the six instruments', () => {
  const cfg = loadConfig(CONFIG);
  assert.strictEqual(cfg.mode, 'paper');
  assert.deepStrictEqual(Object.keys(cfg.instruments).sort(),
    ['btc', 'eth', 'gold', 'nasdaq', 'oil', 'sp500']);
});

await test('a non-paper mode is refused outright', () => {
  const f = tmp();
  fs.writeFileSync(f, JSON.stringify({ ...CFG, mode: 'live' }));
  assert.throws(() => loadConfig(f), /must be "paper"/);
});

await test('an auto executionMode is refused outright', () => {
  const f = tmp();
  fs.writeFileSync(f, JSON.stringify({ ...CFG, mode: 'paper', executionMode: 'auto' }));
  assert.throws(() => loadConfig(f), /auto execution path is unimplemented/);
});

// ── sizing derives from one risk budget ───────────────────────────────────
await test('every instrument risks the same fraction of capital', () => {
  const b = book();
  for (const s of Object.keys(CFG.instruments)) {
    const risk = b.maxPositionFraction(s) * CFG.instruments[s].stopLoss;
    assert.ok(Math.abs(risk - CFG.riskPerTrade) < 1e-12,
      `${s} risks ${risk}, expected ${CFG.riskPerTrade}`);
  }
});

await test('the volatile instrument gets the smaller position, not the bigger one', () => {
  const b = book();
  assert.ok(b.maxPositionFraction('btc') < b.maxPositionFraction('gold'),
    'btc (20% stop) must size smaller than gold (8% stop)');
  assert.ok(Math.abs(b.maxPositionFraction('gold') - 0.075) < 1e-9);
  assert.ok(Math.abs(b.maxPositionFraction('btc') - 0.03) < 1e-9);
});

// ── the allowlist ─────────────────────────────────────────────────────────
await test('an instrument outside the six is refused', () => {
  const r = book().propose({ symbol: 'DOGE', side: 'BUY', price: 1, reason: 'no' });
  assert.strictEqual(r.ok, false);
  assert.ok(/not tradeable/.test(r.reason), r.reason);
});

await test('the refusal names what IS allowed', () => {
  const r = book().propose({ symbol: 'TSLA', side: 'BUY', price: 1, reason: 'no' });
  assert.ok(/gold/.test(r.reason) && /btc/.test(r.reason), r.reason);
});

// ── proposal validation ───────────────────────────────────────────────────
await test('a trade with no written reason is refused', () => {
  assert.strictEqual(book().propose({ symbol: 'gold', side: 'BUY', price: 2000, reason: '  ' }).ok, false);
});

await test('an invalid side is refused', () => {
  assert.strictEqual(book().propose({ symbol: 'gold', side: 'HODL', price: 2000, reason: 'x' }).ok, false);
});

await test('a non-positive or non-finite price is refused', () => {
  const b = book();
  for (const p of [0, -5, NaN, Infinity, 'abc']) {
    assert.strictEqual(b.propose({ symbol: 'gold', side: 'BUY', price: p, reason: 'x' }).ok, false,
      `price ${p} should be refused`);
  }
});

await test('stop price sits below entry for BUY and above for SELL', () => {
  const b = book();
  const long = b.propose({ symbol: 'gold', side: 'BUY', price: 2000, reason: 'x' });
  const short = b.propose({ symbol: 'gold', side: 'SELL', price: 2000, reason: 'x' });
  assert.ok(Math.abs(long.stopPrice - 1840) < 1e-9, `${long.stopPrice}`);
  assert.ok(Math.abs(short.stopPrice - 2160) < 1e-9, `${short.stopPrice}`);
});

// ── position limits ───────────────────────────────────────────────────────
await test('a second position in the same instrument is refused', () => {
  const b = book();
  b.open(b.propose({ symbol: 'gold', side: 'BUY', price: 2000, reason: 'first' }));
  assert.strictEqual(b.propose({ symbol: 'gold', side: 'BUY', price: 2010, reason: 'again' }).ok, false);
});

await test('maxOpenPositions is enforced', () => {
  const b = book({ maxOpenPositions: 2 });
  b.open(b.propose({ symbol: 'gold', side: 'BUY', price: 2000, reason: 'a' }));
  b.open(b.propose({ symbol: 'btc', side: 'BUY', price: 60000, reason: 'b' }));
  const third = b.propose({ symbol: 'oil', side: 'BUY', price: 80, reason: 'c' });
  assert.strictEqual(third.ok, false);
  assert.ok(/max open positions/.test(third.reason), third.reason);
});

// ── the daily loss limit ──────────────────────────────────────────────────
await test('the daily loss limit blocks new positions once breached', () => {
  const b = book();
  // 3% capital loss on gold: cap is 2%, so this must lock out further opens.
  b.open(b.propose({ symbol: 'gold', side: 'BUY', price: 2000, reason: 'x' }));
  b.close('gold', 2000 * (1 - 0.40));           // -40% on a 7.5% position ≈ -3%
  assert.ok(b.realizedLossToday() > b.capital * CFG.dailyLossLimit, 'fixture must breach the cap');
  const next = b.propose({ symbol: 'btc', side: 'BUY', price: 60000, reason: 'y' });
  assert.strictEqual(next.ok, false);
  assert.ok(/daily loss limit/.test(next.reason), next.reason);
});

await test('the daily loss limit is per-day, not forever', () => {
  let day = '2026-09-04T12:00:00Z';
  const b = new PaperBook({ config: CFG, journal: tmp(), now: () => new Date(day) });
  b.open(b.propose({ symbol: 'gold', side: 'BUY', price: 2000, reason: 'x' }));
  b.close('gold', 2000 * (1 - 0.40));
  assert.strictEqual(b.propose({ symbol: 'btc', side: 'BUY', price: 60000, reason: 'y' }).ok, false);
  day = '2026-09-05T12:00:00Z';                  // next UTC day
  assert.strictEqual(b.propose({ symbol: 'btc', side: 'BUY', price: 60000, reason: 'y' }).ok, true);
});

// ── the kill switch ───────────────────────────────────────────────────────
await test('the kill switch blocks opening and closing', () => {
  const b = book();
  const opened = b.open(b.propose({ symbol: 'gold', side: 'BUY', price: 2000, reason: 'x' }));
  assert.ok(opened.id);
  let hadStop = fs.existsSync(STOP_FILE);
  try {
    if (!hadStop) fs.writeFileSync(STOP_FILE, 'test');
    assert.throws(() => b.open(b.propose({ symbol: 'btc', side: 'BUY', price: 60000, reason: 'y' })),
      /Kill switch/i, 'open must be blocked');
    assert.throws(() => b.close('gold', 2100), /Kill switch/i, 'close must be blocked too');
  } finally {
    if (!hadStop) fs.unlinkSync(STOP_FILE);      // never leave the repo stopped
  }
  assert.strictEqual(fs.existsSync(STOP_FILE), hadStop, 'kill-switch state must be restored');
});

// ── a stale proposal cannot sneak past ────────────────────────────────────
await test('a proposal built before the book changed is re-validated at open', () => {
  const b = book({ maxOpenPositions: 1 });
  const stale = b.propose({ symbol: 'btc', side: 'BUY', price: 60000, reason: 'built first' });
  assert.strictEqual(stale.ok, true);
  b.open(b.propose({ symbol: 'gold', side: 'BUY', price: 2000, reason: 'takes the only slot' }));
  assert.throws(() => b.open(stale), /REFUSED/, 'the stale proposal must not open');
});

// ── P&L ───────────────────────────────────────────────────────────────────
await test('P&L is signed correctly for BUY and for SELL', () => {
  const b1 = book();
  b1.open(b1.propose({ symbol: 'gold', side: 'BUY', price: 2000, reason: 'x' }));
  assert.ok(b1.close('gold', 2200).pnl > 0, 'long into a rise is a profit');

  const b2 = book();
  b2.open(b2.propose({ symbol: 'gold', side: 'SELL', price: 2000, reason: 'x' }));
  assert.ok(b2.close('gold', 2200).pnl < 0, 'short into a rise is a loss');
});

await test('closing at exactly the stop is flagged as stopped out', () => {
  const b = book();
  const p = b.open(b.propose({ symbol: 'btc', side: 'BUY', price: 60000, reason: 'x' }));
  assert.strictEqual(b.close('btc', p.stopPrice).stoppedOut, true);
});

await test('breaches() finds positions past their stop', () => {
  const b = book();
  b.open(b.propose({ symbol: 'btc', side: 'BUY', price: 60000, reason: 'x' }));
  assert.strictEqual(b.breaches({ btc: 59000 }).length, 0, '-1.7% is not a 20% stop');
  assert.strictEqual(b.breaches({ btc: 40000 }).length, 1, '-33% is past the stop');
});

await test('closing an instrument with no position is refused', () => {
  assert.throws(() => book().close('gold', 2000), /no open position/);
});

// ── the journal ───────────────────────────────────────────────────────────
await test('the journal is append-only and records both sides of a trade', () => {
  const j = tmp();
  const b = new PaperBook({ config: CFG, journal: j, now: () => new Date('2026-09-04T12:00:00Z') });
  b.open(b.propose({ symbol: 'gold', side: 'BUY', price: 2000, reason: 'entry note' }));
  b.close('gold', 2100, 'exit note');
  const lines = fs.readFileSync(j, 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].event, 'open');
  assert.strictEqual(lines[1].event, 'close');
  assert.strictEqual(lines[0].reason, 'entry note', 'the written reason is retained');
  assert.ok(typeof lines[1].pnl === 'number');
});

await test('markToMarket separates realized capital from unrealized', () => {
  const b = book();
  b.open(b.propose({ symbol: 'gold', side: 'BUY', price: 2000, reason: 'x' }));
  const m = b.markToMarket({ gold: 2200 });
  assert.strictEqual(m.capital, CFG.startingCapital, 'capital moves only on close');
  assert.ok(m.unrealized > 0);
  assert.ok(Math.abs(m.equity - (m.capital + m.unrealized)) < 1e-9);
});

finish();
})();
