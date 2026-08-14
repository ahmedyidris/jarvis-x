# Model Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone `packages/model-gateway` package (routing, circuit breaking, budget, telemetry) exactly as scoped in `docs/superpowers/specs/2026-08-12-model-gateway-design.md`, wire it into jarvis-x via `code/gateway-adapter.js`, and retire the dead/duplicate routing code around it.

**Architecture:** Six focused package modules (`tier-policy`, `breaker`, `budget`, `store`, `telemetry`, `gateway`) compose into one `Gateway` class that `gateway-adapter.js` constructs with jarvis-x-specific config and Provider wrappers. `agent.js`, `query.js`, and `scheduler.js` stop importing `router.js`/`gemini.js`/`local.js` directly and call the adapter instead. `models.js` and `universal-router.js` are deleted.

**Tech Stack:** Node.js CommonJS, `better-sqlite3` (package's only runtime dep), Node's built-in `node:test` + `node:assert/strict` for the package, the repo's existing `code/test-helper.js` convention for the adapter test.

## Global Constraints

- Package has exactly one runtime dependency: `better-sqlite3`. No other dependencies without updating the spec first.
- `packages/model-gateway` never imports anything from `code/`. `code/gateway-adapter.js` is the only file that imports both.
- Package tests use `node:test` (run via `node --test`), not the repo's `jest-runner.js` — that stays scoped to `code/test-*.js`.
- `gateway.route()`'s `gated` field is set from the tier's static policy config only — never from which provider in the chain answered, and never cleared because a call degraded.
- `guardCheck` runs before budget, before tier lookup, before any provider is touched. A blocked result short-circuits everything else.
- Persistence (`store.js`, `telemetry.js`) failures are best-effort: caught, logged to stderr, never allowed to block or fail the actual model call.
- `models.js` and `universal-router.js` are deleted outright (confirmed dead in the spec's Context section — nothing requires them).
- `local.js`, `router.js`, `gemini.js` are **not** deleted — they become the implementation behind Provider wrappers, no longer imported directly by `agent.js`, `query.js`, or `scheduler.js`.

---

### Task 1: Package scaffold + `tier-policy.js`

**Files:**
- Create: `packages/model-gateway/package.json`
- Create: `packages/model-gateway/src/tier-policy.js`
- Test: `packages/model-gateway/src/tier-policy.test.js`

**Interfaces:**
- Produces: `createTierPolicy(config: {[tierName]: {chain: string[], gate?: boolean}}) -> { resolve(tierName: string) -> {chain: string[], gate: boolean} }`. Throws `Error('unknown tier: ' + tierName)` for an unconfigured tier. `resolve()` returns a defensive copy of `chain` (callers must not mutate the policy's internal array).

- [x] **Step 1: Create the package scaffold**

`packages/model-gateway/package.json`:
```json
{
  "name": "model-gateway",
  "version": "0.1.0",
  "description": "Routing, circuit breaking, budget enforcement, and telemetry for multi-provider LLM calls.",
  "main": "src/gateway.js",
  "scripts": {
    "test": "node --test src/",
    "demo": "node demo/run-demo.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "license": "MIT"
}
```

Run: `mkdir -p packages/model-gateway/src packages/model-gateway/demo && cd packages/model-gateway && npm install`
Expected: `node_modules/better-sqlite3` present, no errors.

- [x] **Step 2: Write the failing test for `tier-policy.js`**

```js
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
```

- [x] **Step 3: Run test to verify it fails**

Run: `cd packages/model-gateway && node --test src/tier-policy.test.js`
Expected: FAIL — `Cannot find module './tier-policy.js'`

- [x] **Step 4: Write minimal implementation**

```js
// packages/model-gateway/src/tier-policy.js
function createTierPolicy(config) {
  function resolve(tierName) {
    const entry = config[tierName];
    if (!entry) throw new Error('unknown tier: ' + tierName);
    return { chain: entry.chain.slice(), gate: !!entry.gate };
  }
  return { resolve };
}

module.exports = { createTierPolicy };
```

- [x] **Step 5: Run test to verify it passes**

Run: `cd packages/model-gateway && node --test src/tier-policy.test.js`
Expected: PASS, 4/4

- [x] **Step 6: Commit**

```bash
git add packages/model-gateway/package.json packages/model-gateway/package-lock.json packages/model-gateway/src/tier-policy.js packages/model-gateway/src/tier-policy.test.js
git commit -m "model-gateway: scaffold package + tier-policy"
```

---

### Task 2: `breaker.js` — per-provider circuit breaker

**Files:**
- Create: `packages/model-gateway/src/breaker.js`
- Test: `packages/model-gateway/src/breaker.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createBreaker({failureThreshold?: number, cooldownMs?: number, maxCooldownMs?: number, now?: () => number}) -> { isOpen(provider: string) -> boolean, recordSuccess(provider: string) -> void, recordFailure(provider: string) -> void, snapshot() -> object, load(snapshot: object) -> void }`. `snapshot()`/`load()` round-trip through `store.js` (Task 4) — the shape is `{[provider]: {status: 'CLOSED'|'OPEN'|'HALF_OPEN', consecutiveFailures: number, openCount: number, openedAt: number|null}}`.

- [x] **Step 1: Write the failing tests**

```js
// packages/model-gateway/src/breaker.test.js
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
```

- [x] **Step 2: Run to verify failure**

Run: `cd packages/model-gateway && node --test src/breaker.test.js`
Expected: FAIL — module not found

- [x] **Step 3: Implement**

```js
// packages/model-gateway/src/breaker.js
function createBreaker({ failureThreshold = 3, cooldownMs = 30_000, maxCooldownMs = cooldownMs * 8, now = () => Date.now() } = {}) {
  const state = new Map();

  function get(provider) {
    if (!state.has(provider)) {
      state.set(provider, { status: 'CLOSED', consecutiveFailures: 0, openCount: 0, openedAt: null });
    }
    return state.get(provider);
  }

  function effectiveCooldown(openCount) {
    const backoff = cooldownMs * Math.pow(2, Math.max(0, openCount - 1));
    return Math.min(backoff, maxCooldownMs);
  }

  function isOpen(provider) {
    const s = get(provider);
    if (s.status === 'OPEN' && now() - s.openedAt >= effectiveCooldown(s.openCount)) {
      s.status = 'HALF_OPEN';
    }
    return s.status === 'OPEN';
  }

  function recordSuccess(provider) {
    const s = get(provider);
    s.status = 'CLOSED';
    s.consecutiveFailures = 0;
    s.openCount = 0;
    s.openedAt = null;
  }

  function recordFailure(provider) {
    const s = get(provider);
    if (s.status === 'HALF_OPEN') {
      s.openCount += 1;
      s.status = 'OPEN';
      s.openedAt = now();
      return;
    }
    s.consecutiveFailures += 1;
    if (s.consecutiveFailures >= failureThreshold) {
      s.openCount += 1;
      s.status = 'OPEN';
      s.openedAt = now();
    }
  }

  function snapshot() {
    const out = {};
    for (const [provider, s] of state.entries()) out[provider] = { ...s };
    return out;
  }

  function load(snap) {
    for (const [provider, s] of Object.entries(snap || {})) state.set(provider, { ...s });
  }

  return { isOpen, recordSuccess, recordFailure, snapshot, load };
}

module.exports = { createBreaker };
```

- [x] **Step 4: Run to verify pass**

Run: `cd packages/model-gateway && node --test src/breaker.test.js`
Expected: PASS, 8/8

- [x] **Step 5: Commit**

```bash
git add packages/model-gateway/src/breaker.js packages/model-gateway/src/breaker.test.js
git commit -m "model-gateway: add circuit breaker"
```

---

### Task 3: `budget.js` — per-tag rate cap + shared daily cost ceiling

**Files:**
- Create: `packages/model-gateway/src/budget.js`
- Test: `packages/model-gateway/src/budget.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createBudget({rateLimit?: {windowMs: number, maxCalls: number}, dailyCostCeiling?: number, now?: () => number}) -> { checkAndReserve(tag: string) -> {ok: boolean, reason?: 'rate'|'cost'}, recordCall(tag: string, cost?: number) -> void, snapshot() -> object, load(snapshot: object) -> void }`. `snapshot()` shape: `{dayKey: string|null, dailySpend: number, windows: {[tag]: number[]}}` — consumed by `store.js` (Task 4).

- [x] **Step 1: Write the failing tests**

```js
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
```

- [x] **Step 2: Run to verify failure**

Run: `cd packages/model-gateway && node --test src/budget.test.js`
Expected: FAIL — module not found

- [x] **Step 3: Implement**

```js
// packages/model-gateway/src/budget.js
function dayKeyOf(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function createBudget({ rateLimit = { windowMs: 60_000, maxCalls: 30 }, dailyCostCeiling = 5.0, now = () => Date.now() } = {}) {
  const windows = new Map();
  let dayKey = null;
  let dailySpend = 0;

  function rollDay() {
    const key = dayKeyOf(now());
    if (key !== dayKey) {
      dayKey = key;
      dailySpend = 0;
    }
  }

  function pruneAndGetWindow(tag) {
    const ts = now();
    const arr = (windows.get(tag) || []).filter(t => ts - t < rateLimit.windowMs);
    windows.set(tag, arr);
    return arr;
  }

  function checkAndReserve(tag) {
    rollDay();
    if (pruneAndGetWindow(tag).length >= rateLimit.maxCalls) return { ok: false, reason: 'rate' };
    if (dailySpend >= dailyCostCeiling) return { ok: false, reason: 'cost' };
    return { ok: true };
  }

  function recordCall(tag, cost = 0) {
    rollDay();
    const arr = pruneAndGetWindow(tag);
    arr.push(now());
    windows.set(tag, arr);
    dailySpend += cost;
  }

  function snapshot() {
    rollDay();
    const outWindows = {};
    for (const [tag, arr] of windows.entries()) outWindows[tag] = arr.slice();
    return { dayKey, dailySpend, windows: outWindows };
  }

  function load(snap) {
    if (!snap) return;
    dayKey = snap.dayKey ?? null;
    dailySpend = snap.dailySpend ?? 0;
    for (const [tag, arr] of Object.entries(snap.windows || {})) windows.set(tag, arr.slice());
  }

  return { checkAndReserve, recordCall, snapshot, load };
}

module.exports = { createBudget, dayKeyOf };
```

- [x] **Step 4: Run to verify pass**

Run: `cd packages/model-gateway && node --test src/budget.test.js`
Expected: PASS, 7/7

- [x] **Step 5: Commit**

```bash
git add packages/model-gateway/src/budget.js packages/model-gateway/src/budget.test.js
git commit -m "model-gateway: add budget (rate cap + daily cost ceiling)"
```

---

### Task 4: `store.js` — SQLite persistence for breaker + budget state

**Files:**
- Create: `packages/model-gateway/src/store.js`
- Test: `packages/model-gateway/src/store.test.js`

**Interfaces:**
- Consumes: `breaker.snapshot()`'s shape from Task 2, `budget.snapshot()`'s shape from Task 3 (as data, not by importing those modules).
- Produces: `createStore(dbPath: string) -> { loadBreakerSnapshot() -> object, saveBreakerSnapshot(snap: object) -> void, loadBudgetSnapshot() -> object, saveBudgetSnapshot(snap: object) -> void, close() -> void }`.

- [x] **Step 1: Write the failing tests**

```js
// packages/model-gateway/src/store.test.js
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
```

- [x] **Step 2: Run to verify failure**

Run: `cd packages/model-gateway && node --test src/store.test.js`
Expected: FAIL — module not found

- [x] **Step 3: Implement**

```js
// packages/model-gateway/src/store.js
const Database = require('better-sqlite3');

function createStore(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS breaker_state (
      provider TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      consecutive_failures INTEGER NOT NULL,
      open_count INTEGER NOT NULL,
      opened_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS budget_rate_windows (
      tag TEXT PRIMARY KEY,
      timestamps_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS budget_daily (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      day_key TEXT,
      daily_spend REAL NOT NULL
    );
  `);

  const upsertBreaker = db.prepare(`
    INSERT INTO breaker_state (provider, status, consecutive_failures, open_count, opened_at)
    VALUES (@provider, @status, @consecutiveFailures, @openCount, @openedAt)
    ON CONFLICT(provider) DO UPDATE SET
      status = @status, consecutive_failures = @consecutiveFailures,
      open_count = @openCount, opened_at = @openedAt
  `);

  function loadBreakerSnapshot() {
    const rows = db.prepare('SELECT * FROM breaker_state').all();
    const snap = {};
    for (const r of rows) {
      snap[r.provider] = {
        status: r.status,
        consecutiveFailures: r.consecutive_failures,
        openCount: r.open_count,
        openedAt: r.opened_at,
      };
    }
    return snap;
  }

  function saveBreakerSnapshot(snap) {
    const tx = db.transaction((entries) => {
      for (const [provider, s] of entries) {
        upsertBreaker.run({
          provider, status: s.status, consecutiveFailures: s.consecutiveFailures,
          openCount: s.openCount, openedAt: s.openedAt,
        });
      }
    });
    tx(Object.entries(snap));
  }

  const upsertWindow = db.prepare(`
    INSERT INTO budget_rate_windows (tag, timestamps_json) VALUES (@tag, @json)
    ON CONFLICT(tag) DO UPDATE SET timestamps_json = @json
  `);
  const upsertDaily = db.prepare(`
    INSERT INTO budget_daily (id, day_key, daily_spend) VALUES (1, @dayKey, @dailySpend)
    ON CONFLICT(id) DO UPDATE SET day_key = @dayKey, daily_spend = @dailySpend
  `);

  function loadBudgetSnapshot() {
    const daily = db.prepare('SELECT * FROM budget_daily WHERE id = 1').get();
    const rows = db.prepare('SELECT * FROM budget_rate_windows').all();
    const windows = {};
    for (const r of rows) windows[r.tag] = JSON.parse(r.timestamps_json);
    return {
      dayKey: daily ? daily.day_key : null,
      dailySpend: daily ? daily.daily_spend : 0,
      windows,
    };
  }

  function saveBudgetSnapshot(snap) {
    const tx = db.transaction(() => {
      upsertDaily.run({ dayKey: snap.dayKey, dailySpend: snap.dailySpend });
      for (const [tag, arr] of Object.entries(snap.windows)) {
        upsertWindow.run({ tag, json: JSON.stringify(arr) });
      }
    });
    tx();
  }

  function close() {
    db.close();
  }

  return { loadBreakerSnapshot, saveBreakerSnapshot, loadBudgetSnapshot, saveBudgetSnapshot, close };
}

module.exports = { createStore };
```

- [x] **Step 4: Run to verify pass**

Run: `cd packages/model-gateway && node --test src/store.test.js`
Expected: PASS, 5/5

- [x] **Step 5: Commit**

```bash
git add packages/model-gateway/src/store.js packages/model-gateway/src/store.test.js packages/model-gateway/package.json packages/model-gateway/package-lock.json
git commit -m "model-gateway: add SQLite store for breaker + budget state"
```

---

### Task 5: `telemetry.js` — append-only JSONL audit trail

**Files:**
- Create: `packages/model-gateway/src/telemetry.js`
- Test: `packages/model-gateway/src/telemetry.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createTelemetry(filePath: string) -> { record(entry: {tag, tier, provider, degraded, gated, blocked, latencyMs, cost, reason?}) -> void, readAll() -> Array<object> }`. `record()` stamps `timestamp` itself; never throws (write failures are caught and logged to stderr per Global Constraints).

- [x] **Step 1: Write the failing tests**

```js
// packages/model-gateway/src/telemetry.test.js
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
```

- [x] **Step 2: Run to verify failure**

Run: `cd packages/model-gateway && node --test src/telemetry.test.js`
Expected: FAIL — module not found

- [x] **Step 3: Implement**

```js
// packages/model-gateway/src/telemetry.js
const fs = require('node:fs');

function createTelemetry(filePath) {
  function record(entry) {
    try {
      fs.appendFileSync(filePath, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n');
    } catch (e) {
      console.error('model-gateway telemetry: write failed (call still happened):', e.message);
    }
  }

  function readAll() {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  }

  return { record, readAll };
}

module.exports = { createTelemetry };
```

- [x] **Step 4: Run to verify pass**

Run: `cd packages/model-gateway && node --test src/telemetry.test.js`
Expected: PASS, 4/4

- [x] **Step 5: Commit**

```bash
git add packages/model-gateway/src/telemetry.js packages/model-gateway/src/telemetry.test.js
git commit -m "model-gateway: add JSONL telemetry"
```

---

### Task 6: `gateway.js` — the orchestrator

**Files:**
- Create: `packages/model-gateway/src/gateway.js`
- Test: `packages/model-gateway/src/gateway.test.js`

**Interfaces:**
- Consumes: `createTierPolicy` (Task 1), `createBreaker` (Task 2), `createBudget` (Task 3), `createStore` (Task 4), `createTelemetry` (Task 5). A "Provider" is any object shaped `{call(input: string) -> Promise<{text: string, cost?: number}>}`.
- Produces: `class Gateway` — `new Gateway({tierPolicy, guardCheck?, budget, breaker, store?, telemetry?, providers: Map<string, Provider>})`, with `.route(input: string, tier: string, options?: {tag?: string}) -> Promise<{text: string|null, provider: string|null, tier: string, degraded: boolean, gated: boolean, blocked: boolean, reason?: string, cost: number, latencyMs: number}>`. `route()` rejects (throws) only when every provider in the resolved chain fails — `blocked` and a budget/guard short-circuit are normal return values, never exceptions.

- [x] **Step 1: Write the failing tests**

```js
// packages/model-gateway/src/gateway.test.js
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
```

- [x] **Step 2: Run to verify failure**

Run: `cd packages/model-gateway && node --test src/gateway.test.js`
Expected: FAIL — module not found

- [x] **Step 3: Implement**

```js
// packages/model-gateway/src/gateway.js
class Gateway {
  constructor({ tierPolicy, guardCheck, budget, breaker, store, telemetry, providers }) {
    this.tierPolicy = tierPolicy;
    this.guardCheck = guardCheck || (() => ({ blocked: false }));
    this.budget = budget;
    this.breaker = breaker;
    this.store = store;
    this.telemetry = telemetry;
    this.providers = providers;

    if (this.store) {
      this.breaker.load(this.store.loadBreakerSnapshot());
      this.budget.load(this.store.loadBudgetSnapshot());
    }
  }

  async route(input, tier, options = {}) {
    const tag = options.tag || 'default';
    const startedAt = Date.now();

    const finish = (fields) => {
      const latencyMs = Date.now() - startedAt;
      const record = { tag, tier, latencyMs, ...fields };
      if (this.telemetry) this.telemetry.record(record);
      return { text: null, provider: null, degraded: false, gated: false, blocked: false, cost: 0, ...record };
    };

    const guardResult = await this.guardCheck({ input, tier, tag });
    if (guardResult && guardResult.blocked) {
      return finish({ blocked: true, reason: guardResult.reason, cost: 0 });
    }

    const budgetResult = this.budget.checkAndReserve(tag);
    if (!budgetResult.ok) {
      return finish({ blocked: true, reason: `budget:${budgetResult.reason}`, cost: 0 });
    }

    const { chain, gate } = this.tierPolicy.resolve(tier);
    const available = chain.filter(name => !this.breaker.isOpen(name));

    const errors = [];
    for (let i = 0; i < available.length; i++) {
      const name = available[i];
      const provider = this.providers.get(name);
      try {
        const result = await provider.call(input);
        this.breaker.recordSuccess(name);
        this.budget.recordCall(tag, result.cost || 0);
        this._persist();
        return finish({ text: result.text, provider: name, degraded: i > 0, gated: gate, blocked: false, cost: result.cost || 0 });
      } catch (e) {
        this.breaker.recordFailure(name);
        this._persist();
        errors.push(`${name}: ${e.message}`);
      }
    }

    finish({ provider: null, gated: gate, blocked: false, exhausted: true, cost: 0, reason: errors.join(' | ') });
    throw new Error(`all providers exhausted for tier ${tier} -> ${errors.join(' | ')}`);
  }

  _persist() {
    if (!this.store) return;
    try {
      this.store.saveBreakerSnapshot(this.breaker.snapshot());
      this.store.saveBudgetSnapshot(this.budget.snapshot());
    } catch (e) {
      console.error('model-gateway: persistence failed (call still happened):', e.message);
    }
  }
}

module.exports = { Gateway };
```

- [x] **Step 4: Run to verify pass**

Run: `cd packages/model-gateway && node --test src/gateway.test.js`
Expected: PASS, 9/9

- [x] **Step 5: Commit**

```bash
git add packages/model-gateway/src/gateway.js packages/model-gateway/src/gateway.test.js
git commit -m "model-gateway: add Gateway orchestrator"
```

---

### Task 7: `demo/` — mock providers, synthetic traffic, induced failure

**Files:**
- Create: `packages/model-gateway/demo/mock-providers.js`
- Create: `packages/model-gateway/demo/run-demo.js`
- Test: `packages/model-gateway/demo/mock-providers.test.js`

**Interfaces:**
- Consumes: `Gateway` (Task 6), `createTierPolicy`/`createBreaker`/`createBudget`/`createStore`/`createTelemetry` (Tasks 1–5).
- Produces: `createMockProvider({name, latencyMs?, failureRate?, forceFailure?, cost?}) -> Provider` (the `{call(input)}` shape Task 6 consumes). `run-demo.js` is a script, not a module other tasks import.

- [x] **Step 1: Write the failing test for the mock provider factory**

```js
// packages/model-gateway/demo/mock-providers.test.js
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
```

- [x] **Step 2: Run to verify failure**

Run: `cd packages/model-gateway && node --test demo/mock-providers.test.js`
Expected: FAIL — module not found

- [x] **Step 3: Implement the mock provider factory**

```js
// packages/model-gateway/demo/mock-providers.js
function createMockProvider({ name, latencyMs = 50, failureRate = 0, forceFailure = false, cost = 0.001 }) {
  let callCount = 0;
  return {
    name,
    async call(input) {
      callCount += 1;
      if (latencyMs > 0) await new Promise(resolve => setTimeout(resolve, latencyMs));
      if (forceFailure || (failureRate > 0 && Math.random() < failureRate)) {
        throw new Error(`${name} simulated failure (call #${callCount})`);
      }
      return { text: `[${name}] response to: ${String(input).slice(0, 40)}`, cost };
    },
  };
}

module.exports = { createMockProvider };
```

- [x] **Step 4: Run to verify pass**

Run: `cd packages/model-gateway && node --test demo/mock-providers.test.js`
Expected: PASS, 3/3

- [x] **Step 5: Write the demo script (no test — this is the manual/portfolio artifact)**

```js
// packages/model-gateway/demo/run-demo.js
const path = require('node:path');
const fs = require('node:fs');
const { Gateway } = require('../src/gateway.js');
const { createTierPolicy } = require('../src/tier-policy.js');
const { createBreaker } = require('../src/breaker.js');
const { createBudget } = require('../src/budget.js');
const { createStore } = require('../src/store.js');
const { createTelemetry } = require('../src/telemetry.js');
const { createMockProvider } = require('./mock-providers.js');
const { printSummary, renderHtml } = require('../src/report.js');

const OUT_DIR = path.join(__dirname, 'output');
fs.mkdirSync(OUT_DIR, { recursive: true });
const dbPath = path.join(OUT_DIR, 'demo-state.db');
const telemetryPath = path.join(OUT_DIR, 'demo-telemetry.jsonl');
[dbPath, telemetryPath].forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });

const gateway = new Gateway({
  tierPolicy: createTierPolicy({
    'quick-tier': { chain: ['fast-reliable'], gate: false },
    'careful-tier': { chain: ['slow-flaky', 'fast-reliable'], gate: true },
  }),
  breaker: createBreaker({ failureThreshold: 2, cooldownMs: 2000 }),
  budget: createBudget({ rateLimit: { windowMs: 10_000, maxCalls: 100 }, dailyCostCeiling: 100 }),
  store: createStore(dbPath),
  telemetry: createTelemetry(telemetryPath),
  providers: new Map([
    ['fast-reliable', createMockProvider({ name: 'fast-reliable', latencyMs: 20, cost: 0.0005 })],
    ['slow-flaky', createMockProvider({ name: 'slow-flaky', latencyMs: 80, failureRate: 0.3, cost: 0.002 })],
  ]),
});

async function main() {
  console.log('Running synthetic traffic (20 calls, quick + careful tiers mixed)...');
  for (let i = 0; i < 20; i++) {
    const tier = i % 3 === 0 ? 'careful-tier' : 'quick-tier';
    try {
      await gateway.route(`synthetic request #${i}`, tier, { tag: i % 2 === 0 ? 'voice' : 'scheduler' });
    } catch (e) {
      console.log(`  call #${i} exhausted: ${e.message}`);
    }
  }

  console.log('\nInducing a mid-run failure: forcing slow-flaky to always fail for 5 calls...');
  gateway.providers.set('slow-flaky', createMockProvider({ name: 'slow-flaky', forceFailure: true }));
  for (let i = 20; i < 25; i++) {
    try {
      await gateway.route(`synthetic request #${i}`, 'careful-tier', { tag: 'agent' });
    } catch (e) {
      console.log(`  call #${i} exhausted: ${e.message}`);
    }
  }

  const { createTelemetry: reopenTelemetry } = require('../src/telemetry.js');
  const entries = reopenTelemetry(telemetryPath).readAll();
  console.log('\n=== Summary ===');
  printSummary(entries);

  const htmlPath = path.join(OUT_DIR, 'dashboard.html');
  fs.writeFileSync(htmlPath, renderHtml(entries));
  console.log(`\nDashboard written to ${htmlPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
```

Run: `cd packages/model-gateway && npm run demo`
Expected: prints a summary (some calls degraded to `fast-reliable`, some exhausted during the induced-failure window), writes `demo/output/dashboard.html`. (`report.js` doesn't exist yet — this step's manual run happens after Task 8; commit the demo files now, verify the full run at the end of Task 8.)

- [x] **Step 6: Commit**

```bash
git add packages/model-gateway/demo/
git commit -m "model-gateway: add demo mock providers + synthetic-traffic script"
```

---

### Task 8: `report.js` + package `README.md`

**Files:**
- Create: `packages/model-gateway/src/report.js`
- Test: `packages/model-gateway/src/report.test.js`
- Create: `packages/model-gateway/README.md`

**Interfaces:**
- Consumes: telemetry entries in the shape Task 5/6 produce (`{tag, tier, provider, degraded, gated, blocked, cost, latencyMs, timestamp}`).
- Produces: `summarize(entries) -> {total, blocked, gated, degraded, totalCost, byProvider: {[name]: {calls, cost}}}`, `printSummary(entries) -> void`, `renderHtml(entries) -> string`.

- [x] **Step 1: Write the failing tests**

```js
// packages/model-gateway/src/report.test.js
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
```

- [x] **Step 2: Run to verify failure**

Run: `cd packages/model-gateway && node --test src/report.test.js`
Expected: FAIL — module not found

- [x] **Step 3: Implement**

```js
// packages/model-gateway/src/report.js
function summarize(entries) {
  let blocked = 0, gated = 0, degraded = 0, totalCost = 0;
  const byProvider = {};
  for (const e of entries) {
    if (e.blocked) blocked++;
    if (e.gated) gated++;
    if (e.degraded) degraded++;
    totalCost += e.cost || 0;
    if (e.provider) {
      byProvider[e.provider] = byProvider[e.provider] || { calls: 0, cost: 0 };
      byProvider[e.provider].calls += 1;
      byProvider[e.provider].cost += e.cost || 0;
    }
  }
  return { total: entries.length, blocked, gated, degraded, totalCost, byProvider };
}

function printSummary(entries) {
  const s = summarize(entries);
  console.log(`Total: ${s.total}`);
  console.log(`Blocked: ${s.blocked}  Gated: ${s.gated}  Degraded: ${s.degraded}`);
  console.log(`Total cost: $${s.totalCost.toFixed(4)}`);
  for (const [provider, stats] of Object.entries(s.byProvider)) {
    console.log(`  ${provider}: ${stats.calls} calls, $${stats.cost.toFixed(4)}`);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderHtml(entries) {
  const s = summarize(entries);
  const rows = entries.map(e => `<tr><td>${escapeHtml(e.timestamp)}</td><td>${escapeHtml(e.tag)}</td><td>${escapeHtml(e.tier)}</td><td>${escapeHtml(e.provider || '-')}</td><td>${e.blocked ? 'blocked' : e.degraded ? 'degraded' : 'ok'}</td><td>${e.gated ? 'yes' : 'no'}</td><td>${e.latencyMs}ms</td><td>$${(e.cost || 0).toFixed(4)}</td></tr>`).join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Model Gateway Dashboard</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;font-size:14px}</style>
</head><body>
<h1>Model Gateway Dashboard</h1>
<p>Total: ${s.total} &middot; Blocked: ${s.blocked} &middot; Gated: ${s.gated} &middot; Degraded: ${s.degraded} &middot; Cost: $${s.totalCost.toFixed(4)}</p>
<table><thead><tr><th>Time</th><th>Tag</th><th>Tier</th><th>Provider</th><th>Status</th><th>Gated</th><th>Latency</th><th>Cost</th></tr></thead>
<tbody>
${rows}
</tbody></table>
</body></html>`;
}

if (require.main === module) {
  const { createTelemetry } = require('./telemetry.js');
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node src/report.js <telemetry.jsonl> [output.html]');
    process.exit(1);
  }
  const entries = createTelemetry(filePath).readAll();
  printSummary(entries);
  if (process.argv[3]) {
    require('node:fs').writeFileSync(process.argv[3], renderHtml(entries));
    console.log(`\nHTML dashboard written to ${process.argv[3]}`);
  }
}

module.exports = { summarize, printSummary, renderHtml };
```

- [x] **Step 4: Run to verify pass**

Run: `cd packages/model-gateway && node --test src/report.test.js`
Expected: PASS, 4/4

- [x] **Step 5: Run the full package test suite and the demo end-to-end**

Run: `cd packages/model-gateway && npm test && npm run demo`
Expected: all `node --test` files pass; demo prints a summary and writes `demo/output/dashboard.html` with rows for the induced-failure window showing `exhausted` calls.

- [x] **Step 6: Write the package README**

```markdown
<!-- packages/model-gateway/README.md -->
# Model Gateway

A standalone, dependency-light package that owns exactly one job: given an
already-classified "tier" and a caller tag, route a call through an ordered
fallback chain of providers, enforce per-tag rate limits and a shared daily
cost ceiling, trip a circuit breaker on repeated provider failures, and
record every outcome to an append-only audit log.

It does **not** decide what a prompt is about, run agent logic, or execute
side effects — see [the design spec](../../docs/superpowers/specs/2026-08-12-model-gateway-design.md)
for the full scope boundary.

## Install

```bash
npm install
```

## Quick start

```js
const { Gateway } = require('./src/gateway.js');
const { createTierPolicy } = require('./src/tier-policy.js');
const { createBreaker } = require('./src/breaker.js');
const { createBudget } = require('./src/budget.js');
const { createStore } = require('./src/store.js');
const { createTelemetry } = require('./src/telemetry.js');

const gateway = new Gateway({
  tierPolicy: createTierPolicy({ quick: { chain: ['flash'], gate: false } }),
  breaker: createBreaker(),
  budget: createBudget(),
  store: createStore('./gateway-state.db'),
  telemetry: createTelemetry('./gateway-telemetry.jsonl'),
  providers: new Map([['flash', { call: async (input) => ({ text: await myFlashCall(input), cost: 0.0001 }) }]]),
});

const result = await gateway.route('summarize this', 'quick', { tag: 'my-app' });
```

## Demo

```bash
npm run demo
```

Runs 20 calls of synthetic traffic across two mock providers, induces a
mid-run failure, and writes `demo/output/dashboard.html`.

## Tests

```bash
npm test
```

## Design decisions

See [the design spec](../../docs/superpowers/specs/2026-08-12-model-gateway-design.md)
and [the implementation plan](../../docs/superpowers/plans/2026-08-12-model-gateway-plan.md).
```

- [x] **Step 7: Commit**

```bash
git add packages/model-gateway/src/report.js packages/model-gateway/src/report.test.js packages/model-gateway/README.md
git commit -m "model-gateway: add report/dashboard + package README"
```

---

### Task 9: Fix `guard.js`'s contract (and the Gemini bug it was hiding)

**Files:**
- Modify: `code/guard.js` (full rewrite, same file)
- Modify: `code/gemini.js:34-51` (the `ask` function)
- Modify: `code/test-guard.js` (full rewrite, same file)

**Interfaces:**
- Produces: `guard(action: string, level?: string) -> {blocked: boolean, reason?: string}` (was `(action, level, fn)` accepted-but-`fn`-ignored). `isStopped() -> boolean` (newly exported — `code/scheduler.js:11` already imports this name from `guard.js`, but today's `guard.js` doesn't export it, so `scheduler.js`'s `isStopped()` early-exit call currently throws `TypeError: isStopped is not a function` the moment `runGoal()` runs. This task fixes that latent crash as a side effect of the contract change).

**Why this matters beyond the design spec:** today's `guard.js` accepts a third `fn` argument (as called by `gemini.js` and `test-guard.js`) but never invokes it — it just returns `{executed: true, action}` immediately. That means `gemini.js`'s `ask()` currently returns `{executed: true, action: 'gemini_call'}` instead of the actual model response, silently, on every call. This task both simplifies the contract per the spec and fixes that bug — `ask()` will call `guard()` as a preflight, then do the real fetch itself.

- [x] **Step 1: Write the failing test for the new contract**

```js
// code/test-guard.js (replaces the existing file)
const { test, finish, assert } = require('./test-helper.js');
const fs = require('fs');
const path = require('path');
const { guard, isStopped } = require('./guard.js');

const STOP_FILE = path.join(__dirname, '..', '.jarvis-x-STOP');

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
```

- [x] **Step 2: Run to verify it fails against today's `guard.js`**

Run: `node code/test-guard.js`
Expected: FAIL on the first assertion — today's `guard()` returns `{executed: true, action: 'test_action'}`, not `{blocked: false}`.

- [x] **Step 3: Rewrite `guard.js`**

```js
// code/guard.js
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'actions.jsonl');
const STOP_FILE = path.join(__dirname, '..', '.jarvis-x-STOP');

const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function isStopped() {
  return fs.existsSync(STOP_FILE);
}

// Pure preflight check: may this action proceed? Never executes anything --
// callers (the gateway's route(), or scheduler.js's own action-execution
// block) own running the call themselves after this returns.
function guard(action, level = 'quick') {
  if (isStopped()) {
    console.error('⛔ Kill switch active – action blocked');
    return { blocked: true, reason: 'STOP file present' };
  }

  const entry = { timestamp: new Date().toISOString(), action, level, pid: process.pid };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');

  return { blocked: false };
}

module.exports = { guard, isStopped };
```

- [x] **Step 4: Fix `gemini.js`'s `ask()` to preflight-check then execute itself**

In `code/gemini.js`, replace lines 34-51 (the whole `ask` function):

```js
async function ask(prompt, tier = 'flash') {
  const model = MODELS[tier];
  if (!model) throw new Error('unknown tier: ' + tier);

  const check = guard('gemini_call', `${tier}:${model}`);
  if (check.blocked) throw new Error(`blocked: ${check.reason}`);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': loadKey() },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('no text in response');
  return text;
}
```

(The rest of `code/gemini.js` — `loadKey`, `MODELS`, `askFallback`, the `require.main` block, `module.exports` — is unchanged.)

- [x] **Step 5: Run to verify the new tests pass**

Run: `node code/test-guard.js`
Expected: all 4 assertions pass, `Passed: 4, Failed: 0`

- [x] **Step 6: Manually verify the Gemini bugfix (requires a real API key in `~/.jarvis-x/.env`)**

Run: `node code/gemini.js flash "Say OK and nothing else."`
Expected: prints an actual model reply (e.g. `OK`), not `{"executed":true,"action":"gemini_call"}`. If no key is configured, this step is skipped — Task 10's adapter test covers the contract with a mock instead.

- [x] **Step 7: Commit**

```bash
git add code/guard.js code/gemini.js code/test-guard.js
git commit -m "guard.js: simplify to a pure preflight check, fixing the silently-broken Gemini call path"
```

---

### Task 10: `code/gateway-adapter.js` — the jarvis-x glue

**Files:**
- Create: `code/gateway-adapter.js`
- Test: `code/test-gateway-adapter.js`

**Interfaces:**
- Consumes: `Gateway`, `createTierPolicy`, `createBreaker`, `createBudget`, `createStore`, `createTelemetry` from `packages/model-gateway/src/*` (Tasks 1–6); `guard` from `code/guard.js` (Task 9); `ask` from `code/gemini.js` and `code/local.js` (unchanged).
- Produces: `classifyTier(input: {action?, prompt?, level?}) -> string` (ported verbatim from `code/router.js`'s `classify`, plus the new `'local'` tier short-circuit via `level`). `ask(input: {action?, prompt: string, level?}, options?: {tag?: string}) -> Promise<GatewayRouteResult>` (same result shape Task 6's `Gateway.route()` returns) — this is what `agent.js`, `query.js`, and `scheduler.js` (Task 11) call instead of importing `router.js`/`gemini.js`/`local.js` directly. `getGateway() -> Gateway` (exposed for tests to inject a fresh instance per test via a resettable module — see Step 1).

**Design note carried into this task:** the spec's Data Flow describes providers "in the chain," and router.js's chain values (`flash`, `pro`, `max`) are Gemini's own model tiers — so each becomes its own Provider (calling `gemini.ask(prompt, tier)` directly, not `askFallback`, since the gateway now owns the chain-walk). `local.js` (Ollama) becomes a fourth, single-entry tier (`'local'`) rather than being folded into the Gemini chain — it's a different model with a different cost/quality profile, and today's codebase never mixed the two. This keeps `query.js`'s and `agent.js`'s `BACKEND=local` behavior observably unchanged while still routing through the gateway (telemetry, budget, breaker all now see local calls too).

- [ ] **Step 1: Write the failing tests**

```js
// code/test-gateway-adapter.js
const { test, finish, assert } = require('./test-helper.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const STOP_FILE = path.join(__dirname, '..', '.jarvis-x-STOP');
if (fs.existsSync(STOP_FILE)) fs.unlinkSync(STOP_FILE); // clean slate

// Fresh module + fresh on-disk state per require, so tests don't share a
// singleton Gateway (and don't touch the real logs/ directory).
function freshAdapter() {
  delete require.cache[require.resolve('./gateway-adapter.js')];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-adapter-test-'));
  process.env.JX_GATEWAY_STATE_DIR = dir;
  return require('./gateway-adapter.js');
}

test('classifyTier ports router.js\'s heuristic: consequential action wins', () => {
  const { classifyTier } = freshAdapter();
  assert.strictEqual(classifyTier({ action: 'shell', prompt: 'rm something' }), 'consequential');
});

test('classifyTier: hard hints route to "hard"', () => {
  const { classifyTier } = freshAdapter();
  assert.strictEqual(classifyTier({ prompt: 'why is the agent picking the wrong action' }), 'hard');
});

test('classifyTier: plain prompts default to "quick"', () => {
  const { classifyTier } = freshAdapter();
  assert.strictEqual(classifyTier({ prompt: 'what time is it' }), 'quick');
});

test('classifyTier: an explicit level short-circuits the heuristic, including "local"', () => {
  const { classifyTier } = freshAdapter();
  assert.strictEqual(classifyTier({ prompt: 'anything', level: 'local' }), 'local');
});

test('ask() blocks and never touches a provider when the STOP file is present', async () => {
  const { ask } = freshAdapter();
  fs.writeFileSync(STOP_FILE, '');
  try {
    const result = await ask({ prompt: 'hi', level: 'quick' }, { tag: 'test' });
    assert.strictEqual(result.blocked, true);
    assert.strictEqual(result.reason, 'STOP file present');
  } finally {
    fs.unlinkSync(STOP_FILE);
  }
});

finish();
```

- [ ] **Step 2: Run to verify failure**

Run: `node code/test-gateway-adapter.js`
Expected: FAIL — `Cannot find module './gateway-adapter.js'`

- [ ] **Step 3: Implement**

```js
// code/gateway-adapter.js
const path = require('path');
const { Gateway } = require('../packages/model-gateway/src/gateway.js');
const { createTierPolicy } = require('../packages/model-gateway/src/tier-policy.js');
const { createBreaker } = require('../packages/model-gateway/src/breaker.js');
const { createBudget } = require('../packages/model-gateway/src/budget.js');
const { createStore } = require('../packages/model-gateway/src/store.js');
const { createTelemetry } = require('../packages/model-gateway/src/telemetry.js');
const { guard } = require('./guard.js');

// Ported verbatim from code/router.js -- tier *classification* is jarvis-x
// business logic (the design spec keeps it out of the package), but the
// *behavior* per tier (chain + gate) is exactly router.js's old ROUTE table.
const CONSEQUENTIAL = new Set(['write', 'shell', 'trade']);
const HARD_HINTS = /\b(plan|design|debug|why|analyz|strateg|refactor|architect|compare)\b/i;

function classifyTier({ action = null, prompt = '', level = null } = {}) {
  if (level) return level; // caller (or an explicit 'local') wins outright
  if (action && CONSEQUENTIAL.has(action)) return 'consequential';
  if (HARD_HINTS.test(prompt) || prompt.length > 600) return 'hard';
  return 'quick';
}

const JARVIS_TIER_POLICY = {
  quick: { chain: ['flash'], gate: false },
  hard: { chain: ['pro', 'flash'], gate: false },
  consequential: { chain: ['max', 'pro', 'flash'], gate: true },
  local: { chain: ['local'], gate: false },
};

// Static per-call cost table -- spec's Non-goals explicitly rules out real
// cost estimation for v1, so these are rough $/call placeholders, not
// $/token accounting.
const COST_PER_CALL = { flash: 0.0001, pro: 0.001, max: 0.01, local: 0 };

function makeGeminiProvider(tier) {
  const { ask } = require('./gemini.js');
  return {
    async call(prompt) {
      const text = await ask(prompt, tier);
      return { text, cost: COST_PER_CALL[tier] };
    },
  };
}

function makeLocalProvider() {
  const { ask } = require('./local.js');
  return {
    async call(prompt) {
      const text = await ask(prompt);
      return { text, cost: COST_PER_CALL.local };
    },
  };
}

function makeGuardCheck() {
  return ({ tier, tag }) => guard(tag || 'gateway_call', tier);
}

function stateDir() {
  return process.env.JX_GATEWAY_STATE_DIR || path.join(__dirname, '..', 'logs');
}

let gatewayInstance = null;

function getGateway() {
  if (gatewayInstance) return gatewayInstance;
  const dir = stateDir();
  require('fs').mkdirSync(dir, { recursive: true });
  gatewayInstance = new Gateway({
    tierPolicy: createTierPolicy(JARVIS_TIER_POLICY),
    guardCheck: makeGuardCheck(),
    breaker: createBreaker(),
    budget: createBudget(),
    store: createStore(path.join(dir, 'gateway-state.db')),
    telemetry: createTelemetry(path.join(dir, 'gateway-telemetry.jsonl')),
    providers: new Map([
      ['flash', makeGeminiProvider('flash')],
      ['pro', makeGeminiProvider('pro')],
      ['max', makeGeminiProvider('max')],
      ['local', makeLocalProvider()],
    ]),
  });
  return gatewayInstance;
}

async function ask(input, options = {}) {
  const tier = classifyTier(input);
  const prompt = typeof input === 'string' ? input : input.prompt;
  return getGateway().route(prompt, tier, options);
}

module.exports = { ask, classifyTier, JARVIS_TIER_POLICY, getGateway };
```

- [ ] **Step 4: Run to verify pass**

Run: `node code/test-gateway-adapter.js`
Expected: `Passed: 5, Failed: 0`

- [ ] **Step 5: Commit**

```bash
git add code/gateway-adapter.js code/test-gateway-adapter.js
git commit -m "code: add gateway-adapter, jarvis-x's glue to packages/model-gateway"
```

---

### Task 11: Wire `agent.js`, `query.js`, `scheduler.js` to the adapter; delete dead code

**Files:**
- Modify: `code/agent.js:1-19` (imports + the `ask` helper)
- Modify: `code/query.js` (full file — swap `local.js` for the adapter)
- Modify: `code/scheduler.js:1-16,52-55` (imports + the `ask` helper)
- Delete: `code/models.js`
- Delete: `code/universal-router.js`

**Interfaces:**
- Consumes: `ask`, `classifyTier` from `code/gateway-adapter.js` (Task 10).
- Produces: no new exports — this task only changes call sites. `voice.js` needs **no changes**: it never imports `router.js`/`gemini.js`/`local.js` directly, it calls `agent.js`'s `propose()`, which already goes through the adapter after this task.

- [ ] **Step 1: Update `code/agent.js`**

Replace lines 1-19:
```js
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { ask: gatewayAsk } = require('./gateway-adapter.js');
const { validate } = require('./validate.js');
const { observe, forPrompt } = require('./memory.js');
const { reEscape, parseJSONLoose, execute, confirm } = require('./lib.js');
const { readFile, writeFile, listDir } = require('./exec.js');

const BACKEND = process.env.JX_BACKEND || 'local';

const ask = async (prompt) => {
  const level = BACKEND === 'local' ? 'local' : 'consequential';
  const result = await gatewayAsk({ prompt, level }, { tag: 'agent' });
  if (result.blocked) throw new Error(`blocked: ${result.reason}`);
  return result.text;
};
```
(Everything from `function buildPrompt(goal)` onward is unchanged — `propose()`'s `let raw = await ask(prompt); if (typeof raw !== 'string') raw = raw?.text || JSON.stringify(raw);` still works since `ask()` here now always resolves to a string or throws.)

- [ ] **Step 2: Manually verify `agent.js` still runs**

Run: `JX_BACKEND=local node code/agent.js "list files in code"` (requires Ollama running locally; skip if unavailable and rely on Step 6's automated suite)
Expected: same proposal/execution behavior as before this task — a `list` action proposed and auto-approved.

- [ ] **Step 3: Update `code/query.js`**

Full replacement:
```js
#!/usr/bin/env node
// CLI entry point: sends a one-off prompt (plus Guidelines.md) to the local model and logs the exchange.
const { ask } = require('./gateway-adapter.js');
const fs = require('fs');
const path = require('path');

const LOG = path.join(__dirname, '..', 'logs', 'decisions.jsonl');

async function main() {
  const prompt = process.argv.slice(2).join(' ');
  if (!prompt) return console.log('Usage: node code/query.js "your question"');

  const guidelines = fs.readFileSync(
    path.join(__dirname, '..', 'knowledge', 'Guidelines.md'), 'utf8'
  );

  const full = `You are Jarvis X. Operate within these constraints:\n\n${guidelines}\n\nUser: ${prompt}`;

  const result = await ask({ prompt: full, level: 'local' }, { tag: 'query' });
  if (result.blocked) { console.error('Blocked:', result.reason); return; }
  console.log(`\n${result.text}\n`);

  fs.appendFileSync(LOG, JSON.stringify({
    timestamp: new Date().toISOString(), model: result.provider, prompt, answer: result.text
  }) + '\n');
}

main().catch(e => console.error('Error:', e.message));
```

- [ ] **Step 4: Update `code/scheduler.js`**

Replace line 11 (`const { guard, isStopped } = require('./guard.js');`) and line 15 (`const { run: route } = require('./router.js');`) with:
```js
const { guard, isStopped } = require('./guard.js');
const { ask: gatewayAsk } = require('./gateway-adapter.js');
```
(remove the old `const { run: route } = require('./router.js');` line entirely)

Replace lines 52-55 (the `ask` helper):
```js
async function ask(prompt) {
  const result = await gatewayAsk({ prompt, level: 'hard' }, { tag: 'scheduler' });
  if (result.blocked) throw new Error(`blocked: ${result.reason}`);
  return { text: result.text, model: `${result.provider}${result.degraded ? '(degraded)' : ''}` };
}
```
(The rest of `scheduler.js` — `loadSchedules`, `logRun`, `queueForReview`, `runGoal`, `main` — is unchanged. `runGoal`'s existing `guard('scheduler_act', ...)` call on the *action-execution* side, separate from the model call, is untouched by this task — it still wraps `execute(a)`/`queueForReview`/`logRun`, which is a different concern from routing the LLM call.)

- [ ] **Step 5: Delete the dead files**

```bash
git rm code/models.js code/universal-router.js
```

Run: `grep -rn "models\.js\|universal-router" code/ --include='*.js' | grep -v node_modules`
Expected: no output — confirms nothing still imports either file.

- [ ] **Step 6: Run the full jarvis-x test suite**

Run: `node jest-runner.js`
Expected: all `code/test-*.js` files report PASSED, including `test-gateway-adapter.js`, `test-guard.js`, `test-scheduler.js`.

- [ ] **Step 7: Run the package test suite one more time (nothing here should have touched it, this just confirms isolation)**

Run: `cd packages/model-gateway && npm test`
Expected: PASS, same counts as Task 8.

- [ ] **Step 8: Commit**

```bash
git add code/agent.js code/query.js code/scheduler.js
git commit -m "code: route agent/query/scheduler through gateway-adapter, delete dead models.js + universal-router.js"
```

---

## Self-review notes (for whoever executes this plan)

- **Spec coverage:** tier-policy split (Task 1, 10), guard-first ordering (Task 6 test, Task 9), SQLite for live state / JSONL for the log (Tasks 4, 5), budget shape (Task 3), dead-code deletion (Task 11), tests default to mock providers (Task 7), gate invariant (Task 6 test) — all covered. The four "Open items for the implementation plan" the spec deferred are resolved here: SQLite schema (Task 4, Step 3), telemetry line schema (Task 5, Step 1 test + Task 6), default tier-policy shape vs. jarvis-x's real config (Task 7 uses generic demo tier names; Task 10 owns the real `flash`/`pro`/`max`/`local` config), and day-by-day sequencing (the task order above: package core → adapter → dead-code removal, no demo/report step needed before extraction since this plan doesn't schedule the `git subtree split` extraction — that's explicitly "not scheduled to a specific day" per the spec).
- **`local` tier is a plan-level addition, not literally in the spec text** — the spec's ROUTE-derived chains only cover `quick`/`hard`/`consequential` (all Gemini). Folding `local.js` in as its own tier is what makes decision #5 ("no longer called directly by ... `query.js`") true without silently switching `query.js` from Ollama to Gemini. Flagged here so a reviewer can push back if they'd rather leave `query.js` calling `local.js` directly and interpret decision #5 more narrowly.
- **Task 9 fixes a real, previously-undiscovered bug** (`gemini.js`'s `ask()` returning `{executed, action}` instead of model text, and `scheduler.js`'s `isStopped()` crashing since `guard.js` never exported it) — both are side effects of the contract simplification the spec already called for, not scope creep.
