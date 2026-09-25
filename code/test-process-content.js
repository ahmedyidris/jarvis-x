// THE UNATTENDED CALLER — code/process-content.js.
//
// schedules.json runs it every 30 minutes with nobody watching, which makes it
// the one caller of content-pipeline.js where a gate going decorative is
// invisible until something is already published. test-content-pipeline.js
// proves the gates work when they are called correctly; this suite exists
// because the version of process-content.js it replaced called them
// incorrectly and nothing noticed for four days.
//
// What it had wrong, all of it caught here by construction rather than by a
// test aimed at each mistake:
//
//   1. It switched on STATES.SCRIPT_APPROVED and STATES.CUT_APPROVED. Neither
//      is a member of STATES, so both read `undefined`, so the scheduled task
//      matched no job and did nothing on every run since it landed.
//   2. It called pipeline.advance(id, STATES.CUT_READY, result) — a third
//      argument advance() does not take, and `undefined` for the gate.
//   3. It called the distributor's post(job) DIRECTLY rather than
//      pipeline.post(jobId, poster), which is where rule 4's cut-gate
//      re-check lives. Fixing only (1) would have converted a no-op into an
//      unattended path to YouTube with no gate in front of it.
//
// So the centre of this suite is one assertion repeated across every state: a
// job nobody approved is never posted. Everything else is detail.
//
// Offline by construction: injected clock, temp log, injected render and
// poster, and no default for either.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const P = require('./content-pipeline.js');
const { GATES, STATES } = P;
const PC = require('./process-content.js');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-proc-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

let seq = 0;
function fresh() {
  let t = Date.parse('2026-09-24T00:00:00.000Z');
  const clock = { iso: () => new Date(t += 1000).toISOString() };
  return P.openPipeline({ file: path.join(TMP, `jobs-${seq++}.jsonl`), clock });
}

/** A render that always succeeds, so the gates are the only thing stopping a job. */
const okRender = async () => ({ ok: true, cut: 'cut-bytes' });
/** A poster that always succeeds — used to prove the gates stop it anyway. */
const okPost = async () => ({ ok: true, url: 'https://example.invalid/v' });
/** A poster that must never run. Calling it is the failure. */
let postCalls = 0;
const countingPost = async () => { postCalls++; return { ok: true, url: 'https://example.invalid/v' }; };

const go = (pipeline, opts = {}) => PC.run({
  pipeline, render: okRender, poster: okPost, ...opts,
});

(async () => {

// ─── no defaults, the same rule the pipeline itself keeps ───────────────────

await test('run() refuses without a render function', async () => {
  const p = fresh();
  await assert.rejects(() => PC.run({ pipeline: p, poster: okPost }), /needs a render function/);
});

await test('run() refuses without a poster function', async () => {
  const p = fresh();
  await assert.rejects(() => PC.run({ pipeline: p, render: okRender }), /needs a poster function/);
});

// ─── THE INVARIANT ──────────────────────────────────────────────────────────

await test('NOTHING Ahmed has not approved is ever posted, from any state', async () => {
  // Drive one job to each reachable state with NO approval anywhere, sweep
  // the processor over all of them, and assert the poster was never reached
  // and no job reads `posted`. This is the assertion the whole file is for: it
  // fails if any gate check is removed, if advance() is bypassed, if post() is
  // called around the pipeline, or if a future state is added that skips one.
  const p = fresh();
  postCalls = 0;

  p.start({ brief: 'a', id: 'drafting' });

  p.start({ brief: 'b', id: 'script-review' });
  p.attach('script-review', 'script', 'words');
  p.submit('script-review', GATES.SCRIPT);

  // `producing` is reachable only through an approval, so this one has a
  // legitimate script approval — and still must not be posted, because the
  // CUT gate is a separate question (rule 2).
  p.start({ brief: 'c', id: 'producing' });
  p.attach('producing', 'script', 'words');
  p.submit('producing', GATES.SCRIPT);
  p.approve('producing', GATES.SCRIPT, { by: 'human' });
  p.advance('producing', GATES.SCRIPT);

  p.start({ brief: 'd', id: 'cut-review' });
  p.attach('cut-review', 'script', 'words');
  p.submit('cut-review', GATES.SCRIPT);
  p.approve('cut-review', GATES.SCRIPT, { by: 'human' });
  p.advance('cut-review', GATES.SCRIPT);
  p.attach('cut-review', 'cut', 'frames');
  p.submit('cut-review', GATES.CUT);

  assert.deepStrictEqual(
    p.list().map((j) => j.state).sort(),
    ['cut-review', 'drafting', 'producing', 'script-review'],
    'fixture did not reach the states this test is about');

  // Two sweeps, because a bug that needs one tick to set up and another to
  // fire would survive a single pass.
  await go(p, { poster: countingPost });
  await go(p, { poster: countingPost });

  assert.strictEqual(postCalls, 0, 'the poster ran for a job nobody approved');
  for (const job of p.list()) {
    assert.notStrictEqual(job.state, STATES.POSTED, `${job.id} reached posted unapproved`);
  }
});

await test('an unapproved job in cut-review is not advanced to queued', async () => {
  const p = fresh();
  p.start({ brief: 'x', id: 'j' });
  p.attach('j', 'script', 's');
  p.submit('j', GATES.SCRIPT);
  p.approve('j', GATES.SCRIPT, { by: 'human' });
  p.advance('j', GATES.SCRIPT);
  p.attach('j', 'cut', 'c');
  p.submit('j', GATES.CUT);
  await go(p);
  assert.strictEqual(p.get('j').state, STATES.CUT_REVIEW);
});

await test('a REJECTED gate is not treated as an unanswered one', async () => {
  // Rule 3 the other way round: "he said no" must not decay into "we never
  // asked" and then into a retry that eventually succeeds.
  const p = fresh();
  p.start({ brief: 'x', id: 'j' });
  p.attach('j', 'script', 's');
  p.submit('j', GATES.SCRIPT);
  p.reject('j', GATES.SCRIPT, { by: 'human', why: 'not mine' });
  await go(p);
  await go(p);
  assert.notStrictEqual(p.get('j').state, STATES.PRODUCING);
  assert.notStrictEqual(p.get('j').state, STATES.POSTED);
});

// ─── what it MAY do: carry a job past a gate he has answered ────────────────

await test('an approved script advances and renders in the same sweep', async () => {
  const p = fresh();
  p.start({ brief: 'x', id: 'j' });
  p.attach('j', 'script', 's');
  p.submit('j', GATES.SCRIPT);
  p.approve('j', GATES.SCRIPT, { by: 'human' });
  await go(p);
  const job = p.get('j');
  assert.strictEqual(job.state, STATES.CUT_REVIEW, 'should have advanced, rendered and submitted');
  assert.strictEqual(job.cut, 'cut-bytes');
});

await test('it STOPS at the cut gate in the same sweep — it does not roll on to post', async () => {
  // The step that would be easiest to write as "and then continue". Rendering
  // and submitting is Jarvis's work; what happens next is Ahmed's.
  const p = fresh();
  postCalls = 0;
  p.start({ brief: 'x', id: 'j' });
  p.attach('j', 'script', 's');
  p.submit('j', GATES.SCRIPT);
  p.approve('j', GATES.SCRIPT, { by: 'human' });
  await go(p, { poster: countingPost });
  assert.strictEqual(postCalls, 0);
  assert.strictEqual(p.get('j').state, STATES.CUT_REVIEW);
});

await test('an approved cut advances and posts', async () => {
  const p = fresh();
  p.start({ brief: 'x', id: 'j' });
  p.attach('j', 'script', 's');
  p.submit('j', GATES.SCRIPT);
  p.approve('j', GATES.SCRIPT, { by: 'human' });
  await go(p);                       // -> cut-review, with a cut attached
  p.approve('j', GATES.CUT, { by: 'human' });
  const results = await go(p);
  assert.strictEqual(p.get('j').state, STATES.POSTED);
  const steps = results.find((r) => r.job === 'j').steps.map((s) => s.step);
  assert.deepStrictEqual(steps, ['advance-cut', 'post']);
});

// ─── rule 1 at the last possible instant ────────────────────────────────────

await test('re-attaching the cut after approval voids it, and the processor does not post', async () => {
  const p = fresh();
  postCalls = 0;
  p.start({ brief: 'x', id: 'j' });
  p.attach('j', 'script', 's');
  p.submit('j', GATES.SCRIPT);
  p.approve('j', GATES.SCRIPT, { by: 'human' });
  await go(p);
  p.approve('j', GATES.CUT, { by: 'human' });
  p.advance('j', GATES.CUT);          // queued, approval bound to 'cut-bytes'
  p.attach('j', 'cut', 'different-bytes');
  await go(p, { poster: countingPost });
  assert.strictEqual(postCalls, 0, 'posted a cut he never approved');
  assert.strictEqual(p.get('j').state, STATES.QUEUED);
});

// ─── a refusal is not a post ────────────────────────────────────────────────

await test('a poster that returns {ok:false} does not produce a posted row', async () => {
  const p = fresh();
  p.start({ brief: 'x', id: 'j' });
  p.attach('j', 'script', 's');
  p.submit('j', GATES.SCRIPT);
  p.approve('j', GATES.SCRIPT, { by: 'human' });
  await go(p);
  p.approve('j', GATES.CUT, { by: 'human' });
  await go(p, { poster: async () => ({ ok: false, why: 'no token' }) });
  assert.strictEqual(p.get('j').state, STATES.QUEUED, 'a refused post was recorded as posted');
});

await test('a poster that throws does not produce a posted row, and the error is reported', async () => {
  const p = fresh();
  p.start({ brief: 'x', id: 'j' });
  p.attach('j', 'script', 's');
  p.submit('j', GATES.SCRIPT);
  p.approve('j', GATES.SCRIPT, { by: 'human' });
  await go(p);
  p.approve('j', GATES.CUT, { by: 'human' });
  const results = await go(p, { poster: async () => { throw new Error('upload died'); } });
  assert.strictEqual(p.get('j').state, STATES.QUEUED);
  assert.match(results.find((r) => r.job === 'j').error, /upload died/);
});

await test('one job throwing does not strand the rest of the queue', async () => {
  const p = fresh();
  p.start({ brief: 'a', id: 'boom' });
  p.attach('boom', 'script', 's');
  p.submit('boom', GATES.SCRIPT);
  p.approve('boom', GATES.SCRIPT, { by: 'human' });
  p.start({ brief: 'b', id: 'fine' });
  p.attach('fine', 'script', 's');
  p.submit('fine', GATES.SCRIPT);
  p.approve('fine', GATES.SCRIPT, { by: 'human' });
  const results = await go(p, {
    render: async (job) => { if (job.id === 'boom') throw new Error('render died'); return { ok: true, cut: 'c' }; },
  });
  assert.match(results.find((r) => r.job === 'boom').error, /render died/);
  assert.strictEqual(p.get('fine').state, STATES.CUT_REVIEW);
});

// ─── a refused render is not a cut ──────────────────────────────────────────

await test('a render that refuses leaves the job in producing — it does not reach his desk', async () => {
  const p = fresh();
  p.start({ brief: 'x', id: 'j' });
  p.attach('j', 'script', 's');
  p.submit('j', GATES.SCRIPT);
  p.approve('j', GATES.SCRIPT, { by: 'human' });
  await go(p, { render: async () => ({ ok: false, why: 'not built' }) });
  const job = p.get('j');
  assert.strictEqual(job.state, STATES.PRODUCING);
  assert.strictEqual(job.cut, null, 'attached a cut from a refused render');
});

await test('a render reporting ok with no cut is still not a cut', async () => {
  const p = fresh();
  p.start({ brief: 'x', id: 'j' });
  p.attach('j', 'script', 's');
  p.submit('j', GATES.SCRIPT);
  p.approve('j', GATES.SCRIPT, { by: 'human' });
  await go(p, { render: async () => ({ ok: true }) });
  assert.strictEqual(p.get('j').state, STATES.PRODUCING);
});

await test('a job already carrying a cut is not re-rendered', async () => {
  // Otherwise a job stuck in producing burns a render every 30 minutes
  // forever, and on a real renderer that is real money.
  const p = fresh();
  let renders = 0;
  p.start({ brief: 'x', id: 'j' });
  p.attach('j', 'script', 's');
  p.submit('j', GATES.SCRIPT);
  p.approve('j', GATES.SCRIPT, { by: 'human' });
  p.advance('j', GATES.SCRIPT);
  p.attach('j', 'cut', 'already-there');
  await go(p, { render: async () => { renders++; return { ok: true, cut: 'fresh' }; } });
  assert.strictEqual(renders, 0);
  assert.strictEqual(p.get('j').cut, 'already-there');
});

// ─── structural: the defects that started this ──────────────────────────────

await test('every STATES member the module names actually exists', async () => {
  // The original bug, pinned directly: STATES.SCRIPT_APPROVED read `undefined`
  // and silently matched nothing. A typo'd member is not an error in JS, so
  // nothing but a check like this one can see it.
  const src = fs.readFileSync(path.join(__dirname, 'process-content.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const named = [...src.matchAll(/STATES\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.ok(named.length >= 4, `expected the module to name several states, found ${named.length}`);
  for (const name of named) {
    assert.ok(Object.hasOwn(STATES, name), `process-content.js uses STATES.${name}, which does not exist`);
  }
  const gates = [...src.matchAll(/GATES\.([A-Z_]+)/g)].map((m) => m[1]);
  for (const name of gates) {
    assert.ok(Object.hasOwn(GATES, name), `process-content.js uses GATES.${name}, which does not exist`);
  }
});

await test('the distributor is reached ONLY through pipeline.post()', async () => {
  // Rule 4 lives inside pipeline.post(). A caller that reaches past it
  // publishes with no gate, which is exactly what the previous version did.
  const src = fs.readFileSync(path.join(__dirname, 'process-content.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/pipeline\.post\(/.test(src), 'process-content.js no longer calls pipeline.post()');
  assert.ok(!/distributor\.post\(|distribute\.post\(/.test(src),
    'process-content.js calls the distributor directly, around the cut gate');
});

await test('no other module requires the distributor', async () => {
  const callers = fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.js') && f !== 'process-content.js' && !f.startsWith('test-'))
    .filter((f) => /require\(['"]\.\/content-distribute/.test(
      fs.readFileSync(path.join(__dirname, f), 'utf8')));
  assert.deepStrictEqual(callers, [],
    `these modules reach the distributor around the gate: ${callers.join(', ')}`);
});

await test('the processor leans on pipeline.post()\'s own state check, which is the real one', async () => {
  // WHY THIS TEST EXISTS RATHER THAN A STRONGER ONE ABOVE. Mutating the
  // processor's `state() === QUEUED` to `state() !== POSTED` ESCAPES this
  // suite, and correctly so: pipeline.post() refuses anything but `queued`
  // itself, before it touches the poster, so widening the processor's own
  // check changes nothing. That is the design — a second copy of the gate
  // rules in the unattended caller is a second thing to drift — but a
  // reliance that is never exercised is indistinguishable from a broken one.
  // So the reliance is exercised here, at the place that relies on it.
  const p = fresh();
  let posterRan = false;
  p.start({ brief: 'x', id: 'j' });
  p.attach('j', 'script', 's');
  p.submit('j', GATES.SCRIPT);
  const r = await p.post('j', async () => { posterRan = true; return { ok: true }; });
  assert.strictEqual(r.ok, false);
  assert.match(r.why, /only queued may post/);
  assert.strictEqual(posterRan, false, 'post() reached the poster from a non-queued state');
});

await test('process-content.js supplies no default render or poster', async () => {
  // Same rule as content-pipeline.js's own poster: a convenience default is
  // how the thing a human was supposed to supply gets supplied by a machine.
  const src = fs.readFileSync(path.join(__dirname, 'process-content.js'), 'utf8');
  const runSig = src.slice(src.indexOf('async function run('));
  assert.ok(!/render\s*=\s*[^,)]/.test(runSig.slice(0, runSig.indexOf(')'))),
    'run() has a default render');
  assert.ok(!/poster\s*=\s*[^,)]/.test(runSig.slice(0, runSig.indexOf(')'))),
    'run() has a default poster');
});

await test('the module opens no socket and pulls in no network client', async () => {
  const src = fs.readFileSync(path.join(__dirname, 'process-content.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['axios', 'node-fetch', 'https.request', 'http.request', 'fetch(']) {
    assert.ok(!src.includes(forbidden), `process-content.js reaches the network via ${forbidden}`);
  }
});

// ─── the two stubs must refuse rather than report success ───────────────────

await test('content-render.js refuses when the encoder is unavailable, and spawns nothing here', async () => {
  // As of 2026-09-25 this is a real bridge to automation/phase-b's MoviePy
  // renderer, not a stub. So `run` is INJECTED: without it this suite would
  // spawn python on every CI run and depend on moviepy being installed, which
  // is the offline guarantee its own header claims. The injected runner
  // reproduces exactly what this container returns for a real call —
  // `python3 automation/phase-b/script_renderer.py` refuses with
  // "No module named 'moviepy'" here, because bootstrap puts moviepy in
  // venv-ai and this container never ran bootstrap.
  let spawned = false;
  const r = await require('./content-render.js').render(
    { id: 'j', script: 'words', brief: 'a brief' },
    { run: () => { spawned = true; return { code: 1, bin: 'python3', stderr: '',
        stdout: JSON.stringify({ ok: false, why: "render failed: ModuleNotFoundError: No module named 'moviepy'" }) }; } });
  assert.strictEqual(r.ok, false);
  assert.match(r.why, /moviepy/);
  assert.ok(spawned, 'the injected runner was never reached');
});

await test('content-distribute.js throws rather than mocking a successful post', async () => {
  // It used to return {ok:true, url:'https://youtube.com/watch?v=mock'} with
  // no token set, which is a fabricated URL in the log that records what was
  // published.
  const saved = process.env.YOUTUBE_OAUTH_TOKEN;
  delete process.env.YOUTUBE_OAUTH_TOKEN;
  try {
    await assert.rejects(() => require('./content-distribute.js').post({ id: 'j' }),
      /refusing to report a post that did not happen/);
  } finally {
    if (saved !== undefined) process.env.YOUTUBE_OAUTH_TOKEN = saved;
  }
});

await test('the distributor invents no URL even when a token IS set', async () => {
  const saved = process.env.YOUTUBE_OAUTH_TOKEN;
  process.env.YOUTUBE_OAUTH_TOKEN = 'pretend';
  try {
    await assert.rejects(() => require('./content-distribute.js').post({ id: 'j' }),
      /not built yet/);
  } finally {
    if (saved === undefined) delete process.env.YOUTUBE_OAUTH_TOKEN;
    else process.env.YOUTUBE_OAUTH_TOKEN = saved;
  }
});

// ─── the real wiring, end to end with the real stubs ────────────────────────

await test('the scheduled entry point as configured does nothing but refuse', async () => {
  // What `node code/process-content.js` actually achieves today, asserted
  // rather than assumed: an approved script gets as far as a refused render
  // and stops. Said plainly so nobody reads "wired into schedules.json" as
  // "producing videos".
  const p = fresh();
  p.start({ brief: 'x', id: 'j' });
  p.attach('j', 'script', 's');
  p.submit('j', GATES.SCRIPT);
  p.approve('j', GATES.SCRIPT, { by: 'human' });
  const realRender = require('./content-render.js').render;
  const results = await PC.run({
    pipeline: p,
    // Same reason as above: the real render() spawns python, so the spawn is
    // injected and everything above it — the refusal shape, and what the
    // processor does with it — is exercised for real.
    render: (job) => realRender(job, { run: () => ({ code: 1, bin: 'python3', stderr: '',
      stdout: JSON.stringify({ ok: false, why: "render failed: ModuleNotFoundError: No module named 'moviepy'" }) }) }),
    poster: require('./content-distribute.js').post,
  });
  assert.strictEqual(p.get('j').state, STATES.PRODUCING);
  const render = results.find((r) => r.job === 'j').steps.find((s) => s.step === 'render');
  assert.strictEqual(render.ok, false);
});

finish();
})();
