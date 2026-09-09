// BITEMPORAL MEMORY LAYER 4 — the policy: what a new fact does to an old one.
//
// The judgements worth pinning are the ones that are wrong in ways nobody
// notices for months:
//
//   coexist vs replace   the difference between a store that remembers you
//                        work two jobs and one that thinks you keep changing
//                        jobs. Turns entirely on topic-vs-scope, which the
//                        template flags as where the ambiguity bugs live.
//   reaffirm vs born     a restatement is EVIDENCE, not news. Getting this
//                        wrong is how a store fills with duplicates of one
//                        fact, each looking independently corroborated.
//   replace vs park      replacing retires information, so it clears the
//                        higher bar; and a contradiction on a stable fact
//                        parks at ANY confidence, because high confidence is
//                        what an extraction error looks like from inside.
//
// And the invariant under all of them: NOTHING HERE WRITES. Every function
// returns a decision. A test below asserts the module cannot reach the store.
const { test, finish, assert } = require('./test-helper.js');
const P = require('./memory-policy.js');
const { THRESHOLDS } = require('./memory-bitemporal.js');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

/** A stored, currently-true fact as recall() returns it. */
const fact = (over = {}) => ({
  id: 'f1', topic: 'city', scope: '', text: 'Pune', value: 'Pune',
  volatility: 'slow', confidence: 1, status: 'active', ...over,
});

/** A candidate arriving from extraction. */
const cand = (over = {}) => ({
  topic: 'city', scope: '', text: 'Bengaluru', value: 'Bengaluru',
  volatility: 'slow', confidence: 0.9, ...over,
});

(async () => {

// --- born ------------------------------------------------------------------

await test('nothing comparable stored means born, at the LOWER add bar', () => {
  // Adding is the cheap direction: being wrong leaves a duplicate, not a hole.
  const d = P.decideFact(cand({ confidence: THRESHOLDS.add }), []);
  assert.strictEqual(d.action, 'born');
  assert.strictEqual(d.routing, 'auto');
  assert.strictEqual(d.targetId, null);
});

await test('below the add bar even a new fact parks', () => {
  const d = P.decideFact(cand({ confidence: 0.3 }), []);
  assert.strictEqual(d.action, 'park');
  assert.ok(d.why.some((w) => /below the add bar/.test(w)), `why: ${d.why}`);
});

// --- coexist: the judgement most likely to be silently wrong ---------------

await test('a different SCOPE under the same topic coexists — it does not replace', () => {
  // "works at Acme (weekdays)" must not retire "works at Beta (weekends)".
  // Getting this wrong turns a store that remembers two jobs into one that
  // thinks you keep changing jobs.
  const stored = [fact({ id: 'j1', topic: 'employer', scope: 'weekday', value: 'Acme' })];
  const c = cand({ topic: 'employer', scope: 'weekend', value: 'Beta', text: 'Beta' });
  const d = P.decideFact(c, stored);
  assert.strictEqual(d.action, 'born', 'a new scope is a new interval, not a replacement');
  assert.strictEqual(d.targetId, null, 'nothing is retired');
  assert.ok(P.wouldCoexist(c, stored));
  assert.ok(d.why.some((w) => /other scopes are unaffected/.test(w)), `why: ${d.why}`);
});

await test('the SAME scope is a rival, so it does not coexist', () => {
  const stored = [fact({ topic: 'employer', scope: 'weekday', value: 'Acme' })];
  const c = cand({ topic: 'employer', scope: 'weekday', value: 'Beta' });
  assert.strictEqual(P.wouldCoexist(c, stored), false);
  assert.strictEqual(P.decideFact(c, stored).action, 'replace');
});

await test('an empty scope and a missing scope are the same scope', () => {
  // Or the same fact arrives twice under two spellings of "no scope" and
  // coexists with itself forever.
  const stored = [fact({ scope: '' })];
  const c = cand({ value: 'Pune', text: 'Pune' });
  delete c.scope;
  assert.strictEqual(P.decideFact(c, stored).action, 'reaffirm');
});

// --- reaffirm: a restatement is evidence, not news -------------------------

await test('restating a stored fact reaffirms it rather than creating a duplicate', () => {
  // last_verified_at is what freshness decays from, so this is the single most
  // valuable event in the design: a fact reconfirmed today is fresh however
  // old it is.
  const stored = [fact()];
  const d = P.decideFact(cand({ value: 'Pune', text: 'Pune' }), stored);
  assert.strictEqual(d.action, 'reaffirm');
  assert.strictEqual(d.targetId, 'f1');
  assert.strictEqual(d.routing, 'auto', 'restating what is stored destroys nothing, so it is ungated');
});

await test('a reaffirm is recognised despite case and whitespace', () => {
  const d = P.decideFact(cand({ value: '  pune ', text: '  pune ' }), [fact()]);
  assert.strictEqual(d.action, 'reaffirm');
});

await test('a low-confidence restatement still reaffirms', () => {
  // It adds nothing and removes nothing; gating it would just let a fact rot
  // while being repeatedly confirmed.
  const d = P.decideFact(cand({ value: 'Pune', text: 'Pune', confidence: 0.1 }), [fact()]);
  assert.strictEqual(d.action, 'reaffirm');
});

await test('comparison falls back to text when either side has no value', () => {
  const stored = [fact({ value: null, text: 'lives in Pune' })];
  const d = P.decideFact(cand({ value: null, text: 'lives in Pune' }), stored);
  assert.strictEqual(d.action, 'reaffirm');
});

// --- replace vs park -------------------------------------------------------

await test('a contradiction above the RETIRE bar replaces', () => {
  const d = P.decideFact(cand({ confidence: THRESHOLDS.retire }), [fact()]);
  assert.strictEqual(d.action, 'replace');
  assert.strictEqual(d.targetId, 'f1');
  assert.ok(d.why.some((w) => /contradicts the stored "Pune"/.test(w)), `why: ${d.why}`);
});

await test('a contradiction between the two bars PARKS — retiring costs more than adding', () => {
  // The asymmetry made concrete: this same confidence would have been enough
  // to add a new fact, and is not enough to retire an existing one.
  const between = (THRESHOLDS.add + THRESHOLDS.retire) / 2;
  assert.ok(between > THRESHOLDS.add && between < THRESHOLDS.retire);
  assert.strictEqual(P.decideFact(cand({ confidence: between }), []).action, 'born');
  const d = P.decideFact(cand({ confidence: between }), [fact()]);
  assert.strictEqual(d.action, 'park');
  assert.ok(d.why.some((w) => /below the retire bar/.test(w)), `why: ${d.why}`);
});

await test('a contradiction on a STABLE fact parks at any confidence', () => {
  const stored = [fact({ topic: 'birthday', volatility: 'stable', value: '1990-01-01' })];
  const d = P.decideFact(
    cand({ topic: 'birthday', volatility: 'stable', value: '1991-02-02', confidence: 1 }), stored);
  assert.strictEqual(d.action, 'park');
  assert.ok(d.why.some((w) => /extraction error/.test(w)), `why: ${d.why}`);
});

await test('a park still names its target, so the human inbox knows what is in question', () => {
  const d = P.decideFact(cand({ confidence: 0.65 }), [fact()]);
  assert.strictEqual(d.action, 'park');
  assert.strictEqual(d.targetId, 'f1', 'a proposal with no target is unreviewable');
});

// --- refusals --------------------------------------------------------------

await test('a store already contradicting itself gets no third opinion', () => {
  const stored = [fact({ id: 'a', value: 'Pune' }), fact({ id: 'b', value: 'Delhi' })];
  const d = P.decideFact(cand(), stored);
  assert.strictEqual(d.action, 'park');
  assert.strictEqual(d.targetId, null);
  assert.ok(d.why.some((w) => /contradicts itself/.test(w)), `why: ${d.why}`);
});

await test('a candidate with no topic parks rather than being filed somewhere', () => {
  const d = P.decideFact({ text: 'something', confidence: 1 }, []);
  assert.strictEqual(d.action, 'park');
  assert.ok(d.why.some((w) => /no topic/.test(w)));
});

await test('an unknown volatility class parks rather than defaulting to a shelf life', () => {
  const d = P.decideFact(cand({ volatility: 'occasionally' }), []);
  assert.strictEqual(d.action, 'park');
  assert.ok(d.why.some((w) => /unknown volatility/.test(w)));
});

await test('a candidate with no confidence is treated as zero, not as certain', () => {
  const c = cand(); delete c.confidence;
  assert.strictEqual(P.decideFact(c, []).action, 'park',
    'a missing claim must never read as a confident one — same rule as guard.js v5');
});

await test('every action returned is in the closed set', () => {
  const cases = [
    [cand(), []], [cand(), [fact()]], [cand({ value: 'Pune' }), [fact()]],
    [{ text: 'x' }, []], [cand({ volatility: 'nope' }), []],
    [cand(), [fact({ id: 'a' }), fact({ id: 'b', value: 'Delhi' })]],
  ];
  for (const [c, s] of cases) {
    const d = P.decideFact(c, s);
    assert.ok(P.ACTIONS.includes(d.action), `${d.action} is not a declared action`);
    assert.ok(['auto', 'parked'].includes(d.routing), `${d.routing} is not a routing`);
    assert.ok(Array.isArray(d.why) && d.why.length > 0, 'every decision must say why');
  }
});

// --- extraction is injected, never defaulted -------------------------------

await test('extractWith refuses to run without an extractor', async () => {
  // A default extractor would become the implementation nobody replaced.
  await assert.rejects(() => P.extractWith(undefined, 'I moved'), /deliberately no default/);
  await assert.rejects(() => P.extractWith('not a fn', 'I moved'), /deliberately no default/);
});

await test('extractWith decides on each candidate the extractor yields', async () => {
  const extract = async () => [cand({ value: 'Pune', text: 'Pune' }), cand({ topic: 'pet', value: 'cat' })];
  const out = await P.extractWith(extract, 'anything', [fact()]);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].decision.action, 'reaffirm');
  assert.strictEqual(out[1].decision.action, 'born');
});

await test('candidates are decided against ONE snapshot, not against each other', () => {
  // Applying decision N before deciding N+1 would make this a writer. Two
  // candidates contradicting the same stored fact must therefore BOTH be
  // judged against that fact, and layer 5 resolves the collision.
  const stored = [fact()];
  const a = P.decideFact(cand({ value: 'Delhi', confidence: 0.9 }), stored);
  const b = P.decideFact(cand({ value: 'Mumbai', confidence: 0.9 }), stored);
  assert.strictEqual(a.targetId, 'f1');
  assert.strictEqual(b.targetId, 'f1', 'the second must not see the first as already applied');
});

await test('a non-array from the extractor is refused rather than iterated', async () => {
  await assert.rejects(() => P.extractWith(async () => ({ topic: 'city' }), 'x'), /must return an array/);
});

await test('an extractor yielding nothing is fine and decides nothing', async () => {
  assert.deepStrictEqual(await P.extractWith(async () => [], 'x'), []);
  assert.deepStrictEqual(await P.extractWith(async () => null, 'x'), []);
});

// --- the invariant ---------------------------------------------------------

await test('this layer cannot write — it proposes and nothing else', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('./memory-policy.js'), 'utf8');
  const requires = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(requires, ['./memory-bitemporal.js'],
    'the policy may read the gate and nothing else');

  // Check what is DESTRUCTURED, not what is mentioned. The header names
  // openStore().recall() in prose to explain what layer 3 already provides,
  // and a substring check flags the module's own documentation — the same
  // false positive weekly-sweep.js hit on its own write-up.
  const imported = /const \{([^}]*)\} = require\('\.\/memory-bitemporal\.js'\);/.exec(src);
  assert.ok(imported, 'expected a destructured import from the store module');
  const names = imported[1].split(',').map((n) => n.trim()).filter(Boolean).sort();
  assert.deepStrictEqual(names, ['THRESHOLDS', 'VOLATILITY', 'decide'],
    'importing openStore (or any writer) would make layer 4 a writer');

  // These have no innocent reading in this file: none is a String method and
  // none appears in its prose.
  for (const forbidden of ['appendFileSync', 'writeFileSync', 'mkdirSync']) {
    assert.ok(!src.includes(forbidden),
      `layer 4 must not write; found "${forbidden}" — that is layer 5's job`);
  }
});

await test('the rendered proposal says nothing was applied', () => {
  const text = P.format([{ candidate: cand(), decision: P.decideFact(cand(), [fact()]) }]);
  assert.match(text, /Nothing here has been written/);
  assert.match(text, /layer 5/i);
});

finish();
})();
