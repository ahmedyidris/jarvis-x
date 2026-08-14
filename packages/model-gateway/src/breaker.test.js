const test = require('node:test');
const assert = require('node:assert/strict');
const { createBreaker } = require('./breaker.js');

test('starts closed for an unseen provider', () => {
  const breaker = createBreaker();
  assert.equal(breaker.isOpen('flash'), false);
});

test('trips open after failureThreshold consecutive failures', () => {
  const breaker = createBreaker({ failureThreshold: 3 });
  breaker.recordFailure('flash');
  breaker.recordFailure('flash');
  assert.equal(breaker.isOpen('flash'), false, 'not open before threshold');
  breaker.recordFailure('flash');
  assert.equal(breaker.isOpen('flash'), true, 'open at threshold');
});

test('a success resets the consecutive-failure count', () => {
  const breaker = createBreaker({ failureThreshold: 2 });
  breaker.recordFailure('flash');
  breaker.recordSuccess('flash');
  breaker.recordFailure('flash');
  assert.equal(breaker.isOpen('flash'), false, 'success cleared the streak');
});

test('transitions OPEN -> HALF_OPEN after the cooldown elapses', () => {
  let t = 0;
  const breaker = createBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => t });
  breaker.recordFailure('flash');
  assert.equal(breaker.isOpen('flash'), true);
  t = 1500;
  assert.equal(breaker.isOpen('flash'), false, 'half-open probe should be allowed through');
});

test('a failed HALF_OPEN probe re-opens with a longer (backoff) cooldown', () => {
  let t = 0;
  const breaker = createBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => t });
  breaker.recordFailure('flash');           // OPEN at t=0
  t = 1500;
  assert.equal(breaker.isOpen('flash'), false); // now HALF_OPEN, probe allowed
  breaker.recordFailure('flash');           // probe failed -> re-OPEN with backoff
  t = 2500;                                  // one cooldownMs (1000ms) later — first backoff is 2x
  assert.equal(breaker.isOpen('flash'), true, 'still open: backoff cooldown is longer than base');
  t = 3600;                                  // now past the 2x (2000ms) backoff window
  assert.equal(breaker.isOpen('flash'), false);
});

test('a successful HALF_OPEN probe closes the breaker', () => {
  let t = 0;
  const breaker = createBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => t });
  breaker.recordFailure('flash');
  t = 1500;
  assert.equal(breaker.isOpen('flash'), false);
  breaker.recordSuccess('flash');
  assert.deepEqual(breaker.snapshot().flash.status, 'CLOSED');
});

test('snapshot/load round-trips state', () => {
  const a = createBreaker({ failureThreshold: 1 });
  a.recordFailure('flash');
  const snap = a.snapshot();
  const b = createBreaker({ failureThreshold: 1 });
  b.load(snap);
  assert.equal(b.isOpen('flash'), true);
});

test('providers are tracked independently', () => {
  const breaker = createBreaker({ failureThreshold: 1 });
  breaker.recordFailure('max');
  assert.equal(breaker.isOpen('max'), true);
  assert.equal(breaker.isOpen('flash'), false);
});
