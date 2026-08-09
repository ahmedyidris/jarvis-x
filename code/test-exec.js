const { readFile, writeFile, listDir } = require('./exec.js');

function attempt(label, fn) {
  try { console.log(`OK      ${label}:`, String(fn()).slice(0, 60)); }
  catch (e) { console.log(`BLOCKED ${label}:`, e.message); }
}

attempt('list own dir', () => listDir('.'));
attempt('read guidelines', () => readFile('knowledge/Guidelines.md').slice(0, 40));
attempt('write scratch', () => writeFile('logs/scratch.txt', 'hello from exec\n'));
attempt('escape via ..', () => readFile('../../etc/passwd'));
attempt('escape absolute', () => readFile('/etc/passwd'));
