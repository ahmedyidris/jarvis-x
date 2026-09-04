// The eval harness decides whether the self-debug loop is allowed to be built
// (REMAINING_WORK.md P0). A harness that scores itself generously is worse
// than no harness -- it produces a number with a gate attached and nobody
// re-derives it. So the scoring logic is tested here with an injected
// `propose`, no model involved.
//
// The load-bearing test is the last one: it recomputes the word overlap
// between every 'held-out' case and agent.js's actual few-shot examples, and
// fails if one has drifted into being a copy. That is the exact bug this
// rewrite exists to fix -- one case was verbatim identical and four more were
// near-copies -- and nothing but a test stops it recurring.
const fs = require('fs');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const E = require('./eval-agent.js');
const { CASES, CATEGORIES } = require('./eval-cases.js');

// A fake agent. `answers` maps goal -> type; anything unmapped returns the
// fallback, so a test can make exactly the cases it cares about pass.
const agent = (answers, fallback = 'answer') =>
  async (goal) => ({ action: { type: goal in answers ? answers[goal] : fallback } });

// Answers correctly for whichever case list it is given -- the shipped one by
// default, or a synthetic spec. The first version only knew CASES, so every
// synthetic case threw and scored as a failure for the wrong reason.
const oracleFor = (list) => async (goal) => {
  const c = list.find(x => x.goal === goal);
  if (!c) throw new Error(`oracle has no answer for "${goal}"`);
  return { action: { type: c.expect[0] } };
};
const oracle = oracleFor(CASES);

const cases = (...specs) => specs.map(([goal, expect, category, origin]) =>
  ({ goal, expect, category, origin }));

(async () => {

// ── runOnce: reading the agent's answer ───────────────────────────────────
await test('a correct answer scores as a pass', async () => {
  const r = await E.runOnce(oracle);
  assert.strictEqual(r.length, CASES.length);
  assert.ok(r.every(x => x.ok), 'an oracle must score 100%');
});

await test('a wrong answer scores as a fail, and the answer is recorded', async () => {
  const r = await E.runOnce(agent({}, 'shell'),
    cases(['g', ['list'], 'list', 'held-out']));
  assert.strictEqual(r[0].ok, false);
  assert.strictEqual(r[0].got, 'shell', 'what it actually said must be kept, not just the verdict');
});

await test('both response shapes are read', async () => {
  const viaProposed = async () => ({ proposed: { type: 'list' } });
  const r = await E.runOnce(viaProposed, cases(['g', ['list'], 'list', 'held-out']));
  assert.strictEqual(r[0].ok, true, 'r.proposed is as valid a shape as r.action');
});

await test('a thrown error is a failure, not a crash', async () => {
  const boom = async () => { throw new Error('Ollama unreachable'); };
  const r = await E.runOnce(boom, cases(['g', ['list'], 'list', 'held-out']));
  assert.strictEqual(r[0].ok, false);
  assert.ok(/Ollama unreachable/.test(r[0].err), r[0].err);
});

await test('a null action is a failure, never a pass', async () => {
  const empty = async () => ({});
  const r = await E.runOnce(empty, cases(['g', ['answer'], 'answer', 'held-out']));
  assert.strictEqual(r[0].got, null);
  assert.strictEqual(r[0].ok, false, 'no answer must not satisfy an expectation');
});

await test('a lenient case passes on any of its accepted types', async () => {
  const spec = cases(['g', ['read', 'answer', 'query'], 'ambiguous', 'held-out']);
  for (const t of ['read', 'answer', 'query']) {
    const r = await E.runOnce(agent({}, t), spec);
    assert.strictEqual(r[0].ok, true, t);
  }
  const r = await E.runOnce(agent({}, 'write'), spec);
  assert.strictEqual(r[0].ok, false, 'but not on a type outside the list');
});

// ── summarize: the split that matters ─────────────────────────────────────
const MIXED = cases(
  ['m1', ['list'], 'list', 'mirror'],
  ['m2', ['list'], 'list', 'mirror'],
  ['h1', ['list'], 'list', 'held-out'],
  ['h2', ['list'], 'list', 'held-out'],
);

await test('held-out and mirror are scored separately', async () => {
  // mirrors pass, held-out fail: the overfitting signature.
  const s = E.summarize(await E.runOnce(
    agent({ m1: 'list', m2: 'list', h1: 'shell', h2: 'shell' }), MIXED));
  assert.strictEqual(s.mirror.accuracy, 1);
  assert.strictEqual(s.heldOut.accuracy, 0);
  assert.strictEqual(s.overall.accuracy, 0.5,
    'the overall number hides exactly this, which is why it is not the gate');
});

await test('the gap is mirror minus held-out', async () => {
  const s = E.summarize(await E.runOnce(
    agent({ m1: 'list', m2: 'list', h1: 'list', h2: 'shell' }), MIXED));
  assert.strictEqual(s.gap, 0.5);
});

await test('no gap is reported when one side is empty', async () => {
  const spec = cases(['h', ['list'], 'list', 'held-out']);
  const s = E.summarize(await E.runOnce(oracleFor(spec), spec));
  assert.strictEqual(s.mirror.total, 0);
  assert.strictEqual(s.mirror.accuracy, null, 'zero cases is not zero percent');
  assert.strictEqual(s.gap, null);
});

// ── the gate ──────────────────────────────────────────────────────────────
await test('the gate is judged on held-out only, never on the overall number', async () => {
  // 100% on mirrors would carry the overall score above the gate. It must not.
  const many = [];
  for (let i = 0; i < 30; i++) many.push([`m${i}`, ['list'], 'list', 'mirror']);
  for (let i = 0; i < 30; i++) many.push([`h${i}`, ['list'], 'list', 'held-out']);
  const answers = {};
  for (let i = 0; i < 30; i++) answers[`m${i}`] = 'list';
  for (let i = 0; i < 30; i++) answers[`h${i}`] = i < 15 ? 'list' : 'shell';  // 50% held-out
  const s = E.summarize(await E.runOnce(agent(answers), cases(...many)));
  assert.strictEqual(s.overall.accuracy, 0.75);
  assert.strictEqual(s.heldOut.accuracy, 0.5);
  assert.strictEqual(s.gateMet, false, '75% overall must not pass a gate the held-out set fails');
  assert.strictEqual(s.gateBasis, 'held-out');
});

await test('too few held-out cases yields no verdict rather than a confident one', async () => {
  const few = [];
  for (let i = 0; i < E.MIN_HELDOUT - 1; i++) few.push([`h${i}`, ['list'], 'list', 'held-out']);
  const spec = cases(...few);
  const s = E.summarize(await E.runOnce(oracleFor(spec), spec));
  assert.strictEqual(s.heldOut.accuracy, 1, 'a perfect score...');
  assert.strictEqual(s.gateUndecidable, true, '...on too small a sample is still undecidable');
  assert.strictEqual(s.gateMet, false, 'and must never read as met');
});

await test('exactly the minimum is enough to decide', async () => {
  const n = [];
  for (let i = 0; i < E.MIN_HELDOUT; i++) n.push([`h${i}`, ['list'], 'list', 'held-out']);
  const spec = cases(...n);
  const s = E.summarize(await E.runOnce(oracleFor(spec), spec));
  assert.strictEqual(s.gateUndecidable, false);
  assert.strictEqual(s.gateMet, true);
});

// ── the cuts ──────────────────────────────────────────────────────────────
await test('every category is scored separately', async () => {
  const s = E.summarize(await E.runOnce(oracle));
  for (const cat of CATEGORIES) {
    assert.ok(s.byCategory[cat], `missing category ${cat}`);
    assert.ok(s.byCategory[cat].total > 0, `${cat} has no cases`);
  }
});

await test('strict and lenient cases are counted apart', async () => {
  const spec = cases(
    ['strict', ['list'], 'list', 'held-out'],
    ['loose', ['list', 'shell', 'answer'], 'ambiguous', 'held-out'],
  );
  const s = E.summarize(await E.runOnce(agent({}, 'shell'), spec));
  assert.strictEqual(s.strict.passed, 0, 'the single-answer case failed');
  assert.strictEqual(s.lenient.passed, 1, 'the multi-answer case passed on leniency');
});

// ── variance across runs ──────────────────────────────────────────────────
await test('repeated runs report a mean and a spread', async () => {
  const spec = cases(['h', ['list'], 'list', 'held-out']);
  const summaries = [];
  for (const t of ['list', 'shell', 'list', 'list']) {
    const s = E.summarize(await E.runOnce(agent({}, t), spec));
    s._results = await E.runOnce(agent({}, t), spec);
    summaries.push(s);
  }
  const agg = E.aggregate(summaries);
  assert.strictEqual(agg.runs, 4);
  assert.strictEqual(agg.heldOutMean, 0.75);
  assert.strictEqual(agg.heldOutMin, 0);
  assert.strictEqual(agg.heldOutMax, 1);
  assert.ok(agg.heldOutStdDev > 0, 'a spread this wide must not report as zero');
});

await test('a case that changes its answer between runs is named', async () => {
  const spec = cases(['flaky', ['list'], 'list', 'held-out'],
                     ['steady', ['list'], 'list', 'held-out']);
  const summaries = [];
  for (const t of ['list', 'shell']) {
    const results = await E.runOnce(agent({ steady: 'list' }, t), spec);
    const s = E.summarize(results);
    s._results = results;
    summaries.push(s);
  }
  const agg = E.aggregate(summaries);
  assert.strictEqual(agg.unstable.length, 1);
  assert.strictEqual(agg.unstable[0].goal, 'flaky',
    'an unreliable case is more actionable than the average that hides it');
});

// ── the printed report ────────────────────────────────────────────────────
await test('a wide gap is called out in words, not left as a number to notice', async () => {
  const s = E.summarize(await E.runOnce(
    agent({ m1: 'list', m2: 'list', h1: 'shell', h2: 'shell' }), MIXED));
  const out = E.format(s, null);
  assert.ok(/reciting the prompt/.test(out), out);
});

await test('a refusal miss is called out as what it actually means', async () => {
  const spec = cases(['r', ['answer'], 'refuse', 'held-out']);
  const out = E.format(E.summarize(await E.runOnce(agent({}, 'write'), spec)), null);
  assert.ok(/proposed action for a goal it cannot do/.test(out), out);
});

await test('an undecidable gate prints as undecidable, not as a percentage verdict', async () => {
  const spec = cases(['h', ['list'], 'list', 'held-out']);
  const out = E.format(E.summarize(await E.runOnce(oracleFor(spec), spec)), null);
  assert.ok(/GATE UNDECIDABLE/.test(out), out);
  assert.ok(!/GATE 85% on held-out: MET/.test(out), 'a 1-case perfect score must not read as MET');
});

// ── preflight: telling a broken backend from a bad model ──────────────────
// Three full runs were burned on environmental faults before this existed --
// a TypeError, a stale checkout, and a model Ollama did not have -- each
// printing 144 identical failures and a confident 0.0%. These tests hold the
// distinction the eval needs to make: "routed badly" is not "there is no
// model", and only one of them is a score.

const tags = (names) => ({
  ok: true, status: 200,
  json: async () => ({ models: names.map(n => ({ name: n })) }),
});

await test('a reachable Ollama with the model present passes', async () => {
  const r = await E.preflight({ fetcher: async () => tags(['qwen2.5:3b', 'moondream']), model: 'qwen2.5:3b' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.installed, ['qwen2.5:3b', 'moondream']);
});

await test('an unreachable daemon is reported as unreachable, not as 0%', async () => {
  const r = await E.preflight({ fetcher: async () => { throw new Error('fetch failed'); } });
  assert.strictEqual(r.ok, false);
  assert.ok(/unreachable/.test(r.reason), r.reason);
  assert.ok(/ollama serve/.test(r.fix), 'and it must say what to do');
});

await test('a DIFFERENT SIZE of the same model is not a match', async () => {
  // This is the exact failure that produced "Ollama returned 404" 144 times:
  // 7b installed, 3b requested. The first version of this check accepted any
  // tag of the same family and would have waved it through.
  const r = await E.preflight({ fetcher: async () => tags(['qwen2.5:7b']), model: 'qwen2.5:3b' });
  assert.strictEqual(r.ok, false, '7b does not satisfy a request for 3b');
  assert.ok(/does not have qwen2.5:3b/.test(r.reason), r.reason);
  assert.ok(/ollama pull qwen2.5:3b/.test(r.fix), r.fix);
  assert.ok(/you have qwen2.5:7b/.test(r.fix),
    'naming the sibling tag is what makes it a fix rather than a guess');
});

await test('an empty model list says so rather than reading as a name', async () => {
  const r = await E.preflight({ fetcher: async () => tags([]), model: 'qwen2.5:3b' });
  assert.strictEqual(r.ok, false);
  assert.ok(/installed: nothing/.test(r.fix), r.fix);
});

await test('only the exact tag counts as present', async () => {
  // Deliberately strict. A bare `qwen2.5` may or may not resolve to 3b, and
  // guessing wrong costs a whole run; being told to pull costs one command.
  assert.strictEqual((await E.preflight({
    fetcher: async () => tags(['qwen2.5']), model: 'qwen2.5:3b' })).ok, false);
  assert.strictEqual((await E.preflight({
    fetcher: async () => tags(['qwen2.5:3b']), model: 'qwen2.5:3b' })).ok, true);
});

await test('a non-200 from /api/tags is a daemon problem, not a model problem', async () => {
  const r = await E.preflight({ fetcher: async () => ({ ok: false, status: 503 }) });
  assert.strictEqual(r.ok, false);
  assert.ok(/503/.test(r.reason), r.reason);
  assert.ok(!/ollama pull/.test(r.fix), 'pulling a model would not fix a 503');
});

await test('malformed JSON from the daemon is caught', async () => {
  const r = await E.preflight({
    fetcher: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) });
  assert.strictEqual(r.ok, false);
  assert.ok(/not JSON/.test(r.reason), r.reason);
});

await test('a non-local backend is not checked against Ollama at all', async () => {
  let called = false;
  const r = await E.preflight({ backend: 'gemini', fetcher: async () => { called = true; return tags([]); } });
  assert.strictEqual(r.ok, true);
  assert.ok(/not checking Ollama/.test(r.skipped), r.skipped);
  assert.strictEqual(called, false, 'it must not probe a daemon it does not use');
});

// ── the shipped case set ──────────────────────────────────────────────────
await test('the shipped set is large enough for its own gate to mean anything', () => {
  const heldOut = CASES.filter(c => c.origin === 'held-out').length;
  assert.ok(heldOut >= E.MIN_HELDOUT,
    `${heldOut} held-out cases, ${E.MIN_HELDOUT} needed for a verdict`);
});

await test('no duplicated goals, and every case is well formed', () => {
  const goals = CASES.map(c => c.goal);
  assert.strictEqual(new Set(goals).size, goals.length, 'a duplicated goal double-counts');
  for (const c of CASES) {
    assert.ok(['mirror', 'held-out'].includes(c.origin), `${c.goal}: bad origin`);
    assert.ok(Array.isArray(c.expect) && c.expect.length, `${c.goal}: no expectation`);
    assert.ok(c.category, `${c.goal}: no category`);
  }
});

await test('the refusal category is substantial, since it is the one that can hurt', () => {
  const refuse = CASES.filter(c => c.category === 'refuse');
  assert.ok(refuse.length >= 8, `only ${refuse.length} refusal cases`);
  assert.ok(refuse.filter(c => c.origin === 'held-out').length >= 6,
    'most refusal cases must be held-out; the model was shown two of these shapes');
});

// ── the guard against the original bug ────────────────────────────────────
await test('no held-out case is a copy of a few-shot example in agent.js', () => {
  // This is why the rewrite happened: one old case was word-for-word
  // identical to an example the model is shown, and four more were near
  // copies. Recomputed here from agent.js itself, so it keeps holding as
  // that prompt changes.
  const src = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
  const fewshot = [...src.matchAll(/Goal: (.+)/g)]
    .map(m => m[1].trim())
    .filter(g => !g.startsWith('${'));
  assert.ok(fewshot.length >= 5, `only found ${fewshot.length} few-shot goals — did the prompt change shape?`);

  const words = (s) => new Set(s.toLowerCase().match(/[a-z]+/g) || []);
  const jaccard = (a, b) => {
    const A = words(a), B = words(b);
    const inter = [...A].filter(x => B.has(x)).length;
    return inter / (new Set([...A, ...B]).size || 1);
  };

  const offenders = [];
  for (const c of CASES.filter(c => c.origin === 'held-out')) {
    for (const f of fewshot) {
      const j = jaccard(c.goal, f);
      if (j >= 0.5) offenders.push(`${c.goal} ~ ${f} (${j.toFixed(2)})`);
    }
  }
  assert.deepStrictEqual(offenders, [],
    'a held-out case must not overlap a few-shot example by half its words — ' +
    'either rephrase it or retag it as a mirror');
});

await test('the mirror cases really are mirrors, or they are mislabelled', () => {
  const src = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
  const fewshot = [...src.matchAll(/Goal: (.+)/g)].map(m => m[1].trim()).filter(g => !g.startsWith('${'));
  const words = (s) => new Set(s.toLowerCase().match(/[a-z]+/g) || []);
  const best = (goal) => Math.max(...fewshot.map(f => {
    const A = words(goal), B = words(f);
    return [...A].filter(x => B.has(x)).length / (new Set([...A, ...B]).size || 1);
  }));
  // 0.25, not 0.3: "what is 2 plus 2" against the shown "what is the capital
  // of France" scores 0.29. Those share a TEMPLATE, not vocabulary, and the
  // template is what the model would be reciting -- so it is a genuine mirror
  // that word overlap understates. The floor exists to stop a case being
  // tagged mirror to shrink the held-out set, and 0.25 still does that.
  const weak = CASES.filter(c => c.origin === 'mirror' && best(c.goal) < 0.25).map(c => c.goal);
  assert.deepStrictEqual(weak, [],
    'a case tagged mirror that resembles no few-shot example inflates the ' +
    'held-out set by exclusion — retag it');
});

finish();
})();
