const BaseProvider = require('./base-provider');

class MarketBriefProvider extends BaseProvider {
  constructor() {
    super('market-brief', { rateLimit: { requests: 10, window: 86400000 } });
    this.apiKey = process.env.MARKET_API_KEY || null;
  }

  async fetch(key) {
    await this.checkRateLimit();
    const mockData = {
      'sp500': { value: 5800, change: 0.5 },
      'nasdaq100': { value: 18500, change: 1.2 },
      '10y-yield': { value: 4.15, change: -0.05 }
    };
    if (!mockData[key]) throw new Error(`Unknown market key: ${key}`);
    this.logRequest(key, 'FETCH', mockData[key]);
    return mockData[key];
  }
}

module.exports = MarketBriefProvider;
