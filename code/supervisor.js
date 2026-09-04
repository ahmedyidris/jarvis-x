#!/usr/bin/env node
// NVIDIA's AVO paper (Agentic Variation Operators, ARC-AGI-3, Aug 2026) is two
// mechanisms: persistent memory that carries prior attempts forward so the
// agent resumes instead of re-deriving, and a SUPERVISOR that watches the
// trajectory for stagnation and redirects when the agent is looping
// unproductively. NVIDIA released a paper, not code -- there is nothing to
// install. What is portable is the second mechanism, and this file is it.
//
// WHY THIS AND NOT THE REST OF AVO: AVO's premise is long-horizon autonomy,
// days of unattended work. CONSTITUTION.md rules that out, and scheduler.js
// enforces it -- only read-only actions run unattended, everything else is
// queued for a human. So the autonomy half of AVO is declined outright.
// The supervisor half is adopted because it is the one component whose only
// effect is to do LESS: it can skip a goal, never add one, never widen a
// permission, never execute anything. A supervisor is safe here precisely
// because its output is subtraction.
//
// WHAT IT WATCHES: logs/scheduled.jsonl, which scheduler.js has been writing
// all along -- {timestamp, goal, model, proposed, outcome} per run. Nothing
// ever read it back. A goal that has proposed the identical action with the
// identical outcome ten times running is burning an LLM call every interval to
// learn nothing, and until now no part of this system could notice.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHED_LOG = path.join(ROOT, 'logs', 'scheduled.jsonl');

// How many recent runs of one goal to judge on. Below this, no verdict.
const WINDOW = 5;

// A skip that is permanent is a deletion the user never agreed to. After this
// many consecutive skips, one run is let through to re-test the judgement --
// the environment may have changed, an API key may now be present, the queue
// may have been drained. AVO's supervisor redirects exploration rather than
// terminating it; this is the same idea with the only lever available here.
const PROBE_AFTER = 20;

const VERDICTS = ['insufficient', 'productive', 'stagnant', 'failing', 'queue-flooding'];

function load(logPath = SCHED_LOG) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(r => r && typeof r.goal === 'string');
}

/** The last `window` real runs of one goal, oldest first. Skips are not runs. */
function recent(rows, goal, window = WINDOW) {
  return rows.filter(r => r.goal === goal && outcomeClass(r.outcome) !== 'supervised')
             .slice(-window);
}

/** Consecutive supervisor skips at the tail of this goal's log. */
function skipStreak(rows, goal) {
  const mine = rows.filter(r => r.goal === goal);
  let n = 0;
  for (let i = mine.length - 1; i >= 0 && outcomeClass(mine[i].outcome) === 'supervised'; i--) n++;
  return n;
}

function outcomeClass(outcome) {
  const o = String(outcome ?? '');
  // The supervisor's own skip entries land in the same log it reads. Left
  // unclassified they would fill the window with identical fingerprints and
  // the goal would be judged stagnant BECAUSE it was skipped -- a verdict
  // that proves itself. They are excluded from judgement entirely.
  if (o.startsWith('supervisor skip:')) return 'supervised';
  if (o.startsWith('error:')) return 'error';
  if (o.startsWith('rejected:')) return 'rejected';
  if (o.startsWith('halted')) return 'halted';
  if (o === 'queued for review') return 'queued';
  return 'output';
}

// The first version compared the outcome's CLASS only, on the theory that
// outcome strings vary in their tails. That was backwards and it was the worst
// mistake this module could make: a goal like "summarise today's changes"
// returns different text every day and identical class every day, so it was
// judged stagnant and silently disabled -- a false positive that switches off
// a working goal. For a real output the text IS the signal, so compare it in
// full. For errors, rejections and queue entries the tail genuinely is noise
// (a timestamp, a byte count), and those have dedicated branches above anyway.
function fingerprint(row) {
  const cls = outcomeClass(row.outcome);
  const tail = cls === 'output' ? String(row.outcome ?? '') : cls;
  return JSON.stringify(row.proposed ?? null) + '|' + tail;
}

/**
 * One verdict for one goal. Returns why, always, so the judgement can be
 * checked rather than trusted.
 */
function assess(rows, goal, { window = WINDOW } = {}) {
  const runs = recent(rows, goal, window);
  if (runs.length < window) {
    return { goal, verdict: 'insufficient', runs: runs.length, need: window,
             because: [`only ${runs.length} of ${window} runs recorded — nothing to judge yet`],
             skip: false };
  }

  const classes = runs.map(r => outcomeClass(r.outcome));
  // A halted run is the kill switch working, not the goal misbehaving.
  if (classes.every(c => c === 'halted')) {
    return { goal, verdict: 'productive', runs: runs.length, skip: false,
             because: [`all ${window} runs halted on the kill switch — that is the switch, not the goal`] };
  }

  if (classes.every(c => c === 'error' || c === 'rejected')) {
    return { goal, verdict: 'failing', runs: runs.length, skip: true,
             because: [`all ${window} recent runs ${classes[0] === 'error' ? 'errored' : 'were rejected'}`,
                       `last: ${String(runs[runs.length - 1].outcome).slice(0, 120)}`,
                       'the goal is spending an LLM call per interval to fail identically'] };
  }

  if (classes.every(c => c === 'queued')) {
    return { goal, verdict: 'queue-flooding', runs: runs.length, skip: true,
             because: [`all ${window} recent runs queued a write or shell action for review`,
                       'nothing unattended will ever run these; they accumulate in logs/queue.jsonl',
                       'drain the queue or rephrase the goal as something read-only'] };
  }

  const prints = new Set(runs.map(fingerprint));
  if (prints.size === 1) {
    return { goal, verdict: 'stagnant', runs: runs.length, skip: true,
             because: [`the last ${window} runs proposed the identical action and returned identical output`,
                       `proposal: ${JSON.stringify(runs[runs.length - 1].proposed).slice(0, 120)}`,
                       'nothing new is being learned; re-running costs a model call and returns the same answer'] };
  }

  return { goal, verdict: 'productive', runs: runs.length, skip: false,
           because: [`${prints.size} distinct outcomes across the last ${window} runs`] };
}

/** Every goal seen in the log. */
function goals(rows) {
  return [...new Set(rows.map(r => r.goal))];
}

function review(rows, opts = {}) {
  return goals(rows).map(g => assess(rows, g, opts));
}

/**
 * The one hook scheduler.js needs: should this goal fire right now?
 * Returns null to proceed, or the assessment explaining the skip. Reads the
 * log fresh so clearing it, or a goal recovering, takes effect immediately.
 */
function shouldSkip(goal, { logPath = SCHED_LOG, window = WINDOW,
                            probeAfter = PROBE_AFTER } = {}) {
  const rows = load(logPath);
  const a = assess(rows, goal, { window });
  if (!a.skip) return null;
  if (skipStreak(rows, goal) >= probeAfter) return null;   // let one through
  return a;
}

function format(assessments) {
  const lines = [];
  for (const a of assessments) {
    lines.push(`${a.verdict.padEnd(15)} ${a.skip ? 'SKIP  ' : '      '} ${a.goal}`);
    for (const b of a.because) lines.push(`                       · ${b}`);
  }
  const skipping = assessments.filter(a => a.skip).length;
  lines.push('');
  lines.push(skipping
    ? `${skipping} goal(s) will be skipped until their log changes. Nothing was edited:`
    : 'No goal is stagnating.');
  if (skipping) {
    lines.push('the supervisor can only withhold a run, never add one, and it does not');
    lines.push('touch schedules.json. Remove or rephrase the goal yourself.');
    lines.push(`Every ${PROBE_AFTER} skips one run is let through to re-test the verdict.`);
  }
  return lines.join('\n');
}

module.exports = { load, recent, assess, review, shouldSkip, format, goals,
                   outcomeClass, fingerprint, skipStreak, WINDOW, PROBE_AFTER, VERDICTS };

if (require.main === module) {
  console.log(format(review(load())));
}
