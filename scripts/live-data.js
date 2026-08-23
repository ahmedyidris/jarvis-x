#!/usr/bin/env node
// Emits current live-data snapshot as JSON for the FastAPI dashboard.
require('dotenv').config();

const CryptoProvider = require('../code/providers/crypto-provider');
const MarketProvider = require('../code/providers/market-brief-provider');
const EnergyProvider = require('../code/providers/energy-provider');
const NewsProvider = require('../code/providers/news-provider');

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

  for (const t of TARGETS) {
    try {
      const v = await providers[t.provider].fetch(t.key);
      items.push({
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
      });
    } catch (err) {
      items.push({
        id: t.id, label: t.label, value: null, unit: null,
        changePercent24h: null, origin: 'error', live: false,
        note: null, asOf: null, error: String(err.message || err)
      });
    }
  }

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
