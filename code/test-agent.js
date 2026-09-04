// agent.js had NO TEST AT ALL until 2026-09-04, and it was completely broken.
//
// shell.js exported { run, ALLOWED, ... } until commit 7720897 ("Arabic voice
// layer: cloned Egyptian TTS worker, name mapping, supervisord integration")
// narrowed that line to { run }. agent.js line 11 still destructured ALLOWED
// from it, so SHELL_ALLOWED was undefined and buildPrompt()'s `[...
// SHELL_ALLOWED]` was a TypeError. propose() threw on EVERY goal. The agent --
// the core capability of this project -- produced nothing from that commit
// until now, as collateral damage of an unrelated voice-layer change.
//
// Nothing noticed for two reasons worth naming. There was no test for this
// file. And scheduler.js calls route() directly rather than propose(), so the
// one thing that runs unattended never touched the broken path. It surfaced
// only when the routing eval was finally run, which is what an eval is for.
//
// buildPrompt() runs BEFORE any model call, so this was catchable offline the
// whole time. These tests are offline: nothing here calls a model.
const fs = require('fs');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const { buildPrompt } = require('./agent.js');
const { ALLOWED } = require('./shell.js');

(async () => {

// ── the regression itself ─────────────────────────────────────────────────
await test('buildPrompt does not throw', () => {
  // This is the whole bug. It threw "SHELL_ALLOWED is not iterable" for every
  // goal, and no test existed to say so.
  assert.doesNotThrow(() => buildPrompt('list the files in the code directory'));
  const p = buildPrompt('anything');
  assert.ok(typeof p === 'string' && p.length > 100, 'a prompt must come back');
});

await test('shell.js exports the allowlist agent.js needs', () => {
  assert.ok(ALLOWED, 'shell.js must export ALLOWED');
  assert.ok(ALLOWED.length > 0, 'and it must be non-empty');
  assert.ok(typeof ALLOWED[Symbol.iterator] === 'function',
    'and iterable — buildPrompt spreads it');
});

await test('the exported allowlist cannot be widened by a caller', () => {
  // A frozen copy, not the live Set. Handing out the Set would let any caller
  // do ALLOWED.add('git') and widen a security control at runtime.
  assert.ok(Object.isFrozen(ALLOWED), 'the export must be frozen');
  const before = ALLOWED.length;
  assert.throws(() => ALLOWED.push('git'), TypeError);
  assert.strictEqual(ALLOWED.length, before);
});

// ── the prompt's contract with the model ──────────────────────────────────
await test('every allowlisted command is named in the prompt', () => {
  const p = buildPrompt('run something');
  for (const cmd of ALLOWED) {
    assert.ok(p.includes(cmd), `the model is never told '${cmd}' is available`);
  }
});

await test('the command list is derived from shell.js, not hardcoded', () => {
  // If it were hardcoded, adding a command to shell.js would silently leave
  // the model unaware of it -- and removing one would leave the model
  // proposing something the allowlist now refuses.
  const src = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
  assert.ok(/SHELL_ALLOWED/.test(src), 'the prompt must interpolate the real set');
  assert.ok(!/'ls', 'cat', 'head'/.test(src), 'and must not restate it inline');
});

await test('every valid action type is named in the prompt', () => {
  const p = buildPrompt('x');
  for (const t of ['list', 'read', 'write', 'shell', 'query', 'answer', 'list_models']) {
    assert.ok(p.includes(`"${t}"`), `action type ${t} is missing from the prompt`);
  }
});

await test('the goal is actually put in front of the model', () => {
  const p = buildPrompt('a very distinctive goal string 8471');
  assert.ok(p.includes('a very distinctive goal string 8471'));
});

await test('the prompt keeps the instruction that stops invented capabilities', () => {
  // The model used to answer "delete all my files" with a write action whose
  // content was a shell command. The prompt forbids that by name.
  const p = buildPrompt('delete everything');
  assert.ok(/cannot do it|can't do it/i.test(p), 'it must be told to refuse');
  assert.ok(/Do NOT invent/i.test(p), 'and told the specific wrong move to avoid');
});

await test('the prompt insists on the type field', () => {
  // A bare {"q":"..."} used to reach validate() and be rejected there. The
  // instruction exists so the model stops producing it.
  assert.ok(/"type" field/.test(buildPrompt('x')));
});

// ── the general guard against this class of bug ───────────────────────────
await test('every name agent.js destructures from a local module is exported by it', () => {
  // The bug was an import that silently yielded undefined. Node does not
  // complain; the failure surfaces at first use, arbitrarily far away. This
  // recomputes the check for every local require in agent.js, so the next one
  // of these fails here instead of at runtime.
  const src = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
  const pattern = /const\s*\{([^}]+)\}\s*=\s*require\(['"](\.\/[^'"]+)['"]\)/g;
  const problems = [];
  let seen = 0;
  for (const m of src.matchAll(pattern)) {
    const [, names, rel] = m;
    const mod = require(rel);
    for (const raw of names.split(',')) {
      const name = raw.split(':')[0].trim();
      if (!name) continue;
      seen++;
      if (!(name in mod)) problems.push(`${rel} does not export ${name}`);
    }
  }
  assert.ok(seen >= 5, `only checked ${seen} imports — did the require style change?`);
  assert.deepStrictEqual(problems, []);
});

finish();
})();
