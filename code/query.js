#!/usr/bin/env node
// CLI entry point: sends a one-off prompt (plus Guidelines.md) to the local model and logs the exchange.
const { ask } = require('./gateway-adapter.js');
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

  const result = await ask({ prompt: full, level: 'local' }, { tag: 'query' });
  if (result.blocked) { console.error('Blocked:', result.reason); return; }
  console.log(`\n${result.text}\n`);

  fs.appendFileSync(LOG, JSON.stringify({
    timestamp: new Date().toISOString(), model: result.provider, prompt, answer: result.text
  }) + '\n');
}

main().catch(e => console.error('Error:', e.message));
