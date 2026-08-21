/**
 * Phase 1B: Data-source abstraction layer
 * Provider-agnostic interface for real-time market/crypto/energy/news data
 * 
 * Design:
 * - Each provider (MarketBriefProvider, CryptoProvider, EnergyProvider, NewsProvider)
 *   extends BaseProvider and implements fetch(), parse(), cache logic
 * - Agent calls getDataPoint(key) → gets {value, fetchedAt, staleness, source}
 * - Agent must check staleness and state it in output ("as of X, data is Y minutes old")
 * - Graceful degradation: "data unavailable as of 2026-08-20 12:34" never "no data"
 * - Rate-limit handling per provider (free tier limits, paid tier docs)
 */

const BaseProvider = require('./providers/base-provider');

class DataLayer {
  constructor() {
    this.providers = new Map();
    this.cache = new Map(); // {key: {value, fetchedAt, provider}}
    this.cacheMaxAge = 300000; // 5 min default, overridable per provider
  }

  /**
   * Register a provider (market, crypto, energy, news)
   */
  registerProvider(name, providerInstance) {
    if (!(providerInstance instanceof BaseProvider)) {
      throw new Error(`Provider ${name} must extend BaseProvider`);
    }
    this.providers.set(name, providerInstance);
    console.log(`[DataLayer] Registered provider: ${name}`);
  }

  /**
   * Get a datapoint with staleness metadata
   * Returns {value, fetchedAt, staleness, source} or null on failure
   */
  async getDataPoint(key, options = {}) {
    const { allowStale = true } = options;

    // Check cache first
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      const age = Date.now() - cached.fetchedAt;
      const staleMs = age - this.cacheMaxAge;

      if (age < this.cacheMaxAge) {
        // Fresh
        return {
          value: cached.value,
          fetchedAt: cached.fetchedAt,
          staleness: 0,
          source: cached.provider
        };
      } else if (allowStale) {
        // Stale but allowed
        return {
          value: cached.value,
          fetchedAt: cached.fetchedAt,
          staleness: staleMs,
          source: cached.provider,
          warning: `Data is ${Math.round(staleMs / 1000)}s stale`
        };
      }
    }

    // Cache miss or stale not allowed — fetch fresh
    const [provider, dataKey] = key.split(':');
    const prov = this.providers.get(provider);

    if (!prov) {
      return {
        value: null,
        error: `No provider registered for "${provider}"`,
        fetchedAt: null
      };
    }

    try {
      const result = await prov.fetch(dataKey);
      const fetchedAt = Date.now();

      // Cache it
      this.cache.set(key, {
        value: result,
        fetchedAt,
        provider: prov.name
      });

      return {
        value: result,
        fetchedAt,
        staleness: 0,
        source: prov.name
      };
    } catch (err) {
      return {
        value: null,
        error: err.message,
        fetchedAt: null,
        source: prov.name
      };
    }
  }

  /**
   * Graceful degradation message for agent
   */
  formatDataUnavailable(key, reason) {
    const now = new Date().toISOString().split('T')[0];
    return `Data unavailable as of ${now}: ${reason}`;
  }

  /**
   * Clear cache (for testing, or forced refresh)
   */
  clearCache(pattern) {
    if (!pattern) {
      this.cache.clear();
      return;
    }
    for (const [key] of this.cache) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }
}

module.exports = DataLayer;
