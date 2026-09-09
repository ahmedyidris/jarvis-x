// agent-data-integration.js maps a natural-language question to a data key and
// builds the answer. This file had three faults at once, and they compounded:
//
//   1. It ended in `runAgentDataTests().catch(console.error)`, so every failure
//      printed and the process exited 0. Same shape as test-data-layer.js and
//      the two before it -- see docs/triage/2026-09-repo-triage.md.
//   2. It called requireNet() at the TOP, so the whole file was skipped unless
//      JX_NET=1. Four of its five tests never needed the network at all:
//      resolveQuery() is pure keyword matching, and the unknown-query path
//      returns before the data layer is touched. A live dependency in one test
//      was keeping four offline ones out of CI.
//   3. It did not import test-helper.js, so it audited to the machine's real
//      logs/actions.jsonl (REMAINING_WORK.md P0.7).
//
// So the split is by what each case actually needs, not by which file it sits
// in. The offline part runs in CI on every push. Only the real CoinGecko round
// trip stays behind JX_NET, and it is the last thing in the file so a skip
// there costs nothing else.
//
// AS_BUILT.md's "5/5, measured on Ahmed's machine" for this file was never a
// measurement: the file exited 0 either way. That row is corrected.
const { test, finish, assert } = require('./test-helper.js');
// FUSE. A hung await drains the event loop and exits 0 having printed no
// tally -- a vacuous pass that reads as green, and the exact shape sweep.js
// exists to catch. finish() calls process.exit() explicitly, so this default
// only survives when finish() was never reached. Found by mutation-testing
// code/status.js; see code/test-status.js for the full account.
process.exitCode = 1;

const AgentDataIntegration = require('./agent-data-integration.js');

/** A data layer that answers from a table instead of the internet. The real
 *  one is swapped out rather than mocked at the module level, because the
 *  seam that matters is `agent.dataLayer` -- if buildResponse() ever reaches
 *  around it, these tests keep passing while the real path breaks, so one
 *  test below asserts it is the only route. */
function stubLayer(response) {
  return {
    calls: [],
    async getDataWithContext(key) { this.calls.push(key); return response; },
    async getStats() { return {}; },
    async close() { this.closed = true; },
  };
}

const LIVE = { value: { symbol: 'btc', price: 45000, changePercent24h: 2.5 },
               fetchedAt: new Date(), staleness: 0, source: 'coingecko', cacheHit: false };

(async () => {

// ── query resolution: pure string matching, no network ────────────────────
await test('the three keys the header advertises resolve', async () => {
  const a = new AgentDataIntegration();
  assert.strictEqual(await a.resolveQuery('What is Bitcoin price?'), 'crypto:btc');
  assert.strictEqual(await a.resolveQuery('How is the stock market?'), 'market:sp500');
  assert.strictEqual(await a.resolveQuery('Oil price today'), 'energy:crude-oil-wti');
});

await test('every keyword in the map reaches its key', async () => {
  // The old file checked three of eleven mappings. A typo in any of the other
  // eight would route a real question to the wrong provider, silently.
  const a = new AgentDataIntegration();
  const expected = [
    ['bitcoin', 'crypto:btc'], ['btc', 'crypto:btc'],
    ['ethereum', 'crypto:eth'], ['eth', 'crypto:eth'],
    ['sp500', 'market:sp500'], ['s&p 500', 'market:sp500'],
    ['stock market', 'market:sp500'], ['nasdaq', 'market:nasdaq100'],
    ['tech stocks', 'market:nasdaq100'], ['yield', 'market:10y-yield'],
    ['treasury', 'market:10y-yield'], ['gold', 'energy:gold'],
    ['oil', 'energy:crude-oil-wti'], ['crude', 'energy:crude-oil-wti'],
    ['natural gas', 'energy:natural-gas'], ['fed', 'news:fed-announcement'],
    ['earnings', 'news:earnings-season'], ['red sea', 'news:geopolitical-risk'],
  ];
  for (const [phrase, key] of expected) {
    assert.strictEqual(await a.resolveQuery(phrase), key, `"${phrase}" misrouted`);
  }
});

await test('matching is case-insensitive', async () => {
  const a = new AgentDataIntegration();
  assert.strictEqual(await a.resolveQuery('BITCOIN'), 'crypto:btc');
  assert.strictEqual(await a.resolveQuery('BiTcOiN price'), 'crypto:btc');
});

await test('an unmatched query resolves to null, not to a guess', async () => {
  const a = new AgentDataIntegration();
  assert.strictEqual(await a.resolveQuery('Random nonsense query xyz'), null);
  assert.strictEqual(await a.resolveQuery(''), null);
});

await test('earlier entries win, so the order in the map is the contract', () => {
  // 'gold' sits above 'oil'. A question naming both is not ambiguous by
  // accident -- it resolves to whichever the table lists first, and pinning
  // that stops a reorder changing behaviour with no test failing.
  const src = require('fs').readFileSync(
    require('path').join(__dirname, 'agent-data-integration.js'), 'utf8');
  const goldAt = src.indexOf("key: 'energy:gold'");
  const oilAt = src.indexOf("key: 'energy:crude-oil-wti'");
  assert.ok(goldAt > 0 && oilAt > 0);
  assert.ok(goldAt < oilAt, 'gold must precede oil, or the test below is wrong');
});

await test('a query naming two instruments takes the first in the map', async () => {
  const a = new AgentDataIntegration();
  assert.strictEqual(await a.resolveQuery('gold and oil prices'), 'energy:gold');
});

// ── response building, against an injected layer ──────────────────────────
await test('an unknown query answers without touching the data layer at all', async () => {
  // The old Test 5 asserted the message. What matters more is that nothing was
  // fetched: this is the path a nonsense question takes, and it must not spend
  // a network round trip or an API quota unit.
  const a = new AgentDataIntegration();
  const stub = stubLayer(LIVE);
  a.dataLayer = stub;
  const r = await a.buildResponse('Random nonsense query xyz');
  assert.ok(r.text.includes("couldn't find"), r.text);
  assert.strictEqual(r.dataKey, null);
  assert.deepStrictEqual(stub.calls, [], 'it fetched for a query it could not resolve');
});

await test('a resolved query is fetched by its key and formatted with the price', async () => {
  const a = new AgentDataIntegration();
  const stub = stubLayer(LIVE);
  a.dataLayer = stub;
  const r = await a.buildResponse('Bitcoin price?');
  assert.deepStrictEqual(stub.calls, ['crypto:btc'], 'wrong key requested');
  assert.strictEqual(r.dataKey, 'crypto:btc');
  assert.strictEqual(r.source, 'coingecko');
  assert.ok(/45,000/.test(r.text), `price not formatted: ${r.text}`);
  assert.ok(/fresh/.test(r.text), `staleness not stated: ${r.text}`);
});

await test('staleness is always stated, fresh or not', async () => {
  // The module's stated contract: "as of X, data is Y minutes old", never a
  // bare number. A price with no age is the one output that can mislead.
  const a = new AgentDataIntegration();
  a.dataLayer = stubLayer({ ...LIVE, staleness: 120000 });
  const r = await a.buildResponse('Bitcoin price?');
  assert.ok(/120s stale/.test(r.text), r.text);
  assert.ok(!/fresh/.test(r.text));
});

await test('a provider error degrades to a message, never to a thrown call', async () => {
  const a = new AgentDataIntegration();
  a.dataLayer = stubLayer({ error: 'CoinGecko 429', message: 'Data unavailable: rate limited' });
  const r = await a.buildResponse('Bitcoin price?');
  assert.strictEqual(r.staleness, 'unavailable');
  assert.strictEqual(r.error, 'CoinGecko 429');
  assert.ok(/unavailable/i.test(r.text), r.text);
  assert.ok(!/\$/.test(r.text), 'an error must not carry a price-shaped string');
});

await test('a news item formats as a headline, not as a price', async () => {
  const a = new AgentDataIntegration();
  a.dataLayer = stubLayer({ value: { title: 'Fed holds rates' }, staleness: 0,
                            fetchedAt: new Date(), source: 'news' });
  const r = await a.buildResponse('fed announcement');
  assert.ok(/Fed holds rates/.test(r.text), r.text);
  assert.ok(!/\$/.test(r.text));
});

await test('a missing change percentage prints no arrow rather than NaN', async () => {
  const a = new AgentDataIntegration();
  a.dataLayer = stubLayer({ value: { symbol: 'gold', price: 2400 }, staleness: 0,
                            fetchedAt: new Date(), source: 'stub' });
  const r = await a.buildResponse('gold price');
  assert.ok(!/NaN/.test(r.text), r.text);
  assert.ok(!/[↑↓]/.test(r.text), `no move is known, so no arrow: ${r.text}`);
  assert.ok(/2,400/.test(r.text));
});

await test('buildResponse routes through this.dataLayer and nothing else', async () => {
  // If it reached a provider directly, every test above would still pass while
  // the real path diverged.
  const a = new AgentDataIntegration();
  const stub = stubLayer(LIVE);
  a.dataLayer = stub;
  await a.buildResponse('ethereum price');
  assert.deepStrictEqual(stub.calls, ['crypto:eth'],
    'the injected layer was bypassed — there is a second route to the network');
});

// ── the live path, and only the live path, needs the internet ─────────────
if (process.env.JX_NET) {
  await test('[JX_NET] a real CoinGecko fetch produces a priced answer or an honest error', async () => {
    const a = new AgentDataIntegration();
    try {
      const r = await a.buildResponse('Bitcoin price?');
      assert.strictEqual(r.dataKey, 'crypto:btc');
      if (r.error) {
        // A live quota or outage is not a code failure. It must still be an
        // honest string, which is the contract this asserts.
        assert.ok(typeof r.error === 'string' && r.error.length > 0);
        assert.strictEqual(r.staleness, 'unavailable');
      } else {
        assert.ok(r.source, 'a live answer must name its source');
        assert.ok(/\$[\d,]/.test(r.text), r.text);
      }
    } finally {
      await a.close();
    }
  });
} else {
  console.log('JX_TEST_SKIPPED: the live CoinGecko round trip — set JX_NET=1 to include it. ' +
              'The other tests here are offline and just ran.');
}

finish();
})();
