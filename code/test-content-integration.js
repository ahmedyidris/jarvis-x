// THE CONTENT PATH AS ONE STORY — draft, gate, produce, gate, post.
//
// code/content-draft.js, content-fidelity.js, content-pipeline.js and
// content-cli.js each have their own green suite. None of those suites can see
// a gap BETWEEN them, and that is where the expensive bugs live: the bitemporal
// memory stack had five green layer suites while no human-approved change could
// ever be applied, because layer 4 and layer 7 disagreed about one token.
//
// So this drives the whole path with fakes at the edges and asks the questions
// only the seams can answer:
//   - Does what the drafter PRODUCES fit what the pipeline ACCEPTS?
//   - Does the gate show Ahmed enough to actually judge the thing?
//   - Does a refusal upstream reliably stop anything reaching the gate?
//   - Does the script the gate binds to stay byte-identical end to end?
//
// Offline: every model call, research call and post is a fake, and the voice
// profile is a temp file. Nothing here opens a socket.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const D = require('./content-draft.js');
const P = require('./content-pipeline.js');
const CLI = require('./content-cli.js');
const { GATES, STATES } = P;

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-cint-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

let seq = 0;
const HUMAN = { interactive: true };
const SOURCE = 'CPI rose 2.4% in August, the slowest pace since 2021.';
const BRIEF = 'explain the August CPI print for a general audience';

function voiceFile() {
  const p = path.join(TMP, `voice-${seq++}.md`);
  fs.writeFileSync(p, '# voice\n\nShort sentences. I never open with a rhetorical question.\n');
  return p;
}
function pipeline() {
  let t = Date.parse('2026-09-15T09:00:00.000Z');
  return P.openPipeline({
    file: path.join(TMP, `jobs-${seq++}.jsonl`),
    clock: { iso: () => new Date(t += 1000).toISOString() },
  });
}
function scriptedAsk(...answers) {
  const prompts = [];
  const fn = async (p) => { prompts.push(p); return answers[prompts.length - 1] ?? answers[answers.length - 1]; };
  fn.prompts = prompts;
  return fn;
}
const researchOK = async () => [SOURCE];

(async () => {

// --- the whole story, once, so the rest is known to be blocking something --

await test('brief -> draft -> gate -> produce -> gate -> queued -> posted', async () => {
  const pipe = pipeline();
  const drafted = await D.draft({
    brief: BRIEF, ask: scriptedAsk('Outline: CPI 2.4%', 'Script: CPI rose 2.4% in August.'),
    research: researchOK, voiceFile: voiceFile(),
  });
  assert.strictEqual(drafted.ok, true, drafted.why);

  const job = pipe.start({ brief: drafted.brief });
  pipe.attach(job.id, 'script', drafted.script);
  pipe.attach(job.id, 'sources', drafted.sources);
  pipe.submit(job.id, GATES.SCRIPT);

  assert.strictEqual(CLI.run(pipe, ['approve', job.id], HUMAN).exitCode, 0);
  assert.strictEqual(pipe.get(job.id).state, STATES.PRODUCING);

  pipe.attach(job.id, 'cut', 'rendered.mp4');
  pipe.submit(job.id, GATES.CUT);
  assert.strictEqual(CLI.run(pipe, ['approve', job.id], HUMAN).exitCode, 0);
  assert.strictEqual(pipe.get(job.id).state, STATES.QUEUED);

  const posted = await pipe.post(job.id, async () => 'https://example/v1');
  assert.strictEqual(posted.ok, true);
  assert.strictEqual(pipe.get(job.id).state, STATES.POSTED);
});

// --- THE SEAM THIS SUITE WAS WRITTEN TO CHECK ----------------------------

await test('the gate shows Ahmed what the script was drafted FROM', async () => {
  // draft() returns `sources` and its own docstring calls that "what makes
  // 'is this true' answerable at all". If the pipeline cannot hold them and
  // the CLI cannot show them, the gate presents a script with no provenance
  // and the human is asked to approve prose he cannot check. Every module's
  // own suite passes in that state — which is exactly why this lives here.
  const pipe = pipeline();
  const drafted = await D.draft({
    brief: BRIEF, ask: scriptedAsk('Outline: 2.4%', 'Script: CPI rose 2.4%.'),
    research: researchOK, voiceFile: voiceFile(),
  });
  const job = pipe.start({ brief: drafted.brief });
  pipe.attach(job.id, 'script', drafted.script);
  pipe.attach(job.id, 'sources', drafted.sources);
  pipe.submit(job.id, GATES.SCRIPT);

  const shown = CLI.run(pipe, ['show', job.id]).text;
  assert.ok(shown.includes(drafted.script), 'the script is not shown');
  assert.ok(shown.includes(SOURCE),
    'the gate does not show the sources — Ahmed is asked to approve a claim he cannot check');
});

await test('the script the gate binds to is byte-identical to what was drafted', async () => {
  // A trim, a normalisation or a JSON round-trip anywhere in the seam would
  // make the approval hash cover text that is not what the model wrote.
  const pipe = pipeline();
  const script = '  Script with trailing space and\na newline.  ';
  const drafted = await D.draft({
    brief: BRIEF, ask: scriptedAsk('Outline: 2.4%', script),
    research: researchOK, voiceFile: voiceFile(),
  });
  const job = pipe.start({ brief: drafted.brief });
  pipe.attach(job.id, 'script', drafted.script);
  pipe.submit(job.id, GATES.SCRIPT);
  assert.strictEqual(pipe.get(job.id).script, script);
  CLI.run(pipe, ['approve', job.id], HUMAN);
  assert.strictEqual(pipe.get(job.id).approvals[0].artifact_hash, P.hash(script));
});

await test('a REFUSED draft carries no script to attach', async () => {
  // The refusal is only worth anything if the caller cannot get a script out
  // of it by accident. A `{ok:false}` that still carried text would invite
  // exactly that.
  const pipe = pipeline();
  const drafted = await D.draft({
    brief: BRIEF, ask: scriptedAsk('Script: lowest in 40 months', 'Script: lowest in 40 months'),
    research: researchOK, voiceFile: voiceFile(),
  });
  assert.strictEqual(drafted.ok, false);
  assert.strictEqual(drafted.script, undefined);

  const job = pipe.start({ brief: BRIEF });
  // Tight: the regex first written here ended in an empty alternative, which
  // matches ANY error and would have passed on a thrown TypeError just as
  // happily as on the intended refusal.
  assert.throws(() => pipe.attach(job.id, 'script', drafted.script),
    /refusing to attach an empty script/);
  // And with nothing attached, the gate cannot be reached at all.
  assert.strictEqual(pipe.submit(job.id, GATES.SCRIPT).ok, false);
});

await test('a re-draft after approval voids it, end to end', async () => {
  // The drafter and the pipeline each behave correctly alone; this is the
  // combination — regenerate a script Ahmed already approved and the approval
  // must not carry over to the new text.
  const pipe = pipeline();
  const first = await D.draft({
    brief: BRIEF, ask: scriptedAsk('Outline: 2.4%', 'Script: first take, CPI 2.4%.'),
    research: researchOK, voiceFile: voiceFile(),
  });
  const job = pipe.start({ brief: BRIEF });
  pipe.attach(job.id, 'script', first.script);
  pipe.submit(job.id, GATES.SCRIPT);
  pipe.approve(job.id, GATES.SCRIPT, { by: 'human' });
  assert.strictEqual(pipe.checkGate(job.id, GATES.SCRIPT).verdict, 'approved');

  const second = await D.draft({
    brief: BRIEF, ask: scriptedAsk('Outline: 2.4%', 'Script: second take, CPI 2.4%.'),
    research: researchOK, voiceFile: voiceFile(),
  });
  assert.notStrictEqual(second.script, first.script, 'fixture broken: the re-draft is identical');
  pipe.attach(job.id, 'script', second.script);
  assert.notStrictEqual(pipe.checkGate(job.id, GATES.SCRIPT).verdict, 'approved',
    'the approval survived a re-draft — Ahmed would publish text he never read');
});

await test('an unfilled voice profile means nothing ever reaches the queue', async () => {
  // The refusal at the top of the path has to hold all the way down, not just
  // return a falsy object somebody downstream ignores.
  const pipe = pipeline();
  const unfilled = path.join(TMP, `unfilled-${seq++}.md`);
  fs.writeFileSync(unfilled, `${D.UNFILLED}\n\n# voice\n`);
  const drafted = await D.draft({
    brief: BRIEF, ask: scriptedAsk('Script: anything'), research: researchOK, voiceFile: unfilled,
  });
  assert.strictEqual(drafted.ok, false);
  assert.strictEqual(drafted.reason, 'unfilled');
  assert.deepStrictEqual(pipe.pending(), [], 'a job reached the queue despite the refusal');
});

// --- the audit trail the whole thing rests on ----------------------------

await test('the finished job records the brief, the script, and who approved what', async () => {
  // After the fact, "why did this get published" has to be answerable from
  // the log alone — not from whoever happened to be watching.
  const pipe = pipeline();
  const drafted = await D.draft({
    brief: BRIEF, ask: scriptedAsk('Outline: 2.4%', 'Script: CPI rose 2.4%.'),
    research: researchOK, voiceFile: voiceFile(),
  });
  const job = pipe.start({ brief: drafted.brief });
  pipe.attach(job.id, 'script', drafted.script);
  pipe.attach(job.id, 'sources', drafted.sources);
  pipe.submit(job.id, GATES.SCRIPT);
  CLI.run(pipe, ['approve', job.id], HUMAN);
  pipe.attach(job.id, 'cut', 'rendered.mp4');
  pipe.submit(job.id, GATES.CUT);
  CLI.run(pipe, ['approve', job.id], HUMAN);
  await pipe.post(job.id, async () => 'url');

  const final = pipe.get(job.id);
  assert.strictEqual(final.brief, BRIEF);
  assert.strictEqual(final.state, STATES.POSTED);
  assert.deepStrictEqual(final.approvals.map((a) => a.gate), [GATES.SCRIPT, GATES.CUT]);
  for (const a of final.approvals) assert.strictEqual(a.approved_by, 'human');
  assert.ok(final.history.some((r) => r.kind === 'attach' && r.field === 'sources'),
    'the sources are not in the permanent record');
});

finish();
})();
