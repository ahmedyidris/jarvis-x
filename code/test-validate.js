const { test, finish, assert } = require('./test-helper.js');
const { validate } = require('./validate.js');

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
test('path escapes (list)', () => reject({ type: 'list', path: 'a/b/../c' }, 'escapes the jail'));
test('no such directory', () => reject({ type: 'list', path: 'nope-does-not-exist' }, 'no such directory'));
test('not a directory', () => reject({ type: 'list', path: 'code/validate.js' }, 'not a directory'));
test('accept list code', () => accept({ type: 'list', path: 'code' }));
test('accept list .', () => accept({ type: 'list', path: '.' }));
test('no such file', () => reject({ type: 'read', path: 'nope-does-not-exist.txt' }, 'no such file'));
test('is a directory', () => reject({ type: 'read', path: 'code' }, 'is a directory'));
test('accept read Guidelines', () => accept({ type: 'read', path: 'knowledge/Guidelines.md' }));

finish();
