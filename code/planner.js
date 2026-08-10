#!/usr/bin/env node
// Multi-step planning. A plan is a HYPOTHESIS, not a commitment:
// the model writes all steps before seeing any results, so step 3 is a guess
// about a world step 2 hasn't created yet. Therefore every step is re-proposed
// with real context, re-validated, and re-gated. The plan only sets direction.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { readFile, writeFile, listDir } = require('./exec.js');
const { run: sh, gitLog, gitStatus } = require('./shell.js');
const { run: route } = require('./router.js');
const { validate } = require('./validate.js');
const { observe, forPrompt } = require('./memory.js');
const { reEscape, parseJSONLoose, execute, confirm } = require('./lib.js');

const PLANS = path.join(__dirname, '..', 'logs', 'plans.jsonl');
const MAX_STEPS = 5;

const PLAN_PROMPT = `You are Jarvis X, planning. Break the goal into at most ${MAX_STEPS}
short steps. Reply with ONE JSON object, nothing else:
{"steps":["first step","second step"]}
Each step must be achievable with exactly one of: list, read, git_log, git_status,
write, shell, answer. If the goal needs only one step, return one step. If the goal
cannot be done with those actions, return {"steps":[]} and nothing else.`;

const STEP_PROMPT = `You are Jarvis X executing ONE step of a plan. Reply with ONE JSON
object and nothing else, in the same action format as before. Use the results of
previous steps where relevant. If the step is no longer needed or no longer makes
sense given those results, reply {"action":"answer","text":"SKIP: <why>"}.`;

function ask(prompt) { return route({ prompt, level: 'hard' }).then(r => r.text); }



function parseJSON(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch {}
  try { return JSON.parse(reEscape(m[0])); } catch {}
  return null;
}




const yes = (a) => a === '' || a === 'y' || a === 'yes';

async function main() {
  const goal = process.argv.slice(2).join(' ');
  if (!goal) return console.log('Usage: node code/planner.js "your goal"');

  const plan = parseJSON(await ask(`${PLAN_PROMPT}\n\n${forPrompt()}\n\nGoal: ${goal}`));
  if (!plan || !Array.isArray(plan.steps)) return console.log('could not parse a plan');
  if (plan.steps.length === 0) return console.log('\nPlanner says this goal is not achievable with the available actions.\n');

  console.log('\nPLAN:');
  plan.steps.slice(0, MAX_STEPS).forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log('\n  (direction only -- every step is still proposed and gated individually)');

  if (!yes(await confirm('\nProceed with this direction? [y/Enter = yes, n = no] '))) {
    console.log('  abandoned before any step ran.');
    return;
  }

  const results = [];
  for (const [i, step] of plan.steps.slice(0, MAX_STEPS).entries()) {
    const context = results.length
      ? 'Results so far:\n' + results.map((r, j) => `step ${j + 1}: ${String(r).slice(0, 400)}`).join('\n')
      : '(no steps run yet)';

    console.log(`\n--- step ${i + 1}/${plan.steps.length}: ${step}`);
    const a = parseJSON(await ask(`${STEP_PROMPT}\n\n${forPrompt()}\n\nOverall goal: ${goal}\nThis step: ${step}\n\n${context}`));
    if (!a) { console.log('  could not parse an action -- stopping.'); break; }

    console.log(`  PROPOSED: ${JSON.stringify(a)}`);

    if (a.action === 'answer' && String(a.text).startsWith('SKIP:')) {
      console.log(`  ${a.text}`);
      results.push('(skipped)');
      continue;
    }

    const invalid = validate(a);
    if (invalid) {
      console.log(`  REJECTED by validator: ${invalid}`);
      observe(step, JSON.stringify(a), `rejected: ${invalid}`);
      if (!yes(await confirm('  Continue with the rest of the plan? [y/n] '))) break;
      results.push(`(rejected: ${invalid})`);
      continue;
    }

    if (!yes(await confirm('  Execute this step? [y/Enter = yes, n = no] '))) {
      observe(step, JSON.stringify(a), 'declined');
      if (!yes(await confirm('  Continue with the rest of the plan? [y/n] '))) break;
      results.push('(declined)');
      continue;
    }

    let out;
    try { out = execute(a); console.log(String(out).slice(0, 800)); }
    catch (e) { out = `FAILED: ${e.message}`; console.log(`  ${out}`); }
    observe(step, JSON.stringify(a), String(out).slice(0, 200));
    results.push(out);

    // A failure means the plan's assumptions were wrong. Ask, don't plough on.
    if (String(out).startsWith('FAILED') && i < plan.steps.length - 1) {
      if (!yes(await confirm('  That step failed. Continue anyway? [y/n] '))) {
        console.log('  plan abandoned.');
        break;
      }
    }
  }

  fs.mkdirSync(path.dirname(PLANS), { recursive: true });
  fs.appendFileSync(PLANS, JSON.stringify({
    timestamp: new Date().toISOString(), goal, steps: plan.steps, ran: results.length
  }) + '\n');
  console.log(`\ndone -- ${results.length} step(s) attempted.`);
}

main();
