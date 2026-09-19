const { BaseProvider } = require('./base-provider.js');
const fs = require('fs');

/**
 * TradingView Provider (Advisory/Backtest Data)
 * Connects to TradingView's API (webhook/scanner) to fetch market signals and data.
 * Currently returns mock data pending TradingView API key in ~/.jarvis-x/.env.
 */
class TradingViewProvider extends BaseProvider {
  constructor(options = {}) {
    super('tradingview', options);
    this.key = process.env.TRADINGVIEW_API_KEY;
  }

  async fetchSignals(symbol) {
    if (!this.key || this.useMock) {
      return { recommendation: 'HOLD', confidence: 0.5, price: 100.0, source: 'tradingview (mock)' };
    }
    // TODO: Real API integration when key is provided
    throw new Error('Real TradingView API not yet implemented');
  }
}

module.exports = { TradingViewProvider };
