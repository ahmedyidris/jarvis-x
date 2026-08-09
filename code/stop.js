#!/usr/bin/env node
const fs = require('fs');
const { STOP_FILE, isStopped } = require('./guard.js');
const cmd = process.argv[2];

if (cmd === 'off') {
  fs.rmSync(STOP_FILE, { force: true });
  console.log('Kill switch CLEARED. Jarvis X may act.');
} else if (cmd === 'status') {
  console.log(isStopped() ? 'STOPPED' : 'RUNNING');
} else {
  fs.writeFileSync(STOP_FILE, new Date().toISOString());
  console.log('Kill switch ENGAGED. All actions halted.');
}
