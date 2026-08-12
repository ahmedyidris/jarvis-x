#!/usr/bin/env node
const readline = require('readline');
const { propose } = require('./agent.js');
const fs = require('fs');
const path = require('path');

// Load guidelines (for display only)
let guidelines = {};
try {
  const g = fs.readFileSync(path.join(__dirname, '..', 'knowledge', 'Guidelines.md'), 'utf8');
  const stopLoss = g.match(/Stop-loss:\s*(\d+)%/);
  const maxPos = g.match(/Max position:\s*(\d+)%/);
  const dailyLoss = g.match(/Daily loss limit:\s*(\d+)%/);
  guidelines = {
    stopLoss: stopLoss ? parseInt(stopLoss[1]) : 15,
    maxPos: maxPos ? parseInt(maxPos[1]) : 5,
    dailyLoss: dailyLoss ? parseInt(dailyLoss[1]) : 10
  };
} catch (e) {}

console.log(`
🤖 Jarvis X v0.1.0 initializing...

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

✅ Jarvis X is ready!
`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'jj> '
});

rl.prompt();

rl.on('line', async (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }

  if (input === 'exit' || input === 'quit') {
    rl.close();
    return;
  }

  // Handle 'ask' command
  if (input.startsWith('ask ')) {
    const goal = input.slice(4).trim();
    console.log(`\n📝 Processing: "${goal}"`);
    try {
      const result = await propose(goal);
      console.log(`✅ Action executed: ${JSON.stringify(result, null, 2)}`);
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
    }
    console.log();
    rl.prompt();
    return;
  }

  // Fallback – pass raw as a goal
  console.log(`\n📝 Processing: "${input}"`);
  try {
    const result = await propose(input);
    console.log(`✅ Action executed: ${JSON.stringify(result, null, 2)}`);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
  }
  console.log();
  rl.prompt();
}).on('close', () => {
  console.log('\n👋 Jarvis X shutting down.');
  process.exit(0);
});
