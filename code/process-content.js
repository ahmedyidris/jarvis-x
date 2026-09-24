#!/usr/bin/env node
/**
 * CONTENT PIPELINE PROCESSOR — the unattended half, and only the unattended
 * half.
 *
 * `schedules.json` runs this every 30 minutes. That makes it the one caller of
 * content-pipeline.js that no human is watching, so it is the one place where
 * getting the gate discipline wrong is invisible until something is already
 * on YouTube.
 *
 * WHAT IT MAY DO, stated as a rule rather than left to the reading: it may
 * carry a job forward through every step Jarvis owns, and it may carry a job
 * PAST a gate that Ahmed has already answered. It may not answer one. Those
 * are different acts and the difference is the whole of §6.2.
 *
 * The safety here is structural rather than careful. advance() refuses on
 * anything but an `approved` verdict and post() re-checks the cut gate at the
 * moment of posting, so this file calling them in a loop cannot skip a gate
 * even if its own logic is wrong. It is written to lean on that rather than to
 * re-implement it: a second copy of the gate rules here would be a second
 * thing to keep in sync, and the copy that drifts is always the one nobody is
 * watching.
 *
 * WHY IT LOOKS DIFFERENT FROM THE VERSION IT REPLACES. The first version was
 * written against an API that does not exist. It switched on
 * `STATES.SCRIPT_APPROVED` and `STATES.CUT_APPROVED` — neither is a member of
 * STATES, so both read `undefined`, so `job.state === undefined` matched
 * nothing and the scheduled task had been a silent no-op on every run. Under
 * that, `pipeline.advance(id, STATES.CUT_READY, result)` passed `undefined` as
 * the gate (advance takes `(jobId, gate)` and derives the next state itself),
 * and — the part that mattered — it called the distributor's `post(job)`
 * DIRECTLY instead of `pipeline.post(jobId, poster)`, which is the single
 * function where rule 4's cut-gate re-check lives. Correcting only the state
 * names would have turned a no-op into an unattended path to YouTube with no
 * gate in front of it.
 *
 * `render` and `poster` are injected with NO DEFAULTS, the same as
 * content-pipeline.js's own poster. The real ones are supplied at the bottom
 * of this file, under `require.main`, so the module can be driven by a suite
 * without a socket anywhere near it.
 */
const { openPipeline, GATES, STATES } = require('./content-pipeline.js');

/**
 * Carry one job as far as the gates allow, and no further.
 *
 * Each step is attempted in order and each one may stop the job: a gate that
 * Ahmed has not answered simply returns `{ok:false}` from advance() and the
 * job stays where it is until he does.
 */
async function processJob(pipeline, jobId, { render, poster, log }) {
  const steps = [];
  const state = () => pipeline.get(jobId).state;

  // Past the script gate, if he has answered it. advance() is the authority
  // on whether he has; this only asks.
  if (state() === STATES.SCRIPT_REVIEW) {
    const r = pipeline.advance(jobId, GATES.SCRIPT);
    steps.push({ step: 'advance-script', ...r });
    if (!r.ok) return steps;
  }

  // Render. A job already carrying a cut is NOT re-rendered — it reached
  // `producing` with an artifact, which means the submit below is what
  // failed, and re-rendering every 30 minutes forever would be the cost of
  // assuming otherwise.
  if (state() === STATES.PRODUCING) {
    const job = pipeline.get(jobId);
    if (!job.cut) {
      const r = await render(job);
      steps.push({ step: 'render', ...r });
      // A refusal is a refusal. Attaching its result would put a cut in front
      // of Ahmed that no renderer produced, and the gate would be asking him
      // to approve a file that does not exist.
      if (!r || !r.ok || !r.cut) return steps;
      pipeline.attach(jobId, 'cut', r.cut);
    }
    const s = pipeline.submit(jobId, GATES.CUT);
    steps.push({ step: 'submit-cut', ...s });
    return steps; // His desk now. Nothing below this line may run unasked.
  }

  // Past the cut gate, same rule as the script gate.
  if (state() === STATES.CUT_REVIEW) {
    const r = pipeline.advance(jobId, GATES.CUT);
    steps.push({ step: 'advance-cut', ...r });
    if (!r.ok) return steps;
  }

  // Post. Reachable only from `queued`, and post() re-checks the cut gate
  // itself — this call is the ONLY route to the distributor in the codebase,
  // deliberately, and code/test-process-content.js fails if a second appears.
  if (state() === STATES.QUEUED) {
    const r = await pipeline.post(jobId, poster);
    steps.push({ step: 'post', ...r });
    if (r.ok) log(`posted ${jobId}`);
  }

  return steps;
}

/**
 * One sweep of the pipeline. Returns what it did rather than printing it, so
 * the scheduled run and the suite see the same thing.
 */
async function run({ pipeline, render, poster, log = () => {} }) {
  if (typeof render !== 'function') throw new Error('run() needs a render function');
  if (typeof poster !== 'function') throw new Error('run() needs a poster function');

  const results = [];
  for (const job of pipeline.list()) {
    // One job's failure must not strand the rest of the queue. The throw is
    // recorded rather than swallowed: a render that crashes every 30 minutes
    // and says nothing is the same silence this file was rewritten for.
    try {
      results.push({ job: job.id, steps: await processJob(pipeline, job.id, { render, poster, log }) });
    } catch (e) {
      results.push({ job: job.id, error: e.message });
      log(`job ${job.id} failed: ${e.message}`);
    }
  }
  return results;
}

module.exports = { run, processJob };

if (require.main === module) {
  const renderer = require('./content-render.js');
  const distributor = require('./content-distribute.js');
  run({
    pipeline: openPipeline(),
    render: renderer.render,
    poster: distributor.post,
    log: (m) => console.log(m),
  }).then((results) => {
    const acted = results.filter((r) => r.error || r.steps.length);
    console.log(acted.length
      ? JSON.stringify(acted, null, 2)
      : 'nothing to do — no job is waiting on Jarvis');
    if (results.some((r) => r.error)) process.exitCode = 1;
  }).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
