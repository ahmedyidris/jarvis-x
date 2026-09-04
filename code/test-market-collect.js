// The collector's one job that matters: never let a mock price into the
// history. Every provider in code/providers/ silently substitutes a hardcoded
// constant when its API key is missing, so "did we record it?" and "was it
// real?" are different questions and only one of them is safe to skip.
//
// Fully offline: the fetcher is injected, so no test here opens a socket.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const C = require('./market-collect.js');
const { load, MIN_OBSERVATIONS } = require('./market-analyst.js');
const { STOP_FILE } = require('./guard.js');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jx-coll-')), 'history.jsonl');
const now = () => new Date('2026-09-04T12:00:00Z');

// Mirrors the real provider shapes, including the `source` tag they all set.
const LIVE = {
  'crypto:btc':          { symbol: 'btc',   price: 60000, source: 'coingecko' },
  'crypto:eth':          { symbol: 'eth',   price: 3000,  source: 'coingecko' },
  'energy:crude-oil-wti':{ symbol: 'oil',   price: 73.2,  source: 'eia' },
  'market:sp500':        { symbol: 'sp500', price: 5600,  source: 'alphavantage' },
  'market:nasdaq100':    { symbol: 'nasdaq',price: 19800, source: 'alphavantage' },
  'energy:gold':         { symbol: 'gold',  price: 2050,  source: 'mock',
                           note: 'EIA does not publish gold; needs a metals provider' },
};
const fetcherFor = (table) => async (k) => {
  if (!(k in table)) throw new Error(`Unknown key: ${k}`);
  const v = table[k];
  if (v instanceof Error) throw v;
  return v;
};

(async () => {

// ── the rule the whole file exists for ────────────────────────────────────
await test('a mock price is never written to history', async () => {
  const f = tmp();
  const { results, written } = await C.collect({ fetcher: fetcherFor(LIVE), historyPath: f, now });
  assert.strictEqual(written, 5, 'the five live instruments record; gold does not');
  const recorded = load(f).map(r => r.symbol);
  assert.ok(!recorded.includes('gold'), 'gold is served from a MOCK constant and must be excluded');
  const gold = results.find(r => r.symbol === 'gold');
  assert.strictEqual(gold.status, 'skipped');
});

await test('the skip states the provider\'s own reason, not a generic one', async () => {
  const { results } = await C.collect({ fetcher: fetcherFor(LIVE), historyPath: tmp(), now });
  const gold = results.find(r => r.symbol === 'gold');
  assert.ok(/EIA does not publish gold/.test(gold.why), gold.why);
});

await test('an unlabelled price is treated as suspect, not as live', async () => {
  const table = { ...LIVE, 'crypto:btc': { symbol: 'btc', price: 60000 } };  // no source
  const { results } = await C.collect({ fetcher: fetcherFor(table), historyPath: tmp(), now });
  const btc = results.find(r => r.symbol === 'btc');
  assert.strictEqual(btc.status, 'skipped', 'no provenance means it does not go in the record');
  assert.ok(/unlabelled/.test(btc.why), btc.why);
});

// ── failure handling ──────────────────────────────────────────────────────
await test('one provider failing does not lose the others', async () => {
  const table = { ...LIVE, 'market:sp500': new Error('Alpha Vantage rate limit') };
  const f = tmp();
  const { results, written } = await C.collect({ fetcher: fetcherFor(table), historyPath: f, now });
  assert.strictEqual(written, 4);
  const sp = results.find(r => r.symbol === 'sp500');
  assert.strictEqual(sp.status, 'error');
  assert.ok(/rate limit/.test(sp.why), sp.why);
  assert.deepStrictEqual(load(f).map(r => r.symbol).sort(), ['btc', 'eth', 'nasdaq', 'oil']);
});

await test('a nonsense price is refused even when the source looks live', async () => {
  const table = { ...LIVE, 'crypto:eth': { symbol: 'eth', price: -1, source: 'coingecko' } };
  const { results } = await C.collect({ fetcher: fetcherFor(table), historyPath: tmp(), now });
  assert.strictEqual(results.find(r => r.symbol === 'eth').status, 'skipped');
});

await test('every configured instrument is accounted for in the result', async () => {
  const { results } = await C.collect({ fetcher: fetcherFor(LIVE), historyPath: tmp(), now });
  assert.deepStrictEqual(results.map(r => r.symbol).sort(),
    ['btc', 'eth', 'gold', 'nasdaq', 'oil', 'sp500']);
  assert.ok(results.every(r => ['live', 'skipped', 'error'].includes(r.status)));
});

await test('a total outage writes nothing rather than a partial fiction', async () => {
  const dead = async () => { throw new Error('network unreachable'); };
  const f = tmp();
  const { written } = await C.collect({ fetcher: dead, historyPath: f, now });
  assert.strictEqual(written, 0);
  assert.strictEqual(fs.existsSync(f), false);
});

// ── accumulation ──────────────────────────────────────────────────────────
await test('repeated runs accumulate toward the analyst\'s minimum', async () => {
  const f = tmp();
  for (let i = 0; i < 3; i++) {
    await C.collect({ fetcher: fetcherFor(LIVE), historyPath: f, now: () => new Date(Date.UTC(2026, 8, 1 + i)) });
  }
  const btc = load(f).filter(r => r.symbol === 'btc');
  assert.strictEqual(btc.length, 3);
  assert.ok(btc.length < MIN_OBSERVATIONS, 'three days is still not enough to judge, by design');
});

// ── the kill switch ───────────────────────────────────────────────────────
await test('the kill switch stops collection', async () => {
  const hadStop = fs.existsSync(STOP_FILE);
  try {
    if (!hadStop) fs.writeFileSync(STOP_FILE, 'test');
    await assert.rejects(
      C.collect({ fetcher: fetcherFor(LIVE), historyPath: tmp(), now }),
      /Kill switch/i);
  } finally {
    if (!hadStop) fs.unlinkSync(STOP_FILE);
  }
  assert.strictEqual(fs.existsSync(STOP_FILE), hadStop, 'kill-switch state must be restored');
});

// ── the report ────────────────────────────────────────────────────────────
await test('the summary names what was skipped instead of quietly reporting 5', async () => {
  const { results, written } = await C.collect({ fetcher: fetcherFor(LIVE), historyPath: tmp(), now });
  const out = C.format(results, written);
  assert.ok(/5 of 6 instruments had a live price/.test(out), out);
  assert.ok(/No history recorded for: gold/.test(out), out);
});

// ── fallbacks ─────────────────────────────────────────────────────────────
// config/trading.json gives the four keyless-source-less instruments a
// `stooq:*` fallback. It is tried ONLY when the primary yields a mock or an
// error -- never as a preference -- and a fallback price must clear exactly
// the same source check as a primary one.
const WITH_STOOQ = {
  ...LIVE,
  'stooq:gold':   { symbol: 'gold',   price: 3308.75, source: 'stooq' },
  'stooq:sp500':  { symbol: 'sp500',  price: 6510.2,  source: 'stooq' },
  'stooq:nasdaq': { symbol: 'nasdaq', price: 24010.5, source: 'stooq' },
  'stooq:oil':    { symbol: 'oil',    price: 71.4,    source: 'stooq' },
};

await test('a mock primary falls back, and all six record', async () => {
  const f = tmp();
  const { results, written } = await C.collect({ fetcher: fetcherFor(WITH_STOOQ), historyPath: f, now });
  assert.strictEqual(written, 6, 'the fallback closes the four gaps');
  assert.deepStrictEqual(load(f).map(r => r.symbol).sort(),
    ['btc', 'eth', 'gold', 'nasdaq', 'oil', 'sp500']);
  const gold = results.find(r => r.symbol === 'gold');
  assert.strictEqual(gold.status, 'live');
  assert.strictEqual(gold.source, 'stooq');
  assert.strictEqual(gold.fellBackFrom, 'energy:gold');
});

await test('a working primary is never displaced by a fallback', async () => {
  const table = { ...WITH_STOOQ, 'energy:gold': { symbol: 'gold', price: 3300, source: 'eia' } };
  const gold = (await C.collect({ fetcher: fetcherFor(table), historyPath: tmp(), now }))
    .results.find(r => r.symbol === 'gold');
  assert.strictEqual(gold.price, 3300, 'the primary won');
  assert.strictEqual(gold.source, 'eia');
  assert.strictEqual(gold.fellBackFrom, undefined);
});

await test('btc has no fallback, so a CoinGecko outage is simply an outage', async () => {
  const table = { ...WITH_STOOQ, 'crypto:btc': new Error('CoinGecko HTTP 429') };
  const btc = (await C.collect({ fetcher: fetcherFor(table), historyPath: tmp(), now }))
    .results.find(r => r.symbol === 'btc');
  assert.strictEqual(btc.status, 'error');
  assert.ok(/429/.test(btc.why), btc.why);
});

await test('when the fallback fails too, the PRIMARY reason survives', async () => {
  // The primary's reason names the missing key or absent series -- the thing
  // that actually needs fixing. A fallback's transport error must not bury it.
  const table = { ...WITH_STOOQ, 'stooq:gold': new Error('Stooq HTTP 403') };
  const gold = (await C.collect({ fetcher: fetcherFor(table), historyPath: tmp(), now }))
    .results.find(r => r.symbol === 'gold');
  assert.strictEqual(gold.status, 'skipped');
  assert.ok(/EIA does not publish gold/.test(gold.why), gold.why);
  assert.ok(/403/.test(gold.fallbackWhy), 'and the fallback failure is carried alongside');
  assert.strictEqual(gold.fallbackTried, 'stooq:gold');
});

await test('a fallback serving a mock is refused like any other mock', async () => {
  const table = { ...WITH_STOOQ, 'stooq:gold': { symbol: 'gold', price: 3308, source: 'mock' } };
  const f = tmp();
  const { results } = await C.collect({ fetcher: fetcherFor(table), historyPath: f, now });
  assert.strictEqual(results.find(r => r.symbol === 'gold').status, 'skipped');
  assert.ok(!load(f).some(r => r.symbol === 'gold'), 'a fallback gets no special trust');
});

await test('the summary shows which instruments fell back and why', async () => {
  const { results, written } = await C.collect({ fetcher: fetcherFor(WITH_STOOQ), historyPath: tmp(), now });
  const out = C.format(results, written);
  assert.ok(/6 of 6 instruments had a live price/.test(out), out);
  assert.ok(/gold\s+recorded\s+3308.75 \(stooq, fallback\)/.test(out), out);
  assert.ok(/energy:gold was unusable/.test(out), out);
});

await test('attempt() classifies one key and never reaches for another', async () => {
  const seen = [];
  const spy = async (k) => { seen.push(k); return fetcherFor(WITH_STOOQ)(k); };
  const r = await C.attempt(spy, 'gold', 'energy:gold');
  assert.deepStrictEqual(seen, ['energy:gold'], 'attempt is one try, by design');
  assert.strictEqual(r.status, 'skipped');
  assert.strictEqual(r.via, 'energy:gold');
});

// ── the boundary ──────────────────────────────────────────────────────────
await test('the collector cannot open a position', () => {
  const src = fs.readFileSync(path.join(__dirname, 'market-collect.js'), 'utf8');
  assert.ok(!/require\(['"]\.\/paper-trading/.test(src),
    'collecting prices must not import the trade book');
  assert.strictEqual(C.open, undefined);
});

finish();
})();
