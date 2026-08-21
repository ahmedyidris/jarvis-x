const BaseProvider = require('./base-provider');

class EnergyProvider extends BaseProvider {
  constructor() {
    super('energy', { rateLimit: { requests: 120, window: 3600000 } });
  }

  async fetch(key) {
    await this.checkRateLimit();
    const mockData = {
      'crude-oil-wti': { value: 78.45, change: 0.35 },
      'gold': { value: 2045, change: -5 },
      'natural-gas': { value: 2.82, change: 0.02 }
    };
    if (!mockData[key]) throw new Error(`Unknown energy key: ${key}`);
    this.logRequest(key, 'FETCH', mockData[key]);
    return mockData[key];
  }
}

module.exports = EnergyProvider;
