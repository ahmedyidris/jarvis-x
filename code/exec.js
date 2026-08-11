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

module.exports = { safePath, BASE };
