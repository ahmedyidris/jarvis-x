#!/usr/bin/env node
// Turns the spot-only providers into the price history code/market-analyst.js
// needs. One run = one observation per instrument.
//
// THE RULE THAT SHAPES THIS FILE: a mock price is never recorded. Every
// provider in code/providers/ falls back to a hardcoded MOCK object when its
// API key is missing, and returns it tagged `source: 'mock'`. Recording those
// would build a range out of constants -- gold would show a 0.00% range around
// 2050.0 forever, and the analyst would report `hold` with total confidence and
// no information. So a mock is a SKIP with a stated reason, not a data point.
//
// Live coverage today (see report()): btc and eth are keyless via CoinGecko.
// oil needs EIA_API_KEY, sp500 and nasdaq need ALPHAVANTAGE_API_KEY. Gold has
// no live source at all -- EIA publishes no gold series, so energy-provider.js
// hardcodes 2050.0 and says so. Gold stays permanently `insufficient` until a
// metals provider exists. That is the honest state, not a bug to paper over.
const fs = require('fs');
const path = require('path');
const { record, symbols } = require('./market-analyst.js');
const { isStopped } = require('./guard.js');

const ROOT = path.join(__dirname, '..');
const TRADING_CONFIG = path.join(ROOT, 'config', 'trading.json');

/** Default fetcher: the real providers. Replaced wholesale in tests. */
function liveFetcher() {
  const { registry } = (() => {
    const CryptoProvider = require('./providers/crypto-provider.js');
    const EnergyProvider = require('./providers/energy-provider.js');
    const MarketBriefProvider = require('./providers/market-brief-provider.js');
    return { registry: {
      crypto: new CryptoProvider(),
      energy: new EnergyProvider(),
      market: new MarketBriefProvider(),
    } };
  })();
  return async (dataKey) => {
    const [family, key] = dataKey.split(':');
    const provider = registry[family];
    if (!provider) throw new Error(`no provider for family "${family}"`);
    return provider.fetch(key);
  };
}

/**
 * Fetch every configured instrument once and return what each attempt yielded.
 * Nothing is written here -- collect() decides, so the decision is testable
 * separately from the fetching.
 */
async function probe(fetcher, { configPath = TRADING_CONFIG } = {}) {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const results = [];
  for (const [symbol, inst] of Object.entries(cfg.instruments)) {
    try {
      const row = await fetcher(inst.dataKey);
      const price = row && typeof row.price === 'number' ? row.price : null;
      if (price === null || !Number.isFinite(price) || price <= 0) {
        results.push({ symbol, status: 'skipped', why: 'provider returned no usable price' });
      } else if (row.source === 'mock' || row.source === undefined) {
        results.push({
          symbol, status: 'skipped', price, source: row.source ?? 'unlabelled',
          why: row.note || `provider served a ${row.source ?? 'unlabelled'} price, not a live quote`,
        });
      } else {
        results.push({ symbol, status: 'live', price, source: row.source });
      }
    } catch (e) {
      results.push({ symbol, status: 'error', why: e.message });
    }
  }
  return results;
}

/** Probe, then append only the live prices. Returns what happened, per symbol. */
async function collect({ fetcher = null, configPath = TRADING_CONFIG, historyPath, now } = {}) {
  if (isStopped()) throw new Error('Kill switch is ON — .jarvis-x-STOP exists; not collecting.');
  const results = await probe(fetcher || liveFetcher(), { configPath });
  const prices = {};
  for (const r of results) if (r.status === 'live') prices[r.symbol] = r.price;
  const opts = {};
  if (historyPath) opts.historyPath = historyPath;
  if (now) opts.now = now;
  const written = Object.keys(prices).length ? record(prices, opts) : 0;
  return { results, written };
}

function format(results, written) {
  const lines = [];
  for (const r of results) {
    const tag = r.status === 'live' ? 'recorded' : r.status;
    const detail = r.status === 'live' ? `${r.price} (${r.source})` : r.why;
    lines.push(`${r.symbol.padEnd(8)} ${tag.padEnd(9)} ${detail}`);
  }
  lines.push('');
  lines.push(`${written} of ${results.length} instruments had a live price this run.`);
  const skipped = results.filter(r => r.status !== 'live').map(r => r.symbol);
  if (skipped.length) {
    lines.push(`No history recorded for: ${skipped.join(', ')}. A mock price is`);
    lines.push('deliberately not written — a range built from constants would read');
    lines.push('as confident and mean nothing.');
  }
  return lines.join('\n');
}

module.exports = { probe, collect, format, liveFetcher, symbols };

if (require.main === module) {
  collect().then(({ results, written }) => {
    console.log(format(results, written));
    process.exit(0);
  }).catch(e => { console.error(e.message); process.exit(1); });
}
