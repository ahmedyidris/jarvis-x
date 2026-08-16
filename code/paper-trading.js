const fs = require('fs');
const path = require('path');

const JOURNAL_FILE = path.join(__dirname, '../logs/trading-journal.jsonl');
const TRADES_DIR = path.join(__dirname, '../trading');

// Ensure trading directory exists
if (!fs.existsSync(TRADES_DIR)) fs.mkdirSync(TRADES_DIR, { recursive: true });

class PaperTradingEnv {
  constructor(initialCapital = 10000) {
    this.capital = initialCapital;
    this.positions = {}; // symbol -> {qty, entry_price, entry_time}
    this.trades = [];
    this.startTime = new Date();
  }

  // Propose a trade (does not execute immediately)
  proposeTrade(symbol, side, quantity, entryPrice, reason) {
    if (side !== 'BUY' && side !== 'SELL') {
      throw new Error('Side must be BUY or SELL');
    }

    const proposal = {
      id: `trade-${Date.now()}`,
      timestamp: new Date().toISOString(),
      symbol,
      side,
      quantity,
      entryPrice,
      reason,
      status: 'proposed'
    };

    return proposal;
  }

  // Execute a proposed trade (logs it, updates positions)
  executeTrade(proposal, approvedBy = 'human') {
    const { symbol, side, quantity, entryPrice } = proposal;
    const cost = quantity * entryPrice;

    if (side === 'BUY') {
      if (cost > this.capital) {
        throw new Error(`Insufficient capital: need ${cost}, have ${this.capital}`);
      }
      this.capital -= cost;
      this.positions[symbol] = {
        qty: (this.positions[symbol]?.qty || 0) + quantity,
        entryPrice,
        entryTime: new Date().toISOString()
      };
    } else if (side === 'SELL') {
      if (!this.positions[symbol] || this.positions[symbol].qty < quantity) {
        throw new Error(`Insufficient position: need ${quantity}, have ${this.positions[symbol]?.qty || 0}`);
      }
      this.capital += cost;
      this.positions[symbol].qty -= quantity;
      if (this.positions[symbol].qty === 0) delete this.positions[symbol];
    }

    const trade = {
      id: proposal.id,
      ...proposal,
      approvedBy,
      executedAt: new Date().toISOString(),
      status: 'executed'
    };

    this.trades.push(trade);
    this.logTrade(trade);
    return trade;
  }

  logTrade(trade) {
    const line = JSON.stringify(trade) + '\n';
    fs.appendFileSync(JOURNAL_FILE, line);
  }

  // Get current P&L. `currentPrices` (optional): { SYMBOL: currentPrice }.
  // Previously this always used entryPrice for currentValue too, so it was
  // subtracted from an identical cost-basis figure and pnl was 0 no matter
  // what the market actually did. A symbol missing from `currentPrices`
  // still falls back to its entryPrice (no live price known -> no
  // unrealized gain/loss can be claimed for it), same as calling this with
  // no argument at all -- that keeps existing callers working unchanged.
  getPortfolioStats(currentPrices = {}) {
    let currentValue = this.capital;
    const positionDetails = [];

    Object.entries(this.positions).forEach(([symbol, pos]) => {
      const currentPrice = currentPrices[symbol] ?? pos.entryPrice;
      const positionValue = pos.qty * currentPrice;
      currentValue += positionValue;
      positionDetails.push({
        symbol,
        qty: pos.qty,
        entryPrice: pos.entryPrice,
        currentPrice,
        currentValue: positionValue,
        pnl: positionValue - (pos.qty * pos.entryPrice)
      });
    });

    const costBasisValue = this.capital + Object.values(this.positions).reduce((sum, p) => sum + p.qty * p.entryPrice, 0);
    const pnl = currentValue - costBasisValue;

    return {
      startCapital: 10000,
      currentCapital: this.capital,
      currentValue,
      openPositions: positionDetails,
      totalTrades: this.trades.length,
      pnl,
      roi: ((currentValue - 10000) / 10000 * 100).toFixed(2) + '%'
    };
  }

  // Summarize trades
  summary() {
    const stats = this.getPortfolioStats();
    return {
      timestamp: new Date().toISOString(),
      uptime: Math.round((Date.now() - this.startTime.getTime()) / 1000) + 's',
      ...stats
    };
  }
}

module.exports = { PaperTradingEnv };

if (require.main === module) {
  const env = new PaperTradingEnv();
  
  // Example trades
  const t1 = env.proposeTrade('BTC', 'BUY', 0.01, 45000, 'Testing paper trading');
  env.executeTrade(t1);
  
  const t2 = env.proposeTrade('ETH', 'BUY', 0.1, 2500, 'Diversify portfolio');
  env.executeTrade(t2);
  
  console.log('Paper Trading Summary:');
  console.log(JSON.stringify(env.summary(), null, 2));
}
