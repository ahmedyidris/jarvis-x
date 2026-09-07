#!/usr/bin/env node
// Re-runnable agent routing eval. Scores action-TYPE selection only -- not
// argument correctness -- because that is what the 85% gate was ever actually
// measuring by hand.
//
// WHAT CHANGED 2026-09-04, and why. The old set was 15 cases scoring 15/15,
// which REMAINING_WORK.md P0 already distrusted: the cases and agent.js's
// few-shot examples were written in one sitting. Measured, that was right and
// understated -- one case was VERBATIM identical to a few-shot example and
// four more were near-copies, so a third of the set measured recall.
//
// Three things follow from that, and they are the whole of this rewrite:
//
//   1. Cases are tagged 'mirror' or 'held-out' (see eval-cases.js). The GAP
//      between those accuracies is the overfitting measurement. Only the
//      held-out number may be compared against the gate.
//   2. Accuracy is reported per category. A uniform 85% and an 85% that is
//      100% on listing and 40% on refusals are different systems, and only
//      one of them is safe to build a self-debug loop on top of.
//   3. --runs N repeats the whole set and reports the spread. One pass over a
//      stochastic model is an estimate with an error bar nobody had drawn.
//
// The harness REFUSES to declare the gate met on too small a held-out sample
// rather than reporting a confident fraction of a handful.
const fs = require('fs');
const path = require('path');
const { CASES, CATEGORIES } = require('./eval-cases.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'logs', 'eval-agent.json');

const GATE = 0.85;
// Below this many held-out cases, no gate verdict is issued. At n=10 a single
// flip moves the number 10 points; calling that "85% met" would be theatre.
const MIN_HELDOUT = 25;

/** One pass over every case. `propose` is injected so the scoring logic here
 *  is testable without a model -- see code/test-eval-agent.js. */
async function runOnce(propose, cases = CASES, { onResult = null } = {}) {
  const results = [];
  for (const c of cases) {
    let got = null, err = null;
    try {
      const r = await propose(c.goal, { dryRun: true });
      got = r.action ? r.action.type : (r.proposed ? r.proposed.type : null);
      if (r.error) err = r.reason || r.error;
    } catch (e) { err = e.message; }
    const row = {
      goal: c.goal, expect: c.expect, category: c.category, origin: c.origin,
      lenient: c.expect.length > 1,
      got, err, ok: got !== null && c.expect.includes(got),
    };
    results.push(row);
    // Reported as it happens, not after the loop. The CLI used to collect all
    // 48 rows and print the PASS/FAIL block afterwards, which put propose()'s
    // own "REJECTED by validator: ..." lines ABOVE the block, detached from
    // the cases they belonged to. That misled me into attributing a rejection
    // to the first case, which had passed. Interleaved output keeps a model's
    // console noise next to the row it explains.
    if (onResult) onResult(row);
  }
  return results;
}

const pct = (n, d) => (d === 0 ? null : n / d);

function slice(results, predicate) {
  const rows = results.filter(predicate);
  return { total: rows.length, passed: rows.filter(r => r.ok).length,
           accuracy: pct(rows.filter(r => r.ok).length, rows.length) };
}

/** Everything worth knowing about one pass, cut the ways that matter. */
function summarize(results) {
  const heldOut = slice(results, r => r.origin === 'held-out');
  const mirror = slice(results, r => r.origin === 'mirror');
  // Cases the prompt was changed in response to. Reported, never in the gate:
  // a case whose failure told me what to teach cannot then testify that the
  // teaching generalized. Slicing by origin means this stays out of heldOut
  // automatically, which is the point of the third label.
  const tuned = slice(results, r => r.origin === 'tuned');
  const byCategory = {};
  for (const cat of CATEGORIES) byCategory[cat] = slice(results, r => r.category === cat);

  // A gap this wide means the model is reciting the prompt, not routing.
  const gap = (mirror.accuracy !== null && heldOut.accuracy !== null)
    ? mirror.accuracy - heldOut.accuracy : null;

  return {
    overall: slice(results, () => true),
    heldOut, mirror, tuned, gap,
    strict: slice(results, r => !r.lenient),
    lenient: slice(results, r => r.lenient),
    byCategory,
    // The verdict is deliberately about held-out only, and refuses to exist
    // when the sample cannot support it.
    gate: GATE,
    gateBasis: 'held-out',
    gateMet: heldOut.total >= MIN_HELDOUT && heldOut.accuracy >= GATE,
    gateUndecidable: heldOut.total < MIN_HELDOUT,
    minHeldOut: MIN_HELDOUT,
  };
}

/** Spread across repeated passes. One run of a stochastic model is a point
 *  estimate; this is the error bar. */
function aggregate(summaries) {
  const acc = summaries.map(s => s.heldOut.accuracy).filter(a => a !== null);
  if (!acc.length) return null;
  const mean = acc.reduce((a, b) => a + b, 0) / acc.length;
  const sd = Math.sqrt(acc.reduce((a, x) => a + (x - mean) ** 2, 0) / acc.length);
  // Flaky cases are more actionable than the average: a case that passes on
  // one run and fails on the next is not "85% correct", it is unreliable.
  const byGoal = {};
  for (const s of summaries) {
    for (const r of s._results) {
      (byGoal[r.goal] ||= []).push(r.ok);
    }
  }
  const unstable = Object.entries(byGoal)
    .filter(([, oks]) => oks.some(Boolean) && !oks.every(Boolean))
    .map(([goal, oks]) => ({ goal, passed: oks.filter(Boolean).length, of: oks.length }));
  return { runs: acc.length, heldOutMean: mean, heldOutMin: Math.min(...acc),
           heldOutMax: Math.max(...acc), heldOutStdDev: sd, unstable };
}

function format(summary, agg) {
  const p = (a) => (a === null ? '  n/a' : `${(a * 100).toFixed(1)}%`);
  const L = [];
  L.push('');
  L.push(`held-out   ${summary.heldOut.passed}/${summary.heldOut.total}  ${p(summary.heldOut.accuracy)}   <- the number that counts`);
  L.push(`mirror     ${summary.mirror.passed}/${summary.mirror.total}  ${p(summary.mirror.accuracy)}   (close to agent.js's few-shot examples)`);
  if (summary.tuned.total) {
    L.push(`tuned      ${summary.tuned.passed}/${summary.tuned.total}  ${p(summary.tuned.accuracy)}   (the prompt was changed for these -- NOT in the gate)`);
  }
  if (summary.gap !== null) {
    L.push(`gap        ${(summary.gap * 100).toFixed(1)} points` +
           (summary.gap > 0.15 ? '  <- WIDE: the model is reciting the prompt, not routing' : ''));
  }
  L.push('');
  L.push('by category:');
  for (const [cat, s] of Object.entries(summary.byCategory)) {
    const flag = cat === 'refuse' && s.accuracy !== null && s.accuracy < 1
      ? '  <- a miss here is a proposed action for a goal it cannot do' : '';
    L.push(`  ${cat.padEnd(12)} ${String(s.passed).padStart(2)}/${String(s.total).padEnd(2)}  ${p(s.accuracy)}${flag}`);
  }
  L.push('');
  L.push(`strict cases  ${summary.strict.passed}/${summary.strict.total}  ${p(summary.strict.accuracy)}`);
  L.push(`lenient cases ${summary.lenient.passed}/${summary.lenient.total}  ${p(summary.lenient.accuracy)}  (more than one accepted answer)`);

  if (agg && agg.runs > 1) {
    L.push('');
    L.push(`across ${agg.runs} runs: held-out mean ${p(agg.heldOutMean)}, ` +
           `range ${p(agg.heldOutMin)}-${p(agg.heldOutMax)}, sd ${(agg.heldOutStdDev * 100).toFixed(1)} points`);
    if (agg.unstable.length) {
      L.push(`${agg.unstable.length} case(s) changed answer between runs:`);
      for (const u of agg.unstable) L.push(`  ${u.passed}/${u.of}  ${u.goal}`);
    } else {
      L.push('every case answered the same way on every run.');
    }
  }

  L.push('');
  if (summary.gateUndecidable) {
    L.push(`GATE UNDECIDABLE: ${summary.heldOut.total} held-out cases, ${summary.minHeldOut} required.`);
    L.push('Not reporting a verdict on a sample this size.');
  } else {
    L.push(`GATE ${(summary.gate * 100).toFixed(0)}% on held-out: ${summary.gateMet ? 'MET' : 'NOT MET'}`);
  }
  return L.join('\n');
}

/**
 * Persist what has been measured so far.
 *
 * WHY THIS IS CALLED AFTER EVERY RUN, not once at the end. It used to write
 * only after the final run, so interrupting a `--runs 3` on run 3 left the
 * PREVIOUS invocation's file in place -- and that file reads as current. It
 * happened: a completed run of 48 backend failures was still on disk while
 * runs 1 and 2 of a healthy pass had printed 90% to the terminal, and the
 * stale JSON was taken for the new result.
 *
 * `runsCompleted` vs `runsRequested` is the tell. If they differ, the file is
 * partial and says so rather than looking finished.
 */
function persist(summaries, requested, { out = OUT } = {}) {
  const agg = aggregate(summaries);
  const last = summaries[summaries.length - 1];
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    timestamp: new Date().toISOString(),
    model: process.env.JX_BACKEND || 'local',
    runsRequested: requested,
    runsCompleted: summaries.length,
    complete: summaries.length === requested,
    aggregate: agg,
    summary: summaries.map(({ _results, ...s }) => s),
    results: last ? last._results : [],
  }, null, 2));
  return agg;
}

/**
 * Check the backend can actually answer BEFORE spending 48 cases x N runs on
 * it. Added after three separate full runs were burned on environmental
 * faults: a TypeError in agent.js, then a stale checkout, then a model Ollama
 * did not have. Each printed 144 identical failure lines and a confident
 * 0.0%, which reads like a routing result and is not one.
 *
 * An eval that cannot tell "the model routed badly" from "there is no model"
 * is not measuring what it claims to measure.
 *
 * `fetcher` is injected so this is testable without a daemon.
 */
async function preflight({ fetcher = fetch, base = 'http://127.0.0.1:11434',
                           model = require('./local.js').MODEL,
                           backend = process.env.JX_BACKEND || 'local' } = {}) {
  if (backend !== 'local') {
    return { ok: true, skipped: `backend is ${backend}, not local — not checking Ollama` };
  }
  let res;
  try {
    res = await fetcher(`${base}/api/tags`);
  } catch (e) {
    return { ok: false, reason: `Ollama is unreachable at ${base} (${e.message})`,
             fix: 'start it with `ollama serve`, then re-run' };
  }
  if (!res.ok) {
    return { ok: false, reason: `Ollama answered ${res.status} for /api/tags`,
             fix: 'check the daemon; `curl -sf 127.0.0.1:11434/api/tags` should return JSON' };
  }
  let tags;
  try { tags = await res.json(); } catch (e) {
    return { ok: false, reason: `Ollama's /api/tags was not JSON (${e.message})`, fix: 'check the daemon' };
  }
  const installed = (tags.models || []).map(m => m.name || m.model).filter(Boolean);
  // EXACT match only. The first version also accepted any tag of the same
  // family, which would have passed `qwen2.5:7b` for a request for
  // `qwen2.5:3b` -- two different models, and Ollama 404s on the mismatch.
  // Blocking a run that would have worked costs one command; passing a run
  // that cannot work costs 48 cases x N runs of identical failures, which is
  // the thing this function exists to prevent. So err toward blocking.
  const present = installed.includes(model);
  if (!present) {
    // Naming the sibling tags is the difference between a fix and a guess:
    // "you have 7b, you asked for 3b" is immediately actionable.
    const family = model.split(':')[0];
    const siblings = installed.filter(n => n.split(':')[0] === family);
    return { ok: false, model, installed,
             reason: `Ollama is running but does not have ${model}`,
             fix: `ollama pull ${model}` +
                  (siblings.length ? `   (you have ${siblings.join(', ')} — a different size)`
                                   : `   (installed: ${installed.join(', ') || 'nothing'})`) };
  }
  return { ok: true, model, installed };
}

module.exports = { runOnce, preflight, summarize, aggregate, persist, format, slice,
                   GATE, MIN_HELDOUT, CASES };

if (require.main === module) {
  const { propose } = require('./agent.js');
  const runsArg = process.argv.indexOf('--runs');
  const runs = runsArg > -1 ? Math.max(1, parseInt(process.argv[runsArg + 1], 10) || 1) : 1;

  (async () => {
    // Fail fast and legibly rather than printing 144 identical lines and a
    // 0.0% that looks like a measurement.
    const pf = await preflight();
    if (!pf.ok) {
      console.error(`\nCannot run the eval: ${pf.reason}`);
      console.error(`Fix: ${pf.fix}`);
      console.error('\nNo cases were run, and no accuracy is reported —');
      console.error('a broken backend is not a routing score.');
      process.exit(1);
    }
    if (pf.skipped) console.log(`preflight: ${pf.skipped}`);
    else console.log(`preflight: Ollama has ${pf.model}`);

    const summaries = [];
    // Ctrl-C mid-run must leave the completed runs on disk, not the previous
    // invocation's file.
    process.on('SIGINT', () => {
      if (summaries.length) {
        persist(summaries, runs);
        console.error(`\ninterrupted after ${summaries.length} of ${runs} run(s) — ` +
                      `${OUT} holds what completed, marked incomplete.`);
      } else {
        console.error('\ninterrupted before any run finished — nothing written.');
      }
      process.exit(130);
    });

    for (let i = 0; i < runs; i++) {
      if (runs > 1) console.log(`\n--- run ${i + 1} of ${runs} ---`);
      const results = await runOnce(propose, CASES, {
        onResult: (r) => console.log(
          `${r.ok ? 'PASS' : 'FAIL'}  [${r.origin}] ${r.goal}  -> ${r.got || r.err}`),
      });
      const s = summarize(results);
      s._results = results;
      summaries.push(s);
      // Written now, not at the end. A partial file that says it is partial
      // beats a stale file that looks current.
      persist(summaries, runs);
    }
    console.log(format(summaries[summaries.length - 1], aggregate(summaries)));
    process.exit(0);
  })();
}
