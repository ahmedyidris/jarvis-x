const BaseProvider = require('./base-provider');

// EIA v2 series IDs
const SERIES = {
  'crude-oil-wti': 'RWTC',
  'crude-oil-brent': 'RBRTE'
};

const MOCK = {
  'crude-oil-wti':   { symbol: 'crude-oil-wti',   price: 73.2,  unit: 'USD/barrel' },
  'crude-oil-brent': { symbol: 'crude-oil-brent', price: 78.1,  unit: 'USD/barrel' },
  'natural-gas':     { symbol: 'natural-gas',     price: 2.65,  unit: 'USD/MMBtu' },
  'gold':            { symbol: 'gold',            price: 2050.0, unit: 'USD/oz' }
};

class EnergyProvider extends BaseProvider {
  constructor(options = {}) {
    super('energy', { rateLimit: { requests: 20, window: 60000 } });
    this.baseUrl = 'https://api.eia.gov/v2';
    this.apiKey = process.env.EIA_API_KEY || '';
    this.timeoutMs = options.timeoutMs || 10000;
    this.useMock = options.useMock === true || !this.apiKey;
  }

  async fetch(key) {
    await this.checkRateLimit();

    // EIA has no gold series - always mock, flagged honestly
    if (key === 'gold') {
      this.logRequest(key, 'MOCK (no EIA gold series)', MOCK[key]);
      return { ...MOCK[key], timestamp: new Date().toISOString(), source: 'mock',
               note: 'EIA does not publish gold; needs a metals provider' };
    }

    if (this.useMock) {
      if (!MOCK[key]) throw new Error(`Unknown energy key: ${key}`);
      const why = this.apiKey ? 'forced' : 'EIA_API_KEY not set';
      this.logRequest(key, `MOCK (${why})`, MOCK[key]);
      return { ...MOCK[key], timestamp: new Date().toISOString(), source: 'mock' };
    }

    const result = key === 'natural-gas'
      ? await this.fetchSeries('natural-gas', 'natural-gas/pri/fut/data', 'RNGWHHD', 'USD/MMBtu')
      : await this.fetchSeries(key, 'petroleum/pri/spt/data', SERIES[key], 'USD/barrel');

    this.logRequest(key, 'LIVE', result);
    return result;
  }

  async fetchSeries(key, route, seriesId, unit) {
    if (!seriesId) throw new Error(`Unknown energy key: ${key}`);
    const url = `${this.baseUrl}/${route}/?api_key=${this.apiKey}` +
      `&frequency=daily&data[0]=value&facets[series][]=${seriesId}` +
      `&sort[0][column]=period&sort[0][direction]=desc&length=1`;

    const json = await this.getJson(url);
    const row = json?.response?.data?.[0];
    if (!row || row.value === undefined || row.value === null) {
      throw new Error(`EIA returned no data for ${seriesId}`);
    }

    return {
      symbol: key,
      price: parseFloat(row.value),
      unit: row['units'] || unit,
      period: row.period || null,
      timestamp: new Date().toISOString(),
      source: 'eia'
    };
  }

  async getJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
      if (res.status === 403) throw new Error('EIA rejected the API key (403)');
      if (!res.ok) throw new Error(`EIA HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(`EIA: ${json.error}`);
      return json;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`EIA timeout after ${this.timeoutMs}ms`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = EnergyProvider;
