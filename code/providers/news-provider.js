const BaseProvider = require('./base-provider');

class NewsProvider extends BaseProvider {
  constructor() {
    super('news', { rateLimit: { requests: 100, window: 86400000 } });
    this.apiKey = process.env.NEWS_API_KEY || null;
    this.baseUrl = process.env.NEWS_API_URL || 'https://newsapi.org/v2/everything';
  }

  async fetch(key) {
    await this.checkRateLimit();
    
    const mockResponses = {
      'fed-announcement': { title: 'Federal Reserve holds rates steady', source: 'Reuters', timestamp: new Date().toISOString(), url: '#' },
      'earnings-season': { title: 'Tech earnings beat expectations by 8%', source: 'Bloomberg', timestamp: new Date().toISOString(), url: '#' },
      'geopolitical-risk': { title: 'Red Sea shipping disruptions escalate', source: 'AP News', timestamp: new Date().toISOString(), url: '#' },
      'market-volatility': { title: 'S&P 500 rebounds on positive data', source: 'CNBC', timestamp: new Date().toISOString(), url: '#' },
      'inflation-report': { title: 'Core inflation shows signs of cooling', source: 'WSJ', timestamp: new Date().toISOString(), url: '#' }
    };

    if (!mockResponses[key]) throw new Error(`Unknown news key: ${key}`);
    
    this.logRequest(key, 'FETCH', mockResponses[key]);
    return mockResponses[key];
  }

  async fetchReal(query) {
    if (!this.apiKey) throw new Error('NEWS_API_KEY not set');
    // const response = await fetch(`${this.baseUrl}?q=${query}&apiKey=${this.apiKey}`);
    // return response.json();
  }
}

module.exports = NewsProvider;
