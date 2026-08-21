const BaseProvider = require('./base-provider');

class NewsProvider extends BaseProvider {
  constructor() {
    super('news', { rateLimit: { requests: 100, window: 86400000 } });
    this.apiKey = process.env.NEWS_API_KEY || null;
  }

  async fetch(key) {
    await this.checkRateLimit();
    const mockData = {
      'fed-announcement': 'Federal Reserve maintains interest rates at 5.25-5.50%',
      'earnings-season': 'Tech sector earnings beat expectations by 8% average',
      'geopolitical-risk': 'Red Sea shipping disruptions continue'
    };
    if (!mockData[key]) throw new Error(`Unknown news key: ${key}`);
    this.logRequest(key, 'FETCH', mockData[key]);
    return mockData[key];
  }
}

module.exports = NewsProvider;
