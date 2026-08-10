// Structural rejection of bad proposals, BEFORE they reach the human gate.
// Prompt rules are advisory; this is not. Every check here corresponds to a
// real failure observed in logs/proposals.jsonl.
const fs = require('fs');
const path = require('path');
const BASE = path.join(process.env.HOME, 'jarvis-x');

const KNOWN = new Set(['list','read','git_log','git_status','write','shell','answer']);
const PLACEHOLDER = new Set(['text','content','...','todo','example','placeholder','string','your text here']);

// returns null if valid, else a human-readable reason
function validate(a) {
  if (!a || typeof a !== 'object') return 'not an object';
  if (!KNOWN.has(a.action)) return `unknown action "${a.action}"`;

  if (a.action === 'answer') {
    return (a.text && String(a.text).trim()) ? null : 'answer with no text';
  }

  if (['list','read','write'].includes(a.action)) {
    if (!a.path || typeof a.path !== 'string') return `${a.action} requires a path`;
    if (/[*?\[\]]/.test(a.path)) return `path contains a glob: ${a.path}`;
  }

  const abs = a.path ? path.join(BASE, a.path) : null;

  if (a.action === 'list') {
    if (!fs.existsSync(abs)) return `no such directory: ${a.path}`;
    if (!fs.statSync(abs).isDirectory()) return `not a directory: ${a.path}`;
  }
  if (a.action === 'read') {
    if (!fs.existsSync(abs)) return `no such file: ${a.path}`;
    if (fs.statSync(abs).isDirectory()) return `is a directory, not a file: ${a.path}`;
  }
  if (a.action === 'write') {
    const c = String(a.content ?? '').trim();
    if (!c) return 'write with empty content';
    if (PLACEHOLDER.has(c.toLowerCase())) return `write with placeholder content: "${c}"`;
  }
  if (a.action === 'git_log' && a.n !== undefined) {
    const n = Number(a.n);
    if (!Number.isFinite(n) || n < 1) return `git_log n must be >= 1 (got ${a.n})`;
  }
  if (a.action === 'shell' && !a.cmd) return 'shell requires cmd';

  return null;
}

module.exports = { validate, KNOWN };

if (require.main === module) {
  // regression suite: every case below actually happened tonight
  const cases = [
    [{action:'list',path:'constraints'},                          'reject'],
    [{action:'list',path:'logs/*'},                               'reject'],
    [{action:'list',path:'models'},                               'reject'],
    [{action:'write',path:'logs/trading_log.txt',content:'text'}, 'reject'],
    [{action:'git_log',n:-1},                                     'reject'],
    [{action:'email',to:'accountant'},                            'reject'],
    [{action:'answer',text:"I can't do that."},                   'accept'],
    [{action:'read',path:'knowledge/Guidelines.md'},              'accept'],
    [{action:'git_log',n:3},                                      'accept'],
    [{action:'list',path:'code'},                                 'accept'],
  ];
  let pass = 0;
  for (const [a, want] of cases) {
    const r = validate(a);
    const got = r ? 'reject' : 'accept';
    const ok = got === want;
    pass += ok ? 1 : 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${want.padEnd(6)} ${JSON.stringify(a).slice(0,52).padEnd(54)} ${r || ''}`);
  }
  console.log(`\n${pass}/${cases.length} passed`);
}
