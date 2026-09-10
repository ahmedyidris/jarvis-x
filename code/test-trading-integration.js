// PaperBook WRITES the journal; trading-performance READS it.
//
// Those two modules were written months apart and have never met. Every test
// in code/test-trading-performance.js feeds it a journal I built by hand from
// reading paper-trading.js — which verifies the arithmetic and proves nothing
// at all about whether the two agree on field names. If `pnl` were `profit`,
// or `closedAt` were `closed_at`, the measurement would read undefined,
// silently report zeros, and return `insufficient-evidence` for the rest of
// time. It would look exactly like an empty journal, which is the state it
// legitimately reports today.
//
// That is the same class of bug code/test-memory-integration.js just found one
// system over: two modules each correct about their own contract, wrong about
// the seam. So this drives a REAL PaperBook through real opens and closes and
// measures what it actually wrote.
//
// Offline: PaperBook takes prices as arguments and opens no sockets
// (CONSTITUTION.md §IV, DECISION_RECORD_paper-trading.md), and test-helper
// redirects the audit log. Nothing here touches logs/trading-journal.jsonl.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const { PaperBook, loadConfig } = require('./paper-trading.js');
const P = require('./trading-performance.js');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-tradeint-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

let seq = 0;
/** A real book writing to a real (temp) journal, on an injected clock. */
function freshBook(startISO = '2026-01-01T00:00:00.000Z') {
  let t = Date.parse(startISO);
  const journal = path.join(TMP, `j-${seq++}.jsonl`);
  const book = new PaperBook({ config: loadConfig(), journal, now: () => new Date(t) });
  return { book, journal, advanceDays: (d) => { t += d * 86400000; }, read: () => rows(journal) };
}

const rows = (j) => (fs.existsSync(j)
  ? fs.readFileSync(j, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : []);

/** Open and close one position at real prices, through the real book. */
function trade(ctx, symbol, open, close, days = 2) {
  const p = ctx.book.propose({ symbol, side: 'BUY', price: open, reason: 'integration fixture' });
  assert.ok(p.ok, `the book refused a fixture trade: ${p.reason}`);
  ctx.book.open(p);
  ctx.advanceDays(days);
  return ctx.book.close(symbol, close);
}

(async () => {

// --- the seam ---------------------------------------------------------------

await test('the reader understands every field the writer actually emits', () => {
  const ctx = freshBook();
  const closed = trade(ctx, 'btc', 100, 130);

  const journal = ctx.read();
  assert.strictEqual(journal.length, 2, 'one open row and one close row');

  const report = P.measure(journal, { startingCapital: loadConfig().startingCapital });
  assert.strictEqual(report.counts.closed, 1, 'the close row must be recognised as a closed trade');
  assert.strictEqual(report.counts.open, 0, 'and must NOT also count as still open');
  assert.strictEqual(report.counts.wins, 1);

  // The numbers must match what the book itself computed, not merely be
  // non-zero: reading the wrong field would give 0, and 0 is a plausible pnl.
  assert.strictEqual(report.realized.pnl, P.round(closed.pnl));
  assert.ok(closed.pnl > 0, 'the fixture should be a winner, or this asserts nothing');
});

await test('an open position is seen as open and marked to market at the right price', () => {
  const ctx = freshBook();
  const p = ctx.book.propose({ symbol: 'eth', side: 'BUY', price: 100, reason: 'still open' });
  ctx.book.open(p);

  const report = P.measure(ctx.read(), { prices: { eth: 120 } });
  assert.strictEqual(report.counts.open, 1);
  assert.strictEqual(report.counts.closed, 0);
  assert.strictEqual(report.unrealized.priced, 1, 'the symbol on the row must match the price key');
  // quantity comes from the book's own risk-derived sizing, so compute the
  // expectation from the row rather than assuming a quantity of 1.
  const openRow = ctx.read().find((r) => r.event === 'open');
  assert.strictEqual(report.unrealized.pnl, P.round((120 - 100) * openRow.quantity));
});

await test('a stopped-out close is recognised as stopped out', () => {
  // If this field name drifted, every run would report zero stop-outs and the
  // "risk model UNVALIDATED" caveat would fire forever on a book that was in
  // fact hitting its stops constantly — the caveat inverted.
  const ctx = freshBook();
  const cfg = loadConfig();
  const stopFraction = cfg.instruments.btc.stopLoss;
  const closed = trade(ctx, 'btc', 100, 100 * (1 - stopFraction) - 1);   // through the stop
  assert.strictEqual(closed.stoppedOut, true, 'the book should call this a stop-out');

  const report = P.measure(ctx.read(), { startingCapital: cfg.startingCapital });
  assert.strictEqual(report.counts.stoppedOut, 1, 'and the reader must agree');
  assert.ok(!report.caveats.some((c) => /UNVALIDATED/.test(c)),
    'a book that hit its stop must not be caveated as having an untested risk model');
});

await test('the window comes from the book\'s own timestamps', () => {
  const ctx = freshBook('2026-03-01T00:00:00.000Z');
  trade(ctx, 'btc', 100, 110, 10);
  const report = P.measure(ctx.read());
  assert.ok(report.window.from.startsWith('2026-03-01'), `from: ${report.window.from}`);
  assert.strictEqual(report.window.days, 10, 'openedAt and closedAt must both parse');
});

await test('several real trades measure to the book\'s own realized total', () => {
  const ctx = freshBook();
  const cfg = loadConfig();
  let expected = 0;
  // Four instruments so the book's maxOpenPositions (4) is respected and each
  // is opened and closed in turn.
  for (const [symbol, open, close] of [['btc', 100, 130], ['eth', 200, 180],
                                       ['gold', 50, 55], ['oil', 80, 70]]) {
    expected += trade(ctx, symbol, open, close).pnl;
  }
  const report = P.measure(ctx.read(), { startingCapital: cfg.startingCapital });
  assert.strictEqual(report.counts.closed, 4);
  assert.strictEqual(report.realized.pnl, P.round(expected));
  assert.strictEqual(report.counts.wins + report.counts.losses, 4);
  // Still not enough to conclude anything, and it must say so.
  assert.strictEqual(report.verdict, 'insufficient-evidence');
});

await test('a real journal never produces a phantom duplicate', () => {
  // reconstruct() dedupes by (event, id). If PaperBook ever reused an id
  // across trades, two distinct trades would silently collapse into one.
  const ctx = freshBook();
  trade(ctx, 'btc', 100, 110);
  trade(ctx, 'eth', 100, 90);
  const report = P.measure(ctx.read());
  assert.strictEqual(report.counts.closed, 2, 'two trades must not collapse into one');
  assert.strictEqual(report.counts.duplicatesIgnored, 0, 'and neither is a duplicate');
});

// --- the constitutional invariant, end to end ---------------------------------

await test('nothing in this pipeline can reach a broker', () => {
  // CONSTITUTION.md §IV forbids real-money trading absolutely.
  // DECISION_RECORD_paper-trading.md records that paper-trading.js takes
  // prices as arguments and makes no network calls, so no code path exists to
  // disable. Asserted here across BOTH modules, since a reader that fetched
  // live prices would reintroduce one at the other end of the seam.
  const strip = (f) => fs.readFileSync(require.resolve(f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const mod of ['./paper-trading.js', './trading-performance.js']) {
    const code = strip(mod);
    for (const forbidden of ['fetch(', 'axios', 'http.request', 'https.request', 'net.connect']) {
      assert.ok(!code.includes(forbidden), `${mod} must open no socket; found "${forbidden}"`);
    }
  }
});

await test('the measurement still cannot authorise anything, on real data', () => {
  const ctx = freshBook();
  trade(ctx, 'btc', 100, 200);
  const report = P.measure(ctx.read());
  assert.ok(P.VERDICTS.includes(report.verdict));
  assert.notStrictEqual(report.verdict, 'promising', 'one trade is not evidence');
  // \s+ because the disclaimer wraps across lines in the rendered report —
  // the same trip-up as in code/test-trading-performance.js.
  assert.match(P.format(report), /not\s+authorisation/);
});

finish();
})();
