const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockProvider } = require('./mock-providers.js');

test('a reliable mock provider resolves with text and cost', async () => {
  const provider = createMockProvider({ name: 'fast-reliable', latencyMs: 0, cost: 0.001 });
  const result = await provider.call('hello');
  assert.match(result.text, /fast-reliable/);
  assert.equal(result.cost, 0.001);
});

test('forceFailure always throws', async () => {
  const provider = createMockProvider({ name: 'slow-flaky', forceFailure: true });
  await assert.rejects(() => provider.call('hello'), /slow-flaky/);
});

test('failureRate of 1 always throws, failureRate of 0 never does', async () => {
  const alwaysFails = createMockProvider({ name: 'a', latencyMs: 0, failureRate: 1 });
  await assert.rejects(() => alwaysFails.call('x'));
  const neverFails = createMockProvider({ name: 'b', latencyMs: 0, failureRate: 0 });
  await assert.doesNotReject(() => neverFails.call('x'));
});
