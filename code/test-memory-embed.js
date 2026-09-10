// BITEMPORAL MEMORY LAYER 3 — embed + recall.
//
// THE ONE RULE THIS SUITE EXISTS TO ENFORCE: a stale fact must never outrank
// a fresh one on similarity alone. The template's §1 names this as the
// dangerous case precisely because semantic search makes it WORSE — an
// obsolete fact "embedded perfectly, retrieves with the highest score" and is
// then stated with total confidence. A ranking that is similarity-only is not
// a neutral starting point here; it is the defect. Several tests below exist
// only to make it impossible to regress to one.
//
// Second rule: nothing stale is dropped. Demoted and flagged, never silent.
// Silence reads as "I never knew that", which is a different and worse claim
// than "I knew that and it may be out of date".
//
// Third rule: a dead embedder is REPORTED. Falling back to lexical is fine;
// pretending the fallback was semantic is not, and returning [] is not either.
//
// Offline and deterministic by construction: the embedder is an argument, and
// every one used below is a plain function over a lookup table. No socket is
// opened, so this runs identically on the Chromebook and on a CI runner with
// no ollama. `ollamaEmbedder` is exercised with an injected fetchFn.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const E = require('./memory-embed.js');
const { openStore, makeClock, THRESHOLDS } = require('./memory-bitemporal.js');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-membed-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

let seq = 0;
function fresh(startISO = '2026-06-01T00:00:00.000Z') {
  const clock = makeClock(startISO);
  return { store: openStore({ file: path.join(TMP, `e-${seq++}.jsonl`), clock }), clock };
}

/**
 * A toy embedding space. Each word is an axis, so "similarity" is literally
 * shared vocabulary — deterministic, inspectable, and requiring no model.
 * The point of the suite is the RANKING, not the quality of the vectors.
 */
const AXES = ['work', 'employer', 'city', 'home', 'project', 'car'];
const toyEmbed = async (text) => {
  const t = text.toLowerCase();
  return AXES.map((a) => (t.includes(a) ? 1 : 0));
};

(async () => {

// --- cosine ---------------------------------------------------------------

await test('cosine of a vector with itself is 1', () => {
  assert.ok(Math.abs(E.cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
});

await test('cosine of orthogonal vectors is 0', () => {
  assert.strictEqual(E.cosine([1, 0], [0, 1]), 0);
});

await test('cosine ignores magnitude, only direction', () => {
  assert.ok(Math.abs(E.cosine([1, 1], [5, 5]) - 1) < 1e-9);
});

await test('cosine of a zero vector is 0, not NaN', () => {
  // A NaN propagates through the sort comparator and reorders results
  // arbitrarily rather than failing loudly — worse than a wrong answer,
  // because it is a DIFFERENT wrong answer each run.
  const c = E.cosine([0, 0], [1, 1]);
  assert.strictEqual(c, 0);
  assert.ok(!Number.isNaN(c));
});

await test('cosine of mismatched lengths is 0, not a partial sum', () => {
  assert.strictEqual(E.cosine([1, 2, 3], [1, 2]), 0);
});

await test('cosine of a non-array is 0 rather than a throw', () => {
  assert.strictEqual(E.cosine(null, [1]), 0);
  assert.strictEqual(E.cosine([1], undefined), 0);
});

await test('cosine handles negative components', () => {
  assert.ok(Math.abs(E.cosine([1, 0], [-1, 0]) + 1) < 1e-9);
});

// --- the cache ------------------------------------------------------------

await test('cacheKey is stable for the same text and differs for different text', () => {
  assert.strictEqual(E.cacheKey('abc'), E.cacheKey('abc'));
  assert.notStrictEqual(E.cacheKey('abc'), E.cacheKey('abd'));
});

await test('embedText joins topic, scope and text, skipping empties', () => {
  assert.strictEqual(E.embedText({ topic: 'work', scope: '', text: 'Acme' }), 'work — Acme');
  assert.strictEqual(E.embedText({ topic: 'work', scope: 'job', text: 'Acme' }), 'work — job — Acme');
});

await test('the cache stops a reaffirmed fact being re-embedded per version', async () => {
  // The store is append-only, so reaffirm writes a byte-identical text under a
  // new version. Keyed by row id this would re-embed every time.
  const { store } = fresh();
  const f = store.born({ topic: 'work', text: 'employer Acme', volatility: 'slow' });
  store.reaffirm(f.id);
  store.reaffirm(f.id);
  let calls = 0;
  const counting = async (t) => { calls++; return toyEmbed(t); };
  const cache = E.makeCache();
  await E.semanticRecall(store, { query: 'work', embed: counting, cache });
  const afterFirst = calls;
  await E.semanticRecall(store, { query: 'work', embed: counting, cache });
  // Second call re-embeds the QUERY only; the fact comes from the cache.
  assert.strictEqual(calls - afterFirst, 1, `re-embedded ${calls - afterFirst} times, expected just the query`);
});

// --- the central rule: freshness modulates similarity ----------------------

await test('a stale fact does NOT outrank a fresh one at equal similarity', async () => {
  // THE HEADLINE TEST. Both facts embed identically; only age differs.
  const { store, clock } = fresh('2026-01-01T00:00:00.000Z');
  const old = store.born({ topic: 'project', text: 'project alpha', volatility: 'fast' });
  clock.advanceDays(120);
  const recent = store.born({ topic: 'project', text: 'project alpha', volatility: 'fast' });
  const { results } = await E.semanticRecall(store, { query: 'project', embed: toyEmbed });
  assert.strictEqual(results[0].id, recent.id, 'the older fact ranked first');
  assert.ok(results.find((r) => r.id === old.id), 'the older fact was dropped instead of demoted');
});

await test('similarity alone would have ranked them equal — the modulation is what separates them', async () => {
  const { store, clock } = fresh('2026-01-01T00:00:00.000Z');
  store.born({ topic: 'project', text: 'project alpha', volatility: 'fast' });
  clock.advanceDays(120);
  store.born({ topic: 'project', text: 'project alpha', volatility: 'fast' });
  const { results } = await E.semanticRecall(store, { query: 'project', embed: toyEmbed });
  assert.strictEqual(results[0].similarity, results[1].similarity, 'fixture broken: similarities differ');
  assert.ok(results[0].score > results[1].score, 'equal similarity produced equal score — freshness was ignored');
});

await test('score is exactly similarity x freshness', async () => {
  const { store } = fresh();
  store.born({ topic: 'work', text: 'employer Acme', volatility: 'slow' });
  const { results } = await E.semanticRecall(store, { query: 'work', embed: toyEmbed });
  const r = results[0];
  assert.ok(Math.abs(r.score - r.similarity * r.freshness) < 1e-12);
});

await test('a stable fact barely decays over a year, a fast one collapses', async () => {
  const { store, clock } = fresh('2026-01-01T00:00:00.000Z');
  store.born({ topic: 'city', text: 'city Toronto', volatility: 'stable' });
  store.born({ topic: 'project', text: 'project alpha', volatility: 'fast' });
  clock.advanceDays(365);
  const { results } = await E.semanticRecall(store, { query: 'city project', embed: toyEmbed });
  const city = results.find((r) => r.topic === 'city');
  const proj = results.find((r) => r.topic === 'project');
  assert.ok(city.freshness > 0.9, `stable decayed to ${city.freshness} in a year`);
  assert.ok(proj.freshness < 0.01, `fast fact still at ${proj.freshness} after a year`);
  assert.ok(city.score > proj.score);
});

// --- nothing stale is dropped ---------------------------------------------

await test('a fact below the freshness floor is still returned, flagged stale', async () => {
  const { store, clock } = fresh('2026-01-01T00:00:00.000Z');
  store.born({ topic: 'project', text: 'project alpha', volatility: 'fast' });
  clock.advanceDays(90);
  const { results } = await E.semanticRecall(store, { query: 'project', embed: toyEmbed });
  assert.strictEqual(results.length, 1, 'the stale fact was dropped');
  assert.strictEqual(results[0].stale, true);
  assert.ok(results[0].freshness < THRESHOLDS.freshnessFloor);
});

await test('the stale flag uses THRESHOLDS.freshnessFloor, not a local number', async () => {
  // Template §9: "Do retrieval and the sweep use the same staleness
  // threshold?" Two numbers for one word contradict each other in front of a
  // user. This pins the shared constant rather than the value 0.5.
  const { store } = fresh();
  const rows = [
    E.decorate({ volatility: 'fast', last_verified_at: '2026-06-01T00:00:00.000Z' }, 1, '2026-06-01T00:00:00.000Z'),
    E.decorate({ volatility: 'fast', last_verified_at: '2026-01-01T00:00:00.000Z' }, 1, '2026-06-01T00:00:00.000Z'),
  ];
  assert.strictEqual(rows[0].stale, rows[0].freshness < THRESHOLDS.freshnessFloor);
  assert.strictEqual(rows[1].stale, rows[1].freshness < THRESHOLDS.freshnessFloor);
  assert.notStrictEqual(rows[0].stale, rows[1].stale, 'fixture broken: both sides of the floor needed');
  assert.ok(store);
});

await test('results carry similarity and freshness separately, not just the score', async () => {
  // Template §8 item 3: "returns a fact's age/confidence alongside its
  // content, not just its text." A caller that disagrees with the combination
  // must not have to re-derive its inputs.
  const { store } = fresh();
  store.born({ topic: 'work', text: 'employer Acme', volatility: 'slow' });
  const { results } = await E.semanticRecall(store, { query: 'work', embed: toyEmbed });
  for (const k of ['similarity', 'freshness', 'stale', 'score', 'halfLifeDays', 'last_verified_at', 'text']) {
    assert.ok(k in results[0], `result is missing ${k}`);
  }
  assert.strictEqual(results[0].halfLifeDays, 365);
});

// --- bitemporal correctness -----------------------------------------------

await test('recall sees only what was valid at `now`, not superseded versions', async () => {
  const { store, clock } = fresh('2026-01-01T00:00:00.000Z');
  const f = store.born({ topic: 'city', text: 'city Toronto', volatility: 'slow' });
  clock.advanceDays(30);
  store.replace(f.id, { topic: 'city', text: 'city Ottawa', volatility: 'slow' });
  const { results } = await E.semanticRecall(store, { query: 'city', embed: toyEmbed });
  assert.strictEqual(results.length, 1);
  assert.ok(results[0].text.includes('Ottawa'));
});

await test('an explicit `now` in the past recovers the superseded answer', async () => {
  const { store, clock } = fresh('2026-01-01T00:00:00.000Z');
  const f = store.born({ topic: 'city', text: 'city Toronto', volatility: 'slow' });
  clock.advanceDays(30);
  store.replace(f.id, { topic: 'city', text: 'city Ottawa', volatility: 'slow' });
  const { results } = await E.semanticRecall(store, {
    query: 'city', embed: toyEmbed, now: '2026-01-15T00:00:00.000Z',
  });
  assert.ok(results[0].text.includes('Toronto'), `got ${results[0].text}`);
});

await test('recall defaults its clock to the store\'s, not the wall clock', async () => {
  // If it read Date.now() the injected clock would be pointless and every
  // decay test in this file would be measuring today's date instead.
  const { store, clock } = fresh('2026-01-01T00:00:00.000Z');
  store.born({ topic: 'project', text: 'project alpha', volatility: 'fast' });
  clock.advanceDays(30);
  const { results } = await E.semanticRecall(store, { query: 'project', embed: toyEmbed });
  assert.ok(Math.abs(results[0].freshness - 0.5) < 1e-9, `freshness ${results[0].freshness} at exactly one half-life`);
});

// --- the similarity floor -------------------------------------------------

await test('an unrelated fact is filtered out by the similarity floor', async () => {
  const { store } = fresh();
  store.born({ topic: 'car', text: 'car Civic', volatility: 'slow' });
  const { results } = await E.semanticRecall(store, { query: 'employer', embed: toyEmbed });
  assert.strictEqual(results.length, 0);
});

await test('the floor applies to raw similarity, before freshness demotes it', async () => {
  // Applied AFTER modulation, an old-but-correct answer would silently vanish
  // — which is the "nothing stale is dropped" rule broken by the back door.
  const { store, clock } = fresh('2026-01-01T00:00:00.000Z');
  store.born({ topic: 'project', text: 'project alpha', volatility: 'fast' });
  clock.advanceDays(300); // freshness ~1e-3; score is far below MIN_SIMILARITY
  const { results } = await E.semanticRecall(store, { query: 'project', embed: toyEmbed });
  assert.strictEqual(results.length, 1, 'a decayed fact was filtered by the floor');
  assert.ok(results[0].score < E.MIN_SIMILARITY);
  assert.ok(results[0].similarity >= E.MIN_SIMILARITY);
});

await test('minSimilarity is caller-overridable', async () => {
  const { store } = fresh();
  store.born({ topic: 'work', scope: 'city', text: 'employer Acme', volatility: 'slow' });
  const strict = await E.semanticRecall(store, { query: 'work', embed: toyEmbed, minSimilarity: 0.99 });
  const loose = await E.semanticRecall(store, { query: 'work', embed: toyEmbed, minSimilarity: 0.1 });
  assert.strictEqual(strict.results.length, 0);
  assert.strictEqual(loose.results.length, 1);
});

await test('limit caps the result count and keeps the highest scores', async () => {
  const { store, clock } = fresh('2026-01-01T00:00:00.000Z');
  const ids = [];
  for (let i = 0; i < 5; i++) {
    ids.push(store.born({ topic: 'project', text: 'project alpha', volatility: 'fast' }).id);
    clock.advanceDays(5);
  }
  const { results } = await E.semanticRecall(store, { query: 'project', embed: toyEmbed, limit: 2 });
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].id, ids[4], 'the freshest was not kept');
});

// --- a dead embedder is reported, never swallowed --------------------------

await test('no embedder falls back to lexical AND says degraded', async () => {
  const { store } = fresh();
  store.born({ topic: 'work', text: 'employer Acme', volatility: 'slow' });
  const out = await E.semanticRecall(store, { query: 'employer' });
  assert.strictEqual(out.degraded, true);
  assert.strictEqual(out.reason, 'no-embedder');
  assert.strictEqual(out.results.length, 1, 'lexical fallback returned nothing');
});

await test('a throwing embedder degrades rather than throwing at the caller', async () => {
  // The chat must keep answering when ollama is down. A ranking improvement
  // must not be able to take the assistant offline.
  const { store } = fresh();
  store.born({ topic: 'work', text: 'employer Acme', volatility: 'slow' });
  const dead = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:11434'); };
  const out = await E.semanticRecall(store, { query: 'employer', embed: dead });
  assert.strictEqual(out.degraded, true);
  assert.ok(out.reason.includes('ECONNREFUSED'), `reason lost the cause: ${out.reason}`);
  assert.strictEqual(out.results.length, 1);
});

await test('a dead embedder never returns an empty list dressed as a real answer', async () => {
  // [] with degraded:false reads as "no such memory" — the reassuring default
  // this whole design is against.
  const { store } = fresh();
  store.born({ topic: 'work', text: 'employer Acme', volatility: 'slow' });
  const dead = async () => { throw new Error('down'); };
  const out = await E.semanticRecall(store, { query: 'employer', embed: dead });
  assert.notStrictEqual(out.degraded, false);
});

await test('a healthy embedder reports degraded:false and a null reason', async () => {
  const { store } = fresh();
  store.born({ topic: 'work', text: 'employer Acme', volatility: 'slow' });
  const out = await E.semanticRecall(store, { query: 'work', embed: toyEmbed });
  assert.strictEqual(out.degraded, false);
  assert.strictEqual(out.reason, null);
  assert.strictEqual(out.embedded, 1);
  assert.strictEqual(out.total, 1);
});

await test('one fact failing to embed does not lose the others', async () => {
  const { store } = fresh();
  store.born({ topic: 'work', text: 'employer Acme', volatility: 'slow' });
  store.born({ topic: 'city', text: 'city Toronto', volatility: 'slow' });
  const flaky = async (t) => {
    if (t.includes('Toronto')) throw new Error('nope');
    return toyEmbed(t);
  };
  const out = await E.semanticRecall(store, { query: 'work city', embed: flaky });
  assert.ok(out.results.find((r) => r.topic === 'work'), 'the healthy fact was lost');
  assert.strictEqual(out.degraded, true);
  assert.ok(out.reason.includes('could not be embedded'));
});

await test('a fact that could not be embedded still surfaces on a lexical match', async () => {
  const { store } = fresh();
  store.born({ topic: 'city', text: 'city Toronto', volatility: 'slow' });
  const dead = async (t) => { if (t.includes('Toronto')) throw new Error('nope'); return toyEmbed(t); };
  const out = await E.semanticRecall(store, { query: 'Toronto', embed: dead });
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.results[0].similarity, null, 'a lexical hit must not claim a similarity');
});

await test('a lexical-only hit sorts below a real semantic match of the same age', async () => {
  const { store } = fresh();
  store.born({ topic: 'work', text: 'employer work Acme', volatility: 'slow' });
  store.born({ topic: 'city', text: 'work Toronto', volatility: 'slow' });
  const partial = async (t) => { if (t.includes('Toronto')) throw new Error('nope'); return toyEmbed(t); };
  const out = await E.semanticRecall(store, { query: 'work', embed: partial });
  assert.strictEqual(out.results[0].topic, 'work');
  assert.strictEqual(out.results[1].similarity, null);
});

// --- input validation -----------------------------------------------------

await test('an empty query is rejected rather than matching everything', async () => {
  const { store } = fresh();
  store.born({ topic: 'work', text: 'employer Acme', volatility: 'slow' });
  for (const q of ['', '   ', null, undefined, 7]) {
    await assert.rejects(() => E.semanticRecall(store, { query: q, embed: toyEmbed }), /needs a query/);
  }
});

await test('an empty store returns no results and is not degraded', async () => {
  const { store } = fresh();
  const out = await E.semanticRecall(store, { query: 'anything', embed: toyEmbed });
  assert.deepStrictEqual(out.results, []);
  assert.strictEqual(out.degraded, false);
  assert.strictEqual(out.total, 0);
});

// --- ollamaEmbedder, with an injected fetch -------------------------------

await test('ollamaEmbedder posts the model and prompt to /api/embeddings', async () => {
  let seen = null;
  const fetchFn = async (url, opts) => {
    seen = { url, body: JSON.parse(opts.body), method: opts.method };
    return { ok: true, json: async () => ({ embedding: [1, 2, 3] }) };
  };
  const embed = E.ollamaEmbedder({ fetchFn });
  const vec = await embed('hello');
  assert.deepStrictEqual(vec, [1, 2, 3]);
  assert.strictEqual(seen.method, 'POST');
  assert.strictEqual(seen.url, `${E.OLLAMA_BASE}/api/embeddings`);
  assert.strictEqual(seen.body.model, E.EMBED_MODEL);
  assert.strictEqual(seen.body.prompt, 'hello');
});

await test('ollamaEmbedder defaults to the model bootstrap/install.sh pulls', () => {
  assert.strictEqual(E.EMBED_MODEL, 'nomic-embed-text');
});

await test('a non-ok response throws with the status, not a silent empty vector', async () => {
  const fetchFn = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => E.ollamaEmbedder({ fetchFn })('hi'), /503/);
});

await test('a 200 with no embedding names the missing pull, not the daemon', async () => {
  // These are different failures and send you to different fixes: a refused
  // connection means start ollama, an empty 200 means `ollama pull`.
  const fetchFn = async () => ({ ok: true, json: async () => ({}) });
  await assert.rejects(() => E.ollamaEmbedder({ fetchFn })('hi'), /is it pulled/);
});

await test('an empty-array embedding is rejected the same as a missing one', async () => {
  const fetchFn = async () => ({ ok: true, json: async () => ({ embedding: [] }) });
  await assert.rejects(() => E.ollamaEmbedder({ fetchFn })('hi'), /is it pulled/);
});

await test('ollamaEmbedder passes an abort signal so a hung daemon cannot hang the chat', async () => {
  let sawSignal = false;
  const fetchFn = async (_u, opts) => {
    sawSignal = !!opts.signal;
    return { ok: true, json: async () => ({ embedding: [1] }) };
  };
  await E.ollamaEmbedder({ fetchFn })('hi');
  assert.strictEqual(sawSignal, true);
});

// process._getActiveHandles() DOES NOT SEE TIMERS. Both of these tests were
// written with it first, and both passed against a build with clearTimeout
// deleted — they were asserting 0 <= 0. Mutation testing caught it; the
// zero-assertion defect class this repo hunts, inside a suite written to hunt
// it. process.getActiveResourcesInfo() is the API that reports 'Timeout'.
const liveTimers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

await test('the fixture can see a live timer at all (guards the two tests below)', () => {
  // Without this, a Node version that stops reporting 'Timeout' turns both
  // timer tests silently vacuous again rather than failing.
  const before = liveTimers();
  const t = setTimeout(() => {}, 60000);
  assert.strictEqual(liveTimers(), before + 1, 'getActiveResourcesInfo no longer reports Timeout');
  clearTimeout(t);
  assert.strictEqual(liveTimers(), before);
});

await test('the abort timer is cleared on success — a live timer would hold the loop open', async () => {
  // The truncation bug in reverse: a pending 10s timer keeps the process
  // alive past finish(). If this regresses, this very suite stops exiting.
  const fetchFn = async () => ({ ok: true, json: async () => ({ embedding: [1] }) });
  const before = liveTimers();
  await E.ollamaEmbedder({ fetchFn })('hi');
  assert.strictEqual(liveTimers(), before, 'an abort timer outlived a successful request');
});

await test('the abort timer is cleared on failure too', async () => {
  const fetchFn = async () => { throw new Error('boom'); };
  const before = liveTimers();
  await assert.rejects(() => E.ollamaEmbedder({ fetchFn })('hi'), /boom/);
  assert.strictEqual(liveTimers(), before, 'an abort timer outlived a failed request');
});

// --- the layering rule ----------------------------------------------------

await test('memory-sweep.js does not import this module', () => {
  // Template §6: detection must be pure lookups, no model calls, so it is
  // cheap enough to run continuously. This module can reach a model.
  // Comments are stripped first: three earlier versions of this check in this
  // repo flagged a module's own documentation of the rule it obeys.
  const src = fs.readFileSync(path.join(__dirname, 'memory-sweep.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/require\(['"]\.\/memory-embed/.test(src),
    'memory-sweep.js imports memory-embed.js — detection must not be able to call a model');
});

await test('this module opens no socket of its own outside ollamaEmbedder', () => {
  const src = fs.readFileSync(path.join(__dirname, 'memory-embed.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['http', 'https', 'net', 'child_process']) {
    assert.ok(!new RegExp(`require\\(['"]${banned}['"]\\)`).test(src),
      `memory-embed.js requires ${banned}`);
  }
  // The only bare `fetch` is the injectable default parameter. Counting raw
  // occurrences would count `fetchFn` too, which is the injected seam itself
  // and the opposite of a violation — so the seam's name is removed first.
  const bare = src.replace(/fetchFn/g, '');
  assert.strictEqual((bare.match(/fetch/g) || []).length, 1,
    `a bare fetch call outside the injected default: ${(bare.match(/.*fetch.*/g) || []).join(' | ')}`);
});

finish();
})();
