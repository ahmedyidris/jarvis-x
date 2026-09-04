#!/usr/bin/env node
// Runs goals on a timer with no human at the gate. That changes what's safe
// to let through: agent.js and planner.js can propose anything because a
// person reads it before it runs. Here nothing reads it first, so only the
// read-only actions (list, read, git_log, git_status, answer) may actually
// execute. write and shell are still valid, structurally-checked proposals --
// they just never run unattended. They land in logs/queue.jsonl instead, for
// Ahmed to review and run by hand.
const fs = require('fs');
const path = require('path');
const { guard, isStopped } = require('./guard.js');
const { validate } = require('./validate.js');
const { observe, forPrompt } = require('./memory.js');
const { execute, parseJSONLoose } = require('./lib.js');
const { run: route } = require('./router.js');
const { readFile } = require('./exec.js');
const { shouldSkip } = require('./supervisor.js');

const ROOT = path.join(__dirname, '..');
const SCHEDULES = path.join(ROOT, 'schedules.json');
const SCHED_LOG = path.join(ROOT, 'logs', 'scheduled.jsonl');
const QUEUE = path.join(ROOT, 'logs', 'queue.jsonl');

// Checking every 15s gives minute-granularity schedules without redoing the
// work of a real cron. schedules.json is reread on every tick so edits take
// effect without a restart.
const POLL_MS = 15_000;

const READ_ONLY = new Set(['list', 'read', 'git_log', 'git_status', 'answer']);

const SYSTEM = `You are Jarvis X, running unattended on a schedule -- no human
reviews this proposal before it either runs or waits for one. Reply with ONE
JSON object and nothing else. Valid forms:
{"action":"list","path":"code"}
{"action":"read","path":"knowledge/Guidelines.md"}
{"action":"git_log","n":5}
{"action":"git_status"}
{"action":"write","path":"logs/note.txt","content":"text"}
{"action":"shell","cmd":"ls","args":["-la","code"]}
{"action":"answer","text":"plain answer if no tool is needed"}

RULES:
- Only list, read, git_log, git_status, and answer run automatically here.
  write and shell are valid actions, but every one is queued for human
  review instead of executed -- propose them when they're the right call,
  don't avoid them just because they won't run immediately.
- knowledge/Guidelines.md is already provided above; answer from it directly.
  For any other file, "read" it before describing its contents.
- If no action can accomplish the goal, use "answer" and say so plainly.
- "list" takes a directory path only. No wildcards, no globs.
Paths are relative to the project root. No markdown, no explanation.`;

async function ask(prompt) {
  const r = await route({ prompt, level: 'hard' });
  return { text: r.text, model: `gemini:${r.tier}${r.degraded ? '(degraded)' : ''}` };
}

function loadSchedules() {
  if (!fs.existsSync(SCHEDULES)) return [];
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(SCHEDULES, 'utf8')); }
  catch (e) { console.error(`schedules.json is not valid JSON: ${e.message}`); return []; }
  if (!Array.isArray(parsed)) { console.error('schedules.json must be a JSON array'); return []; }
  return parsed.filter(e => e && typeof e.goal === 'string' && Number(e.everyMinutes) > 0);
}

function logRun(entry) {
  fs.mkdirSync(path.dirname(SCHED_LOG), { recursive: true });
  fs.appendFileSync(SCHED_LOG, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n');
}

// Never executed -- appended for a human to read and run by hand.
function queueForReview(goal, a) {
  fs.mkdirSync(path.dirname(QUEUE), { recursive: true });
  fs.appendFileSync(QUEUE, JSON.stringify({ timestamp: new Date().toISOString(), goal, proposed: a }) + '\n');
}

async function runGoal(goal) {
  // Cheap check up front so a halted scheduler doesn't spend an LLM call
  // just to be told no by guard() a moment later.
  if (isStopped()) { logRun({ goal, outcome: 'halted' }); return; }

  // Borrowed from NVIDIA's AVO supervisor (see code/supervisor.js): watch the
  // trajectory, and when a goal has been proposing the same action for the
  // same result every interval, stop spending a model call on it. Same
  // reasoning as the isStopped() check above -- the cheapest call is the one
  // not made. The supervisor can only withhold a run; it cannot add one, and
  // it does not edit schedules.json. Nothing here is permanent either: every
  // PROBE_AFTER skips one run is let through to re-test the verdict, because a
  // skip that never lifts is a deletion nobody agreed to.
  const stale = shouldSkip(goal);
  if (stale) {
    logRun({ goal, outcome: `supervisor skip: ${stale.verdict} — ${stale.because[0]}` });
    return;
  }

  let model, raw;
  try {
    const guidelines = readFile('knowledge/Guidelines.md');
    ({ text: raw, model } = await ask(`${SYSTEM}\n\nConstraints:\n${guidelines}\n\n${forPrompt()}\n\nGoal: ${goal}`));
  } catch (e) {
    logRun({ goal, outcome: `error: ${e.message}` });
    return;
  }

  const a = parseJSONLoose(raw) || { action: 'answer', text: raw.trim() };

  // Structural check BEFORE anything else runs, same as agent.js: an invalid
  // proposal never reaches execute(), gated or not. validate.js's validate()
  // expects a {type, ...} shape; this schema is flat with the type under
  // "action" (e.g. {action:"list", path:...}). validate()'s own wrapper (not
  // editable here -- see PASS1 report) pulls out proposal.action as THE
  // WHOLE action whenever it's a truthy string, discarding everything else
  // -- so simply adding a "type" field alongside "action" isn't enough; the
  // "action" key has to be gone entirely, replaced by "type", before calling
  // validate() or execute().
  const { action: _actionType, ...rest } = a;
  const normalized = { ...rest, type: _actionType };
  const invalid = validate(normalized);

  try {
    // guard() is the real kill switch: every branch below runs inside it, so
    // a STOP that lands between the isStopped() check above and here still
    // catches it -- including the queue write, which is itself an action.
    await guard('scheduler_act', `${goal} -> ${JSON.stringify(a)}`, async () => {
      // Was `if (invalid)` -- validate() always returns an object (truthy),
      // so every proposal, valid or not, hit the rejection branch below and
      // nothing ever ran. Also logged the whole {valid,reason} object instead
      // of the reason string.
      if (!invalid.valid) {
        logRun({ goal, model, proposed: a, outcome: `rejected: ${invalid.reason}` });
        observe(goal, JSON.stringify(a), `rejected: ${invalid.reason}`);
        return;
      }
      if (!READ_ONLY.has(a.action)) {
        queueForReview(goal, a);
        logRun({ goal, model, proposed: a, outcome: 'queued for review' });
        observe(goal, JSON.stringify(a), 'queued for review');
        return;
      }
      let out;
      // execute() is async -- this was never awaited, so `out` was a pending
      // Promise object by the time it got logged/observed below.
      try { out = await execute(normalized); }
      catch (e) { out = `FAILED: ${e.message}`; }
      logRun({ goal, model, proposed: a, outcome: String(out).slice(0, 500) });
      observe(goal, JSON.stringify(a), String(out).slice(0, 200));
    });
  } catch (e) {
    // guard() threw -- STOP landed just now. Record it and move on; the next
    // tick tries again, so clearing the kill switch resumes on its own.
    logRun({ goal, model, proposed: a, outcome: `halted: ${e.message}` });
  }
}

function main() {
  if (!loadSchedules().length) {
    console.log(`no schedules loaded from ${SCHEDULES} -- add {"goal", "everyMinutes"} entries and they'll pick up on the next tick.`);
  }
  console.log(`scheduler running, polling every ${POLL_MS / 1000}s (Ctrl+C to stop)`);

  const lastRun = new Map(); // goal text -> ms timestamp it last fired

  setInterval(() => {
    const now = Date.now();
    for (const { goal, everyMinutes } of loadSchedules()) {
      if (!lastRun.has(goal)) {
        // First sighting waits a full interval instead of firing immediately,
        // so restarting the scheduler doesn't stampede every goal at once.
        lastRun.set(goal, now);
        continue;
      }
      if (now - lastRun.get(goal) < everyMinutes * 60_000) continue;
      lastRun.set(goal, now);
      runGoal(goal).catch(e => logRun({ goal, outcome: `error: ${e.message}` }));
    }
  }, POLL_MS);
}

if (require.main === module) main();
module.exports = { runGoal, loadSchedules, READ_ONLY };
