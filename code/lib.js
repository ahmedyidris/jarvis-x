const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { BASE, safePath } = require('./exec.js');
const { isStopped } = require('./guard.js');
const { run: runShell } = require('./shell.js');
// Required lazily inside the write case, not here: validate.js requires
// exec.js, exec.js is required above, and a top-level cycle here would hand
// back a half-initialised module.

function reEscape(str) {
  return str.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

function parseJSONLoose(raw) {
  try { return JSON.parse(raw); } catch (_e) { return null; }
}

// ACTUAL EXECUTION ENGINE
async function execute(action) {
  const { type } = action;
  // Kill switch: every action type is blocked while the STOP file exists.
  // This path (agent.js) previously had no kill-switch check at all --
  // scheduler.js was the only caller that actually respected it.
  if (isStopped()) {
    throw new Error('⛔ Kill switch active – action blocked');
  }
  switch (type) {
    case 'list': {
      const full = safePath(action.path);
      if (!fs.existsSync(full)) return `Directory not found: ${action.path}`;
      const files = fs.readdirSync(full);
      return files.join('\n');
    }
    case 'read': {
      const full = safePath(action.path);
      if (!fs.existsSync(full)) return `File not found: ${action.path}`;
      const content = fs.readFileSync(full, 'utf8');
      return content;
    }
    case 'write': {
      // Reject ".." escapes lexically before creating any directories, then
      // re-check with safePath (resolves symlinks) once the parent exists,
      // right before the write itself.
      const lexical = path.resolve(BASE, action.path);
      if (lexical !== BASE && !(lexical + path.sep).startsWith(BASE + path.sep)) {
        throw new Error(`path escapes the jail: ${action.path}`);
      }
      const dir = path.dirname(lexical);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const full = safePath(action.path);
      // Enforced HERE as well as in validate.js, for the reason shell.js
      // gives about the kill switch: leaving a control to validate() makes it
      // depend on every future caller routing through validate() first.
      // execute() does not -- it has its own jail and never calls validate --
      // so before this line `execute({type:'write', path:'memory/rules.md'})`
      // overwrote the authoritative rules file. Demonstrated 2026-09-07; the
      // file came back reading "PWNED" and was restored from a copy.
      //
      // The list lives in validate.js so there is one list, not two that can
      // drift. This is the second gate on it, not a second copy of it.
      const { isOffLimits } = require('./validate.js');
      if (isOffLimits(action.path)) {
        throw new Error(
          `REFUSED: ${action.path} is off-limits to self-modification (NOTES.md durable rule 2)`);
      }
      fs.writeFileSync(full, action.content, 'utf8');
      return `Written to ${action.path}`;
    }
    case 'shell': {
      // Routed through shell.js's allowlisted, shell:false spawner instead of
      // child_process.exec on a raw string. Behavior change: action.cmd must
      // now be one of shell.js's ALLOWED commands, and arguments go in
      // action.args (an array of strings) rather than one shell-parsed string.
      const r = runShell(action.cmd, action.args || []);
      if (r.status !== 0) throw new Error(r.stderr || `exited with status ${r.status}`);
      return r.stdout.trim();
    }
    case 'query': {
      // For now, just echo the query – later can route to model
      return `Query: ${action.q}`;
    }
    case 'answer': {
      return action.text;
    }
    case 'list_models': {
      // Models kept proposing {"action":"list","path":"models"} for "what
      // models do you have" -- there was no way to enumerate them, so they
      // reached for the filesystem and failed validation. Ask Ollama.
      // Native fetch, not runShell -- 'curl' is deliberately not in
      // shell.js's allowlist, and widening that boundary to serve an
      // unrelated read-only feature would be a bad trade.
      const base = process.env.OLLAMA_HOST || 'http://localhost:11434';
      return (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        try {
          const res = await fetch(`${base}/api/tags`, { signal: controller.signal });
          if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
          const parsed = await res.json();
          const names = (parsed.models || []).map(m => m.name);
          if (names.length === 0) return 'No models installed.';
          return `Available models (${names.length}): ${names.join(', ')}`;
        } catch (err) {
          if (err.name === 'AbortError') throw new Error('Ollama timed out after 10s');
          throw new Error(`could not reach Ollama: ${err.message}`);
        } finally {
          clearTimeout(timer);
        }
      })();
    }
    default:
      return `Unknown action type: ${type}`;
  }
}

function confirm(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(question, ans => {
      rl.close();
      resolve(ans.toLowerCase().startsWith('y'));
    });
  });
}

module.exports = { reEscape, parseJSONLoose, execute, confirm };
