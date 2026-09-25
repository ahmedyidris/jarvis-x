// TRADINGVIEW SIGNALS — the consumer for a write-only log.
//
// Three things this suite is really about, in order of how much they matter:
//
//   1. THE MODULE CANNOT TRADE. §III gates proposing a paper trade on a human
//      tap and §IV forbids holding anything outside config/trading.json's six.
//      A signal source is exactly the kind of module that grows an "and then
//      act on it" later, so the prohibition is asserted structurally rather
//      than left to the header.
//   2. EVERY ROW IS UNTRUSTED. app.py's webhook skips its passphrase check
//      entirely when TRADINGVIEW_PASSPHRASE is unset — `if expected_passphrase
//      and ...` — and that variable lives in an .env that is still unfilled.
//      It binds to 127.0.0.1 today, so this is latent, but the consumer is the
//      wrong place to discover it stopped being latent.
//   3. A STALE SIGNAL IS NOT A CURRENT ONE, and a rejected row is not an
//      absent one. Both are the same failure this repo keeps naming: an
//      unknown taking the reassuring value.
//
// Offline by construction: the log path, the clock and the config path are all
// arguments, so nothing here reads the machine's real signal log.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const S = require('./trading-signals.js');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-sig-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

const NOW = new Date('2026-09-25T12:00:00.000Z');
const ago = (h) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

let seq = 0;
function logFile(rows) {
  const f = path.join(TMP, `sig-${seq++}.jsonl`);
  fs.writeFileSync(f, rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
  return f;
}
const readFile = (rows, opts = {}) => S.read({ file: logFile(rows), now: NOW, ...opts });

const row = (over = {}) => ({
  timestamp: ago(1), source: 'tradingview', symbol: 'BTCUSD',
  action: 'BUY', price: 60000, timeframe: '1h', ...over,
});

(async () => {

// ─── 1. it cannot trade ────────────────────────────────────────────────────

await test('the module imports no executor and touches no book', () => {
  const src = fs.readFileSync(path.join(__dirname, 'trading-signals.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['paper-trading', 'trade-advisor', '.open(', '.close(', 'propose']) {
    assert.ok(!src.includes(forbidden), `trading-signals.js reaches ${forbidden}`);
  }
});

await test('the module opens no socket', () => {
  const src = fs.readFileSync(path.join(__dirname, 'trading-signals.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['axios', 'node-fetch', 'https.request', 'http.request', 'fetch(', 'child_process']) {
    assert.ok(!src.includes(forbidden), `trading-signals.js reaches the network via ${forbidden}`);
  }
});

await test('every ticker maps to one of config/trading.json\'s six, and no seventh', () => {
  // §IV: "Holding any instrument outside config/trading.json's six". The map
  // is the one place a seventh could be introduced by accident.
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'trading.json'), 'utf8'));
  const allowed = Object.keys(cfg.instruments);
  assert.strictEqual(allowed.length, 6, 'the config no longer lists six instruments');
  for (const [ticker, instrument] of Object.entries(S.TICKERS)) {
    assert.ok(allowed.includes(instrument), `${ticker} maps to "${instrument}", which is not one of the six`);
  }
});

await test('a ticker mapping to an instrument the config does not list THROWS', () => {
  // Not a rejected row — a thrown error. A rejected row says "this alert is
  // not for us"; a map pointing outside the six says the allowlist itself has
  // been widened, which must stop the read rather than filter one line.
  assert.throws(
    () => S.validate(row(), { allowed: ['gold'], now: NOW }),
    /seventh tradeable instrument/);
});

// ─── 2. untrusted input ────────────────────────────────────────────────────

await test('an unknown ticker is rejected by name, not silently dropped', () => {
  const r = readFile([row({ symbol: 'TSLA' })]);
  assert.deepStrictEqual(r.latest, {});
  assert.strictEqual(r.rejected.length, 1);
  assert.match(r.rejected[0].why, /unknown ticker "TSLA"/);
});

await test('an unknown action is rejected', () => {
  const r = readFile([row({ action: 'YOLO' })]);
  assert.match(r.rejected[0].why, /unknown action "YOLO"/);
  assert.deepStrictEqual(r.latest, {});
});

await test('a missing price is NOT read as zero', () => {
  // Number(null) is 0 and Number('') is 0. A price of 0 passing a `> 0` check
  // by accident is the exact shape of bug this repo keeps finding.
  for (const bad of [undefined, null, '', '60000', 0, -1, Number.NaN, Infinity]) {
    const r = readFile([row({ price: bad })]);
    assert.strictEqual(Object.keys(r.latest).length, 0, `price ${JSON.stringify(bad)} was accepted`);
    assert.match(r.rejected[0].why, /is not a positive finite number/);
  }
});

await test('an unparseable timestamp is rejected', () => {
  const r = readFile([row({ timestamp: 'last tuesday' })]);
  assert.match(r.rejected[0].why, /is not a date/);
});

await test('a row from the FUTURE is rejected, not treated as the freshest', () => {
  // A forged row or a clock skew. Either way it must not win the fold below.
  const r = readFile([row({ timestamp: ago(-5) })]);
  assert.match(r.rejected[0].why, /in the future/);
  assert.deepStrictEqual(r.latest, {});
});

await test('a malformed line is rejected with its line number, and the rest still read', () => {
  const r = readFile(['{not json', row({ symbol: 'ETHUSD', price: 3000 })]);
  assert.strictEqual(r.rejected.length, 1);
  assert.strictEqual(r.rejected[0].line, 1);
  assert.match(r.rejected[0].why, /not valid JSON/);
  assert.strictEqual(r.latest.eth.price, 3000, 'one bad line stopped the good ones');
});

await test('rejected rows are REPORTED, so a broken feed cannot look like a quiet one', () => {
  // A webhook discarding every row looks identical to a webhook nobody is
  // firing, unless the rejects come back.
  const r = readFile([row({ symbol: 'TSLA' }), row({ symbol: 'AAPL' }), row({ action: 'X' })]);
  assert.strictEqual(r.rows, 3);
  assert.strictEqual(r.rejected.length, 3);
  assert.deepStrictEqual(r.latest, {});
  assert.match(S.format(r), /3 row\(s\) rejected/);
});

// ─── 3. stale is not current, missing is not empty ─────────────────────────

await test('a signal past MAX_AGE_HOURS is marked stale rather than dropped', () => {
  const r = readFile([row({ timestamp: ago(S.MAX_AGE_HOURS + 1) })]);
  assert.strictEqual(r.latest.btc.stale, true);
  assert.ok(r.latest.btc.ageHours > S.MAX_AGE_HOURS);
});

await test('a fresh signal is not stale', () => {
  const r = readFile([row({ timestamp: ago(1) })]);
  assert.strictEqual(r.latest.btc.stale, false);
});

await test('the staleness boundary is the configured one, not a hardcoded guess', () => {
  const r = readFile([row({ timestamp: ago(2) })], { maxAgeHours: 1 });
  assert.strictEqual(r.latest.btc.stale, true, 'maxAgeHours is not honoured');
});

await test('NO FILE and an EMPTY file are different answers', () => {
  const missing = S.read({ file: path.join(TMP, 'never-written.jsonl'), now: NOW });
  assert.strictEqual(missing.fileMissing, true);
  assert.match(S.format(missing), /the webhook has never fired here/);

  const empty = readFile([]);
  assert.strictEqual(empty.fileMissing, false);
  assert.strictEqual(empty.rows, 0);
  assert.match(S.format(empty), /no usable signal/);
});

// ─── the fold ──────────────────────────────────────────────────────────────

await test('the latest signal per instrument wins, by its own timestamp not file order', () => {
  // An out-of-order arrival — a retried webhook, a queued alert — must not let
  // an older alert overwrite a newer one just by being appended later.
  const r = readFile([
    row({ symbol: 'BTCUSD', action: 'BUY', price: 60000, timestamp: ago(1) }),
    row({ symbol: 'BTCUSD', action: 'SELL', price: 59000, timestamp: ago(5) }),
  ]);
  assert.strictEqual(r.latest.btc.action, 'BUY');
  assert.strictEqual(r.latest.btc.price, 60000);
});

await test('instruments are folded independently', () => {
  const r = readFile([
    row({ symbol: 'BTCUSD', action: 'BUY' }),
    row({ symbol: 'XAUUSD', action: 'SELL', price: 2400 }),
  ]);
  assert.strictEqual(r.latest.btc.action, 'BUY');
  assert.strictEqual(r.latest.gold.action, 'SELL');
});

await test('ticker matching is case- and whitespace-insensitive', () => {
  const r = readFile([row({ symbol: '  btcusd  ' })]);
  assert.strictEqual(r.latest.btc.action, 'BUY');
});

// ─── agreement: a reading for a human, never a decision ────────────────────

await test('agreement corroborates, contradicts or stays unrelated', () => {
  const buy = { action: 'BUY', stale: false };
  const sell = { action: 'SELL', stale: false };
  assert.strictEqual(S.agreement(buy, 'near-low'), 'corroborates');
  assert.strictEqual(S.agreement(buy, 'near-high'), 'contradicts');
  assert.strictEqual(S.agreement(sell, 'near-high'), 'corroborates');
  assert.strictEqual(S.agreement(sell, 'near-low'), 'contradicts');
  assert.strictEqual(S.agreement(buy, 'hold'), 'unrelated');
});

await test('a STALE signal never corroborates anything', () => {
  // The whole point of marking staleness is that it changes what the signal
  // is allowed to mean. If a six-hour-old alert can still corroborate, the
  // flag is decoration.
  assert.strictEqual(S.agreement({ action: 'BUY', stale: true }, 'near-low'), 'unrelated');
  assert.strictEqual(S.agreement({ action: 'SELL', stale: true }, 'near-high'), 'unrelated');
});

await test('no signal at all is unrelated, not agreement by default', () => {
  assert.strictEqual(S.agreement(null, 'near-low'), 'unrelated');
  assert.strictEqual(S.agreement(undefined, 'near-high'), 'unrelated');
});

await test('agreement returns a reading and nothing else — it cannot recommend', () => {
  // Pinned so nobody later has it return an action. An external feed that
  // could flip a verdict would be a second opinion with no accountability:
  // nobody here can say why TradingView fired, and "the alert said so" is not
  // a reason Ahmed can check at a gate.
  const out = new Set();
  for (const action of S.ACTIONS) {
    for (const verdict of ['near-low', 'near-high', 'hold', 'insufficient']) {
      out.add(S.agreement({ action, stale: false }, verdict));
    }
  }
  assert.deepStrictEqual([...out].sort(), ['contradicts', 'corroborates', 'unrelated']);
});

finish();
})();
