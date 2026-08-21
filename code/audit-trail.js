const sqlite3 = require('sqlite3').verbose();
class AuditTrail {
  constructor(dbPath = 'logs/audit-trail.db') {
    this.dbPath = dbPath;
    this.db = new sqlite3.Database(dbPath);
    this.db.run(`CREATE TABLE IF NOT EXISTS data_fetches (
      id INTEGER PRIMARY KEY, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      provider TEXT, key TEXT, value TEXT, status TEXT, error TEXT, latency_ms INTEGER
    )`);
  }
  async log(entry) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO data_fetches (provider, key, value, status, error, latency_ms) VALUES (?, ?, ?, ?, ?, ?)`,
        [entry.provider, entry.key, JSON.stringify(entry.value), entry.status, entry.error, entry.latency],
        function(err) { if (err) reject(err); else resolve(this.lastID); }
      );
    });
  }
  close() {
    return new Promise((resolve) => { if (this.db) this.db.close(resolve); else resolve(); });
  }
}
module.exports = AuditTrail;
