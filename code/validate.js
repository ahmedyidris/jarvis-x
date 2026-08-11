const fs = require('fs');
const path = require('path');
const { safePath, BASE } = require('./exec');

function validateAction(action) {
  // 1. Basic input checks
  if (action === null || typeof action !== 'object')
    return { valid: false, reason: 'action must be an object' };
  if (!action.type)
    return { valid: false, reason: 'missing type' };

  // 2. Handle 'answer' type specially – just needs text
  if (action.type === 'answer') {
    if (typeof action.text !== 'string' || action.text.trim().length === 0)
      return { valid: false, reason: 'answer requires non-empty text' };
    return { valid: true };
  }

  // 3. Path‑based operations: write, read, list
  if (['write', 'read', 'list'].includes(action.type)) {
    // path must be a non‑empty string
    if (typeof action.path !== 'string' || action.path.trim() === '')
      return { valid: false, reason: 'path must be a non-empty string' };

    // reject glob characters
    if (/[*?[\]{}]/.test(action.path))
      return { valid: false, reason: 'path contains glob characters' };

    // reject leading ~ or / (must be relative)
    if (action.path.startsWith('~') || path.isAbsolute(action.path))
      return { valid: false, reason: 'path must be relative' };

    // 4. Resolve the full path and check existence / type
    let fullPath;
    try {
      fullPath = safePath(action.path);
    } catch (e) {
      // If safePath throws with 'escapes the jail', we return that reason
      if (e.message.includes('escapes the jail'))
        return { valid: false, reason: 'path escapes the jail' };
      // Otherwise, it could be an ENOENT or other error – we'll handle below
      return { valid: false, reason: e.message };
    }

    // 5. Check existence and type based on action
    try {
      const stats = fs.statSync(fullPath);
      if (action.type === 'list' && !stats.isDirectory())
        return { valid: false, reason: 'not a directory' };
      if (action.type === 'read' && !stats.isFile())
        return { valid: false, reason: 'is a directory' };
      // For write, we don't require existence; we'll allow creation, but we may want to check parent directory exists.
      // We'll allow write if path is valid and within jail.
    } catch (e) {
      // If file doesn't exist
      if (e.code === 'ENOENT') {
        if (action.type === 'list')
          return { valid: false, reason: 'no such directory' };
        if (action.type === 'read')
          return { valid: false, reason: 'no such file' };
        // For write, we allow creating new files, so we need to check parent directory exists.
        if (action.type === 'write') {
          const parent = path.dirname(fullPath);
          try {
            fs.statSync(parent);
          } catch (parentErr) {
            return { valid: false, reason: 'parent directory does not exist' };
          }
          // parent exists, so we can allow write
        }
      } else {
        return { valid: false, reason: e.message };
      }
    }

    // 6. For write, ensure content is provided
    if (action.type === 'write' && action.content === undefined)
      return { valid: false, reason: 'write requires content' };
  }

  // 7. Shell command – just check cmd is a non‑empty string
  if (action.type === 'shell') {
    if (typeof action.cmd !== 'string' || action.cmd.trim() === '')
      return { valid: false, reason: 'shell requires cmd' };
  }

  // 8. Query – just check q is a non‑empty string
  if (action.type === 'query') {
    if (typeof action.q !== 'string' || action.q.trim() === '')
      return { valid: false, reason: 'query requires q' };
  }

  // If we get here, action is valid
  return { valid: true };
}

// Alias for backward compatibility (agent.js and scheduler.js call validate)
function validate(proposal) {
  // If proposal has an action field, use that; otherwise treat proposal as action
  const action = proposal && typeof proposal === 'object' && proposal.action ? proposal.action : proposal;
  return validateAction(action);
}

module.exports = { validate, validateAction };
