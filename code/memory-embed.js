/**
 * BITEMPORAL MEMORY — layer 3 of the template's build order: embed + recall.
 *
 * PLAN_5 §7 Tier 3 item 10. docs/incoming/MEMORY_TEMPLATE.txt §8 item 3:
 * "Embed + recall — retrieval that returns a fact's age/confidence alongside
 * its content, not just its text."
 *
 *   1. clock abstraction          code/memory-bitemporal.js
 *   2. store + read/write helpers code/memory-bitemporal.js
 *   3. embed + recall             <- here
 *   4. extract + classify + policy  code/memory-policy.js
 *   5. repair (the one writer)      code/memory-repair.js
 *   6. detect + propose + sweep     code/memory-sweep.js
 *   7. human inbox                  code/memory-inbox.js
 *
 * WHY THIS LAYER WAS BUILT LAST despite being third in the order. It is the
 * only layer that needs a model — `nomic-embed-text` via ollama on
 * 127.0.0.1:11434 — and the remote session that built layers 4-7 has no
 * ollama. The other six layers were finishable without it, so they were
 * finished first and this one was recorded as blocked. That was half right:
 * the LIVE embedder needs the Chromebook, but the layer does not, because the
 * embedder is an argument like the clock and the repairFn before it. What is
 * below is complete and tested; what needs the Chromebook is one function
 * (`ollamaEmbedder`) and the verification that it returns what this expects.
 *
 * THE FAILURE THIS LAYER IS DESIGNED AGAINST, in the template's own words
 * (§1): "A memory that was true is the dangerous case. It embedded perfectly,
 * retrieves with the highest score" -- and is then stated with total
 * confidence. So a semantic recall that ranks by similarity ALONE actively
 * makes this system worse than the exact-topic `recall()` it sits beside: it
 * is precisely the mechanism by which a year-old truth outranks this week's.
 * Ranking here is therefore similarity MODULATED BY FRESHNESS, and the two
 * inputs are both returned so a caller can disagree with the combination
 * without re-deriving it.
 *
 * NOTHING STALE IS DROPPED. Demoted, flagged, but returned. Dropping it would
 * destroy the one answer this store exists to give -- "I believed X, and it
 * may now be out of date" -- and replace it with silence, which reads as "I
 * never knew X". Silence is the reassuring default this whole PR is built
 * against.
 *
 * THE STALENESS THRESHOLD IS NOT REDEFINED HERE. It is
 * THRESHOLDS.freshnessFloor, imported, the same number `recall()` and
 * `memory-sweep.js` use -- template §9's checklist item "Do retrieval and the
 * sweep use the same staleness threshold?". Two numbers for one word
 * contradict each other in front of a user: retrieval says "may be out of
 * date" while the sweep calls it fine.
 *
 * AN UNREACHABLE EMBEDDER IS REPORTED, NEVER SWALLOWED. If ollama is down,
 * `semanticRecall` falls back to the lexical path and says so in
 * `degraded`/`reason`. It does not return an empty list (which reads as "no
 * such memory") and it does not throw (which would take the chat down over a
 * ranking improvement). Same rule as `jj status` and the v5 gate: an unknown
 * gets its own value and never defaults to the reassuring one.
 *
 * THE SWEEP MUST NOT IMPORT THIS. Template §6: "Detection should be pure
 * lookups against your own metadata -- no model calls, so it's cheap enough to
 * run continuously." memory-sweep.js has a test asserting it imports nothing
 * that can reach a model, and this module can. Retrieval may embed; detection
 * may not.
 */
const crypto = require('crypto');
const { THRESHOLDS, VOLATILITY, freshness } = require('./memory-bitemporal.js');

/** The model bootstrap/install.sh step 3 already pulls. Unwired until now. */
const EMBED_MODEL = 'nomic-embed-text';
const OLLAMA_BASE = 'http://127.0.0.1:11434';

/**
 * Below this, a fact is not an answer to the query -- it is noise that happens
 * to share a word. Deliberately low: the freshness modulation below can only
 * push a score DOWN, so a floor applied after modulation would silently drop
 * old-but-correct answers. It is applied to raw similarity, before.
 */
const MIN_SIMILARITY = 0.25;

/**
 * Cosine similarity. Returns 0 -- not NaN -- for a zero vector, because a NaN
 * propagates through the sort and reorders results arbitrarily rather than
 * failing loudly.
 */
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** What a fact's embedding is computed over, and what the cache is keyed on. */
const embedText = (row) => [row.topic, row.scope, row.text].filter(Boolean).join(' — ');
const cacheKey = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * THE LIVE EMBEDDER. `fetchFn` is an argument so every test in
 * test-memory-embed.js runs without a socket; the default is real `fetch` so
 * production needs no wiring. Unverified against a running daemon as of
 * 2026-09-09 -- see the header. `/api/embeddings` is ollama's single-input
 * endpoint and returns `{ embedding: [...] }`.
 */
function ollamaEmbedder({ fetchFn = fetch, base = OLLAMA_BASE, model = EMBED_MODEL, timeoutMs = 10000 } = {}) {
  return async function embed(text) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${base}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`ollama /api/embeddings returned ${res.status}`);
      const body = await res.json();
      if (!Array.isArray(body.embedding) || !body.embedding.length) {
        // A 200 with no vector is a DIFFERENT failure from a refused
        // connection -- usually the model was never pulled -- and saying so
        // saves the next person from debugging the daemon instead of the pull.
        throw new Error(`ollama returned no embedding for model "${model}" (is it pulled?)`);
      }
      return body.embedding;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * An in-process cache keyed by content hash. The store is append-only, so
 * `reaffirm` writes a new row version with byte-identical text; without this,
 * every recall re-embeds every version of every fact. Keyed by TEXT, not by
 * row id or version, so the versions share one entry.
 */
function makeCache(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get: (k) => map.get(k),
    set: (k, v) => map.set(k, v),
    has: (k) => map.has(k),
    get size() { return map.size; },
  };
}

/**
 * SEMANTIC RECALL over the store's currently-valid facts.
 *
 * Takes the store rather than a file so it inherits the store's injected
 * clock: "what do I know about X" and "what did I know about X in April" are
 * the same query with a different `now`, and re-deriving time here would let
 * the two answers drift.
 *
 * Returns an OBJECT, not an array, because the caller has to be able to tell
 * "nothing matched" from "the embedder was down and this is lexical". Both
 * produce results; only one of them means what it looks like.
 */
async function semanticRecall(store, {
  query,
  embed = null,
  now = null,
  limit = 10,
  minSimilarity = MIN_SIMILARITY,
  cache = makeCache(),
} = {}) {
  const at = now || store.clock.iso();
  if (typeof query !== 'string' || !query.trim()) throw new Error('semanticRecall needs a query');

  const rows = store.validAt(at);
  const lexical = () => rows
    .filter((r) => embedText(r).toLowerCase().includes(query.trim().toLowerCase()))
    .map((r) => decorate(r, null, at))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (typeof embed !== 'function') {
    return { results: lexical(), degraded: true, reason: 'no-embedder', embedded: 0, total: rows.length };
  }

  let queryVec;
  try {
    queryVec = await embed(query);
  } catch (e) {
    // The chat must keep answering when ollama is down. It just must not
    // claim the answer was ranked semantically.
    return { results: lexical(), degraded: true, reason: `embedder-failed: ${e.message}`, embedded: 0, total: rows.length };
  }

  const scored = [];
  let embedded = 0, failed = 0;
  for (const row of rows) {
    const text = embedText(row);
    const key = cacheKey(text);
    let vec = cache.get(key);
    if (vec === undefined) {
      try {
        vec = await embed(text);
        cache.set(key, vec);
      } catch (_e) {
        // One fact failing to embed must not lose the other nineteen, and
        // must not silently vanish either -- it falls through to the lexical
        // test below and is counted.
        vec = null;
        failed++;
      }
    }
    if (vec) embedded++;
    const sim = vec ? cosine(queryVec, vec) : null;
    if (sim === null) {
      if (text.toLowerCase().includes(query.trim().toLowerCase())) scored.push(decorate(row, null, at));
      continue;
    }
    if (sim < minSimilarity) continue;
    scored.push(decorate(row, sim, at));
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    results: scored.slice(0, limit),
    degraded: failed > 0,
    reason: failed > 0 ? `${failed} of ${rows.length} facts could not be embedded` : null,
    embedded,
    total: rows.length,
  };
}

/**
 * One result row. Carries similarity and freshness SEPARATELY as well as the
 * combined score, because a caller that disagrees with the combination should
 * not have to re-derive its inputs -- and because a UI that says "I know this,
 * but I last confirmed it 14 months ago" needs the age, which is the whole
 * point of template §8 item 3 ("age/confidence alongside its content").
 *
 * score = similarity x freshness. Multiplicative, not a weighted sum: a sum
 * lets a perfect embedding carry a dead fact to the top on similarity alone,
 * which is exactly the failure in the header. A `stable` fact barely moves
 * (3650-day half-life), a `fast` one falls off in weeks, and `scheduled` never
 * decays because it ends instead.
 *
 * A lexical-only hit has similarity null and scores on freshness alone -- it
 * sorts below any real semantic match of comparable age, which is right: it
 * matched a substring, not a meaning.
 */
function decorate(row, similarity, at) {
  const f = freshness(row, at);
  return {
    ...row,
    similarity,
    freshness: f,
    stale: f < THRESHOLDS.freshnessFloor,
    halfLifeDays: VOLATILITY[row.volatility]?.halfLifeDays ?? null,
    score: similarity === null ? f * MIN_SIMILARITY : similarity * f,
  };
}

module.exports = {
  semanticRecall, ollamaEmbedder, cosine, makeCache,
  embedText, cacheKey, decorate,
  EMBED_MODEL, OLLAMA_BASE, MIN_SIMILARITY,
};
