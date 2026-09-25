const { BaseProvider } = require('./base-provider.js');

/**
 * TradingView Provider (Advisory/Backtest Data)
 * Connects to TradingView's API (webhook/scanner) to fetch market signals and data.
 * Currently returns mock data pending TradingView API key in ~/.jarvis-x/.env.
 *
 * NOTHING IMPORTS THIS CLASS. Recorded 2026-09-24 rather than left for the
 * next reader to discover: MASTER_PLAN_v5 Tier 2 task 5 is marked DONE as
 * "TradingView data integration ... TradingView webhook receiver built into
 * app.py". The receiver exists and writes to logs/trading-signals.jsonl,
 * which nothing reads; this provider is in no registry and has no caller. So
 * the integration is a write-only log plus an unreferenced mock, which is a
 * reasonable half-step but is not what DONE reads as.
 *
 * Its mock return IS tagged `source: 'tradingview (mock)'`, which is the
 * convention the rest of this directory follows — unlike the three voice
 * providers, which were not and now are.
 */
class TradingViewProvider extends BaseProvider {
  constructor(options = {}) {
    super('tradingview', options);
    this.key = process.env.TRADINGVIEW_API_KEY;
  }

  async fetchSignals(_symbol) {
    if (!this.key || this.useMock) {
      return { recommendation: 'HOLD', confidence: 0.5, price: 100.0, source: 'tradingview (mock)' };
    }
    // TODO: Real API integration when key is provided
    throw new Error('Real TradingView API not yet implemented');
  }
}

module.exports = { TradingViewProvider };
