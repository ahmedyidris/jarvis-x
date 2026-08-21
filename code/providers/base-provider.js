class BaseProvider {
  constructor(name, options = {}) {
    this.name = name;
    this.rateLimit = options.rateLimit || { requests: 60, window: 60000 };
    this.requestLog = [];
  }

  async fetch(key) {
    throw new Error(`${this.name}.fetch() not implemented`);
  }

  async checkRateLimit() {
    const now = Date.now();
    this.requestLog = this.requestLog.filter(t => now - t < this.rateLimit.window);
    if (this.requestLog.length >= this.rateLimit.requests) {
      const oldestRequest = this.requestLog[0];
      const waitTime = this.rateLimit.window - (now - oldestRequest);
      throw new Error(`${this.name} rate limit exceeded. Wait ${Math.ceil(waitTime / 1000)}s`);
    }
    this.requestLog.push(now);
  }

  logRequest(key, status, result) {
    console.log(`[${this.name}] ${status}: ${key}`);
  }
}

module.exports = BaseProvider;
