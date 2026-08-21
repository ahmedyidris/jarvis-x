/**
 * Integration between agent and data layer
 * Agent calls getDataWithContext() instead of raw getDataPoint()
 * Handles staleness, formats output, logs to audit trail
 */

const DataLayer = require('./data-layer');
const CacheLayer = require('./cache-layer');
const AuditTrail = require('./audit-trail');

class DataLayerIntegration {
  constructor(providers = {}) {
    this.dataLayer = new DataLayer();
    this.cache = new CacheLayer();
    this.audit = new AuditTrail();

    // Register all providers
    Object.entries(providers).forEach(([name, Provider]) => {
      this.dataLayer.registerProvider(name, new Provider());
    });
  }

  /**
   * Get data with full context (staleness, audit, cache)
   * Called by agent when building responses
   */
  async getDataWithContext(key, options = {}) {
    const startTime = Date.now();
    const { allowStale = true, logToAudit = true } = options;

    // Check cache first
    const cacheResult = await this.cache.get(key);
    if (cacheResult && cacheResult.staleness === 'fresh') {
      await this.audit.log({
        provider: key.split(':')[0],
        key: key.split(':')[1],
        value: cacheResult.value,
        status: 'CACHE_HIT',
        latency: Date.now() - startTime,
        cacheHit: true
      });
      return {
        value: cacheResult.value,
        fetchedAt: new Date(),
        staleness: 0,
        source: 'cache',
        cacheHit: true
      };
    }

    // Fetch from provider
    try {
      const result = await this.dataLayer.getDataPoint(key, { allowStale });
      const latency = Date.now() - startTime;

      // Cache it
      await this.cache.set(key, result.value);

      // Log to audit trail
      if (logToAudit) {
        await this.audit.log({
          provider: key.split(':')[0],
          key: key.split(':')[1],
          value: result.value,
          status: 'FETCH_SUCCESS',
          latency,
          sourceUrl: result.source,
          cacheHit: false
        });
      }

      return {
        ...result,
        cacheHit: false,
        latency
      };
    } catch (err) {
      const latency = Date.now() - startTime;

      // Log error to audit
      if (logToAudit) {
        await this.audit.log({
          provider: key.split(':')[0],
          key: key.split(':')[1],
          status: 'FETCH_ERROR',
          error: err.message,
          latency
        });
      }

      // Graceful degradation message for agent
      const now = new Date().toISOString().split('T')[0];
      return {
        value: null,
        error: err.message,
        message: `Data unavailable as of ${now}. ${err.message}`,
        cacheHit: false
      };
    }
  }

  async getStats() {
    return {
      cache: this.cache.getStats(),
      auditEntries: await this.audit.query({ limit: 10 })
    };
  }

  async close() {
    await this.audit.close();
  }
}

module.exports = DataLayerIntegration;
