#!/usr/bin/env node
// Emits current live-data snapshot as JSON for the FastAPI dashboard.
require('dotenv').config();

const CryptoProvider = require('../code/providers/crypto-provider');
const MarketProvider = require('../code/providers/market-brief-provider');
const EnergyProvider = require('../code/providers/energy-provider');
const NewsProvider = require('../code/providers/news-provider');

const fs = require('fs');
const path = require('path');

// Alpha Vantage echoes the API key back inside its own rate-limit error
// text, and this script passes err.message straight to the dashboard, which
// renders it verbatim -- a screenshot of the Live Data tab leaked the key.
// Redact any configured secret before anything reaches the response.
const SECRETS = Object.entries(process.env)
  .filter(([k, v]) => /KEY|TOKEN|SECRET/i.test(k) && v && v.length >= 8)
  .map(([, v]) => v);

function redact(text) {
  let out = String(text);
  for (const secret of SECRETS) out = out.split(secret).join('[REDACTED]');
  return out;
}

// Each dashboard load spawns this script fresh, so BaseProvider's in-memory
// requestLog starts empty every time and its rate limiting never applies
// across requests. Alpha Vantage's free tier is 25 calls/DAY total -- two
// page loads exhausted it. Cache on disk so the TTL survives the process.
const CACHE_FILE = path.join(__dirname, '..', 'logs', '.live-data-cache.json');
const TTL_MS = { crypto: 5 * 60e3, market: 60 * 60e3, energy: 60 * 60e3, news: 30 * 60e3 };

function readCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
}

function writeCache(cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
  } catch { /* cache is an optimization; never fail the fetch over it */ }
}

const TARGETS = [
  { id: 'btc',       label: 'Bitcoin',      provider: 'crypto', key: 'btc' },
  { id: 'eth',       label: 'Ethereum',     provider: 'crypto', key: 'eth' },
  { id: 'sol',       label: 'Solana',       provider: 'crypto', key: 'sol' },
  { id: 'xrp',       label: 'XRP',          provider: 'crypto', key: 'xrp' },
  { id: 'usdc',      label: 'USD Coin',     provider: 'crypto', key: 'usdc' },
  { id: 'btc-dominance', label: 'BTC Dominance', provider: 'crypto', key: 'btc-dominance' },
  { id: 'sp500',     label: 'S&P 500 (SPY)', provider: 'market', key: 'sp500' },
  { id: '10y-yield', label: 'US 10Y Yield', provider: 'market', key: '10y-yield' },
  { id: 'crude-oil-wti', label: 'Crude Oil (WTI)', provider: 'energy', key: 'crude-oil-wti' },
  { id: 'fed-announcement', label: 'Fed / Rates', provider: 'news', key: 'fed-announcement' }
];

(async () => {
  const providers = {
    crypto: new CryptoProvider(), market: new MarketProvider(),
    energy: new EnergyProvider(), news: new NewsProvider()
  };
  const items = [];
  const cache = readCache();
  const now = Date.now();

  for (const t of TARGETS) {
    const cached = cache[t.id];
    const ttl = TTL_MS[t.provider] || 5 * 60e3;
    if (cached && (now - cached.fetchedAt) < ttl && !cached.item.error) {
      items.push({ ...cached.item,
        note: [cached.item.note, `cached ${Math.round((now - cached.fetchedAt) / 1000)}s ago`]
          .filter(Boolean).join(' | ') });
      continue;
    }

    try {
      const v = await providers[t.provider].fetch(t.key);
      const item = {
        id: t.id,
        label: t.label,
        // v.dominance: CryptoProvider's fetchDominance() shape (btc-dominance),
        // a percentage, not a USD price -- distinct from v.price/v.value.
        value: v.price ?? v.value ?? v.dominance ?? null,
        headline: v.title || null,
        unit: v.unit || (v.price !== undefined ? 'USD' : (v.dominance !== undefined ? '%' : null)),
        // v.change24h: fetchDominance()'s own field name for the same
        // 24h-change concept every other provider calls changePercent24h.
        changePercent24h: v.changePercent24h ?? v.change24h ?? null,
        origin: v.source,
        live: v.source !== 'mock',
        note: v.note || null,
        asOf: v.tradingDay || v.date || v.timestamp,
        error: null
      };
      items.push(item);
      cache[t.id] = { fetchedAt: now, item };
    } catch (err) {
      const message = redact(err.message || err);
      const isRateLimit = /429|rate limit|too many/i.test(message);
      // A stale number beats a red error box: on a rate limit, serve the
      // last good value and say how old it is.
      if (isRateLimit && cached) {
        items.push({ ...cached.item, live: false,
          note: `stale (${Math.round((now - cached.fetchedAt) / 60000)}m old) -- upstream rate limited` });
      } else {
        items.push({
          id: t.id, label: t.label, value: null, unit: null,
          changePercent24h: null, origin: isRateLimit ? 'rate-limited' : 'error',
          live: false, note: null, asOf: null, error: message
        });
      }
    }
  }

  writeCache(cache);

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    live_count: items.filter(i => i.live).length,
    total: items.length,
    items
  }));
})().catch(err => {
  console.error(String(err));
  process.exit(1);
});
