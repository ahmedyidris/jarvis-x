const fs = require('fs');
const path = require('path');

// The jail is the repo root -- one level up from code/. Deriving it from
// __dirname instead of guessing $HOME/jarvis-x means the jail follows the
// checkout, so realpathSync below can't ENOENT on a path that isn't there.
const BASE = path.resolve(__dirname, '..');

function safePath(relativePath) {
  const fullPath = path.resolve(BASE, relativePath);
  const realBase = fs.realpathSync(BASE);
  let realFull;
  try {
    // Resolve the full path INCLUDING the leaf, so a symlink placed directly
    // in the jail (not just a symlinked ancestor directory) gets caught too.
    realFull = fs.realpathSync(fullPath);
  } catch (e) {
    // Target doesn't exist yet (e.g. a new file about to be written) --
    // nothing on disk to symlink-escape through at the leaf, so resolve as
    // far as the path actually exists.
    realFull = fs.realpathSync(path.dirname(fullPath)) + path.sep + path.basename(fullPath);
  }
  if (!realFull.startsWith(realBase + path.sep) && realFull !== realBase) {
    throw new Error(`path escapes the jail: ${relativePath}`);
  }
  return fullPath;
}

function readFile(relativePath) {
  return fs.readFileSync(safePath(relativePath), 'utf8');
}

module.exports = { safePath, BASE, readFile };
