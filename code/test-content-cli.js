// `jj content` — the surface Ahmed operates the two gates through.
//
// The gates themselves are covered by test-content-pipeline.js. This suite
// covers the things a CLI gets wrong: approving the wrong job because a short
// id was ambiguous, approving from a script, approving a job no gate is
// waiting on, and reporting success when nothing happened.
//
// THE ONE IT EXISTS FOR: `approve` must not work without an interactive
// terminal. That check is a speed bump rather than a security boundary — an
// agent with shell access can call the pipeline module directly, since
// shell.js's allowlist includes `node` — and the module's header says so
// plainly. A test below asserts the refusal text keeps saying so, because a
// speed bump described as a boundary is worse than no speed bump.
//
// Offline: injected pipeline over a temp log, `interactive` injected rather
// than read from process.stdin.isTTY, so both answers are testable.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const CLI = require('./content-cli.js');
const P = require('./content-pipeline.js');
const { GATES, STATES } = P;

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-ccli-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

let seq = 0;
function fresh() {
  let t = Date.parse('2026-09-10T00:00:00.000Z');
  return P.openPipeline({
    file: path.join(TMP, `cli-${seq++}.jsonl`),
    clock: { iso: () => new Date(t += 1000).toISOString() },
  });
}
const HUMAN = { interactive: true };

function atScript(pipe, brief = 'a video about X', script = 'the draft') {
  const id = pipe.start({ brief }).id;
  pipe.attach(id, 'script', script);
  pipe.submit(id, GATES.SCRIPT);
  return id;
}

(async () => {

// ── the queue view ────────────────────────────────────────────────────────

await test('an empty queue says so rather than printing a bare header', () => {
  const out = CLI.run(fresh(), ['queue']);
  assert.strictEqual(out.exitCode, 0);
  assert.ok(/Nothing waiting on you/.test(out.text), out.text);
});

await test('queue lists only what is at a gate', () => {
  const pipe = fresh();
  const drafting = pipe.start({ brief: 'not ready yet' }).id;
  const waiting = atScript(pipe, 'this one needs you');
  const out = CLI.run(pipe, ['queue']);
  assert.ok(out.text.includes(waiting.slice(0, 8)), out.text);
  assert.ok(!out.text.includes(drafting.slice(0, 8)), 'a drafting job appeared on his desk');
});

await test('queue names which gate each job waits on', () => {
  const pipe = fresh();
  const id = atScript(pipe);
  pipe.approve(id, GATES.SCRIPT, { by: 'human' });
  pipe.advance(id, GATES.SCRIPT);
  pipe.attach(id, 'cut', 'rendered');
  pipe.submit(id, GATES.CUT);
  assert.ok(/\bcut\b/.test(CLI.run(pipe, ['queue']).text));
});

await test('list shows every job, gated or not', () => {
  const pipe = fresh();
  const drafting = pipe.start({ brief: 'x' }).id;
  const waiting = atScript(pipe);
  const text = CLI.run(pipe, ['list']).text;
  assert.ok(text.includes(drafting.slice(0, 8)));
  assert.ok(text.includes(waiting.slice(0, 8)));
});

// ── show ─────────────────────────────────────────────────────────────────

await test('show prints the artifact in full, not a preview', () => {
  const long = 'A'.repeat(500);
  const pipe = fresh();
  const id = atScript(pipe, 'brief', long);
  const text = CLI.run(pipe, ['show', id]).text;
  assert.ok(text.includes(long), 'the script was truncated — he cannot approve what he cannot read');
});

await test('show prints a hash beside EVERY artifact, not just the gated one', () => {
  // The footer already names the gate's artifact hash, so asserting on that
  // one alone passed even with the per-artifact hashes deleted. The point of
  // the per-artifact hash is matching any log row back to specific bytes by
  // eye — including artifacts the current gate is not about.
  const pipe = fresh();
  const id = pipe.start({ brief: 'b' }).id;
  pipe.attach(id, 'script', 'script bytes');
  pipe.attach(id, 'cut', 'cut bytes');
  pipe.submit(id, GATES.SCRIPT);
  const text = CLI.run(pipe, ['show', id]).text;
  assert.ok(text.includes(P.hash('script bytes').slice(0, 8)), 'no hash for the script');
  assert.ok(text.includes(P.hash('cut bytes').slice(0, 8)), 'no hash for the cut — only the gated artifact was hashed');
});

await test('show says when a job is not waiting on him', () => {
  const pipe = fresh();
  const id = pipe.start({ brief: 'x' }).id;
  assert.ok(/Not waiting on you/.test(CLI.run(pipe, ['show', id]).text));
});

await test('show surfaces a prior rejection and its reason', () => {
  const pipe = fresh();
  const id = atScript(pipe);
  pipe.reject(id, GATES.SCRIPT, { by: 'human', why: 'wrong angle' });
  assert.ok(/wrong angle/.test(CLI.run(pipe, ['show', id]).text));
});

// ── id resolution: the convenience that must not cause a wrong approval ──

await test('a short id prefix resolves', () => {
  const pipe = fresh();
  const id = atScript(pipe);
  assert.strictEqual(CLI.run(pipe, ['show', id.slice(0, 8)]).exitCode, 0);
});

await test('an AMBIGUOUS prefix refuses instead of picking one', () => {
  // Approving the wrong job is exactly the mistake a convenience feature
  // must not be able to cause.
  const pipe = fresh();
  pipe.start({ brief: 'one', id: 'abc111' });
  pipe.start({ brief: 'two', id: 'abc222' });
  const out = CLI.run(pipe, ['show', 'abc']);
  assert.strictEqual(out.exitCode, 1);
  assert.ok(/matches 2 jobs/.test(out.text), out.text);
});

await test('an exact id wins over being a prefix of another', () => {
  const pipe = fresh();
  pipe.start({ brief: 'short', id: 'abc' });
  pipe.start({ brief: 'longer', id: 'abcdef' });
  const out = CLI.run(pipe, ['show', 'abc']);
  assert.strictEqual(out.exitCode, 0);
  assert.ok(/brief   short/.test(out.text), out.text);
});

await test('an unknown id is an error, not an empty report', () => {
  const out = CLI.run(fresh(), ['show', 'nope']);
  assert.strictEqual(out.exitCode, 1);
  assert.ok(/no job matches/.test(out.text));
});

await test('a command with no id is an error', () => {
  for (const sub of ['show', 'approve', 'reject']) {
    const out = CLI.run(fresh(), [sub]);
    assert.strictEqual(out.exitCode, 1, `${sub} accepted no id`);
    assert.ok(/needs a job id/.test(out.text));
  }
});

// ── THE ONE THIS SUITE EXISTS FOR: no approving from a script ────────────

await test('approve refuses without an interactive terminal', () => {
  const pipe = fresh();
  const id = atScript(pipe);
  const out = CLI.run(pipe, ['approve', id]);
  assert.strictEqual(out.exitCode, 1);
  assert.strictEqual(pipe.get(id).approvals.length, 0, 'an approval was written anyway');
  assert.strictEqual(pipe.get(id).state, STATES.SCRIPT_REVIEW);
});

await test('reject also refuses without a terminal', () => {
  // Rejecting is less dangerous than approving but is still a claim about
  // what a human said, and the log should not carry a false one either way.
  const pipe = fresh();
  const id = atScript(pipe);
  assert.strictEqual(CLI.run(pipe, ['reject', id, 'no']).exitCode, 1);
  assert.strictEqual(pipe.get(id).rejections.length, 0);
});

await test('the refusal keeps admitting it is a speed bump, not a boundary', () => {
  // A speed bump described as a security boundary is worse than no speed
  // bump, because it invites reliance it cannot carry. If someone later
  // rewrites this message into a confident one, this fails.
  const pipe = fresh();
  const out = CLI.run(pipe, ['approve', atScript(pipe)]);
  const text = out.text.toLowerCase();
  assert.ok(/not a security boundary/.test(text), out.text);
  assert.ok(/directly/.test(text), 'the refusal no longer says the module can be called directly');
  assert.ok(/detectable/.test(text), 'the refusal no longer points at the audit row');
});

await test('an interactive approve opens the gate and advances', () => {
  const pipe = fresh();
  const id = atScript(pipe);
  const out = CLI.run(pipe, ['approve', id], HUMAN);
  assert.strictEqual(out.exitCode, 0, out.text);
  assert.strictEqual(pipe.get(id).state, STATES.PRODUCING);
});

await test('the approval it writes is bound to the artifact', () => {
  const pipe = fresh();
  const id = atScript(pipe, 'brief', 'the bytes he read');
  CLI.run(pipe, ['approve', id], HUMAN);
  assert.strictEqual(pipe.get(id).approvals[0].artifact_hash, P.hash('the bytes he read'));
});

await test('an interactive reject records the reason', () => {
  const pipe = fresh();
  const id = atScript(pipe);
  const out = CLI.run(pipe, ['reject', id, 'not', 'my', 'angle'], HUMAN);
  assert.strictEqual(out.exitCode, 0);
  assert.strictEqual(pipe.get(id).rejections[0].why, 'not my angle');
  assert.strictEqual(pipe.get(id).state, STATES.REJECTED);
});

await test('approving a job at no gate is refused, even interactively', () => {
  const pipe = fresh();
  const id = pipe.start({ brief: 'still drafting' }).id;
  const out = CLI.run(pipe, ['approve', id], HUMAN);
  assert.strictEqual(out.exitCode, 1);
  assert.ok(/no gate is waiting on you/.test(out.text), out.text);
});

await test('a job mid-production is not approvable — only the two review states are', () => {
  // gateFor() must map ONLY the review states to a gate. A mutation widening
  // it to include `producing` escaped until this existed: nothing drove a
  // non-review, non-terminal job at approve.
  const pipe = fresh();
  const id = atScript(pipe);
  CLI.run(pipe, ['approve', id], HUMAN);
  assert.strictEqual(pipe.get(id).state, STATES.PRODUCING, 'fixture broken');
  const out = CLI.run(pipe, ['approve', id], HUMAN);
  assert.strictEqual(out.exitCode, 1, 'approved a job that was mid-production');
  assert.ok(/no gate is waiting on you/.test(out.text), out.text);
  assert.strictEqual(pipe.get(id).approvals.length, 1, 'a second approval was written');
});

// The two branches below are unreachable through the real pipeline: the CLI
// only reaches approve() when gateFor() says a gate is open, and it always
// passes a valid approver. Both mutations that made them report SUCCESS
// escaped for exactly that reason. They are defensive, and a defensive branch
// nothing exercises is indistinguishable from a broken one — so they are
// driven with a stub pipe. `run()` takes the pipeline as an argument, which
// is what makes this possible without contorting the real one.
const stubPipe = (over = {}) => ({
  all: () => [{ job_id: 'stub1' }],
  get: () => ({
    id: 'stub1', state: STATES.SCRIPT_REVIEW, brief: 'b',
    script: 's', cut: null, metadata: null,
    approvals: [], rejections: [], history: [],
  }),
  approve: () => ({ ok: true }),
  advance: () => ({ ok: true, state: STATES.PRODUCING }),
  reject: () => ({ ok: true }),
  pending: () => [], list: () => [],
  ...over,
});

await test('approve surfaces a refusal from the pipeline instead of claiming success', () => {
  const out = CLI.run(stubPipe({ approve: () => ({ ok: false, why: 'nope' }) }), ['approve', 'stub1'], HUMAN);
  assert.strictEqual(out.exitCode, 1);
  assert.ok(/nope/.test(out.text), out.text);
});

await test('approve surfaces a failed advance instead of claiming success', () => {
  const out = CLI.run(stubPipe({ advance: () => ({ ok: false, why: 'stale' }) }), ['approve', 'stub1'], HUMAN);
  assert.strictEqual(out.exitCode, 1);
  assert.ok(/could not advance/.test(out.text), out.text);
  assert.ok(/stale/.test(out.text), out.text);
});

await test('reject surfaces a refusal from the pipeline', () => {
  const out = CLI.run(stubPipe({ reject: () => ({ ok: false, why: 'bad approver' }) }), ['reject', 'stub1'], HUMAN);
  assert.strictEqual(out.exitCode, 1);
  assert.ok(/bad approver/.test(out.text), out.text);
});

await test('approve reports failure rather than success when advance refuses', () => {
  // A CLI that says "done" when nothing happened is the vacuous-pass shape
  // one layer up.
  const pipe = fresh();
  const id = atScript(pipe);
  pipe.reject(id, GATES.SCRIPT, { by: 'human', why: 'no' });
  // The job is REJECTED, so gateFor() finds no gate — the refusal must be an
  // error exit, never a cheerful one.
  const out = CLI.run(pipe, ['approve', id], HUMAN);
  assert.strictEqual(out.exitCode, 1);
});

// ── help and unknown commands ────────────────────────────────────────────

await test('no subcommand prints usage and exits non-zero', () => {
  const out = CLI.run(fresh(), []);
  assert.strictEqual(out.exitCode, 1);
  assert.ok(/Usage: jj content/.test(out.text));
});

await test('explicit help exits zero', () => {
  assert.strictEqual(CLI.run(fresh(), ['help']).exitCode, 0);
});

await test('an unknown subcommand is an error, not silence', () => {
  const out = CLI.run(fresh(), ['aprove', 'x']);
  assert.strictEqual(out.exitCode, 1);
  assert.ok(/unknown command/.test(out.text));
});

await test('run() never writes to the console or exits the process', () => {
  const src = fs.readFileSync(path.join(__dirname, 'content-cli.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/console\./.test(src), 'content-cli.js writes to the console');
  assert.ok(!/process\.exit/.test(src), 'content-cli.js exits the process');
  assert.ok(!/isTTY/.test(src), 'content-cli.js reads isTTY instead of taking it as an argument');
});

finish();
})();
