const fs = require('fs');
const path = require('path');
const { BASE } = require('./exec');

function isPathSafe(relativePath) {
  const resolved = path.resolve(BASE, relativePath);
  const normBase = path.normalize(BASE) + path.sep;
  const normResolved = path.normalize(resolved) + path.sep;
  return normResolved.startsWith(normBase) || resolved === BASE;
}

function validateAction(action) {
  if (action === null || typeof action !== 'object')
    return { valid: false, reason: 'action must be an object' };
  if (!action.type)
    return { valid: false, reason: 'missing type' };

  // 'answer' type
  if (action.type === 'answer') {
    if (typeof action.text !== 'string' || action.text.trim().length === 0)
      return { valid: false, reason: 'answer requires non-empty text' };
    return { valid: true };
  }

  // Path operations
  if (['write', 'read', 'list'].includes(action.type)) {
    if (typeof action.path !== 'string' || action.path.trim() === '')
      return { valid: false, reason: 'path must be a non-empty string' };
    if (/[*?[\]{}]/.test(action.path))
      return { valid: false, reason: 'path contains glob characters' };
    if (action.path.startsWith('~') || path.isAbsolute(action.path))
      return { valid: false, reason: 'path must be relative' };
    if (!isPathSafe(action.path))
      return { valid: false, reason: 'path escapes the jail' };

    const fullPath = path.resolve(BASE, action.path);
    try {
      const stats = fs.statSync(fullPath);
      if (action.type === 'list' && !stats.isDirectory())
        return { valid: false, reason: 'not a directory' };
      if (action.type === 'read' && !stats.isFile())
        return { valid: false, reason: 'is a directory' };
      // For write, we allow new files; we already checked parent exists below
      // If we reach here, it's a valid path and exists with correct type
      return { valid: true };
    } catch (e) {
      if (e.code === 'ENOENT') {
        if (action.type === 'list')
          return { valid: false, reason: 'no such directory' };
        if (action.type === 'read')
          return { valid: false, reason: 'no such file' };
        if (action.type === 'write') {
          // Check parent directory exists
          const parent = path.dirname(fullPath);
          try {
            fs.statSync(parent);
          } catch (parentErr) {
            return { valid: false, reason: 'parent directory does not exist' };
          }
          // parent exists, we can write new file
          return { valid: true };
        }
      }
      return { valid: false, reason: e.message };
    }
  }

  // Shell
  if (action.type === 'shell') {
    if (typeof action.cmd !== 'string' || action.cmd.trim() === '')
      return { valid: false, reason: 'shell requires cmd' };
    return { valid: true };
  }

  // Query
  if (action.type === 'query') {
    if (typeof action.q !== 'string' || action.q.trim() === '')
      return { valid: false, reason: 'query requires q' };
    return { valid: true };
  }

  // Unknown type → invalid
  return { valid: false, reason: `unknown action type: ${action.type}` };
}

function validate(proposal) {
  const action = (proposal && typeof proposal === 'object' && proposal.action)
    ? proposal.action
    : proposal;
  return validateAction(action);
}

module.exports = { validate, validateAction };
