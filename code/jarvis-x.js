#!/usr/bin/env node
const readline = require('readline');
const { propose } = require('./agent.js');
const fs = require('fs');
const path = require('path');

// Minimal REPL with describe and voice
console.log('Jarvis X REPL – Type "describe <path>" to test vision.');

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

  if (input === 'help') {
    console.log('Commands: describe <path>, voice, <any goal>');
    rl.prompt();
    return;
  }

  if (input === 'voice' || input === 'v') {
    console.log('Voice not yet integrated in this minimal version');
    rl.prompt();
    return;
  }

  if (input.startsWith('describe ')) {
    const imgPath = input.slice(9).trim();
    try {
      const { describe } = require('./vision.js');
      const desc = await describe(imgPath);
      console.log(`📷 ${desc}`);
    } catch (err) {
      console.error('❌', err.message);
    }
    rl.prompt();
    return;
  }

  // Fallback – send to agent
  console.log(`📝 Goal: "${input}"`);
  const res = await propose(input);
  if (res.error) console.error('❌', res.error);
  console.log('');
  rl.prompt();
}).on('close', () => {
  console.log('👋 Goodbye.');
  process.exit(0);
});
