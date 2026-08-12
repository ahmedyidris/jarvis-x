#!/usr/bin/env node
const readline = require('readline');
const { propose } = require('./agent.js');
const fs = require('fs');
const path = require('path');

// Load guidelines
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
Type "help" or "?" for available commands.
`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'jj> '
});

rl.prompt();

rl.on('line', async (line) => {
  const input = line.trim();
  if (!input) return rl.prompt();

  // Exit
  if (['exit', 'quit', '/exit', '/quit'].includes(input)) {
    rl.close();
    return;
  }

  // Help
  if (input === 'help' || input === '?') {
    console.log(`
Available commands:
  <goal>               – run any natural language goal
  ask <goal>           – same as above
  voice | v            – listen and respond via speech (5s)
  describe <path>      – describe an image using vision
  exit | quit          – leave the REPL
`);
    rl.prompt();
    return;
  }

  // Voice
  if (input === 'voice' || input === 'v') {
    const { voiceInteraction } = require('./voice.js');
    await voiceInteraction(5);
    console.log('');
    rl.prompt();
    return;
  }

  // Describe
  if (input.startsWith('describe ')) {
    const imgPath = input.slice(9).trim();
    const { describe } = require('./vision.js');
    try {
      const desc = await describe(imgPath);
      console.log(`📷 Description: ${desc}`);
    } catch (err) {
      console.error(`❌ Vision error: ${err.message || err}`);
    }
    console.log('');
    rl.prompt();
    return;
  }

  // Regular goal
  const goal = input.startsWith('ask ') ? input.slice(4) : input;
  console.log(`\n📝 Goal: "${goal}"`);
  const res = await propose(goal);
  if (res.error) {
    console.error('❌', res.error);
    if (res.reason) console.error('   Reason:', res.reason);
  }
  console.log('');
  rl.prompt();
}).on('close', () => {
  console.log('\n👋 Goodbye.');
  process.exit(0);
});
