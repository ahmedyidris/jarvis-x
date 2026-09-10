const { test, finish, assert } = require('./test-helper.js');
// FUSE. A hung await drains the event loop and exits 0 having printed no
// tally -- a vacuous pass that reads as green, and the exact shape sweep.js
// exists to catch. finish() calls process.exit() explicitly, so this default
// only survives when finish() was never reached. Found by mutation-testing
// code/status.js; see code/test-status.js for the full account.
process.exitCode = 1;

const exec = require('./exec.js');

test('safePath confines to BASE', () => {
  const result = exec.safePath('code/test.txt');
  assert(result.startsWith(exec.BASE), 'should be inside BASE');
});

test('safePath rejects absolute', () => {
  try {
    exec.safePath('/etc/passwd');
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e.message.includes('escapes the jail'), 'error message should mention escape');
  }
});

finish();
