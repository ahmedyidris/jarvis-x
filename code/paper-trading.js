#!/usr/bin/env node
// Paper trading. Simulated only.
//
// CONSTITUTION.md section IV forbids real-money trading of any kind. This
// module honours that structurally rather than by promising: it takes prices
// as arguments and makes no network calls, so there is no code path from here
// to a broker or an exchange. Nothing to disable, nothing to misconfigure.
//
// The rule this module exists to not repeat: knowledge/Guidelines.md used to
// carry stop-loss and position caps under the heading "Intended but NOT yet
// enforced", next to the honest warning "do not treat them as active
// protections". Every limit in config/trading.json is enforced below and
// covered by code/test-paper-trading.js. A limit that lives only in prose is
// a limit that does not exist.
const fs = require('fs');
const path = require('path');
const { guard, isStopped, logAction } = require('./guard.js');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'config', 'trading.json');
const JOURNAL = path.join(ROOT, 'logs', 'trading-journal.jsonl');

function loadConfig(file = CONFIG) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (cfg.mode !== 'paper') {
    // The only value this field may hold. Anything else is either a mistake or
    // an attempt to point the simulation at something real; both stop here.
    throw new Error(`REFUSED: trading mode must be "paper", got ${JSON.stringify(cfg.mode)}`);
  }
  return cfg;
}

class PaperBook {
  /**
   * @param config   parsed config/trading.json
   * @param journal  path for the append-only trade log
   * @param now      injected clock, so tests can cross a day boundary
   */
  constructor({ config = loadConfig(), journal = JOURNAL, now = () => new Date() } = {}) {
    this.cfg = config;
    this.journalPath = journal;
    this.now = now;
    this.positions = new Map();
    this.closed = [];
    this.capital = config.startingCapital;
  }

  instrument(symbol) {
    const inst = this.cfg.instruments[symbol];
    if (!inst) {
      throw new Error(
        `REFUSED: ${symbol} is not tradeable. Allowed: ${Object.keys(this.cfg.instruments).join(', ')}`);
    }
    return inst;
  }

  // Position size is derived, never chosen. Same risk on every instrument;
  // the volatile ones get smaller positions because their stop is wider.
  maxPositionFraction(symbol) {
    return this.cfg.riskPerTrade / this.instrument(symbol).stopLoss;
  }

  maxPositionValue(symbol) {
    return this.capital * this.maxPositionFraction(symbol);
  }

  dayKey(d = this.now()) {
    return d.toISOString().slice(0, 10);
  }

  realizedLossToday() {
    const today = this.dayKey();
    return this.closed
      .filter(t => this.dayKey(new Date(t.closedAt)) === today && t.pnl < 0)
      .reduce((sum, t) => sum + Math.abs(t.pnl), 0);
  }

  /**
   * Validate a trade without opening it. Returns {ok, reason, ...sizing}.
   * Separate from open() so a proposal can be shown to a human first --
   * CONSTITUTION.md section III gates trade proposals on approval.
   */
  propose({ symbol, side, price, reason }) {
    const fail = (r) => ({ ok: false, reason: r });

    if (side !== 'BUY' && side !== 'SELL') return fail(`side must be BUY or SELL, got ${side}`);
    if (!(price > 0) || !Number.isFinite(price)) return fail(`price must be a positive number, got ${price}`);
    if (!reason || !String(reason).trim()) return fail('a written reason is required');

    let inst;
    try { inst = this.instrument(symbol); } catch (e) { return fail(e.message); }

    if (this.positions.has(symbol)) return fail(`already holding ${symbol}; close it first`);
    if (this.positions.size >= this.cfg.maxOpenPositions) {
      return fail(`max open positions is ${this.cfg.maxOpenPositions}`);
    }

    const lossCap = this.capital * this.cfg.dailyLossLimit;
    const lostToday = this.realizedLossToday();
    if (lostToday >= lossCap) {
      return fail(`daily loss limit reached (${lostToday.toFixed(2)} of ${lossCap.toFixed(2)}) — no new positions today`);
    }

    const value = this.maxPositionValue(symbol);
    const quantity = value / price;
    const stopPrice = side === 'BUY'
      ? price * (1 - inst.stopLoss)
      : price * (1 + inst.stopLoss);

    return {
      ok: true, symbol, side, price, reason: String(reason).trim(),
      quantity, value, stopPrice,
      stopLoss: inst.stopLoss,
      riskIfStopped: value * inst.stopLoss,
      positionFraction: this.maxPositionFraction(symbol),
    };
  }

  /** Open a validated proposal. Gated: guard() throws if the kill switch is set. */
  open(proposal) {
    if (!proposal || !proposal.ok) {
      throw new Error(`REFUSED: ${proposal ? proposal.reason : 'no proposal'}`);
    }
    // Re-validate rather than trusting the caller's object: a proposal may have
    // been built before another position was opened or the loss limit was hit.
    const fresh = this.propose(proposal);
    if (!fresh.ok) throw new Error(`REFUSED: ${fresh.reason}`);

    return guard('paper-trade-open', `${fresh.side} ${fresh.symbol} @ ${fresh.price}`, () => {
      const trade = {
        id: `t-${this.dayKey()}-${this.closed.length + this.positions.size + 1}`,
        ...fresh, ok: undefined,
        openedAt: this.now().toISOString(),
      };
      delete trade.ok;
      this.positions.set(fresh.symbol, trade);
      this.append({ event: 'open', ...trade });
      return trade;
    });
  }

  /** Close an open position at a given price. Gated the same way. */
  close(symbol, price, note = '') {
    const pos = this.positions.get(symbol);
    if (!pos) throw new Error(`REFUSED: no open position in ${symbol}`);
    if (!(price > 0) || !Number.isFinite(price)) throw new Error(`REFUSED: price must be positive, got ${price}`);

    return guard('paper-trade-close', `${symbol} @ ${price}`, () => {
      const direction = pos.side === 'BUY' ? 1 : -1;
      const pnl = (price - pos.price) * pos.quantity * direction;
      const closed = {
        ...pos, closePrice: price, closedAt: this.now().toISOString(),
        pnl, note, stoppedOut: this.wouldStop(pos, price),
      };
      this.positions.delete(symbol);
      this.closed.push(closed);
      this.capital += pnl;
      this.append({ event: 'close', ...closed });
      return closed;
    });
  }

  wouldStop(pos, price) {
    return pos.side === 'BUY' ? price <= pos.stopPrice : price >= pos.stopPrice;
  }

  /** Positions whose stop has been breached at the given prices. */
  breaches(prices) {
    const hit = [];
    for (const [symbol, pos] of this.positions) {
      const p = prices[symbol];
      if (typeof p === 'number' && this.wouldStop(pos, p)) hit.push({ symbol, price: p, stopPrice: pos.stopPrice });
    }
    return hit;
  }

  markToMarket(prices) {
    let open = 0;
    for (const [symbol, pos] of this.positions) {
      const p = prices[symbol];
      if (typeof p !== 'number') continue;
      const direction = pos.side === 'BUY' ? 1 : -1;
      open += (p - pos.price) * pos.quantity * direction;
    }
    return { capital: this.capital, unrealized: open, equity: this.capital + open };
  }

  stats() {
    const wins = this.closed.filter(t => t.pnl > 0);
    return {
      capital: this.capital,
      startingCapital: this.cfg.startingCapital,
      openPositions: this.positions.size,
      closedTrades: this.closed.length,
      wins: wins.length,
      realizedPnl: this.closed.reduce((s, t) => s + t.pnl, 0),
      lostToday: this.realizedLossToday(),
      dailyLossCap: this.capital * this.cfg.dailyLossLimit,
    };
  }

  // Append-only: CONSTITUTION.md section IV forbids overwriting audit logs.
  append(entry) {
    try {
      fs.mkdirSync(path.dirname(this.journalPath), { recursive: true });
      fs.appendFileSync(this.journalPath, JSON.stringify(entry) + '\n');
    } catch (_e) {
      logAction('journal-write-failed', this.journalPath, { allowed: false, outcome: 'error' });
    }
  }
}

module.exports = { PaperBook, loadConfig, CONFIG, JOURNAL };

if (require.main === module) {
  if (isStopped()) { console.error('Kill switch active.'); process.exit(1); }
  const book = new PaperBook();
  const cfg = book.cfg;
  console.log(`Paper book — ${cfg.mode} mode, $${cfg.startingCapital} simulated\n`);
  console.log(`${'instrument'.padEnd(10)} ${'stop'.padStart(6)} ${'max position'.padStart(14)} ${'risk'.padStart(7)}`);
  console.log('-'.repeat(42));
  for (const symbol of Object.keys(cfg.instruments)) {
    const f = book.maxPositionFraction(symbol);
    const stop = cfg.instruments[symbol].stopLoss;
    console.log(`${symbol.padEnd(10)} ${(stop * 100).toFixed(0).padStart(5)}% ` +
                `${(f * 100).toFixed(1).padStart(13)}% ${(f * stop * 100).toFixed(2).padStart(6)}%`);
  }
  console.log('-'.repeat(42));
  console.log('Same risk per trade on every instrument. No real money anywhere in this file.');
}
