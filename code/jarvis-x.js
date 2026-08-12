#!/usr/bin/env node
const readline = require('readline');
const { propose } = require('./agent.js');
const fs = require('fs');
const path = require('path');

// Status banner
const guidelines = {};
try {
  const g = fs.readFileSync(path.join(__dirname, '..', 'knowledge', 'Guidelines.md'), 'utf8');
  const stopLoss = g.match(/Stop-loss:\s*(\d+)%/);
  const maxPos = g.match(/Max position:\s*(\d+)%/);
  const dailyLoss = g.match(/Daily loss limit:\s*(\d+)%/);
  guidelines.stopLoss = stopLoss ? parseInt(stopLoss[1]) : 15;
  guidelines.maxPos = maxPos ? parseInt(maxPos[1]) : 5;
  guidelines.dailyLoss = dailyLoss ? parseInt(dailyLoss[1]) : 10;
} catch (e) {}

console.log(`\n🤖 Jarvis X v0.1.0 initializing...

✅ Guidelines loaded
   • Stop-loss: ${guidelines.stopLoss}%
   • Max position: ${guidelines.maxPos}%
   • Daily loss limit: ${guidelines.dailyLoss}%
✅ Logging initialized

╔════════════════════════════════════════╗
║        JARVIS X STATUS REPORT          ║
╚════════════════════════════════════════╝

Name:        Jarvis X
Version:     0.1.0
Timestamp:   ${new Date().toISOString()}

Constraints:
  Stop-loss:        ${guidelines.stopLoss}%
  Max position:     ${guidelines.maxPos}%
  Daily loss limit: ${guidelines.dailyLoss}%

✅ Jarvis X is ready!`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'jj> '
});

rl.prompt();

rl.on('line', async (line) => {
  const input = line.trim();
  if (!input) return rl.prompt();
  if (input === 'exit' || input === 'quit') return rl.close();

  const goal = input.startsWith('ask ') ? input.slice(4) : input;
  console.log(`\n📝 Goal: "${goal}"`);
  const res = await propose(goal);
  if (res.error) console.error('❌', res.error);
  console.log('');
  rl.prompt();
}).on('close', () => {
  console.log('\n👋 Goodbye.');
  process.exit(0);
});
