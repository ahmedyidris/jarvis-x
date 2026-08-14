const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTelemetry } = require('./telemetry.js');

function tmpPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-telemetry-')), 'log.jsonl');
}

test('readAll returns [] when the file does not exist yet', () => {
  const telemetry = createTelemetry(tmpPath());
  assert.deepEqual(telemetry.readAll(), []);
});

test('record appends one JSON line with a timestamp added', () => {
  const filePath = tmpPath();
  const telemetry = createTelemetry(filePath);
  telemetry.record({ tag: 'voice', tier: 'quick', provider: 'flash', degraded: false, gated: false, blocked: false, latencyMs: 120, cost: 0.0001 });
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.tag, 'voice');
  assert.ok(entry.timestamp);
});

test('multiple calls append multiple lines in order', () => {
  const telemetry = createTelemetry(tmpPath());
  telemetry.record({ tag: 'a', tier: 'quick', provider: 'flash', degraded: false, gated: false, blocked: false, latencyMs: 1, cost: 0 });
  telemetry.record({ tag: 'b', tier: 'hard', provider: 'pro', degraded: true, gated: false, blocked: false, latencyMs: 2, cost: 0 });
  const all = telemetry.readAll();
  assert.equal(all.length, 2);
  assert.equal(all[0].tag, 'a');
  assert.equal(all[1].tag, 'b');
});

test('record does not throw when the directory does not exist', () => {
  const badPath = '/nonexistent-dir-xyz/log.jsonl';
  const telemetry = createTelemetry(badPath);
  assert.doesNotThrow(() => telemetry.record({ tag: 'a' }));
});
