const fs = require('fs');
const path = require('path');

const BASE = path.resolve(process.env.HOME || '~', 'jarvis-x');

function safePath(relativePath) {
  // Resolve the absolute path of the parent directory of the target
  const fullPath = path.resolve(BASE, relativePath);
  const realBase = fs.realpathSync(BASE);
  const realFull = fs.realpathSync(path.dirname(fullPath)) + path.sep + path.basename(fullPath);
  if (!realFull.startsWith(realBase + path.sep) && realFull !== realBase) {
    throw new Error(`path escapes the jail: ${relativePath}`);
  }
  return fullPath;
}

function readFile(relativePath) {
  return fs.readFileSync(safePath(relativePath), 'utf8');
}

function writeFile(relativePath, content) {
  const full = safePath(relativePath);
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

function listDir(relativePath) {
  return fs.readdirSync(safePath(relativePath));
}

module.exports = { safePath, BASE, readFile, writeFile, listDir };
