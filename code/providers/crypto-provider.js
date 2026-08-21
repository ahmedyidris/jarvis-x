const BaseProvider = require('./base-provider');

class CryptoProvider extends BaseProvider {
  constructor() {
    super('crypto', { rateLimit: { requests: 50, window: 60000 } });
  }

  async fetch(key) {
    await this.checkRateLimit();
    const mockData = {
      'btc': { value: 42500, change: 2.3 },
      'eth': { value: 2250, change: 1.5 },
      'btc-market-cap': { value: 833000000000 }
    };
    if (!mockData[key]) throw new Error(`Unknown crypto key: ${key}`);
    this.logRequest(key, 'FETCH', mockData[key]);
    return mockData[key];
  }
}

module.exports = CryptoProvider;
