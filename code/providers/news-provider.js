const BaseProvider = require('./base-provider');

const QUERIES = {
  'fed-announcement':  'Federal Reserve OR FOMC OR "interest rates"',
  'earnings-season':   'earnings report OR quarterly results',
  'geopolitical-risk': 'geopolitical risk OR sanctions OR conflict'
};

const MOCK = {
  'fed-announcement':  { title: '[MOCK] Fed holds rates steady', outlet: 'mock-wire' },
  'earnings-season':   { title: '[MOCK] Earnings season beats expectations', outlet: 'mock-wire' },
  'geopolitical-risk': { title: '[MOCK] Shipping disruptions continue', outlet: 'mock-wire' }
};

class NewsProvider extends BaseProvider {
  constructor(options = {}) {
    super('news', { rateLimit: { requests: 10, window: 60000 } });
    this.baseUrl = 'https://newsapi.org/v2/everything';
    this.apiKey = process.env.NEWSAPI_KEY || '';
    this.timeoutMs = options.timeoutMs || 10000;
    this.useMock = options.useMock === true || !this.apiKey;
  }

  async fetch(key) {
    await this.checkRateLimit();

    if (this.useMock) {
      if (!MOCK[key]) throw new Error(`Unknown news key: ${key}`);
      const why = this.apiKey ? 'forced' : 'NEWSAPI_KEY not set';
      this.logRequest(key, `MOCK (${why})`, MOCK[key]);
      return { key, ...MOCK[key], publishedAt: null, url: null,
               timestamp: new Date().toISOString(), source: 'mock' };
    }

    const q = QUERIES[key];
    if (!q) throw new Error(`Unknown news key: ${key}`);

    const json = await this.getJson(
      `${this.baseUrl}?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=3`
    );
    const top = (json.articles || [])[0];
    if (!top) throw new Error(`NewsAPI returned no articles for ${key}`);

    return {
      key,
      title: top.title,
      outlet: top.source?.name || null,
      url: top.url,
      publishedAt: top.publishedAt,
      headlines: (json.articles || []).slice(0, 3).map(a => a.title),
      timestamp: new Date().toISOString(),
      source: 'newsapi'
    };
  }

  async getJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json', 'X-Api-Key': this.apiKey }
      });
      if (res.status === 401) throw new Error('NewsAPI rejected the key (401)');
      if (res.status === 429) throw new Error('NewsAPI rate limit (429)');
      if (!res.ok) throw new Error(`NewsAPI HTTP ${res.status}`);
      const json = await res.json();
      if (json.status === 'error') throw new Error(`NewsAPI: ${json.message}`);
      return json;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`NewsAPI timeout after ${this.timeoutMs}ms`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = NewsProvider;
