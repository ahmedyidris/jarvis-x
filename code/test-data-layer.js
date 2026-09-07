// The data layer: DataLayer's provider registry and cache, CacheLayer's TTL
// bookkeeping, BaseProvider's rate limiter, MarketBriefProvider's mock path.
//
// WHAT WAS HERE BEFORE: five tests with real assertions, ended by
//
//   runTests().catch(console.error);
//
// which printed any failure and exited 0 anyway. Demonstrated 2026-09-07 by
// renaming `registerProvider` in data-layer.js -- the registration API gone
// entirely, every test unable to run -- after which the file still exited 0
// and the TypeError scrolled past looking like log output. The same shape as
// test-shell.js and test-guard.js before they were replaced, with one
// difference: those two had no assertions, this one had assertions it threw
// away. It was also not in CI, so nothing ran it at all.
//
// It ALSO reached the network. Test 2 called getDataPoint('market:sp500'),
// which goes live whenever ALPHAVANTAGE_API_KEY is set, and the file loaded
// dotenv itself to make sure it was. That is why it was never added to the CI
// list. MarketBriefProvider already takes { useMock: true }, so every test
// here passes it explicitly -- the suite is offline whether or not a key is
// present in the environment, and one test deletes the variable to check the
// no-key default.
//
// The old file is in git history; this replaces it, and adds it to CI.
const { test, finish, assert } = require('./test-helper.js');
const DataLayer = require('./data-layer.js');
const CacheLayer = require('./cache-layer.js');
const BaseProvider = require('./providers/base-provider.js');
const MarketBriefProvider = require('./providers/market-brief-provider.js');

/** A provider that records its calls, so cache hits are provable rather than
 *  inferred from a value coming back. */
class StubProvider extends BaseProvider {
  constructor(behaviour = {}) {
    super('stub', { rateLimit: { requests: 1000, window: 60000 } });
    this.calls = [];
    this.behaviour = behaviour;
  }
  async fetch(key) {
    this.calls.push(key);
    if (this.behaviour.throws) throw new Error(this.behaviour.throws);
    return { key, price: 1.5, source: 'stub' };
  }
  logRequest() { /* silent: the real one writes to stderr on every call */ }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {

// ── DataLayer: the registry ───────────────────────────────────────────────
await test('a registered provider is findable by name', async () => {
  const dl = new DataLayer();
  const p = new StubProvider();
  dl.registerProvider('stub', p);
  assert.ok(dl.providers.has('stub'));
  assert.strictEqual(dl.providers.get('stub'), p, 'the instance itself, not a copy');
});

await test('something that is not a provider is refused at registration', () => {
  // data-layer.js checks `instanceof BaseProvider` on purpose. Without it a
  // plain object registers fine and fails later inside getDataPoint, where
  // the error reads as a fetch failure rather than a wiring mistake.
  const dl = new DataLayer();
  assert.throws(() => dl.registerProvider('bad', { fetch: async () => ({}) }),
    /must extend BaseProvider/);
  assert.throws(() => dl.registerProvider('bad', null), /must extend BaseProvider/);
  assert.strictEqual(dl.providers.size, 0, 'and nothing is left half-registered');
});

// ── DataLayer: fetching ───────────────────────────────────────────────────
await test('a fresh fetch returns the value, its source and zero staleness', async () => {
  const dl = new DataLayer();
  dl.registerProvider('stub', new StubProvider());
  const r = await dl.getDataPoint('stub:thing');
  assert.strictEqual(r.value.key, 'thing', 'the key after the colon is what reaches the provider');
  assert.strictEqual(r.source, 'stub');
  assert.strictEqual(r.staleness, 0);
  assert.ok(typeof r.fetchedAt === 'number' && r.fetchedAt > 0, 'a caller must be able to age it');
  assert.strictEqual(r.error, undefined);
});

await test('an unregistered provider prefix is an error object, never a throw', async () => {
  // The layer's stated contract is graceful degradation. A throw here would
  // take down whatever asked for the datapoint.
  const dl = new DataLayer();
  const r = await dl.getDataPoint('nosuch:key');
  assert.strictEqual(r.value, null);
  assert.ok(/No provider registered/.test(r.error), r.error);
  assert.ok(/nosuch/.test(r.error), 'and it must name the prefix it could not find');
});

await test('a provider that throws degrades to an error, with its name kept', async () => {
  const dl = new DataLayer();
  dl.registerProvider('stub', new StubProvider({ throws: 'upstream 503' }));
  const r = await dl.getDataPoint('stub:thing');
  assert.strictEqual(r.value, null);
  assert.strictEqual(r.error, 'upstream 503', 'the provider\'s own reason, not a generic one');
  assert.strictEqual(r.source, 'stub', 'which provider failed is the first thing a reader needs');
  assert.strictEqual(r.fetchedAt, null, 'and nothing may look like it was fetched');
});

await test('a failed fetch is not cached as a success', async () => {
  const dl = new DataLayer();
  const p = new StubProvider({ throws: 'upstream 503' });
  dl.registerProvider('stub', p);
  await dl.getDataPoint('stub:thing');
  await dl.getDataPoint('stub:thing');
  assert.strictEqual(p.calls.length, 2, 'an error must not be served from cache');
});

// ── DataLayer: the cache ──────────────────────────────────────────────────
await test('the second call inside the window does not reach the provider', async () => {
  const dl = new DataLayer();
  const p = new StubProvider();
  dl.registerProvider('stub', p);
  await dl.getDataPoint('stub:thing');
  const r = await dl.getDataPoint('stub:thing');
  assert.strictEqual(p.calls.length, 1, 'the provider was called twice — the cache is not working');
  assert.strictEqual(r.value.key, 'thing', 'and the cached value still comes back');
  assert.strictEqual(r.staleness, 0);
});

await test('past the max age the value still comes back, but flagged stale', async () => {
  const dl = new DataLayer();
  dl.registerProvider('stub', new StubProvider());
  await dl.getDataPoint('stub:thing');
  dl.cacheMaxAge = 0;               // everything already held is now old
  await sleep(5);
  const r = await dl.getDataPoint('stub:thing');
  assert.ok(r.value, 'stale data beats no data — that is the documented behaviour');
  assert.ok(r.staleness > 0, `staleness must be positive, got ${r.staleness}`);
  assert.ok(/stale/.test(r.warning || ''), `and it must say so in words: ${r.warning}`);
});

await test('allowStale false refetches instead of serving old data', async () => {
  const dl = new DataLayer();
  const p = new StubProvider();
  dl.registerProvider('stub', p);
  await dl.getDataPoint('stub:thing');
  dl.cacheMaxAge = 0;
  await sleep(5);
  const r = await dl.getDataPoint('stub:thing', { allowStale: false });
  assert.strictEqual(p.calls.length, 2, 'a caller refusing stale data must get a real fetch');
  assert.strictEqual(r.staleness, 0);
  assert.strictEqual(r.warning, undefined);
});

await test('clearCache with no pattern empties it, with a pattern is selective', async () => {
  const dl = new DataLayer();
  const p = new StubProvider();
  dl.registerProvider('stub', p);
  await dl.getDataPoint('stub:alpha');
  await dl.getDataPoint('stub:beta');
  assert.strictEqual(dl.cache.size, 2);

  dl.clearCache('alpha');
  assert.strictEqual(dl.cache.size, 1, 'only the matching key');
  assert.ok(dl.cache.has('stub:beta'));

  dl.clearCache();
  assert.strictEqual(dl.cache.size, 0);
});

await test('the unavailable message carries the reason, not just a date', async () => {
  const dl = new DataLayer();
  const msg = dl.formatDataUnavailable('market:sp500', 'quota exhausted');
  assert.ok(/quota exhausted/.test(msg), msg);
  assert.ok(/\d{4}-\d{2}-\d{2}/.test(msg), 'and when, so "unavailable" is dateable');
  assert.ok(!/no data/i.test(msg), 'the header forbids a bare "no data"');
});

// ── CacheLayer ────────────────────────────────────────────────────────────
await test('a missing key is null and counts as a miss', async () => {
  const c = new CacheLayer();
  assert.strictEqual(await c.get('nope'), null, 'null, not undefined and not a shaped empty');
  assert.strictEqual(c.stats.misses, 1);
});

await test('set then get round-trips and reads fresh', async () => {
  const c = new CacheLayer();
  await c.set('k', { data: 'value' });
  const got = await c.get('k');
  assert.strictEqual(got.value.data, 'value');
  assert.strictEqual(got.staleness, 'fresh');
  assert.ok(got.age >= 0);
  assert.strictEqual(c.stats.hits, 1);
});

await test('an expired entry is a miss and is dropped, not returned old', async () => {
  const c = new CacheLayer();
  await c.set('k', 'v', 10);
  await sleep(25);
  assert.strictEqual(await c.get('k'), null);
  assert.strictEqual(c.memoryStore.has('k'), false, 'and the dead entry is evicted');
});

await test('past 80% of its TTL an entry reads stale while still usable', async () => {
  // The threshold is the point of the field: a caller can prefer a refresh
  // before the entry actually dies.
  const c = new CacheLayer();
  await c.set('k', 'v', 60);
  await sleep(55);
  const got = await c.get('k');
  assert.ok(got, 'it must not have expired yet');
  assert.strictEqual(got.staleness, 'stale');
});

await test('the hit rate is reported, and says N/A rather than 0% on no traffic', async () => {
  const c = new CacheLayer();
  assert.strictEqual(c.getStats().hitRate, 'N/A', '0% would imply requests that failed');
  await c.set('k', 'v');
  await c.get('k');
  await c.get('missing');
  const s = c.getStats();
  assert.strictEqual(s.hits, 1);
  assert.strictEqual(s.misses, 1);
  assert.strictEqual(s.hitRate, '50.00%');
});

await test('CacheLayer and DataLayer do NOT share a staleness convention', async () => {
  // Pinned as a divergence, not fixed here. CacheLayer.staleness is the
  // string 'fresh'|'stale'; DataLayer.staleness is milliseconds past the max
  // age, where 0 means fresh. Anything reading both -- and they are two
  // halves of one "data layer" -- must branch on which it holds. A truthy
  // check on the wrong one reads every fresh CacheLayer entry as stale and
  // every fresh DataLayer entry as fine.
  const c = new CacheLayer();
  await c.set('k', 'v');
  const cacheSide = await c.get('k');
  const dl = new DataLayer();
  dl.registerProvider('stub', new StubProvider());
  const layerSide = await dl.getDataPoint('stub:thing');
  assert.strictEqual(typeof cacheSide.staleness, 'string');
  assert.strictEqual(typeof layerSide.staleness, 'number');
  assert.ok(cacheSide.staleness, 'the string form is truthy WHEN FRESH');
  assert.ok(!layerSide.staleness, 'and the numeric form is falsy when fresh — opposite senses');
});

// ── BaseProvider ──────────────────────────────────────────────────────────
await test('the base fetch is unimplemented and says which provider', async () => {
  const p = new BaseProvider('unfinished');
  await assert.rejects(() => p.fetch('k'), /unfinished\.fetch\(\) not implemented/);
});

await test('the rate limiter allows exactly its quota, then refuses', async () => {
  const p = new BaseProvider('test', { rateLimit: { requests: 2, window: 1000 } });
  await p.checkRateLimit();
  await p.checkRateLimit();
  await assert.rejects(() => p.checkRateLimit(), /rate limit exceeded/,
    'the third call inside the window must be refused');
});

await test('the refusal says how long to wait, not just that it happened', async () => {
  const p = new BaseProvider('test', { rateLimit: { requests: 1, window: 5000 } });
  await p.checkRateLimit();
  await assert.rejects(() => p.checkRateLimit(), /Wait \d+s/);
});

await test('the window slides, so a limit is not permanent', async () => {
  const p = new BaseProvider('test', { rateLimit: { requests: 1, window: 30 } });
  await p.checkRateLimit();
  await assert.rejects(() => p.checkRateLimit(), /rate limit/);
  await sleep(45);
  await p.checkRateLimit();  // must not throw
  assert.strictEqual(p.requestLog.length, 1, 'expired timestamps are dropped, not accumulated');
});

await test('the default limit exists even when no options are passed', () => {
  const p = new BaseProvider('bare');
  assert.ok(p.rateLimit.requests > 0 && p.rateLimit.window > 0,
    'an unconfigured provider must still be limited, not unlimited');
});

// ── MarketBriefProvider, offline ──────────────────────────────────────────
await test('with no API key it serves a mock, and labels it a mock', async () => {
  const had = process.env.ALPHAVANTAGE_API_KEY;
  delete process.env.ALPHAVANTAGE_API_KEY;
  try {
    const p = new MarketBriefProvider();
    assert.strictEqual(p.useMock, true, 'no key must mean no live request');
    const r = await p.fetch('sp500');
    assert.strictEqual(r.source, 'mock',
      'an unlabelled or alphavantage-labelled mock is the failure mode that matters');
    assert.ok(typeof r.price === 'number');
  } finally {
    if (had !== undefined) process.env.ALPHAVANTAGE_API_KEY = had;
  }
});

await test('useMock forces the mock path even when a key is present', async () => {
  const had = process.env.ALPHAVANTAGE_API_KEY;
  process.env.ALPHAVANTAGE_API_KEY = 'not-a-real-key';
  try {
    const p = new MarketBriefProvider({ useMock: true });
    assert.strictEqual(p.useMock, true);
    const r = await p.fetch('nasdaq100');
    assert.strictEqual(r.source, 'mock');
  } finally {
    if (had === undefined) delete process.env.ALPHAVANTAGE_API_KEY;
    else process.env.ALPHAVANTAGE_API_KEY = had;
  }
});

await test('an unknown market key throws rather than inventing a mock', async () => {
  const p = new MarketBriefProvider({ useMock: true });
  await assert.rejects(() => p.fetch('dogecoin'), /Unknown market key/);
});

await test('every mock row declares itself, and none claims a live source', async () => {
  const p = new MarketBriefProvider({ useMock: true });
  for (const key of ['sp500', 'nasdaq100', '10y-yield']) {
    const r = await p.fetch(key);
    assert.strictEqual(r.source, 'mock', `${key} is not labelled mock`);
    assert.notStrictEqual(r.source, 'alphavantage');
    assert.ok(r.timestamp, `${key} has no timestamp`);
  }
});

await test('a mock reaching DataLayer keeps its label all the way through', async () => {
  // DataLayer's `source` is the PROVIDER name ('market'), which is not the
  // data's origin. The origin only survives on the value, so a caller
  // checking r.source alone cannot tell a mock from a live quote.
  const dl = new DataLayer();
  dl.registerProvider('market', new MarketBriefProvider({ useMock: true }));
  const r = await dl.getDataPoint('market:sp500');
  assert.strictEqual(r.source, 'market', 'this is the provider, not the origin');
  assert.strictEqual(r.value.source, 'mock', 'the origin lives here and must survive');
});

// ── this file's own honesty ───────────────────────────────────────────────
await test('this suite reaches no network of its own', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(__filename, 'utf8');
  // The old file loaded dotenv precisely so the live path would be taken.
  assert.ok(!/require\(['"]dotenv['"]\)/.test(src),
    'loading .env is what put a live Alpha Vantage call in a unit test');
  // Every MarketBriefProvider built here must be explicitly mocked, or a
  // machine with a key set runs a different suite than CI does.
  const built = [...src.matchAll(/new MarketBriefProvider\(([^)]*)\)/g)].map(m => m[1].trim());
  assert.ok(built.length >= 4, `only ${built.length} constructions found — did the tests change?`);
  const unmocked = built.filter(a => !/useMock:\s*true/.test(a));
  assert.deepStrictEqual(unmocked, [''],
    'exactly one bare construction is expected (the no-key default test, which ' +
    'deletes the variable first); every other must pass useMock: true');
});

finish();
})();
