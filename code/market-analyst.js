#!/usr/bin/env node
// Price history + rule-based signals for the six instruments in config/trading.json.
//
// WHAT THIS IS NOT: a predictor. Nothing here forecasts a price. An LLM cannot
// predict an asset price, and a module that claimed to would be producing
// confident output with no predictive validity -- the exact failure the rest of
// this repo has spent its history correcting. Every verdict below is a
// restatement of where today's price sits inside a range this file recorded,
// with the arithmetic attached so it can be checked.
//
// WHY IT EXISTS AT ALL: code/providers/ are spot-only -- price and 24h change,
// no series. "Buy low, sell high" is unanswerable without knowing what low was,
// so the first job is to start writing prices down. Until enough days exist,
// every signal honestly returns `insufficient`.
const fs = require('fs');
const path = require('path');
const { logAction } = require('./guard.js');

const ROOT = path.join(__dirname, '..');
const HISTORY = path.join(ROOT, 'logs', 'market-history.jsonl');
const TRADING_CONFIG = path.join(ROOT, 'config', 'trading.json');

// Below this many observations a range is noise, not a range.
const MIN_OBSERVATIONS = 20;
// Where in the range a price has to sit before the verdict changes.
const LOW_BAND = 0.20;
const HIGH_BAND = 0.80;

function symbols(configPath = TRADING_CONFIG) {
  return Object.keys(JSON.parse(fs.readFileSync(configPath, 'utf8')).instruments);
}

/**
 * Append one observation per symbol. Prices are passed in -- this module makes
 * no network calls, so its tests stay offline and it cannot reach an exchange.
 */
function record(prices, { historyPath = HISTORY, now = () => new Date() } = {}) {
  const at = now().toISOString();
  const rows = [];
  for (const [symbol, price] of Object.entries(prices)) {
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue;
    rows.push({ at, symbol, price });
  }
  if (!rows.length) return 0;
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.appendFileSync(historyPath, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  logAction('market-record', `${rows.length} prices`, { allowed: true, outcome: 'recorded' });
  return rows.length;
}

function load(historyPath = HISTORY) {
  if (!fs.existsSync(historyPath)) return [];
  return fs.readFileSync(historyPath, 'utf8').split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(r => r && r.symbol && typeof r.price === 'number');
}

function series(rows, symbol, days = 30, now = () => new Date()) {
  const cutoff = now().getTime() - days * 86400000;
  return rows.filter(r => r.symbol === symbol && new Date(r.at).getTime() >= cutoff)
             .sort((a, b) => new Date(a.at) - new Date(b.at));
}

/** Where the latest price sits inside the window's range, plus how noisy it is. */
function stats(rows, symbol, days = 30, now = () => new Date()) {
  const s = series(rows, symbol, days, now);
  if (s.length < MIN_OBSERVATIONS) {
    return { symbol, insufficient: true, have: s.length, need: MIN_OBSERVATIONS };
  }
  const prices = s.map(r => r.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const last = prices[prices.length - 1];
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const sd = Math.sqrt(prices.reduce((a, p) => a + (p - mean) ** 2, 0) / prices.length);
  return {
    symbol, insufficient: false, have: s.length, days,
    min, max, last, mean,
    // Guard the degenerate case: a flat series has no range to sit inside.
    position: max === min ? 0.5 : (last - min) / (max - min),
    volatility: mean === 0 ? 0 : sd / mean,
  };
}

/**
 * A verdict, with its arithmetic. Never "will rise" -- only "is currently near
 * the bottom of the range I have recorded", which is a fact about the past.
 */
function signal(rows, symbol, { days = 30, now = () => new Date() } = {}) {
  const st = stats(rows, symbol, days, now);
  if (st.insufficient) {
    return {
      symbol, verdict: 'insufficient',
      because: [`only ${st.have} of ${st.need} observations recorded — no range to judge against`],
      stats: st,
    };
  }
  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  const where = `last ${st.last.toFixed(2)} sits at ${pct(st.position)} of the ` +
                `${st.min.toFixed(2)}–${st.max.toFixed(2)} range over ${st.have} observations`;

  let verdict = 'hold';
  const because = [where];
  if (st.position <= LOW_BAND) {
    verdict = 'near-low';
    because.push(`at or below the bottom ${pct(LOW_BAND)} of that range`);
  } else if (st.position >= HIGH_BAND) {
    verdict = 'near-high';
    because.push(`at or above the top ${pct(1 - HIGH_BAND)} of that range`);
  }
  because.push(`volatility ${pct(st.volatility)} of mean over the window`);
  because.push('this describes the recorded past, not the future');
  return { symbol, verdict, because, stats: st };
}

/** Signals for every configured instrument, worst-informed first. */
function report(rows, { days = 30, now = () => new Date(), configPath = TRADING_CONFIG } = {}) {
  return symbols(configPath).map(s => signal(rows, s, { days, now }));
}

function format(signals) {
  const lines = [];
  for (const s of signals) {
    lines.push(`${s.symbol.padEnd(8)} ${s.verdict}`);
    for (const b of s.because) lines.push(`         · ${b}`);
  }
  const ready = signals.filter(s => s.verdict !== 'insufficient').length;
  lines.push('');
  lines.push(`${ready} of ${signals.length} instruments have enough history to judge.`);
  if (ready < signals.length) {
    lines.push(`Run this daily; ${MIN_OBSERVATIONS} observations per instrument are needed.`);
  }
  lines.push('These are descriptions of recorded prices. They are not forecasts,');
  lines.push('and none of them opens a position — see code/paper-trading.js.');
  return lines.join('\n');
}

module.exports = {
  record, load, series, stats, signal, report, format, symbols,
  HISTORY, MIN_OBSERVATIONS, LOW_BAND, HIGH_BAND,
};

if (require.main === module) {
  console.log(format(report(load())));
}
