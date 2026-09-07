const { test, finish, assert } = require('./test-helper.js');
const fs = require('fs');
const path = require('path');
const { validate, OFF_LIMITS, isOffLimits } = require('./validate.js');
const { BASE } = require('./exec.js');

function reject(proposal, expectedReasonPart) {
  const result = validate(proposal);
  assert.strictEqual(result.valid, false, 'expected invalid');
  if (expectedReasonPart) {
    assert.ok(result.reason.includes(expectedReasonPart), 
      `reason should include "${expectedReasonPart}" but got "${result.reason}"`);
  }
}

function accept(proposal) {
  const result = validate(proposal);
  assert.strictEqual(result.valid, true, 'expected valid');
}

test('reject null', () => reject(null, 'object'));
test('reject 42', () => reject(42, 'object'));
test('unknown action "undefined"', () => reject({}, 'missing type'));
test('unknown action "delete"', () => reject({ type: 'delete', path: 'code' }, 'unknown action type'));
test('answer with no text', () => reject({ type: 'answer' }, 'answer requires non-empty text'));
test('answer with empty text', () => reject({ type: 'answer', text: '' }, 'answer requires non-empty text'));
test('answer with spaces', () => reject({ type: 'answer', text: '   ' }, 'answer requires non-empty text'));
test('accept answer with text', () => accept({ type: 'answer', text: 'here you go' }));
test('list requires a path', () => reject({ type: 'list' }, 'path must be a non-empty string'));
test('read requires a path', () => reject({ type: 'read', path: '' }, 'path must be a non-empty string'));
test('write requires a path', () => reject({ type: 'write', path: 123, content: 'hi' }, 'path must be a non-empty string'));
test('path contains a glob', () => reject({ type: 'list', path: 'code/*.js' }, 'glob'));
test('path must be relative (tilde)', () => reject({ type: 'read', path: '~/secrets' }, 'must be relative'));
test('path must be relative (absolute)', () => reject({ type: 'write', path: '/etc/shadow', content: 'hi' }, 'must be relative'));
test('path escapes', () => reject({ type: 'read', path: 'code/../../../etc/passwd' }, 'escapes the jail'));
test('path escapes (list)', () => reject({ type: 'list', path: 'a/b/../c' }, 'no such directory'));
test('no such directory', () => reject({ type: 'list', path: 'nope-does-not-exist' }, 'no such directory'));
test('not a directory', () => reject({ type: 'list', path: 'code/validate.js' }, 'not a directory'));
test('accept list code', () => accept({ type: 'list', path: 'code' }));
test('accept list .', () => accept({ type: 'list', path: '.' }));
test('no such file', () => reject({ type: 'read', path: 'nope-does-not-exist.txt' }, 'no such file'));
test('is a directory', () => reject({ type: 'read', path: 'code' }, 'is a directory'));
test('accept read Guidelines', () => accept({ type: 'read', path: 'knowledge/Guidelines.md' }));


// ── the off-limits set, added 2026-09-07 ──────────────────────────────────
// NOTES.md durable rule 2 has always claimed these files are off-limits to
// self-modification. Verified 2026-09-07, only half of that was real: the
// ~/.claude/settings.json deny rules constrain CLAUDE CODE, and the agent
// reaches the filesystem as a node process through here, so validate()
// accepted a write to every one of them. code/memory.js's header made the
// same unenforced claim about rules.md specifically.
//
// These tests exist because the control is the prerequisite for
// selfdebug.js: NOTES.md defers that loop because "a self-modifying loop
// plus a model that picks the right action three times in four is how a repo
// ends up editing its own constraints".

test('every off-limits file refuses a write', () => {
  for (const p of OFF_LIMITS) {
    reject({ type: 'write', path: p, content: 'overwritten' }, 'off-limits');
  }
  assert.ok(OFF_LIMITS.length >= 7, `only ${OFF_LIMITS.length} entries — was one dropped?`);
});

test('the refusal names the rule, so the reason is actionable', () => {
  const r = validate({ type: 'write', path: 'memory/rules.md', content: 'x' });
  assert.ok(/durable rule 2/.test(r.reason), r.reason);
  assert.ok(/memory\/rules\.md/.test(r.reason), 'and names the file it refused');
});

test('the four files NOTES.md rule 2 names are all covered', () => {
  // Derived from the rule, not from the implementation, so dropping one from
  // OFF_LIMITS fails here rather than passing a self-consistent list.
  for (const p of ['code/guard.js', 'code/validate.js',
                   'knowledge/Guidelines.md', 'memory/rules.md']) {
    assert.ok(OFF_LIMITS.includes(p), `rule 2 names ${p} and it is not protected`);
  }
});

test('the other two enforcement modules are covered too', () => {
  // exec.js holds the path jail, shell.js the command allowlist. Protecting
  // validate.js while leaving these writable is incoherent: either one alone
  // can be rewritten to reach the other.
  assert.ok(OFF_LIMITS.includes('code/exec.js'), 'the path jail is unprotected');
  assert.ok(OFF_LIMITS.includes('code/shell.js'), 'the command allowlist is unprotected');
});

test('reads of off-limits files are still allowed', () => {
  // Deliberate. An agent that cannot read its own constraints is worse at
  // obeying them. This blocks write only.
  accept({ type: 'read', path: 'memory/rules.md' });
  accept({ type: 'read', path: 'code/guard.js' });
  accept({ type: 'read', path: 'CONSTITUTION.md' });
});

test('listing a directory holding off-limits files is still allowed', () => {
  accept({ type: 'list', path: 'code' });
  accept({ type: 'list', path: 'memory' });
});

test('an ordinary write is untouched', () => {
  accept({ type: 'write', path: 'logs/scratch-offlimits-test.txt', content: 'x' });
  accept({ type: 'write', path: 'README.md', content: 'x' });
});

test('spelling a protected path differently does not get through', () => {
  // A name-based list is only as good as its normalisation.
  for (const p of ['./memory/rules.md', 'memory/../memory/rules.md',
                   'memory//rules.md', './code/./validate.js',
                   'logs/../memory/rules.md', 'code/../code/guard.js']) {
    reject({ type: 'write', path: p, content: 'x' }, 'off-limits');
  }
});

test('a symlink pointing at a protected file does not get through', () => {
  // The obvious way around a name list: point a new name at the real file.
  const link = path.join(BASE, 'test-offlimits-link.md');
  try {
    if (fs.existsSync(link)) fs.unlinkSync(link);
    fs.symlinkSync('memory/rules.md', link);
    reject({ type: 'write', path: 'test-offlimits-link.md', content: 'x' }, 'off-limits');
  } finally {
    if (fs.existsSync(link) || fs.lstatSync(link, { throwIfNoEntry: false })) {
      try { fs.unlinkSync(link); } catch { /* already gone */ }
    }
  }
});

test('a symlinked DIRECTORY does not smuggle a write through', () => {
  const link = path.join(BASE, 'test-offlimits-dirlink');
  try {
    try { fs.unlinkSync(link); } catch { /* not there */ }
    fs.symlinkSync('memory', link);
    reject({ type: 'write', path: 'test-offlimits-dirlink/rules.md', content: 'x' }, 'off-limits');
  } finally {
    try { fs.unlinkSync(link); } catch { /* already gone */ }
  }
});

test('the off-limits check runs before the filesystem is consulted', () => {
  // If it were checked after the stat calls, the refusal for a file that
  // happened not to exist would be 'parent directory does not exist' or
  // similar -- a reason that says nothing about the rule, and that would
  // start ACCEPTING the write the moment the file was deleted.
  const src = fs.readFileSync(path.join(__dirname, 'validate.js'), 'utf8');
  assert.ok(src.indexOf('isOffLimits(action.path)') < src.indexOf('fs.statSync(fullPath)'),
    'the rule must be enforced before the stat, not after');
});

test('the exported list cannot be widened or narrowed by a caller', () => {
  assert.ok(Object.isFrozen(OFF_LIMITS), 'a mutable control is not a control');
  assert.throws(() => OFF_LIMITS.push('README.md'), TypeError);
  assert.throws(() => OFF_LIMITS.pop(), TypeError);
});

test('memory.js\'s claim about rules.md is now true', () => {
  // Its header says "rules.md -- human-written, authoritative, agent CANNOT
  // write it ... so the agent cannot author its own future instructions".
  // That was a comment, not a control, until this list existed.
  const src = fs.readFileSync(path.join(__dirname, 'memory.js'), 'utf8');
  assert.ok(/CANNOT write it/.test(src), 'memory.js still makes the claim...');
  assert.ok(isOffLimits('memory/rules.md'), '...and it must be backed by the list');
});

finish();