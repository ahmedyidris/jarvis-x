const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'actions.jsonl');
const STOP_FILE = path.join(__dirname, '..', '.jarvis-x-STOP');

const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function isStopped() {
  return fs.existsSync(STOP_FILE);
}

// Pure preflight check: may this action proceed? Never executes anything --
// callers (the gateway's route(), or scheduler.js's own action-execution
// block) own running the call themselves after this returns.
function guard(action, level = 'quick') {
  if (isStopped()) {
    console.error('⛔ Kill switch active – action blocked');
    return { blocked: true, reason: 'STOP file present' };
  }

  const entry = { timestamp: new Date().toISOString(), action, level, pid: process.pid };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');

  return { blocked: false };
}

module.exports = { guard, isStopped };
