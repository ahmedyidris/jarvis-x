const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'actions.jsonl');
const STOP_FILE = path.join(__dirname, '..', '.jarvis-x-STOP');

// Ensure logs directory exists
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function guard(action, level = 'quick', fn) {
  // Kill switch: STOP file exists → throw
  if (fs.existsSync(STOP_FILE)) {
    throw new Error('⛔ Kill switch active – action blocked');
  }

  // Log every action
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    level,
    pid: process.pid
  };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');

  return fn ? fn() : { executed: true, action };
}

function isStopped() {
  return fs.existsSync(STOP_FILE);
}

function logAction(action, level = 'quick') {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    level,
    pid: process.pid
  };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

module.exports = { guard, isStopped, logAction, STOP_FILE, LOG_FILE };
