const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('./store.js');

function tmpDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-store-')), 'state.db');
}

test('breaker snapshot round-trips through the database', () => {
  const store = createStore(tmpDbPath());
  const snap = { flash: { status: 'OPEN', consecutiveFailures: 3, openCount: 1, openedAt: 12345 } };
  store.saveBreakerSnapshot(snap);
  assert.deepEqual(store.loadBreakerSnapshot(), snap);
  store.close();
});

test('an empty database yields empty snapshots, not an error', () => {
  const store = createStore(tmpDbPath());
  assert.deepEqual(store.loadBreakerSnapshot(), {});
  assert.deepEqual(store.loadBudgetSnapshot(), { dayKey: null, dailySpend: 0, windows: {} });
  store.close();
});

test('budget snapshot round-trips through the database', () => {
  const store = createStore(tmpDbPath());
  const snap = { dayKey: '2026-08-12', dailySpend: 1.25, windows: { voice: [1, 2, 3], scheduler: [4] } };
  store.saveBudgetSnapshot(snap);
  assert.deepEqual(store.loadBudgetSnapshot(), snap);
  store.close();
});

test('saving again overwrites rather than duplicating rows (restart-safety)', () => {
  const dbPath = tmpDbPath();
  let store = createStore(dbPath);
  store.saveBreakerSnapshot({ flash: { status: 'OPEN', consecutiveFailures: 3, openCount: 1, openedAt: 1 } });
  store.close();

  store = createStore(dbPath); // simulate process restart: fresh instance, same file
  store.saveBreakerSnapshot({ flash: { status: 'CLOSED', consecutiveFailures: 0, openCount: 0, openedAt: null } });
  const loaded = store.loadBreakerSnapshot();
  assert.deepEqual(loaded, { flash: { status: 'CLOSED', consecutiveFailures: 0, openCount: 0, openedAt: null } });
  store.close();
});

test('state survives a full close and reopen against the same file', () => {
  const dbPath = tmpDbPath();
  let store = createStore(dbPath);
  store.saveBudgetSnapshot({ dayKey: '2026-08-12', dailySpend: 2.5, windows: { agent: [99] } });
  store.close();

  store = createStore(dbPath);
  assert.deepEqual(store.loadBudgetSnapshot(), { dayKey: '2026-08-12', dailySpend: 2.5, windows: { agent: [99] } });
  store.close();
});
