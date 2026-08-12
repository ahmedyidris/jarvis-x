// Shared helpers for agent.js and planner.js. Single home for the pieces that
// were duplicated -- notably reEscape, where two copies meant a parser fix
// could land in one file and silently not the other.
const readline = require('readline');
const { readFile, writeFile, listDir } = require('./exec.js');
const { run: sh, gitLog, gitStatus } = require('./shell.js');

// Models emit real newlines inside JSON string literals, which is invalid JSON.
// Re-escape control chars that sit INSIDE strings, leaving structure untouched.
function reEscape(t) {
  let out = '', inStr = false, esc = false;
  for (const ch of t) {
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && ch === '\n') { out += '\\n'; continue; }
    if (inStr && ch === '\r') { out += '\\r'; continue; }
    if (inStr && ch === '\t') { out += '\\t'; continue; }
    out += ch;
  }
  return out;
}

// Best-effort JSON extraction. Returns the object, or null.
function parseJSONLoose(raw) {
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch {}
  try { return JSON.parse(reEscape(m[0])); } catch {}
  return null;
}

// Dispatch. Adds no authority: every branch goes through exec.js/shell.js,
// which route through guard() and the file jail.
function execute(a) {
  switch (a.action) {
    case 'list':       return listDir(a.path || '.').join('\n');
    case 'read':       return readFile(a.path);
    case 'git_log':    return gitLog(a.n || 5).stdout;
    case 'git_status': return gitStatus().stdout || '(clean)';
    case 'write':      return writeFile(a.path, a.content ?? '');
    case 'shell':      { const r = sh(a.cmd, a.args || []); return r.stdout || r.stderr; }
    default:           return a.text || '(no action)';
  }
}

// Returns the answer trimmed and lowercased.
function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, a => { rl.close(); res(a.trim().toLowerCase()); }));
}

const yes = (a) => a === '' || a === 'y' || a === 'yes';

module.exports = { reEscape, parseJSONLoose, execute, confirm, yes };
exports.execute = (action) => { console.log('Execute:', action); return 'ok'; };
exports.confirm = async (q) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); return new Promise(resolve => rl.question(q, ans => { rl.close(); resolve(ans.toLowerCase().startsWith('y')); })); };
