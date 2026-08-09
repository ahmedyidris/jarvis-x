#!/usr/bin/env node
const { ask, MODEL } = require('./local.js');
const fs = require('fs');
const path = require('path');

const LOG = path.join(__dirname, '..', 'logs', 'decisions.jsonl');

async function main() {
  const prompt = process.argv.slice(2).join(' ');
  if (!prompt) return console.log('Usage: node code/query.js "your question"');

  const guidelines = fs.readFileSync(
    path.join(__dirname, '..', 'knowledge', 'Guidelines.md'), 'utf8'
  );

  const full = `You are Jarvis X. Operate within these constraints:\n\n${guidelines}\n\nUser: ${prompt}`;

  const answer = await ask(full);
  console.log(`\n${answer}\n`);

  fs.appendFileSync(LOG, JSON.stringify({
    timestamp: new Date().toISOString(), model: MODEL, prompt, answer
  }) + '\n');
}

main().catch(e => console.error('Error:', e.message));
