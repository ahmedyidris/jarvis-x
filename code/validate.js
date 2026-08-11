const { safePath } = require('./exec');

function validateAction(action) {
  if (!action || typeof action !== 'object')
    return { valid: false, reason: 'action must be an object' };
  if (!action.type)
    return { valid: false, reason: 'missing type' };

  switch (action.type) {
    case 'write':
      if (!action.path) return { valid: false, reason: 'write requires path' };
      if (action.content === undefined) return { valid: false, reason: 'write requires content' };
      break;
    case 'read':
    case 'list':
      if (!action.path) return { valid: false, reason: `${action.type} requires path` };
      break;
    case 'shell':
      if (!action.cmd) return { valid: false, reason: 'shell requires cmd' };
      break;
    case 'query':
      if (!action.q) return { valid: false, reason: 'query requires q' };
      break;
    default:
      return { valid: false, reason: `unknown action type: ${action.type}` };
  }

  // Path confinement for file operations
  if (['write', 'read', 'list'].includes(action.type)) {
    try {
      safePath(action.path);
    } catch (e) {
      return { valid: false, reason: e.message };
    }
  }

  return { valid: true };
}

// Alias for backward compatibility
function validate(proposal) {
  // If proposal has an action field, use that; otherwise treat proposal as action
  const action = proposal.action || proposal;
  return validateAction(action);
}

module.exports = { validate, validateAction };
