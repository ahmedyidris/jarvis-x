const { test, finish, assert } = require('./test-helper.js');
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

test('readFile reads a real file inside BASE', () => {
  const content = exec.readFile('package.json');
  assert.ok(content.includes('"name"'), 'should read actual file content');
});

test('readFile rejects jail-escape attempts', () => {
  try {
    exec.readFile('/etc/passwd');
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e.message.includes('escapes the jail'), 'error message should mention escape');
  }
});

test('writeFile writes to a temp path inside BASE and readFile reads it back', () => {
  const relPath = 'logs/test-exec-tmp.txt';
  const marker = `exec.js round-trip test ${Date.now()}`;
  exec.writeFile(relPath, marker);
  const readBack = exec.readFile(relPath);
  assert.strictEqual(readBack, marker);
  const fs = require('fs');
  fs.unlinkSync(exec.safePath(relPath));
});

test('writeFile rejects jail-escape attempts', () => {
  try {
    exec.writeFile('/etc/tmp-jail-escape.txt', 'nope');
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e.message.includes('escapes the jail'), 'error message should mention escape');
  }
});

test('listDir lists a real directory inside BASE', () => {
  const entries = exec.listDir('code');
  assert.ok(Array.isArray(entries), 'should return an array');
  assert.ok(entries.includes('exec.js'), 'should include exec.js in the code/ directory');
});

test('listDir rejects jail-escape attempts', () => {
  try {
    exec.listDir('../../etc');
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e.message.includes('escapes the jail'), 'error message should mention escape');
  }
});

finish();
