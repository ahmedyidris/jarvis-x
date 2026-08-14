const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, renderHtml } = require('./report.js');

const SAMPLE = [
  { timestamp: 't1', tag: 'voice', tier: 'quick', provider: 'flash', degraded: false, gated: false, blocked: false, cost: 0.001, latencyMs: 50 },
  { timestamp: 't2', tag: 'agent', tier: 'consequential', provider: 'flash', degraded: true, gated: true, blocked: false, cost: 0.002, latencyMs: 80 },
  { timestamp: 't3', tag: 'voice', tier: 'quick', provider: null, degraded: false, gated: false, blocked: true, reason: 'budget:rate', cost: 0, latencyMs: 1 },
];

test('summarize counts totals, blocked, gated, degraded, and cost correctly', () => {
  const s = summarize(SAMPLE);
  assert.equal(s.total, 3);
  assert.equal(s.blocked, 1);
  assert.equal(s.gated, 1);
  assert.equal(s.degraded, 1);
  assert.equal(s.totalCost, 0.003);
});

test('summarize groups by-provider stats, skipping blocked/no-provider entries', () => {
  const s = summarize(SAMPLE);
  assert.deepEqual(s.byProvider, { flash: { calls: 2, cost: 0.003 } });
});

test('summarize on an empty list returns zeroed totals, not an error', () => {
  const s = summarize([]);
  assert.equal(s.total, 0);
  assert.deepEqual(s.byProvider, {});
});

test('renderHtml embeds the total count and each entry as a table row', () => {
  const html = renderHtml(SAMPLE);
  assert.match(html, /<table/);
  assert.match(html, /Total: 3/);
  assert.equal((html.match(/<tr>/g) || []).length, SAMPLE.length + 1); // +1 header row
});
