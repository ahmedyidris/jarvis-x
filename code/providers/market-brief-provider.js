const BaseProvider = require('./base-provider');

const SYMBOLS = { 'sp500': 'SPY', 'nasdaq100': 'QQQ' };

const MOCK = {
  'sp500': { symbol: 'sp500', price: 4780.5, changePercent24h: 0.4 },
  'nasdaq100': { symbol: 'nasdaq100', price: 16800.2, changePercent24h: 0.6 },
  '10y-yield': { symbol: '10y-yield', value: 4.15, unit: 'percent' }
};

class MarketBriefProvider extends BaseProvider {
  constructor(options = {}) {
    super('market', { rateLimit: { requests: 5, window: 60000 } });
    this.baseUrl = 'https://www.alphavantage.co/query';
    this.apiKey = process.env.ALPHAVANTAGE_API_KEY || '';
    this.timeoutMs = options.timeoutMs || 10000;
    this.useMock = options.useMock === true || !this.apiKey;
  }

  async fetch(key) {
    await this.checkRateLimit();

    if (this.useMock) {
      if (!MOCK[key]) throw new Error(`Unknown market key: ${key}`);
      const why = this.apiKey ? 'forced' : 'ALPHAVANTAGE_API_KEY not set';
      this.logRequest(key, `MOCK (${why})`, MOCK[key]);
      return { ...MOCK[key], timestamp: new Date().toISOString(), source: 'mock' };
    }

    const result = key === '10y-yield'
      ? await this.fetchYield()
      : await this.fetchQuote(key);

    this.logRequest(key, 'LIVE', result);
    return result;
  }

  async fetchQuote(key) {
    const sym = SYMBOLS[key];
    if (!sym) throw new Error(`Unknown market key: ${key}`);

    const json = await this.getJson(
      `${this.baseUrl}?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${this.apiKey}`
    );
    const q = json['Global Quote'];
    if (!q || !q['05. price']) {
      throw new Error(`Alpha Vantage returned no quote for ${sym}`);
    }

    return {
      symbol: key,
      proxy: sym,
      price: parseFloat(q['05. price']),
      changePercent24h: parseFloat(String(q['10. change percent'] || '').replace('%', '')),
      tradingDay: q['07. latest trading day'] || null,
      timestamp: new Date().toISOString(),
      source: 'alphavantage'
    };
  }

  async fetchYield() {
    const json = await this.getJson(
      `${this.baseUrl}?function=TREASURY_YIELD&interval=daily&maturity=10year&apikey=${this.apiKey}`
    );
    const latest = (json.data || []).find(d => d.value && d.value !== '.');
    if (!latest) throw new Error('Alpha Vantage returned no treasury yield');

    return {
      symbol: '10y-yield',
      value: parseFloat(latest.value),
      unit: 'percent',
      date: latest.date,
      timestamp: new Date().toISOString(),
      source: 'alphavantage'
    };
  }

  async getJson(url) {
    // Alpha Vantage free tier requires >=1s between requests
    const since = Date.now() - (this._lastCall || 0);
    if (since < 1200) await new Promise(r => setTimeout(r, 1200 - since));
    this._lastCall = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
      const json = await res.json();
      if (json.Note) throw new Error('Alpha Vantage rate limit (25/day free tier)');
      if (json.Information) throw new Error(`Alpha Vantage: ${json.Information}`);
      if (json['Error Message']) throw new Error(`Alpha Vantage: ${json['Error Message']}`);
      return json;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`Alpha Vantage timeout after ${this.timeoutMs}ms`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = MarketBriefProvider;
