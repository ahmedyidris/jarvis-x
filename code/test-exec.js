const { test, finish, assert } = require('./test-helper.js');
const exec = require('./exec.js');
const path = require('path');
const fs = require('fs');

test('safePath confines to BASE', () => {
  const result = exec.safePath('code/test.txt');
  assert(result.startsWith(exec.BASE), 'should be inside BASE');
});

test('safePath rejects absolute', () => {
  try {
    exec.safePath('/etc/passwd');
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e.message.includes('outside jail'));
  }
});

// ... add more tests from original, wrapped in test()

finish();
