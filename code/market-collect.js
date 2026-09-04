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
// FALLBACKS: an instrument may name a second source in config/trading.json.
// It is tried only when the primary yields a mock or an error -- never as a
// preference. btc and eth have none because CoinGecko already works keyless;
// the other four have `stooq:*`, which needs no API key and is the only way
// they can accumulate an observation at all on a machine with no paid keys.
// A fallback price is recorded exactly like a primary one: it must still carry
// a real `source` tag, so a broken fallback fails closed like anything else.
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
    const StooqProvider = require('./providers/stooq-provider.js');
    return { registry: {
      crypto: new CryptoProvider(),
      energy: new EnergyProvider(),
      market: new MarketBriefProvider(),
      stooq: new StooqProvider(),
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
/** One attempt at one data key, classified. No I/O decisions, no fallback. */
async function attempt(fetcher, symbol, dataKey) {
  try {
    const row = await fetcher(dataKey);
    const price = row && typeof row.price === 'number' ? row.price : null;
    if (price === null || !Number.isFinite(price) || price <= 0) {
      return { symbol, status: 'skipped', via: dataKey, why: 'provider returned no usable price' };
    }
    if (row.source === 'mock' || row.source === undefined) {
      return {
        symbol, status: 'skipped', price, via: dataKey, source: row.source ?? 'unlabelled',
        why: row.note || `provider served a ${row.source ?? 'unlabelled'} price, not a live quote`,
      };
    }
    return { symbol, status: 'live', price, via: dataKey, source: row.source };
  } catch (e) {
    return { symbol, status: 'error', via: dataKey, why: e.message };
  }
}

async function probe(fetcher, { configPath = TRADING_CONFIG } = {}) {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const results = [];
  for (const [symbol, inst] of Object.entries(cfg.instruments)) {
    const primary = await attempt(fetcher, symbol, inst.dataKey);
    if (primary.status === 'live' || !inst.fallback) {
      results.push(primary);
      continue;
    }
    // The primary failed or served a mock. Try the fallback, and if that also
    // fails keep the PRIMARY's reason -- it names the missing key or the
    // absent series, which is the thing that actually needs fixing. The
    // fallback's error is carried alongside rather than replacing it.
    const backup = await attempt(fetcher, symbol, inst.fallback);
    if (backup.status === 'live') {
      results.push({ ...backup, fellBackFrom: inst.dataKey, primaryWhy: primary.why });
    } else {
      results.push({ ...primary, fallbackTried: inst.fallback, fallbackWhy: backup.why });
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
    const detail = r.status === 'live'
      ? `${r.price} (${r.source}${r.fellBackFrom ? ', fallback' : ''})`
      : r.why;
    lines.push(`${r.symbol.padEnd(8)} ${tag.padEnd(9)} ${detail}`);
    if (r.fellBackFrom) lines.push(`${''.padEnd(18)} ↳ ${r.fellBackFrom} was unusable: ${r.primaryWhy}`);
    if (r.fallbackWhy) lines.push(`${''.padEnd(18)} ↳ fallback ${r.fallbackTried} also failed: ${r.fallbackWhy}`);
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

module.exports = { attempt, probe, collect, format, liveFetcher, symbols };

if (require.main === module) {
  collect().then(({ results, written }) => {
    console.log(format(results, written));
    process.exit(0);
  }).catch(e => { console.error(e.message); process.exit(1); });
}
