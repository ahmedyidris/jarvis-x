const test = require('node:test');
const assert = require('node:assert/strict');
const { Gateway } = require('./gateway.js');
const { createTierPolicy } = require('./tier-policy.js');
const { createBreaker } = require('./breaker.js');
const { createBudget } = require('./budget.js');
const { createTelemetry } = require('./telemetry.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function mockProvider(name, { fail = false, text = `${name}-reply`, cost = 0.01 } = {}) {
  const calls = [];
  return {
    calls,
    provider: {
      async call(input) {
        calls.push(input);
        if (fail) throw new Error(`${name} failed`);
        return { text, cost };
      },
    },
  };
}

function baseGateway(overrides = {}) {
  const tierPolicy = createTierPolicy({
    quick: { chain: ['flash'], gate: false },
    consequential: { chain: ['max', 'flash'], gate: true },
  });
  return new Gateway({
    tierPolicy,
    breaker: createBreaker(),
    budget: createBudget({ rateLimit: { windowMs: 60_000, maxCalls: 1000 }, dailyCostCeiling: 1000 }),
    providers: new Map(),
    ...overrides,
  });
}

test('a successful first-choice call returns degraded: false, gated from tier policy', async () => {
  const flash = mockProvider('flash');
  const gateway = baseGateway({ providers: new Map([['flash', flash.provider]]) });
  const result = await gateway.route('hi', 'quick', { tag: 'voice' });
  assert.equal(result.text, 'flash-reply');
  assert.equal(result.provider, 'flash');
  assert.equal(result.degraded, false);
  assert.equal(result.gated, false);
  assert.equal(result.blocked, false);
});

test('falling back to a later provider sets degraded: true', async () => {
  const max = mockProvider('max', { fail: true });
  const flash = mockProvider('flash');
  const gateway = baseGateway({ providers: new Map([['max', max.provider], ['flash', flash.provider]]) });
  const result = await gateway.route('do the trade', 'consequential', { tag: 'agent' });
  assert.equal(result.provider, 'flash');
  assert.equal(result.degraded, true);
});

test('gate invariant: gated reflects tier policy even when the chain degrades to its last entry', async () => {
  const max = mockProvider('max', { fail: true });
  const flash = mockProvider('flash');
  const gateway = baseGateway({ providers: new Map([['max', max.provider], ['flash', flash.provider]]) });
  const result = await gateway.route('do the trade', 'consequential', { tag: 'agent' });
  assert.equal(result.gated, true, 'consequential tier is always gated, regardless of which provider answered');
});

test('guardCheck runs first: a blocked guard means zero provider calls', async () => {
  const flash = mockProvider('flash');
  const gateway = baseGateway({
    guardCheck: () => ({ blocked: true, reason: 'STOP file present' }),
    providers: new Map([['flash', flash.provider]]),
  });
  const result = await gateway.route('hi', 'quick', { tag: 'voice' });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, 'STOP file present');
  assert.equal(flash.calls.length, 0, 'guard-first: provider must never be touched');
});

test('a budget block is a normal return value, not a thrown error, and touches no provider', async () => {
  const flash = mockProvider('flash');
  const gateway = baseGateway({
    budget: createBudget({ rateLimit: { windowMs: 60_000, maxCalls: 0 }, dailyCostCeiling: 1000 }),
    providers: new Map([['flash', flash.provider]]),
  });
  const result = await gateway.route('hi', 'quick', { tag: 'voice' });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /^budget:/);
  assert.equal(flash.calls.length, 0);
});

test('an open breaker removes a provider from the chain without touching it', async () => {
  const max = mockProvider('max');
  const flash = mockProvider('flash');
  const breaker = createBreaker({ failureThreshold: 1 });
  breaker.recordFailure('max'); // pre-open max's breaker
  const gateway = baseGateway({
    breaker,
    providers: new Map([['max', max.provider], ['flash', flash.provider]]),
  });
  const result = await gateway.route('do the trade', 'consequential', { tag: 'agent' });
  assert.equal(result.provider, 'flash');
  assert.equal(max.calls.length, 0, 'open breaker means max is skipped entirely, not called-and-failed');
});

test('exhausting the entire chain throws, with each provider error included', async () => {
  const max = mockProvider('max', { fail: true });
  const flash = mockProvider('flash', { fail: true });
  const gateway = baseGateway({ providers: new Map([['max', max.provider], ['flash', flash.provider]]) });
  await assert.rejects(
    () => gateway.route('do the trade', 'consequential', { tag: 'agent' }),
    (err) => /max failed/.test(err.message) && /flash failed/.test(err.message)
  );
});

test('a successful call is recorded to telemetry with the full field set', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-telemetry-'));
  const telemetryPath = path.join(dir, 'log.jsonl');
  const telemetry = createTelemetry(telemetryPath);
  const flash = mockProvider('flash', { cost: 0.0002 });
  const gateway = baseGateway({ telemetry, providers: new Map([['flash', flash.provider]]) });
  await gateway.route('hi', 'quick', { tag: 'voice' });
  const [entry] = telemetry.readAll();
  assert.equal(entry.tag, 'voice');
  assert.equal(entry.tier, 'quick');
  assert.equal(entry.provider, 'flash');
  assert.equal(entry.blocked, false);
  assert.equal(entry.cost, 0.0002);
  assert.ok(typeof entry.latencyMs === 'number');
});

test('options.tag defaults to "default" when omitted', async () => {
  const flash = mockProvider('flash');
  const gateway = baseGateway({ providers: new Map([['flash', flash.provider]]) });
  const result = await gateway.route('hi', 'quick');
  assert.equal(result.text, 'flash-reply');
});

test('constructor tolerates a store whose loadBreakerSnapshot() throws: construction succeeds and the gateway remains usable with default state', async () => {
  const flash = mockProvider('flash');
  const badStore = {
    loadBreakerSnapshot() {
      throw new Error('corrupt breaker snapshot file');
    },
    loadBudgetSnapshot() {
      return {};
    },
    saveBreakerSnapshot() {},
    saveBudgetSnapshot() {},
  };

  let gateway;
  assert.doesNotThrow(() => {
    gateway = baseGateway({ store: badStore, providers: new Map([['flash', flash.provider]]) });
  }, 'a failing store load must not prevent Gateway construction (best-effort persistence)');

  const result = await gateway.route('hi', 'quick', { tag: 'voice' });
  assert.equal(result.text, 'flash-reply');
  assert.equal(result.provider, 'flash');
  assert.equal(result.blocked, false);
});
