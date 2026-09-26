// The parser is the whole risk surface here. Stooq answers an unknown symbol
// with a row of "N/D" and HTTP 200 -- a bad symbol arrives looking exactly
// like a good one, and Number('N/D') is NaN. A naive parse would put NaN in
// logs/market-history.jsonl, where it would poison the min/max of every
// subsequent range silently. Most of this file is that one failure mode.
//
// Fully offline: getText is injected, so no test here opens a socket.
const fs = require('fs');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
// FUSE. A hung await drains the event loop and exits 0 having printed no
// tally -- a vacuous pass that reads as green, and the exact shape sweep.js
// exists to catch. finish() calls process.exit() explicitly, so this default
// only survives when finish() was never reached. Found by mutation-testing
// code/status.js; see code/test-status.js for the full account.
process.exitCode = 1;

const StooqProvider = require('./providers/stooq-provider.js');
const { parseQuote } = StooqProvider;

const HEAD = 'Symbol,Date,Time,Open,High,Low,Close';
const csv = (row) => `${HEAD}\n${row}\n`;
const GOOD = csv('XAUUSD,2026-09-04,01:55:12,3305.10,3312.40,3299.80,3308.75');

const provider = (text) => new StooqProvider({ getText: async () => text });

(async () => {

// ── the happy path ────────────────────────────────────────────────────────
await test('a normal quote parses into a usable price', () => {
  const q = parseQuote(GOOD, 'xauusd');
  assert.strictEqual(q.close, 3308.75);
  assert.strictEqual(q.open, 3305.10);
  assert.strictEqual(q.high, 3312.40);
  assert.strictEqual(q.low, 3299.80);
  assert.strictEqual(q.date, '2026-09-04');
});

await test('fetch tags the row with a real source so the collector accepts it', async () => {
  const r = await provider(GOOD).fetch('gold');
  assert.strictEqual(r.source, 'stooq', 'market-collect.js refuses anything not tagged live');
  assert.strictEqual(r.price, 3308.75);
  assert.strictEqual(r.symbol, 'gold');
  assert.strictEqual(r.unit, 'USD/oz');
});

// ── the no-data trap, which is the reason this file is long ───────────────
await test('an N/D row is an error, never a NaN price', () => {
  assert.throws(() => parseQuote(csv('XAUUSD,N/D,N/D,N/D,N/D,N/D,N/D'), 'xauusd'),
    /no usable close/);
});

await test('every no-data spelling is caught', () => {
  for (const nd of ['N/D', 'n/d', 'ND', 'nd', '']) {
    assert.throws(() => parseQuote(csv(`XAUUSD,2026-09-04,01:55:12,1,2,3,${nd}`), 'xauusd'),
      /no usable close/, `"${nd}" must not parse as a price`);
  }
});

await test('a NaN can never reach the caller', async () => {
  await assert.rejects(provider(csv('XAUUSD,N/D,N/D,N/D,N/D,N/D,N/D')).fetch('gold'),
    /no usable close/);
});

await test('zero and negative closes are refused like any other bad price', () => {
  for (const bad of ['0', '-12.5']) {
    assert.throws(() => parseQuote(csv(`XAUUSD,2026-09-04,01:55:12,1,2,3,${bad}`), 'xauusd'),
      /no usable close/);
  }
});

await test('a partial row still yields a price when only the extras are missing', () => {
  const q = parseQuote(csv('XAUUSD,2026-09-04,01:55:12,N/D,N/D,N/D,3308.75'), 'xauusd');
  assert.strictEqual(q.close, 3308.75, 'close is the only field that matters');
  assert.strictEqual(q.open, null, 'and a missing extra is null, not NaN');
  assert.ok(!Number.isNaN(q.high));
});

// ── the wrong-symbol trap ─────────────────────────────────────────────────
await test('a response for a different symbol is refused, not recorded', () => {
  assert.throws(() => parseQuote(csv('SPY,2026-09-04,01:55:12,1,2,3,650.10'), 'xauusd'),
    /returned SPY, expected xauusd/);
});

await test('the symbol check is case-insensitive, since Stooq upper-cases', () => {
  assert.doesNotThrow(() => parseQuote(GOOD, 'XAUUSD'));
  assert.doesNotThrow(() => parseQuote(GOOD, 'xauusd'));
});

// ── malformed input ───────────────────────────────────────────────────────
await test('an empty or header-only body is an error, not an empty price', () => {
  for (const body of ['', '   ', HEAD, HEAD + '\n']) {
    assert.throws(() => parseQuote(body, 'xauusd'), /no quote row/);
  }
});

await test('an HTML error page does not parse as a quote', () => {
  assert.throws(() => parseQuote('<html><body>403 Forbidden</body></html>\n<p>x</p>', 'xauusd'),
    /no quote row|no usable close/);
});

await test('columns are found by header name, not by position', () => {
  const reordered = 'Close,Symbol,Date,Time,Open,High,Low\n' +
                    '3308.75,XAUUSD,2026-09-04,01:55:12,3305.10,3312.40,3299.80\n';
  assert.strictEqual(parseQuote(reordered, 'xauusd').close, 3308.75,
    'Stooq is free to reorder its columns; position-based parsing would silently swap fields');
});

await test('CRLF line endings parse the same as LF', () => {
  assert.strictEqual(parseQuote(GOOD.replace(/\n/g, '\r\n'), 'xauusd').close, 3308.75);
});

// ── URLs and symbol table ─────────────────────────────────────────────────
await test('the caret in an index symbol is percent-encoded', () => {
  const u = new StooqProvider().url('sp500');
  assert.ok(u.includes('s=%5Espx'), u);
  assert.ok(!u.includes('s=^'), 'a raw caret in a query string is not safe');
});

await test('the table covers exactly the four instruments nothing else can serve', () => {
  assert.deepStrictEqual(StooqProvider.symbols().sort(), ['gold', 'nasdaq', 'oil', 'sp500']);
  assert.ok(!StooqProvider.symbols().includes('btc'), 'btc and eth already work via CoinGecko');
});

await test('an unknown key is refused before any request is made', async () => {
  let called = false;
  const p = new StooqProvider({ getText: async () => { called = true; return GOOD; } });
  await assert.rejects(p.fetch('doge'), /Unknown stooq key/);
  assert.strictEqual(called, false, 'no request should be made for a key we do not know');
});

// ── the boundary ──────────────────────────────────────────────────────────
await test('a transport failure propagates rather than becoming a price', async () => {
  const p = new StooqProvider({ getText: async () => { throw new Error('Stooq HTTP 503'); } });
  await assert.rejects(p.fetch('gold'), /503/);
});

await test('the provider records nothing and trades nothing', () => {
  const src = fs.readFileSync(path.join(__dirname, 'providers', 'stooq-provider.js'), 'utf8');
  for (const forbidden of ['appendFileSync', 'writeFileSync', 'paper-trading', 'market-analyst']) {
    assert.ok(!src.includes(forbidden), `stooq-provider.js must not contain ${forbidden}`);
  }
});

await test('the file records the probe result rather than implying it works', () => {
  const src = fs.readFileSync(path.join(__dirname, 'providers', 'stooq-provider.js'), 'utf8');
  assert.ok(/NOT WIRED IN/.test(src), 'its status must be the first thing a reader sees');
  assert.ok(/404/.test(src), 'and the measured result must be written down, not just the intent');
  assert.ok(/--probe/.test(src), 'with the command that would change that status');
});

// ─── THE CONTROL, and the verdict it makes possible ────────────────────────
//
// The 2026-09-04 probe ended in a question: four uniform 404s that could mean
// the codes are wrong OR the URL is. The file's own comment named the
// experiment that separates them and it went un-run for three weeks, because
// it was a thing a human had to remember to do by hand. It is part of the
// probe now, and diagnose() is the decision table — pure, so every branch is
// reachable here without a socket.

await test('the control fetch uses the SAME url shape as an instrument', () => {
  // A control built a different way tests a different thing and would prove
  // nothing about the four.
  const p = new StooqProvider({ getText: async () => GOOD });
  assert.strictEqual(p.urlFor(StooqProvider.SYMBOLS.gold.code), p.url('gold'));
  assert.ok(p.urlFor(StooqProvider.CONTROL.code).startsWith('https://stooq.com/q/l/?s=aapl.us'));
});

await test('a network failure on the control means NOTHING is learned about the symbols', () => {
  for (const err of ['Stooq timed out after 10000ms', 'fetch failed', 'ECONNRESET', 'ENOTFOUND stooq.com']) {
    const d = StooqProvider.diagnose({ ok: false, error: err },
      [{ key: 'gold', ok: false }, { key: 'oil', ok: false }]);
    assert.strictEqual(d.verdict, 'no-network', `"${err}" was not read as a network failure`);
    assert.strictEqual(d.actionable, false, 'a no-network run must not look actionable');
    assert.match(d.why, /nothing is learned/);
  }
});

await test('an HTTP failure on the control blames the ENDPOINT, not the codes', () => {
  const d = StooqProvider.diagnose({ ok: false, error: 'Stooq HTTP 404' },
    [{ key: 'gold', ok: false }, { key: 'oil', ok: false }]);
  assert.strictEqual(d.verdict, 'endpoint-wrong');
  assert.match(d.why, /the URL or the request shape is wrong, not the four codes/);
  assert.match(StooqProvider.NEXT_STEP['endpoint-wrong'], /Do NOT\n  touch the symbol table/);
});

await test('control OK + everything else failing blames the CODES — the answer 2026-09-04 could not reach', () => {
  const d = StooqProvider.diagnose({ ok: true },
    [{ key: 'gold', ok: false }, { key: 'sp500', ok: false }, { key: 'nasdaq', ok: false }, { key: 'oil', ok: false }]);
  assert.strictEqual(d.verdict, 'symbols-wrong');
  assert.match(d.why, /the endpoint is fine and these codes are wrong/);
});

await test('a partial result is its own verdict, not rounded to success or failure', () => {
  const d = StooqProvider.diagnose({ ok: true },
    [{ key: 'gold', ok: true }, { key: 'oil', ok: false }]);
  assert.strictEqual(d.verdict, 'partial');
  assert.match(StooqProvider.NEXT_STEP.partial, /Wire ONLY the passing symbols/);
});

await test('every symbol resolving is the only route to `confirmed`', () => {
  assert.strictEqual(StooqProvider.diagnose({ ok: true },
    [{ key: 'gold', ok: true }, { key: 'oil', ok: true }]).verdict, 'confirmed');
  // One failure anywhere must not confirm.
  assert.notStrictEqual(StooqProvider.diagnose({ ok: true },
    [{ key: 'gold', ok: true }, { key: 'oil', ok: false }]).verdict, 'confirmed');
});

await test('every verdict has a next step — a diagnosis with no instruction is half a tool', () => {
  const verdicts = ['no-network', 'endpoint-wrong', 'symbols-wrong', 'partial', 'confirmed'];
  for (const v of verdicts) {
    assert.ok(StooqProvider.NEXT_STEP[v], `no next step for ${v}`);
  }
  assert.deepStrictEqual(Object.keys(StooqProvider.NEXT_STEP).sort(), [...verdicts].sort(),
    'NEXT_STEP and the verdicts diagnose() can return have drifted apart');
});

await test('classify tells network from http from parse', () => {
  assert.strictEqual(StooqProvider.classify('Stooq timed out after 10000ms'), 'network');
  assert.strictEqual(StooqProvider.classify('Stooq HTTP 404'), 'http');
  assert.strictEqual(StooqProvider.classify('Stooq returned no usable close for xauusd'), 'parse');
});

await test('probeControl resolves either way — its failure is the datum, not an exception', () => {
  const bad = new StooqProvider({ getText: async () => { throw new Error('Stooq HTTP 500'); } });
  return bad.probeControl().then((r) => {
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'Stooq HTTP 500');
  });
});

await test('probeControl rejects an N/D row for the control too', () => {
  // The control has to be held to the same parse standard, or a Stooq "symbol
  // not found" row would read as a working endpoint and wrongly blame the four.
  const nd = new StooqProvider({ getText: async () => csv('AAPL.US,N/D,N/D,N/D,N/D,N/D,N/D') });
  return nd.probeControl().then((r) => assert.strictEqual(r.ok, false, 'an N/D control passed'));
});

await test('the file records that the cloud session CANNOT run this probe', () => {
  // Written down because the next session will otherwise spend the same
  // twenty minutes rediscovering it. Attempted 2026-09-25: every request to
  // stooq.com:443 died as ws_closed_mid_exchange through the container's
  // egress proxy, control included, curl included.
  const src = fs.readFileSync(path.join(__dirname, 'providers', 'stooq-provider.js'), 'utf8');
  assert.match(src, /ws_closed_mid_exchange/, 'the measured proxy failure is not recorded');
  assert.match(src, /HAS TO RUN ON THE CHROMEBOOK/, 'where it must be run is not stated');
});

finish();
})();
