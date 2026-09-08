const fs = require('fs');
const path = require('path');
const { BASE } = require('./exec');

// FILES THE AGENT MAY READ BUT NEVER WRITE.
//
// NOTES.md durable rule 2 has always said these are "OFF-LIMITS to
// self-modification and to Claude Code (deny rules in
// ~/.claude/settings.json)". Verified 2026-09-07: only the second half was
// real. Those deny rules constrain CLAUDE CODE. The agent reaches the
// filesystem through validate() and exec.js as a node process, so they never
// applied to it, and validate() accepted a write to every file on this list:
//
//   ACCEPTED  code/guard.js        ACCEPTED  memory/rules.md
//   ACCEPTED  code/validate.js     ACCEPTED  CONSTITUTION.md
//   ACCEPTED  knowledge/Guidelines.md
//
// code/memory.js's own header says of rules.md "agent CANNOT write it ... so
// the agent cannot author its own future instructions". Nothing enforced it;
// memory.js simply offered no writer for it, while the generic `write` action
// went straight through.
//
// What kept this from mattering so far is agent.js's approval gate: `write`
// is not in safeTypes, so every write waits on a human y/n, and
// scheduler.js's READ_ONLY set excludes write entirely. That is a gate on
// ATTENTION, not on capability -- and NOTES.md defers selfdebug.js precisely
// because "a self-modifying loop plus a model that picks the right action
// three times in four is how a repo ends up editing its own constraints".
// A proposal loop's failure mode is approval fatigue: a human saying y to the
// thirtieth suggested fix, which happens to rewrite validate.js. This refuses
// such a write before it is ever offered to a human at all.
//
// WHY MORE THAN THE FOUR RULE 2 NAMES. Rule 2 lists guard.js, validate.js,
// Guidelines.md and memory/rules.md. exec.js holds the path jail and shell.js
// holds the command allowlist -- controls of exactly the same kind, and
// protecting validate.js while leaving exec.js writable is incoherent, since
// either one alone can be removed to reach the other. CONSTITUTION.md is
// amended by Ahmed only. Each entry blocks a nameable failure:
//
//   guard.js      -- kill switch and audit log could be disabled
//   validate.js   -- this list, and the path jail, could be deleted
//   exec.js       -- BASE and the path jail could be widened
//   shell.js      -- the command allowlist could be widened
//   Guidelines.md, memory/rules.md, CONSTITUTION.md
//                 -- the agent could author its own future instructions
//
// READS ARE DELIBERATELY ALLOWED. The agent should be able to read its own
// constraints; being unable to would make it worse at obeying them. This
// blocks `write` only.
const OFF_LIMITS = Object.freeze([
  'code/guard.js',
  'code/validate.js',
  'code/exec.js',
  'code/shell.js',
  'knowledge/Guidelines.md',
  'memory/rules.md',
  'CONSTITUTION.md',
]);

/** The repo-relative path a write would actually land on, with symlinks
 *  resolved. A symlink is the obvious way around a name-based list: point
 *  notes.md at memory/rules.md and write to notes.md. realpathSync throws on
 *  a path that does not exist yet, which is the normal case for a new file --
 *  there the lexical resolution is already the truth. The PARENT is resolved
 *  either way, so a symlinked directory cannot smuggle a write through. */
function effectiveRelPath(relativePath) {
  const resolved = path.resolve(BASE, relativePath);
  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    // Not there yet: resolve the parent (which usually is) and re-attach.
    try {
      real = path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved));
    } catch {
      real = resolved;
    }
  }
  return path.relative(fs.existsSync(BASE) ? fs.realpathSync(BASE) : BASE, real);
}

function isOffLimits(relativePath) {
  const rel = effectiveRelPath(relativePath);
  return OFF_LIMITS.includes(rel);
}

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
    // Checked here, before the stat calls below, so the refusal is about the
    // rule and not about whether the file happens to exist.
    if (action.type === 'write' && isOffLimits(action.path))
      return { valid: false,
        reason: `${action.path} is off-limits to self-modification (NOTES.md durable rule 2)` };

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
          } catch (_parentErr) {
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

  // Model introspection: no path, no args, read-only. Nothing to jail.
  if (action.type === 'list_models') {
    return { valid: true };
  }

  // Unknown type → invalid
  return { valid: false, reason: `unknown action type: ${action.type}` };
}

function validate(proposal) {
  // Only unwrap {action:{...}} when .action is genuinely a nested object.
  // The old check was truthiness alone, so the pre-`type` schema
  // {"action":"list","path":"x"} unwrapped to the STRING "list" and got
  // reported as 'action must be an object' -- technically true of the
  // string, but a misleading diagnosis of a schema-version mismatch.
  const nested = proposal && typeof proposal === 'object'
    && proposal.action !== null && typeof proposal.action === 'object';
  if (nested) return validateAction(proposal.action);

  if (proposal && typeof proposal === 'object'
      && typeof proposal.action === 'string' && !proposal.type) {
    return { valid: false,
      reason: `legacy schema: got {"action":"${proposal.action}"}, expected {"type":"${proposal.action}"}` };
  }

  return validateAction(proposal);
}

module.exports = { validate, validateAction, OFF_LIMITS, isOffLimits };
