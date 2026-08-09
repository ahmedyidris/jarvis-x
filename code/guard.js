const fs = require('fs');
const path = require('path');

const STOP_FILE = path.join(process.env.HOME, '.jarvis-x', 'STOP');
const LOG = path.join(__dirname, '..', 'logs', 'actions.jsonl');

function isStopped() {
  return fs.existsSync(STOP_FILE);
}

function logAction(action, detail, allowed) {
  fs.appendFileSync(LOG, JSON.stringify({
    timestamp: new Date().toISOString(), action, detail, allowed
  }) + '\n');
}

// Every action in Jarvis X must go through this.
function guard(action, detail, fn) {
  if (isStopped()) {
    logAction(action, detail, false);
    throw new Error(`HALTED: kill switch active (${STOP_FILE})`);
  }
  logAction(action, detail, true);
  return fn();
}

module.exports = { guard, isStopped, STOP_FILE };
