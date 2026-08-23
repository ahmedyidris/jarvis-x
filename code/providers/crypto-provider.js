const BaseProvider = require('./base-provider');

const COIN_IDS = {
  'btc': 'bitcoin',
  'eth': 'ethereum',
  'usdc': 'usd-coin',
  'sol': 'solana',
  'xrp': 'ripple'
};

const MOCK = {
  'btc': { id: 'bitcoin', symbol: 'btc', price: 42500, changePercent24h: 2.3, marketCap: 833000000000 },
  'eth': { id: 'ethereum', symbol: 'eth', price: 2250, changePercent24h: 1.5, marketCap: 270000000000 },
  'usdc': { id: 'usd-coin', symbol: 'usdc', price: 1.0, changePercent24h: 0.01, marketCap: 24000000000 },
  'sol': { id: 'solana', symbol: 'sol', price: 140, changePercent24h: -1.2, marketCap: 65000000000 },
  'xrp': { id: 'ripple', symbol: 'xrp', price: 0.62, changePercent24h: 0.8, marketCap: 35000000000 },
  'btc-dominance': { dominance: 52.3, change24h: 0.5 }
};

class CryptoProvider extends BaseProvider {
  constructor(options = {}) {
    super('crypto', { rateLimit: { requests: 10, window: 60000 } });
    this.baseUrl = process.env.CRYPTO_API_URL || 'https://api.coingecko.com/api/v3';
    this.timeoutMs = options.timeoutMs || 8000;
    this.useMock = options.useMock === true;
  }

  async fetch(key) {
    await this.checkRateLimit();

    if (this.useMock) {
      if (!MOCK[key]) throw new Error(`Unknown crypto key: ${key}`);
      this.logRequest(key, 'MOCK', MOCK[key]);
      return { ...MOCK[key], timestamp: new Date().toISOString(), source: 'mock' };
    }

    const result = key === 'btc-dominance'
      ? await this.fetchDominance()
      : await this.fetchPrice(key);

    this.logRequest(key, 'LIVE', result);
    return result;
  }

  async fetchPrice(key) {
    const coinId = COIN_IDS[key];
    if (!coinId) throw new Error(`Unknown crypto key: ${key}`);

    const url = `${this.baseUrl}/simple/price?ids=${coinId}` +
      `&vs_currencies=usd&include_market_cap=true&include_24hr_change=true`;

    const json = await this.getJson(url);
    const row = json[coinId];
    if (!row || typeof row.usd !== 'number') {
      throw new Error(`CoinGecko returned no price for ${coinId}`);
    }

    return {
      id: coinId,
      symbol: key,
      price: row.usd,
      changePercent24h: row.usd_24h_change ?? null,
      marketCap: row.usd_market_cap ?? null,
      timestamp: new Date().toISOString(),
      source: 'coingecko'
    };
  }

  async fetchDominance() {
    const json = await this.getJson(`${this.baseUrl}/global`);
    const pct = json?.data?.market_cap_percentage?.btc;
    if (typeof pct !== 'number') {
      throw new Error('CoinGecko returned no BTC dominance');
    }
    return {
      dominance: pct,
      change24h: json.data.market_cap_change_percentage_24h_usd ?? null,
      timestamp: new Date().toISOString(),
      source: 'coingecko'
    };
  }

  async getJson(url) {
    // CoinGecko's real anonymous-tier rate limit is a burst limit, not just
    // a per-minute count -- 6 sequential calls fired back-to-back (adding
    // sol/xrp/usdc/btc-dominance to the snapshot surfaced this) tripped a
    // real 429 even though our own checkRateLimit() cap (10 req/60s) had
    // budget left. Same fix as market-brief-provider.js already uses for
    // Alpha Vantage: throttle to one call per ~1.1s per provider instance.
    const since = Date.now() - (this._lastCall || 0);
    if (since < 1100) await new Promise(r => setTimeout(r, 1100 - since));
    this._lastCall = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json', 'User-Agent': 'jarvis-x' }
      });
      if (res.status === 429) throw new Error('CoinGecko rate limit (429)');
      if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`CoinGecko timeout after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = CryptoProvider;
