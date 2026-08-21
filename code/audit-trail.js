/**
 * Audit trail for data fetches (in-memory, no sqlite3 dependency)
 * Logs every data fetch, accessible for debugging
 */

class AuditTrail {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000; // Keep last 1000 entries
  }

  async log(entry) {
    const logEntry = {
      id: this.logs.length + 1,
      timestamp: new Date().toISOString(),
      ...entry
    };
    this.logs.push(logEntry);
    
    // Keep only last N entries
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    
    return logEntry.id;
  }

  async query(filter = {}) {
    let results = [...this.logs];
    
    if (filter.provider) {
      results = results.filter(r => r.provider === filter.provider);
    }
    if (filter.startDate) {
      results = results.filter(r => r.timestamp >= filter.startDate);
    }
    
    return results.reverse().slice(0, 100);
  }

  close() {
    return Promise.resolve();
  }

  getStats() {
    return {
      totalLogs: this.logs.length,
      oldestLog: this.logs[0]?.timestamp,
      newestLog: this.logs[this.logs.length - 1]?.timestamp
    };
  }
}

module.exports = AuditTrail;
