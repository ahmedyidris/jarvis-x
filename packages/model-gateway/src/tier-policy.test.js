// packages/model-gateway/src/tier-policy.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTierPolicy } = require('./tier-policy.js');

test('resolves a configured tier to its chain and gate flag', () => {
  const policy = createTierPolicy({
    quick: { chain: ['flash'], gate: false },
    consequential: { chain: ['max', 'pro', 'flash'], gate: true },
  });
  assert.deepEqual(policy.resolve('quick'), { chain: ['flash'], gate: false });
  assert.deepEqual(policy.resolve('consequential'), { chain: ['max', 'pro', 'flash'], gate: true });
});

test('defaults gate to false when omitted', () => {
  const policy = createTierPolicy({ hard: { chain: ['pro', 'flash'] } });
  assert.equal(policy.resolve('hard').gate, false);
});

test('throws on an unknown tier', () => {
  const policy = createTierPolicy({ quick: { chain: ['flash'] } });
  assert.throws(() => policy.resolve('nope'), /unknown tier: nope/);
});

test('resolve returns a copy, not the internal array', () => {
  const policy = createTierPolicy({ quick: { chain: ['flash'] } });
  const chain = policy.resolve('quick').chain;
  chain.push('mutated');
  assert.deepEqual(policy.resolve('quick').chain, ['flash']);
});
