const { spawnSync } = require('child_process');
const { guard, logAction } = require('./guard.js');
const { BASE, safePath } = require('./exec.js');

// Only these may run. Start narrow; widen deliberately.
const ALLOWED = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'grep',
  'date', 'pwd', 'du', 'df'
]);

const TIMEOUT_MS = 15000;
const MAX_OUTPUT = 100_000;

function run(cmd, args = []) {
  if (typeof cmd !== 'string' || !ALLOWED.has(cmd)) {
    logAction('refused-cmd', `${cmd} ${args.join(' ')}`, false);
    throw new Error(`REFUSED: '${cmd}' not in allowlist`);
  }
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) {
    throw new Error('REFUSED: args must be an array of strings');
  }

  // Any arg that looks like a path must resolve inside the jail.
  for (const a of args) {
    if (a.startsWith('-')) continue;          // flags
    if (a.includes('/') || a.includes('..')) safePath(a);
  }

  return guard('shell', `${cmd} ${args.join(' ')}`, () => {
    const r = spawnSync(cmd, args, {
      cwd: BASE,          // always runs inside the jail
      shell: false,       // no shell = no injection via ; && | ` $()
      timeout: TIMEOUT_MS,
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT
    });
    if (r.error) throw new Error(`FAILED: ${r.error.message}`);
    return {
      status: r.status,
      stdout: (r.stdout || '').slice(0, MAX_OUTPUT),
      stderr: (r.stderr || '').slice(0, MAX_OUTPUT)
    };
  });
}


// Hardcoded git helpers. `git` stays OUT of ALLOWED so the caller can ask for
// "git log" but never `git config core.hooksPath=...` or arbitrary subcommands.
function gitRun(args, label) {
  return guard('git', label, () => {
    const r = spawnSync('git', args, {
      cwd: BASE, shell: false, timeout: TIMEOUT_MS,
      encoding: 'utf8', maxBuffer: MAX_OUTPUT
    });
    if (r.error) throw new Error(`FAILED: ${r.error.message}`);
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  });
}

const gitLog    = (n = 10) => gitRun(['log', '--oneline', `-${Math.max(1, Math.floor(Number(n)) || 10)}`], `log (n=${n})`);
const gitStatus = ()       => gitRun(['status', '--short'], 'status');
const gitDiff   = ()       => gitRun(['diff'], 'diff');

module.exports = { run, ALLOWED, gitLog, gitStatus, gitDiff };
