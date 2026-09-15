// CONTENT PIPELINE PHASE 1 — the two gates.
//
// PLAN_5 §6.2's ruling is that Ahmed owns the idea and the narrative and
// Jarvis owns everything downstream. Two human gates enforce that: the script,
// and the finished cut. This suite exists to make both real rather than
// documented, and most of it is aimed at the four ways a gate goes decorative
// while still reporting green:
//
//   1. An approval survives the artifact changing under it ("approve, then
//      swap") — the one a naive implementation always misses.
//   2. An approval for one gate satisfies the other. This is not hypothetical:
//      test-memory-integration.js found exactly this class of bug one module
//      over, where two distinct intents collapsed into one token and every
//      layer's own suite stayed green.
//   3. Absence of an approval reads as approval.
//   4. Posting is reachable without the cut gate.
//
// Offline and deterministic: injected clock, temp log, injected poster. This
// module opens no socket and has no default poster, so there is no path from
// this suite to YouTube even if a test tried.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const P = require('./content-pipeline.js');
const { GATES, STATES } = P;

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-content-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

let seq = 0;
function fresh() {
  let t = Date.parse('2026-09-10T00:00:00.000Z');
  const clock = { iso: () => new Date(t += 1000).toISOString() };
  return P.openPipeline({ file: path.join(TMP, `jobs-${seq++}.jsonl`), clock });
}

/** A job driven to just-before the script gate. */
function atScriptGate(pipe, script = 'draft one') {
  const job = pipe.start({ brief: 'a video about X' });
  pipe.attach(job.id, 'script', script);
  pipe.submit(job.id, GATES.SCRIPT);
  return job.id;
}

/** A job driven all the way to just-before the cut gate. */
function atCutGate(pipe, cut = 'cut one') {
  const id = atScriptGate(pipe);
  pipe.approve(id, GATES.SCRIPT, { by: 'human' });
  pipe.advance(id, GATES.SCRIPT);
  pipe.attach(id, 'cut', cut);
  pipe.submit(id, GATES.CUT);
  return id;
}

(async () => {

// ── the happy path, so the rest is known to be blocking something real ────

await test('a job runs prompt -> script -> gate -> produce -> cut -> gate -> queued', () => {
  const pipe = fresh();
  const job = pipe.start({ brief: 'explain the CPI print' });
  assert.strictEqual(job.state, STATES.DRAFTING);

  pipe.attach(job.id, 'script', 'here is the script');
  assert.strictEqual(pipe.submit(job.id, GATES.SCRIPT).state, STATES.SCRIPT_REVIEW);
  assert.ok(pipe.approve(job.id, GATES.SCRIPT, { by: 'human' }).ok);
  assert.strictEqual(pipe.advance(job.id, GATES.SCRIPT).state, STATES.PRODUCING);

  pipe.attach(job.id, 'cut', 'the rendered mp4');
  assert.strictEqual(pipe.submit(job.id, GATES.CUT).state, STATES.CUT_REVIEW);
  assert.ok(pipe.approve(job.id, GATES.CUT, { by: 'human' }).ok);
  assert.strictEqual(pipe.advance(job.id, GATES.CUT).state, STATES.QUEUED);
});

await test('the brief is required — Jarvis never invents the idea', () => {
  const pipe = fresh();
  for (const bad of ['', '   ', null, undefined, 42]) {
    assert.throws(() => pipe.start({ brief: bad }), /needs a brief/);
  }
});

// ── RULE 1: an approval is bound to the artifact it approved ──────────────

await test('re-attaching the script after approval VOIDS that approval', () => {
  // The headline test. "Approve, then swap" must not publish something he
  // never read.
  const pipe = fresh();
  const id = atScriptGate(pipe, 'the draft he read');
  pipe.approve(id, GATES.SCRIPT, { by: 'human' });
  assert.strictEqual(pipe.checkGate(id, GATES.SCRIPT).verdict, 'approved');

  pipe.attach(id, 'script', 'a completely different draft');
  const after = pipe.checkGate(id, GATES.SCRIPT);
  assert.notStrictEqual(after.verdict, 'approved', 'a swapped script kept its approval');
  assert.ok(/changed after it was approved/.test(after.why), after.why);
});

await test('advance refuses on a voided approval, not just checkGate', () => {
  // checkGate being right is worthless if advance does not consult it.
  const pipe = fresh();
  const id = atScriptGate(pipe, 'original');
  pipe.approve(id, GATES.SCRIPT, { by: 'human' });
  pipe.attach(id, 'script', 'swapped');
  const r = pipe.advance(id, GATES.SCRIPT);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(pipe.get(id).state, STATES.SCRIPT_REVIEW, 'the job advanced anyway');
});

await test('re-approving the NEW script restores the gate', () => {
  // The rule must not be a one-way trapdoor: a re-draft he approves is the
  // normal path, not an error state.
  const pipe = fresh();
  const id = atScriptGate(pipe, 'original');
  pipe.approve(id, GATES.SCRIPT, { by: 'human' });
  pipe.attach(id, 'script', 'revised');
  assert.notStrictEqual(pipe.checkGate(id, GATES.SCRIPT).verdict, 'approved');
  pipe.approve(id, GATES.SCRIPT, { by: 'human' });
  assert.strictEqual(pipe.checkGate(id, GATES.SCRIPT).verdict, 'approved');
});

await test('re-attaching identical text does NOT void the approval', () => {
  // Bound to the CONTENT, not to the act of writing. An idempotent re-save
  // must not force a re-read.
  const pipe = fresh();
  const id = atScriptGate(pipe, 'same bytes');
  pipe.approve(id, GATES.SCRIPT, { by: 'human' });
  pipe.attach(id, 'script', 'same bytes');
  assert.strictEqual(pipe.checkGate(id, GATES.SCRIPT).verdict, 'approved');
});

await test('the cut gate is bound to the cut, independently of the script', () => {
  const pipe = fresh();
  const id = atCutGate(pipe, 'cut A');
  pipe.approve(id, GATES.CUT, { by: 'human' });
  assert.strictEqual(pipe.checkGate(id, GATES.CUT).verdict, 'approved');
  pipe.attach(id, 'cut', 'cut B');
  assert.notStrictEqual(pipe.checkGate(id, GATES.CUT).verdict, 'approved');
});

// ── RULE 2: an approval names its gate ────────────────────────────────────

await test('a script approval does NOT satisfy the cut gate', () => {
  const pipe = fresh();
  const id = atCutGate(pipe);
  // The script approval from atCutGate is real and still on the job.
  assert.ok(pipe.get(id).approvals.some((a) => a.gate === GATES.SCRIPT));
  const cut = pipe.checkGate(id, GATES.CUT);
  assert.notStrictEqual(cut.verdict, 'approved', 'a script approval opened the cut gate');
  assert.ok(/no approval for the cut gate/.test(cut.why), cut.why);
});

await test('advancing the cut gate on a script-only approval is refused', () => {
  const pipe = fresh();
  const id = atCutGate(pipe);
  const r = pipe.advance(id, GATES.CUT);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(pipe.get(id).state, STATES.CUT_REVIEW);
});

await test('an unknown gate name throws rather than defaulting to one', () => {
  const pipe = fresh();
  const id = atScriptGate(pipe);
  for (const fn of ['checkGate', 'advance']) {
    assert.throws(() => pipe[fn](id, 'sCrIpT'), /unknown gate/, `${fn} accepted a near-miss gate name`);
    assert.throws(() => pipe[fn](id, ''), /unknown gate/);
  }
});

// ── RULE 3: absence is never approval ─────────────────────────────────────

await test('a job with no approval reads unknown, never approved', () => {
  const pipe = fresh();
  const id = atScriptGate(pipe);
  const g = pipe.checkGate(id, GATES.SCRIPT);
  assert.strictEqual(g.verdict, 'unknown');
  assert.notStrictEqual(g.verdict, 'approved');
});

await test('the verdict is three-valued — refused and unknown are different', () => {
  // A boolean would make "he said no" and "we never asked" the same fact.
  const pipe = fresh();
  const silent = atScriptGate(fresh());
  const idR = atScriptGate(pipe);
  pipe.reject(idR, GATES.SCRIPT, { by: 'human', why: 'not my angle' });
  assert.strictEqual(pipe.checkGate(idR, GATES.SCRIPT).verdict, 'refused');
  assert.ok(silent);
});

await test('an approval with too little confidence is refused, not approved', () => {
  const pipe = fresh();
  const id = atScriptGate(pipe);
  pipe.approve(id, GATES.SCRIPT, { by: 'human', confidence: 0.4 });
  assert.strictEqual(pipe.checkGate(id, GATES.SCRIPT).verdict, 'refused');
});

await test('a non-approver cannot approve', () => {
  const pipe = fresh();
  const id = atScriptGate(pipe);
  for (const who of ['agent', 'oracle', 'FORGED', '', undefined]) {
    const r = pipe.approve(id, GATES.SCRIPT, { by: who });
    assert.strictEqual(r.ok, false, `"${who}" was accepted as an approver`);
  }
  assert.notStrictEqual(pipe.checkGate(id, GATES.SCRIPT).verdict, 'approved');
});

await test('`by` has no default — a forgetful call path cannot mint a human approval', () => {
  const pipe = fresh();
  const id = atScriptGate(pipe);
  assert.strictEqual(pipe.approve(id, GATES.SCRIPT).ok, false);
});

await test('approving a job that is not at that gate is refused', () => {
  const pipe = fresh();
  const id = pipe.start({ brief: 'still drafting' }).id;
  const r = pipe.approve(id, GATES.SCRIPT, { by: 'human' });
  assert.strictEqual(r.ok, false);
  assert.ok(/not script-review/.test(r.why), r.why);
  // And the cut gate is refused from drafting too, not just the script one.
  assert.strictEqual(pipe.approve(id, GATES.CUT, { by: 'human' }).ok, false);
});

await test('a rejected job stays refused even if later approved', () => {
  const pipe = fresh();
  const id = atScriptGate(pipe);
  pipe.reject(id, GATES.SCRIPT, { by: 'human', why: 'no' });
  pipe.approve(id, GATES.SCRIPT, { by: 'human' });
  assert.strictEqual(pipe.checkGate(id, GATES.SCRIPT).verdict, 'refused');
});

// ── RULE 4: posting requires the cut gate ─────────────────────────────────

await test('post refuses from every state except queued', async () => {
  const posted = [];
  const poster = async () => { posted.push(1); return 'url'; };

  const drafting = fresh();
  const dId = drafting.start({ brief: 'x' }).id;
  assert.strictEqual((await drafting.post(dId, poster)).ok, false);

  const atScript = fresh();
  assert.strictEqual((await atScript.post(atScriptGate(atScript), poster)).ok, false);

  const atCut = fresh();
  assert.strictEqual((await atCut.post(atCutGate(atCut), poster)).ok, false);

  const rejected = fresh();
  const rId = atScriptGate(rejected);
  rejected.reject(rId, GATES.SCRIPT, { by: 'human' });
  assert.strictEqual((await rejected.post(rId, poster)).ok, false);

  assert.strictEqual(posted.length, 0, 'the poster ran for an ungated job');
});

await test('an APPROVED cut still in review does not post — advance is a separate act', async () => {
  // THE CASE THAT SEPARATES RULE 4 FROM RULE 3, and the one the first version
  // of this suite missed: every other state is already blocked by the gate
  // check (no cut, or no approval), so deleting the state check entirely still
  // passed. Here the cut IS approved and the gate says so; only the state
  // stops it. Queueing is a deliberate step, not an inference from approval.
  const pipe = fresh();
  const id = atCutGate(pipe);
  pipe.approve(id, GATES.CUT, { by: 'human' });
  assert.strictEqual(pipe.checkGate(id, GATES.CUT).verdict, 'approved',
    'fixture broken: the gate must be OPEN for this test to mean anything');
  assert.strictEqual(pipe.get(id).state, STATES.CUT_REVIEW);
  let ran = false;
  const r = await pipe.post(id, async () => { ran = true; });
  assert.strictEqual(r.ok, false, 'posted straight out of review, skipping the queue');
  assert.strictEqual(ran, false);
  assert.ok(/only queued may post/.test(r.why), r.why);
});

await test('a queued job posts, and only then', async () => {
  const pipe = fresh();
  const id = atCutGate(pipe);
  pipe.approve(id, GATES.CUT, { by: 'human' });
  pipe.advance(id, GATES.CUT);
  let seen = null;
  const r = await pipe.post(id, async (job) => { seen = job.id; return 'https://example/v'; });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(seen, id);
  assert.strictEqual(pipe.get(id).state, STATES.POSTED);
});

await test('the cut gate is re-checked AT post time, not just at queueing', async () => {
  // Between queue and post the cut can be re-attached. Rule 1 has to hold at
  // the last possible instant or it holds at none.
  const pipe = fresh();
  const id = atCutGate(pipe, 'approved cut');
  pipe.approve(id, GATES.CUT, { by: 'human' });
  pipe.advance(id, GATES.CUT);
  pipe.attach(id, 'cut', 'a different cut slipped in');
  let ran = false;
  const r = await pipe.post(id, async () => { ran = true; });
  assert.strictEqual(r.ok, false, 'posted a cut he never approved');
  assert.strictEqual(ran, false);
});

await test('post has no default poster — there is no accidental path to YouTube', async () => {
  const pipe = fresh();
  const id = atCutGate(pipe);
  pipe.approve(id, GATES.CUT, { by: 'human' });
  pipe.advance(id, GATES.CUT);
  await assert.rejects(() => pipe.post(id), /needs a poster/);
});

// ── the log is append-only and the state is a fold ────────────────────────

await test('nothing is ever overwritten — every version stays readable', () => {
  const pipe = fresh();
  const id = atScriptGate(pipe, 'v1');
  pipe.attach(id, 'script', 'v2');
  pipe.attach(id, 'script', 'v3');
  const scripts = pipe.get(id).history.filter((r) => r.kind === 'attach' && r.field === 'script');
  assert.deepStrictEqual(scripts.map((r) => r.value), ['v1', 'v2', 'v3']);
  assert.strictEqual(pipe.get(id).script, 'v3', 'the fold did not take the latest');
});

await test('an approval records what he saw, so the audit survives a re-draft', () => {
  const pipe = fresh();
  const id = atScriptGate(pipe, 'the exact words he read');
  pipe.approve(id, GATES.SCRIPT, { by: 'human' });
  pipe.attach(id, 'script', 'later rewrite');
  const a = pipe.get(id).approvals[0];
  assert.strictEqual(a.artifact_hash, P.hash('the exact words he read'));
  assert.strictEqual(a.approved_by, 'human');
});

await test('a corrupt line in the log does not take the pipeline down', () => {
  const pipe = fresh();
  const id = atScriptGate(pipe);
  fs.appendFileSync(pipe.file, '{not json\n');
  assert.strictEqual(pipe.get(id).state, STATES.SCRIPT_REVIEW);
});

await test('the same handle sees its own writes — get() is not memoized', () => {
  // The cross-handle test below proves two handles agree; it does NOT prove a
  // single handle stays fresh, because each handle would carry its own cache.
  // A memoized get() escaped both of them until this was added.
  const pipe = fresh();
  const id = pipe.start({ brief: 'x' }).id;
  assert.strictEqual(pipe.get(id).state, STATES.DRAFTING);
  pipe.attach(id, 'script', 's');
  pipe.submit(id, GATES.SCRIPT);
  assert.strictEqual(pipe.get(id).state, STATES.SCRIPT_REVIEW, 'get() returned a stale cached job');
  assert.strictEqual(pipe.get(id).script, 's');
});

await test('state is recomputed from the log, not cached', () => {
  // A cache is a second source of truth. Two handles on one file must agree.
  const file = path.join(TMP, 'shared.jsonl');
  const clock = { iso: () => new Date().toISOString() };
  const a = P.openPipeline({ file, clock });
  const b = P.openPipeline({ file, clock });
  const id = a.start({ brief: 'x' }).id;
  a.attach(id, 'script', 's');
  a.submit(id, GATES.SCRIPT);
  assert.strictEqual(b.get(id).state, STATES.SCRIPT_REVIEW);
});

// ── the queue view Ahmed actually reads ───────────────────────────────────

await test('pending() lists exactly what is on his desk', () => {
  const pipe = fresh();
  const drafting = pipe.start({ brief: 'not ready' }).id;
  const script = atScriptGate(pipe);
  const cut = atCutGate(pipe);
  const ids = pipe.pending().map((j) => j.id).sort();
  assert.deepStrictEqual(ids, [script, cut].sort());
  assert.ok(!ids.includes(drafting));
});

await test('submit refuses when there is nothing to review', () => {
  const pipe = fresh();
  const id = pipe.start({ brief: 'x' }).id;
  const r = pipe.submit(id, GATES.SCRIPT);
  assert.strictEqual(r.ok, false);
  assert.ok(/no script attached/.test(r.why), r.why);
});

await test('an unknown job id throws rather than answering about nothing', () => {
  const pipe = fresh();
  assert.strictEqual(pipe.get('nope'), null);
  assert.throws(() => pipe.checkGate('nope', GATES.SCRIPT), /no such job/);
  assert.throws(() => pipe.attach('nope', 'script', 'x'), /no such job/);
});

await test('a nothing is not an artifact — empty attaches are refused', () => {
  // Found by test-content-integration.js: content-draft.js returns {ok:false}
  // with no `script` when it refuses, and a caller skipping the ok check would
  // attach `undefined`. The gate still refused downstream, but the log gained
  // a meaningless row and the caller got no signal it had ignored a refusal.
  const pipe = fresh();
  const id = pipe.start({ brief: 'x' }).id;
  for (const nothing of [undefined, null, '', '   ', []]) {
    assert.throws(() => pipe.attach(id, 'script', nothing),
      /refusing to attach an empty script/, `attach accepted ${JSON.stringify(nothing)}`);
  }
  assert.strictEqual(pipe.get(id).history.filter((r) => r.kind === 'attach').length, 0,
    'a refused attach still wrote a row');
});

await test('a fresh job declares every artifact, so the shape is uniform', () => {
  // Each attachable artifact starts as an explicit null rather than being
  // absent. The fold sets them dynamically, so omitting one is ALMOST a no-op
  // — `undefined == null` is true, so `== null` consumers cannot tell. It
  // still matters: `'sources' in job` and Object.keys() differ, and a contract
  // where some fields are declared and others appear on first write is one
  // where "has this been attached" has two different answers.
  const pipe = fresh();
  const job = pipe.get(pipe.start({ brief: 'x' }).id);
  for (const field of P.ARTIFACTS) {
    assert.ok(field in job, `a fresh job does not declare "${field}"`);
    assert.strictEqual(job[field], null, `"${field}" starts as ${job[field]}, not null`);
  }
});

await test('sources can be attached, and are NOT a gated artifact', () => {
  // Sources are evidence for the human at the gate, not a thing he approves.
  // If a gate ever bound to them, re-running research would void an approval
  // of a script that had not changed.
  const pipe = fresh();
  const id = pipe.start({ brief: 'x' }).id;
  pipe.attach(id, 'sources', ['CPI rose 2.4%']);
  assert.deepStrictEqual(pipe.get(id).sources, ['CPI rose 2.4%']);
  assert.ok(!Object.values(P.GATE_ARTIFACT).includes('sources'),
    'a gate binds to sources — re-running research would void an unrelated approval');
  // And attaching them alone does not make a job reviewable.
  assert.strictEqual(pipe.submit(id, GATES.SCRIPT).ok, false);
});

await test('an unknown artifact field is rejected', () => {
  const pipe = fresh();
  const id = pipe.start({ brief: 'x' }).id;
  assert.throws(() => pipe.attach(id, 'state', 'queued'), /unknown artifact/);
  assert.throws(() => pipe.attach(id, 'approvals', []), /unknown artifact/);
});

// ── the layering and safety rules ─────────────────────────────────────────

await test('this module opens no socket and shells out to nothing', () => {
  const src = fs.readFileSync(path.join(__dirname, 'content-pipeline.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['http', 'https', 'net', 'child_process', 'node-fetch']) {
    assert.ok(!new RegExp(`require\\(['"]${banned}['"]\\)`).test(src),
      `content-pipeline.js requires ${banned}`);
  }
  assert.ok(!/\bfetch\s*\(/.test(src), 'content-pipeline.js calls fetch');
});

await test('every state change goes through guard(), so the kill switch covers it', () => {
  const src = fs.readFileSync(path.join(__dirname, 'content-pipeline.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // Each append of a 'state' row must sit inside a guard() call. Counting is
  // crude but catches a new transition added around the side.
  const stateAppends = (src.match(/kind: 'state'/g) || []).length;
  const guards = (src.match(/guard\(/g) || []).length;
  assert.ok(guards >= stateAppends,
    `${stateAppends} state transitions but only ${guards} guard() calls`);
});

await test('the pipeline is NOT wired into scheduler.js', () => {
  // Pinned rather than promised, same as the memory stack.
  const sched = fs.readFileSync(path.join(__dirname, 'scheduler.js'), 'utf8');
  assert.ok(!/content-pipeline/.test(sched),
    'content-pipeline is wired into scheduler.js — update this test deliberately');
});

finish();
})();
