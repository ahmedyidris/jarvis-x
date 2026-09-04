#!/usr/bin/env node
// The recommendation layer: market-analyst.js says where a price sits, this
// says what could be done about it, and a human says whether it happens.
//
// WHAT IT DELIBERATELY DOES NOT DO: execute. It never calls book.open() or
// book.close(). CONSTITUTION.md §III gates "Proposing a paper trade" on a
// human, and code/paper-trading.js routes both open() and close() through
// guard() for exactly that reason. An advisor that executed its own advice
// would make that gate decorative. code/test-trade-advisor.js asserts this
// with a book that throws if either method is touched.
//
// "Buy low, sell high" is implemented literally and narrowly: buy = the price
// is in the bottom fifth of the range THIS REPO RECORDED; sell = the top
// fifth, or the stop is breached. No forecast is involved and none is implied.
const path = require('path');
const { signal, symbols } = require('./market-analyst.js');

const TRADING_CONFIG = path.join(__dirname, '..', 'config', 'trading.json');

// Every recommendation is exactly one of these. Nothing here is an instruction.
const KINDS = ['OPEN', 'CLOSE', 'HOLD', 'WAIT', 'BLOCKED'];

/**
 * @param book    a PaperBook — read for its positions and its limits, never mutated
 * @param rows    history from market-analyst.load()
 * @param prices  current spot prices, { symbol: number }
 */
function advise({ book, rows, prices = {}, days = 30, now = () => new Date(),
                  configPath = TRADING_CONFIG } = {}) {
  const out = [];
  for (const symbol of symbols(configPath)) {
    const price = prices[symbol];
    const sig = signal(rows, symbol, { days, now });
    const held = book.positions.get(symbol);

    if (!(price > 0) || !Number.isFinite(price)) {
      out.push({ symbol, kind: 'WAIT', signal: sig,
                 because: ['no current price available for this instrument'] });
      continue;
    }

    if (held) {
      // A breached stop outranks everything: the limit was agreed in advance.
      const breached = book.breaches({ [symbol]: price }).some(b => b.symbol === symbol);
      if (breached) {
        out.push({ symbol, kind: 'CLOSE', held, signal: sig, price,
                   because: [`price ${price} is past the agreed stop ${held.stopPrice.toFixed(2)}`,
                             'the stop was set when the position opened, not now'] });
      } else if (sig.verdict === 'near-high' && held.side === 'BUY') {
        out.push({ symbol, kind: 'CLOSE', held, signal: sig, price,
                   because: [...sig.because, 'holding a long near the top of the recorded range'] });
      } else {
        out.push({ symbol, kind: 'HOLD', held, signal: sig, price, because: sig.because });
      }
      continue;
    }

    if (sig.verdict !== 'near-low') {
      out.push({ symbol, kind: 'WAIT', signal: sig, price,
                 because: sig.verdict === 'insufficient'
                   ? sig.because
                   : [...sig.because, 'not near the bottom of the recorded range'] });
      continue;
    }

    // Let the book itself decide whether this is permissible. Duplicating its
    // limits here would let the two drift apart, and the book is the one with
    // tests on every limit.
    const reason = sig.because.join('; ');
    const proposal = book.propose({ symbol, side: 'BUY', price, reason });
    if (proposal.ok) {
      out.push({ symbol, kind: 'OPEN', proposal, signal: sig, price, because: sig.because });
    } else {
      out.push({ symbol, kind: 'BLOCKED', signal: sig, price,
                 because: [`the book refused this: ${proposal.reason}`] });
    }
  }
  return out;
}

function format(recs) {
  const lines = ['Recommendations — NOTHING BELOW HAS BEEN EXECUTED.', ''];
  for (const r of recs) {
    const head = r.kind === 'OPEN'
      ? `BUY ${r.proposal.quantity.toFixed(6)} @ ${r.price} ` +
        `(${(r.proposal.positionFraction * 100).toFixed(1)}% of capital, ` +
        `stop ${r.proposal.stopPrice.toFixed(2)}, risk ${r.proposal.riskIfStopped.toFixed(2)})`
      : r.kind === 'CLOSE' ? `CLOSE the open ${r.held.side} @ ${r.price}`
      : r.kind;
    lines.push(`${r.symbol.padEnd(8)} ${r.kind.padEnd(8)} ${head === r.kind ? '' : head}`);
    for (const b of r.because) lines.push(`         · ${b}`);
  }
  const acts = recs.filter(r => r.kind === 'OPEN' || r.kind === 'CLOSE');
  lines.push('');
  lines.push(acts.length
    ? `${acts.length} action(s) suggested. Each one needs your approval: the book's`
    : 'No action suggested.');
  if (acts.length) lines.push('open() and close() are gated and this file never calls them.');
  return lines.join('\n');
}

module.exports = { advise, format, KINDS };
