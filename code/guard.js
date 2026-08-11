const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'actions.jsonl');
const STOP_FILE = path.join(__dirname, '..', '.jarvis-x-STOP');

// Ensure logs directory exists
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function guard(action, level = 'quick') {
  // Kill switch: STOP file exists → block all actions
  if (fs.existsSync(STOP_FILE)) {
    console.error('⛔ Kill switch active – action blocked');
    return { blocked: true, reason: 'STOP file present' };
  }

  // Log every action
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    level,
    pid: process.pid
  };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');

  // In this phase, we just return the action; actual execution is done in agent/scheduler.
  // This is a gate, not the executor.
  return { executed: true, action };
}

module.exports = { guard };
