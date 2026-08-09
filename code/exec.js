const fs = require('fs');
const path = require('path');
const { guard } = require('./guard.js');

const BASE = path.join(process.env.HOME, 'jarvis-x');

// Resolve a path and refuse anything outside BASE.
function safePath(p) {
  const resolved = path.resolve(BASE, p);
  // realpath the parent so symlinks can't escape the jail
  const parent = path.dirname(resolved);
  const realParent = fs.existsSync(parent) ? fs.realpathSync(parent) : parent;
  const final = path.join(realParent, path.basename(resolved));
  if (final !== BASE && !final.startsWith(BASE + path.sep)) {
    throw new Error(`REFUSED: path outside jail: ${final}`);
  }
  return final;
}

function readFile(p) {
  const target = safePath(p);
  return guard('read', target, () => fs.readFileSync(target, 'utf8'));
}

function writeFile(p, content) {
  const target = safePath(p);
  return guard('write', target, () => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return `wrote ${content.length} bytes to ${target}`;
  });
}

function listDir(p = '.') {
  const target = safePath(p);
  return guard('list', target, () => fs.readdirSync(target));
}

module.exports = { readFile, writeFile, listDir, safePath, BASE };
