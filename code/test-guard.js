const { test, finish, assert } = require('./test-helper.js');
const fs = require('fs');
const path = require('path');
const { guard, isStopped, STOP_FILE } = require('./guard.js');

const EXPECTED_STOP_FILE = path.join(__dirname, '..', '.jarvis-x-STOP');

test('guard.js exports STOP_FILE as the correct absolute path', () => {
  assert.strictEqual(STOP_FILE, EXPECTED_STOP_FILE);
});

test('guard returns {blocked: false} when no STOP file is present', () => {
  if (fs.existsSync(STOP_FILE)) fs.unlinkSync(STOP_FILE); // ensure clean state
  const result = guard('test_action', 'quick');
  assert.deepStrictEqual(result, { blocked: false });
});

test('guard returns {blocked: true, reason} when the STOP file is present', () => {
  fs.writeFileSync(STOP_FILE, '');
  const result = guard('test_action', 'quick');
  assert.strictEqual(result.blocked, true);
  assert.strictEqual(result.reason, 'STOP file present');
  fs.unlinkSync(STOP_FILE);
});

test('isStopped mirrors the STOP file\'s presence', () => {
  if (fs.existsSync(STOP_FILE)) fs.unlinkSync(STOP_FILE);
  assert.strictEqual(isStopped(), false);
  fs.writeFileSync(STOP_FILE, '');
  assert.strictEqual(isStopped(), true);
  fs.unlinkSync(STOP_FILE);
});

test('guard no longer accepts or runs a third callback argument', () => {
  let ran = false;
  const result = guard('test_action', 'quick', () => { ran = true; return 'should not matter'; });
  assert.strictEqual(ran, false, 'guard is a pure preflight check now, it must not execute a callback');
  assert.deepStrictEqual(result, { blocked: false });
});

finish();
