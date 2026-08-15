#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { ask: askLocal, MODEL: LOCAL_MODEL } = require('./local.js');
const { run: route } = require('./router.js');
const { validate } = require('./validate.js');
const { observe, forPrompt } = require('./memory.js');
const { reEscape, parseJSONLoose, execute, confirm } = require('./lib.js');
const { readFile } = require('./exec.js');
const { ALLOWED: SHELL_ALLOWED } = require('./shell.js');

const BACKEND = process.env.JX_BACKEND || 'local';

const ask = async (prompt) => {
  if (BACKEND === 'local') {
    return askLocal(prompt);
  }
  // route() (router.js's run()) expects one {prompt, level} object, not two
  // positional args -- this used to pass a bare string, which destructured to
  // {action:null, prompt:'', level:null}, so classify() always fell through
  // to 'quick' and the 'consequential' tier's human gate could never trigger.
  // Matches scheduler.js's correct call: route({ prompt, level: 'hard' }).
  return route({ prompt, level: 'consequential' });
};

function buildPrompt(goal) {
  return `You are an AI that converts natural language goals into actions.
Respond with a JSON object ONLY, no other text.
Valid action types: "list", "read", "write", "shell", "query", "answer".
- For "list": include "path" (string)
- For "read": include "path"
- For "write": include "path" and "content"
- For "shell": include "cmd" (must be one of: ${[...SHELL_ALLOWED].join(', ')}) and optionally "args" (array of strings)
- For "query": include "q"
- For "answer": include "text"
Example: for "list files in memory", respond with {"type":"list","path":"memory/"}
Goal: ${goal}`;
}

async function propose(goal) {
  const prompt = buildPrompt(goal);
  let raw = await ask(prompt);
  if (typeof raw !== 'string') raw = raw?.text || JSON.stringify(raw);

  let match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    try {
      const parsed = JSON.parse(raw);
      match = [JSON.stringify(parsed)];
    } catch (e) {
      console.error('No JSON found in response:', raw);
      return { error: 'No valid JSON', raw };
    }
  }

  let action;
  try {
    action = JSON.parse(match[0]);
  } catch (e) {
    console.error('Failed to parse JSON:', match[0]);
    return { error: 'Invalid JSON', raw: match[0] };
  }

  const result = validate(action);
  if (!result.valid) {
    console.log(`  REJECTED by validator: ${result.reason}`);
    return { error: 'Validation failed', reason: result.reason };
  }

  // Auto-approve safe actions; ask for write/shell
  const safeTypes = ['list', 'read', 'answer', 'query'];
  let approved = true;
  if (!safeTypes.includes(action.type)) {
    console.log(`\nPROPOSED: ${JSON.stringify(action, null, 2)}`);
    approved = await confirm('  APPROVE? [y/n] ');
  } else {
    console.log(`\nPROPOSED: ${JSON.stringify(action, null, 2)}`);
    console.log('  Auto-approved (safe action)');
  }

  if (!approved) {
    console.log('  Cancelled.');
    return { cancelled: true };
  }

  const execResult = await execute(action);
  console.log('  EXECUTED:', execResult);
  return { executed: true, action, result: execResult };
}

if (require.main === module) {
  const goal = process.argv.slice(2).join(' ');
  if (!goal) {
    console.error('Usage: node agent.js "your goal"');
    process.exit(1);
  }
  propose(goal)
    .then(res => {
      if (res.error) console.error('Error:', res.error);
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal:', err);
      process.exit(1);
    });
}

module.exports = { propose };
