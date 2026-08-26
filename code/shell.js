const { spawnSync } = require('child_process');
const { guard, logAction } = require('./guard.js');
const { BASE, safePath } = require('./exec.js');

// Expanded allowlist: read-only + write + execute + network
const ALLOWED = new Set([
  // Read-only
  'ls', 'cat', 'head', 'tail', 'wc', 'grep',
  'date', 'pwd', 'du', 'df', 'find',
  // Write operations
  'mkdir', 'touch', 'echo', 'rm',
  // Network
  'curl', 'wget',
  // Script execution
  'bash', 'python', 'node'
]);

const TIMEOUT_MS = 15000;
const MAX_OUTPUT = 100_000;

function run(cmd, args = []) {
  if (typeof cmd !== 'string' || !ALLOWED.has(cmd)) {
    logAction('refused-cmd', `${cmd} ${args.join(' ')}`,
      { allowed: false, outcome: 'refused', reason: 'not in allowlist' });
    throw new Error(`REFUSED: '${cmd}' not in allowlist`);
  }
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) {
    throw new Error('REFUSED: args must be an array of strings');
  }

  // Any arg that looks like a path must resolve inside the jail.
  for (const a of args) {
    if (a.startsWith('-')) continue;
    if (a.includes('/') || a.includes('..')) safePath(a);
  }

  const result = spawnSync(cmd, args, { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT });
  if (result.error) throw result.error;
  
  logAction('cmd-exec', `${cmd} ${args.join(' ')}`,
    { allowed: true, outcome: 'executed', exit_code: result.status });
  
  return {
    exit_code: result.status,
    stdout: (result.stdout || '').toString().slice(0, MAX_OUTPUT),
    stderr: (result.stderr || '').toString().slice(0, MAX_OUTPUT),
  };
}

module.exports = { run };
