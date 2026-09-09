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
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
// FUSE. A hung await drains the event loop and exits 0 having printed no
// tally -- a vacuous pass that reads as green, and the exact shape sweep.js
// exists to catch. finish() calls process.exit() explicitly, so this default
// only survives when finish() was never reached. Found by mutation-testing
// code/status.js; see code/test-status.js for the full account.
process.exitCode = 1;

const E = require('./eval-agent.js');
const { CASES, CATEGORIES, ORIGINS } = require('./eval-cases.js');

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

await test('results are reported as they happen, not after the loop', async () => {
  // The CLI used to print the whole PASS/FAIL block after runOnce returned,
  // so propose()'s own log lines landed above it, detached from their case.
  // That is how a rejection belonging to "show me everything under config"
  // came to sit above "list the files in the code directory" and get
  // attributed to it. Interleaving is the fix, and this holds it.
  const seen = [];
  const spec = cases(
    ['a', ['list'], 'list', 'held-out'],
    ['b', ['list'], 'list', 'held-out'],
    ['c', ['list'], 'list', 'held-out'],
  );
  const results = await E.runOnce(agent({ a: 'list', c: 'list' }, 'read'), spec,
    { onResult: (r) => seen.push([r.goal, r.ok]) });
  assert.deepStrictEqual(seen, [['a', true], ['b', false], ['c', true]],
    'every row must be handed over in order, as it completes');
  assert.strictEqual(seen.length, results.length);
});

await test('runOnce works with no callback at all', async () => {
  const r = await E.runOnce(oracle);
  assert.strictEqual(r.length, CASES.length, 'the callback is optional');
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

// ── persistence: a partial file must not read as a finished one ───────────
// The harness wrote logs/eval-agent.json only after the LAST run. Interrupting
// a --runs 3 on run 3 therefore left the PREVIOUS invocation's file in place,
// and that file reads as current. It happened: a completed run of 48 backend
// failures sat on disk while a healthy pass had printed 90% to the terminal,
// and the stale JSON was taken for the new result.

const summaryFor = async (n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const results = await E.runOnce(oracle);
    const s = E.summarize(results);
    s._results = results;
    out.push(s);
  }
  return out;
};

await test('a completed set of runs is marked complete', async () => {
  const f = path.join(os.tmpdir(), `jx-eval-${Date.now()}-a.json`);
  E.persist(await summaryFor(2), 2, { out: f });
  const w = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(w.runsRequested, 2);
  assert.strictEqual(w.runsCompleted, 2);
  assert.strictEqual(w.complete, true);
});

await test('a partial set says so rather than looking finished', async () => {
  const f = path.join(os.tmpdir(), `jx-eval-${Date.now()}-b.json`);
  E.persist(await summaryFor(1), 3, { out: f });   // 1 of 3 done
  const w = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(w.runsCompleted, 1);
  assert.strictEqual(w.runsRequested, 3);
  assert.strictEqual(w.complete, false,
    'the discrepancy is the only thing that stops a reader trusting it');
});

await test('each run overwrites the file, so a stale one cannot survive', async () => {
  const f = path.join(os.tmpdir(), `jx-eval-${Date.now()}-c.json`);
  // Stand in for the previous invocation's leftovers.
  fs.writeFileSync(f, JSON.stringify({ runsCompleted: 3, complete: true, stale: true }));
  E.persist(await summaryFor(1), 3, { out: f });
  const w = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(w.stale, undefined, 'the old file must be replaced, not merged');
  assert.strictEqual(w.complete, false);
});

await test('the persisted results are the newest run, not the first', async () => {
  const f = path.join(os.tmpdir(), `jx-eval-${Date.now()}-d.json`);
  const rs = [];
  for (const t of ['shell', 'list']) {
    const results = await E.runOnce(agent({}, t), cases(['g', ['list'], 'list', 'held-out']));
    const s = E.summarize(results); s._results = results; rs.push(s);
  }
  E.persist(rs, 2, { out: f });
  const w = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(w.results[0].got, 'list', 'the last run is the one written out');
  assert.strictEqual(w.summary.length, 2, 'but every run keeps its summary');
});

// ── what a number at the ceiling does NOT prove ───────────────────────────
// Measured 2026-09-07: 41/41 held-out, 8/8 mirror, gap 0.0, three identical
// runs. That is the exact shape P0 originally flagged as suspicious about the
// old 15/15, so the harness now states the limits of its own output instead
// of leaving them to be worked out.
await test('a 0.0 gap at a held-out ceiling is flagged as uninformative', () => {
  // The gap can only detect recitation while held-out has room to be worse
  // than mirror. At held-out 100% it is <= 0 by arithmetic.
  const rs = [
    ...Array.from({ length: E.MIN_HELDOUT }, (_, i) =>
      ({ goal: `h${i}`, origin: 'held-out', category: 'list', ok: true })),
    { goal: 'm', origin: 'mirror', category: 'list', ok: true },
  ];
  const s = E.summarize(rs);
  assert.strictEqual(s.gap, 0);
  assert.strictEqual(s.gapUninformative, true);
  const out = E.format(s, null);
  assert.ok(/UNINFORMATIVE/.test(out), `the caveat must be printed:\n${out}`);
  assert.ok(/not evidence of generalization/i.test(out),
    'and must say what it is not, not merely that it is limited');
});

await test('a gap below the ceiling is NOT flagged uninformative', () => {
  // The flag must not fire on every small gap, or it stops meaning anything.
  const rs = [
    ...Array.from({ length: E.MIN_HELDOUT }, (_, i) =>
      ({ goal: `h${i}`, origin: 'held-out', category: 'list', ok: i > 0 })),
    { goal: 'm', origin: 'mirror', category: 'list', ok: true },
  ];
  const s = E.summarize(rs);
  assert.ok(s.gap > 0, 'this fixture must have a real gap');
  assert.strictEqual(s.gapUninformative, false);
  assert.ok(!/UNINFORMATIVE/.test(E.format(s, null)));
});

await test('with no mirror cases there is no gap and no flag', () => {
  const rs = Array.from({ length: E.MIN_HELDOUT }, (_, i) =>
    ({ goal: `h${i}`, origin: 'held-out', category: 'list', ok: true }));
  const s = E.summarize(rs);
  assert.strictEqual(s.gap, null);
  assert.strictEqual(s.gapUninformative, false, 'no gap cannot be an uninformative gap');
});

await test('a zero spread across runs is not reported as model stability', () => {
  // local.js pins temperature 0, so identical runs confirm the harness is
  // reproducible and say nothing about sampling. P0.1 recorded "variance is
  // near zero on this evidence" off two identical runs; that inference was
  // unsupported and this is what stops it being drawn again.
  assert.strictEqual(require('./local.js').DEFAULT_TEMPERATURE, 0,
    'the caveat is conditional on this actually being 0');
  const rows = Array.from({ length: E.MIN_HELDOUT }, (_, i) =>
    ({ goal: `h${i}`, origin: 'held-out', category: 'list', ok: true }));
  const s = E.summarize(rows);
  s._results = rows;
  const agg = E.aggregate([s, s, s]);
  assert.strictEqual(agg.heldOutStdDev, 0);
  const out = E.format(s, agg);
  assert.ok(/deterministic decode/.test(out), `the caveat must be printed:\n${out}`);
  assert.ok(/NOT that the model is stable/.test(out));
});

await test('the temperature in the caveat is read from local.js, not restated', () => {
  // If it were hardcoded here or in eval-agent.js, changing local.js to a
  // sampling temperature would leave the harness claiming a deterministic
  // decode it no longer has.
  const src = fs.readFileSync(path.join(__dirname, 'eval-agent.js'), 'utf8');
  assert.ok(/DEFAULT_TEMPERATURE.*require\('\.\/local\.js'\)/.test(src),
    'eval-agent.js must import the value');
  assert.ok(!/temperature === 0\s*&&\s*true/.test(src));
  const localSrc = fs.readFileSync(path.join(__dirname, 'local.js'), 'utf8');
  assert.ok(/opts\.temperature \?\? DEFAULT_TEMPERATURE/.test(localSrc),
    'and local.js must SEND the exported constant, or the two can disagree');
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
    assert.ok(ORIGINS.includes(c.origin), `${c.goal}: bad origin ${c.origin}`);
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


// ── the third origin ──────────────────────────────────────────────────────
await test('a tuned case is scored but kept out of the gate', () => {
  // The whole reason 'tuned' exists. On 2026-09-07 three list cases failed,
  // agent.js's prompt was changed specifically to address those three shapes,
  // and leaving them tagged held-out would have let the change measure itself.
  const rs = [
    ...Array.from({ length: E.MIN_HELDOUT }, (_, i) =>
      ({ goal: `h${i}`, origin: 'held-out', category: 'list', ok: i > 4 })),
    { goal: 't1', origin: 'tuned', category: 'list', ok: true },
    { goal: 't2', origin: 'tuned', category: 'list', ok: true },
    { goal: 'm1', origin: 'mirror', category: 'list', ok: true },
  ];
  const s = E.summarize(rs);
  assert.strictEqual(s.tuned.total, 2, 'tuned cases must be reported');
  assert.strictEqual(s.tuned.accuracy, 1);
  assert.strictEqual(s.heldOut.total, E.MIN_HELDOUT,
    'and must not be counted as held-out — that is what would flatter the gate');
  // 20/25 = 80%, below the 85% gate. If the two passing tuned cases leaked in
  // it would be 22/27 = 81.5%, still below, so assert on the count as well as
  // the verdict.
  assert.strictEqual(s.gateMet, false);
  assert.strictEqual(s.overall.total, E.MIN_HELDOUT + 3, 'but they are still run');
});

await test('a tuned case does not enter the gap either', () => {
  // The gap is mirror minus held-out. A tuned case in either side would move
  // a number whose only job is to detect memorization.
  const base = Array.from({ length: E.MIN_HELDOUT }, (_, i) =>
    ({ goal: `h${i}`, origin: 'held-out', category: 'list', ok: true }));
  const withMirror = [...base, { goal: 'm', origin: 'mirror', category: 'list', ok: true }];
  const a = E.summarize(withMirror);
  const b = E.summarize([...withMirror,
    { goal: 't', origin: 'tuned', category: 'list', ok: false }]);
  assert.strictEqual(a.gap, b.gap, 'adding a failing tuned case must not move the gap');
  assert.strictEqual(b.tuned.accuracy, 0, 'though the failure must still be visible');
});

await test('the tuned line is printed, and says it is out of the gate', () => {
  const rs = [
    ...Array.from({ length: E.MIN_HELDOUT }, (_, i) =>
      ({ goal: `h${i}`, origin: 'held-out', category: 'list', ok: true })),
    { goal: 't', origin: 'tuned', category: 'list', ok: false },
  ];
  const out = E.format(E.summarize(rs), null);
  assert.ok(/tuned\s+0\/1/.test(out), `no tuned line in:\n${out}`);
  assert.ok(/NOT in the gate/.test(out),
    'a reader must not have to know what the label means');
});

await test('no tuned line is printed when there are none', () => {
  const rs = Array.from({ length: E.MIN_HELDOUT }, (_, i) =>
    ({ goal: `h${i}`, origin: 'held-out', category: 'list', ok: true }));
  assert.ok(!/tuned/.test(E.format(E.summarize(rs), null)),
    'an empty category must not print a 0/0 line');
});

await test('a tuned case is still not a verbatim copy of an example', () => {
  // 'tuned' is not a licence to paste the case into the prompt. The shapes
  // are taught; the wording stays the model's problem. Same 0.5 threshold the
  // held-out cases are held to, so a future "fix" that copies the failing
  // goal into the few-shot block fails here.
  const src = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
  const fewshot = [...src.matchAll(/Goal: (.+)/g)].map(m => m[1].trim()).filter(g => !g.startsWith('${'));
  const words = (s) => new Set(s.toLowerCase().match(/[a-z]+/g) || []);
  const offenders = [];
  for (const c of CASES.filter(c => c.origin === 'tuned')) {
    for (const f of fewshot) {
      const A = words(c.goal), B = words(f);
      const jac = [...A].filter(x => B.has(x)).length / (new Set([...A, ...B]).size || 1);
      if (jac >= 0.5) offenders.push(`${c.goal} ~ ${f} (${jac.toFixed(2)})`);
    }
  }
  assert.deepStrictEqual(offenders, [],
    'teaching the shape is the fix; pasting the goal into the prompt is not');
});

await test('the list category keeps held-out cases after the retag', () => {
  // The retag removed three of the five held-out list cases. Without fresh
  // ones the category would be measured by two cases and a mirror, which is
  // not a measurement. This is the guard against the retag being used to make
  // an inconvenient category disappear.
  const list = CASES.filter(c => c.category === 'list');
  const heldOut = list.filter(c => c.origin === 'held-out');
  assert.ok(heldOut.length >= 5,
    `only ${heldOut.length} held-out list cases — a retagged category needs replacements`);
  assert.ok(list.filter(c => c.origin === 'tuned').length >= 1,
    'and the tuned ones must still be in the set, not deleted');
});

finish();
})();
