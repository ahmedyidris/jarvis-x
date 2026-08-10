#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { ask: askLocal, MODEL: LOCAL_MODEL } = require('./local.js');
const { run: route } = require('./router.js');
const { validate } = require('./validate.js');

// Action selection is the consequential decision -- route it to the hard
// tier, and record which model ACTUALLY answered, not which we hoped would.
let MODEL = LOCAL_MODEL;
// JX_BACKEND=local runs action selection on the offline model instead, so
// prompt changes and model changes can be measured separately.
const BACKEND = process.env.JX_BACKEND || 'gemini';
const ask = async (p) => {
  if (BACKEND === 'local') {
    MODEL = `local:${LOCAL_MODEL}`;
    return askLocal(p);
  }
  const r = await route({ prompt: p, level: 'hard' });
  MODEL = `gemini:${r.tier}${r.degraded ? '(degraded)' : ''}`;
  return r.text;
};
const { readFile, writeFile, listDir } = require('./exec.js');
const { run, gitLog, gitStatus } = require('./shell.js');

// Everything is gated while we measure this model's accuracy.
const AUTO = new Set([]);
const GATED = new Set(['read', 'list', 'git_log', 'git_status', 'write', 'shell']);
const PROPOSALS = path.join(__dirname, '..', 'logs', 'proposals.jsonl');

const SYSTEM = `You are Jarvis X. Reply with ONE JSON object and nothing else.
Valid forms:
{"action":"list","path":"code"}
{"action":"read","path":"knowledge/Guidelines.md"}
{"action":"git_log","n":5}
{"action":"git_status"}
{"action":"write","path":"logs/note.txt","content":"text"}
{"action":"shell","cmd":"ls","args":["-la","code"]}
{"action":"answer","text":"plain answer if no tool is needed"}

RULES:
- knowledge/Guidelines.md is already provided above; you may answer from it
  directly. For ANY other file, you must "read" it before describing it.
  Never describe a file's contents from memory or inference.
- Refusal is a valid, correct answer. Example:
    goal: "delete every commit in git history"
    {"action":"answer","text":"I can't do that - no available action deletes
     files or rewrites git history."}
- If no action above can accomplish the goal, use "answer" and say plainly that
  you cannot do it. Do not substitute a different action that looks related.
- "list" takes a directory path only. No wildcards, no globs.
Paths are relative to the project root. No markdown, no explanation.`;

function parseAction(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { action: 'answer', text: raw.trim() };
  try { return JSON.parse(m[0]); }
  catch { return { action: 'answer', text: raw.trim() }; }
}

function execute(a) {
  switch (a.action) {
    case 'list':       return listDir(a.path || '.').join('\n');
    case 'read':       return readFile(a.path);
    case 'git_log':    return gitLog(a.n || 5).stdout;
    case 'git_status': return gitStatus().stdout || '(clean)';
    case 'write':      return writeFile(a.path, a.content ?? '');
    case 'shell':      { const r = run(a.cmd, a.args || []); return r.stdout || r.stderr; }
    default:           return a.text || '(no action)';
  }
}

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, ans => { rl.close(); res(ans); }));
}

async function main() {
  const goal = process.argv.slice(2).join(' ');
  if (!goal) return console.log('Usage: node code/agent.js "your goal"');

  const guidelines = readFile('knowledge/Guidelines.md');
  const raw = await ask(`${SYSTEM}\n\nConstraints:\n${guidelines}\n\nGoal: ${goal}`);
  const a = parseAction(raw);

  console.log(`\nPROPOSED: ${JSON.stringify(a)}`);

  // Structural check BEFORE the gate: an invalid proposal never becomes
  // something a tired human can approve by reflex.
  const invalid = validate(a);
  if (invalid) console.log(`  REJECTED by validator: ${invalid}`);

  let approved = true;
  if (invalid) {
    approved = false;
  } else if (GATED.has(a.action)) {
    const ans = await confirm('  Execute? [y/Enter = yes, n = no] ');
    const t = ans.trim().toLowerCase();
    approved = t === '' || t === 'y' || t === 'yes';
  } else if (!AUTO.has(a.action)) {
    approved = false;
  }

  const verdict = await confirm('  Was this the RIGHT action for the goal? [y/n] ');
  const correct = verdict.trim().toLowerCase().startsWith('y');

  fs.appendFileSync(PROPOSALS, JSON.stringify({
    timestamp: new Date().toISOString(), model: MODEL, goal,
    proposed: a, gated: GATED.has(a.action), approved, correct, rejected: invalid || null
  }) + '\n');

  if (a.action === 'answer') return console.log(`\n${a.text}\n`);
  if (!approved) return console.log('  DECLINED — nothing ran.\n');

  try { console.log(`\n${String(execute(a)).slice(0, 2000)}\n`); }
  catch (e) { console.log(`  FAILED: ${e.message}\n`); }
}

main().catch(e => console.error('Error:', e.message));
