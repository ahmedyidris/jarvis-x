const BaseProvider = require('./base-provider');
class MarketBriefProvider extends BaseProvider {
  constructor() {
    super('market-brief', { rateLimit: { requests: 10, window: 86400000 } });
  }
  async fetch(key) {
    await this.checkRateLimit();
    const mockResponses = {
      'sp500': { symbol: 'GSPC', price: 5800.25, change: 0.5, timestamp: new Date().toISOString() },
      'nasdaq100': { symbol: 'NDX', price: 18500.75, change: 1.2, timestamp: new Date().toISOString() },
      '10y-yield': { symbol: '10Y', price: 4.15, change: -0.05, timestamp: new Date().toISOString() }
    };
    if (!mockResponses[key]) throw new Error(`Unknown key: ${key}`);
    this.logRequest(key, 'FETCH', mockResponses[key]);
    return mockResponses[key];
  }
}
module.exports = MarketBriefProvider;
