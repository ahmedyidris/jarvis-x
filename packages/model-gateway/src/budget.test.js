// packages/model-gateway/src/budget.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBudget } = require('./budget.js');

test('allows calls under the rate cap', () => {
  const budget = createBudget({ rateLimit: { windowMs: 60_000, maxCalls: 2 } });
  assert.equal(budget.checkAndReserve('voice').ok, true);
  budget.recordCall('voice');
  assert.equal(budget.checkAndReserve('voice').ok, true);
});

test('blocks with reason "rate" once the cap is hit inside the window', () => {
  let t = 0;
  const budget = createBudget({ rateLimit: { windowMs: 60_000, maxCalls: 2 }, now: () => t });
  budget.recordCall('voice'); t += 10;
  budget.recordCall('voice'); t += 10;
  const result = budget.checkAndReserve('voice');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'rate');
});

test('the rate cap is per-tag, not global', () => {
  let t = 0;
  const budget = createBudget({ rateLimit: { windowMs: 60_000, maxCalls: 1 }, now: () => t });
  budget.recordCall('voice');
  assert.equal(budget.checkAndReserve('voice').ok, false);
  assert.equal(budget.checkAndReserve('scheduler').ok, true);
});

test('old calls fall out of the window and free up capacity', () => {
  let t = 0;
  const budget = createBudget({ rateLimit: { windowMs: 1000, maxCalls: 1 }, now: () => t });
  budget.recordCall('voice');
  assert.equal(budget.checkAndReserve('voice').ok, false);
  t = 1500;
  assert.equal(budget.checkAndReserve('voice').ok, true);
});

test('blocks with reason "cost" once the shared daily ceiling is hit, regardless of tag', () => {
  const budget = createBudget({ dailyCostCeiling: 1.0 });
  budget.recordCall('voice', 0.7);
  budget.recordCall('scheduler', 0.4);
  const result = budget.checkAndReserve('agent'); // a third, uninvolved tag
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'cost');
});

test('daily spend resets on a new day', () => {
  let t = new Date('2026-08-12T23:59:00Z').getTime();
  const budget = createBudget({ dailyCostCeiling: 1.0, now: () => t });
  budget.recordCall('voice', 1.0);
  assert.equal(budget.checkAndReserve('voice').ok, false);
  t = new Date('2026-08-13T00:01:00Z').getTime();
  assert.equal(budget.checkAndReserve('voice').ok, true);
});

test('snapshot/load round-trips both rate windows and daily spend', () => {
  const a = createBudget({ dailyCostCeiling: 1.0 });
  a.recordCall('voice', 0.5);
  const snap = a.snapshot();
  const b = createBudget({ dailyCostCeiling: 1.0 });
  b.load(snap);
  assert.equal(b.checkAndReserve('anyone').ok, true);
  b.recordCall('anyone', 0.6);
  assert.equal(b.checkAndReserve('anyone').reason, 'cost'); // 0.5 + 0.6 > 1.0
});
