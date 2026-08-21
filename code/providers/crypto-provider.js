const BaseProvider = require('./base-provider');

class CryptoProvider extends BaseProvider {
  constructor() {
    super('crypto', { rateLimit: { requests: 50, window: 60000 } });
    this.baseUrl = process.env.CRYPTO_API_URL || 'https://api.coingecko.com/api/v3';
  }

  async fetch(key) {
    await this.checkRateLimit();
    
    const mockResponses = {
      'btc': { id: 'bitcoin', symbol: 'btc', price: 42500, changePercent24h: 2.3, marketCap: 833000000000, timestamp: new Date().toISOString() },
      'eth': { id: 'ethereum', symbol: 'eth', price: 2250, changePercent24h: 1.5, marketCap: 270000000000, timestamp: new Date().toISOString() },
      'usdc': { id: 'usd-coin', symbol: 'usdc', price: 1.0, changePercent24h: 0.01, marketCap: 24000000000, timestamp: new Date().toISOString() },
      'btc-dominance': { dominance: 52.3, change24h: 0.5, timestamp: new Date().toISOString() }
    };

    if (!mockResponses[key]) throw new Error(`Unknown crypto key: ${key}`);
    
    this.logRequest(key, 'FETCH', mockResponses[key]);
    return mockResponses[key];
  }

  async fetchReal(ids) {
    // Real CoinGecko call (free tier, no key needed)
    // const response = await fetch(`${this.baseUrl}/simple/price?ids=${ids}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true`);
    // return response.json();
  }
}

module.exports = CryptoProvider;
