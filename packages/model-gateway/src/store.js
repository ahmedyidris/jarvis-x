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
