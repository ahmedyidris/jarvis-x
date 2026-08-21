/**
 * Wire data layer into agent decision loop
 * Agent calls getDataWithContext() instead of hardcoded responses
 * Formats output with staleness, captions, audit trail
 */

const DataLayerIntegration = require('./data-layer-integration');
const AccessibilityIntegration = require('./accessibility-integration');
const MarketBriefProvider = require('./providers/market-brief-provider');
const CryptoProvider = require('./providers/crypto-provider');
const EnergyProvider = require('./providers/energy-provider');
const NewsProvider = require('./providers/news-provider');

class AgentDataIntegration {
  constructor() {
    this.dataLayer = new DataLayerIntegration({
      market: MarketBriefProvider,
      crypto: CryptoProvider,
      energy: EnergyProvider,
      news: NewsProvider
    });
    console.log('[Agent] Data integration initialized');
  }

  /**
   * Extract data keys from agent query
   * Examples:
   *   "What is Bitcoin?" → crypto:btc
   *   "S&P 500 price?" → market:sp500
   *   "Gold price?" → energy:gold
   */
  async resolveQuery(query) {
    const lowerQuery = query.toLowerCase();
    
    const keywordMap = [
      { keywords: ['bitcoin', 'btc'], key: 'crypto:btc' },
      { keywords: ['ethereum', 'eth'], key: 'crypto:eth' },
      { keywords: ['sp500', 's&p 500', 'stock market'], key: 'market:sp500' },
      { keywords: ['nasdaq', 'tech stocks'], key: 'market:nasdaq100' },
      { keywords: ['yield', 'treasury'], key: 'market:10y-yield' },
      { keywords: ['gold'], key: 'energy:gold' },
      { keywords: ['oil', 'crude'], key: 'energy:crude-oil-wti' },
      { keywords: ['gas', 'natural gas'], key: 'energy:natural-gas' },
      { keywords: ['fed', 'interest', 'rate'], key: 'news:fed-announcement' },
      { keywords: ['earnings', 'q3', 'profit'], key: 'news:earnings-season' },
      { keywords: ['geopolitical', 'shipping', 'red sea'], key: 'news:geopolitical-risk' }
    ];

    for (const { keywords, key } of keywordMap) {
      if (keywords.some(kw => lowerQuery.includes(kw))) {
        return key;
      }
    }

    return null;
  }

  /**
   * Build agent response with data context
   * Includes: value, staleness, source, captions, audit log
   */
  async buildResponse(query) {
    const dataKey = await this.resolveQuery(query);
    
    if (!dataKey) {
      return {
        text: "I couldn't find data for that query. Try: Bitcoin price, S&P 500, oil price, or latest news.",
        dataKey: null,
        staleness: null
      };
    }

    // Get data with full context
    const result = await this.dataLayer.getDataWithContext(dataKey);

    if (result.error) {
      // Graceful degradation
      return {
        text: result.message || `Data unavailable for ${dataKey}. ${result.error}`,
        dataKey,
        staleness: 'unavailable',
        error: result.error
      };
    }

    // Format response with staleness
    const now = new Date();
    const fetchedAt = new Date(result.fetchedAt);
    const ageSeconds = Math.round((now - fetchedAt) / 1000);
    const staleness = result.staleness > 0 ? ` (${Math.round(result.staleness / 1000)}s stale)` : ' (fresh)';

    let responseText = '';
    if (result.value && typeof result.value === 'object') {
      if (result.value.price !== undefined) {
        responseText = `${result.value.symbol || dataKey}: $${result.value.price}${result.value.change > 0 ? ' ↑' : ' ↓'} ${result.value.change}${staleness}`;
      } else if (result.value.title) {
        responseText = `📰 ${result.value.title}${staleness}`;
      } else {
        responseText = JSON.stringify(result.value) + staleness;
      }
    } else {
      responseText = String(result.value) + staleness;
    }

    // Wire captions for deaf/hard-of-hearing
    if (typeof window !== 'undefined' && window.captions) {
      window.captions.add(responseText);
    }

    return {
      text: responseText,
      dataKey,
      source: result.source,
      cacheHit: result.cacheHit,
      latency: result.latency,
      fetchedAt: result.fetchedAt,
      staleness: result.staleness
    };
  }

  async getStats() {
    return this.dataLayer.getStats();
  }

  async close() {
    await this.dataLayer.close();
  }
}

module.exports = AgentDataIntegration;
