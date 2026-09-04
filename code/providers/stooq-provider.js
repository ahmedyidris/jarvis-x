const BaseProvider = require('./base-provider');

// Keyless quotes for the four instruments the existing providers cannot serve.
//
// WHY THIS EXISTS: code/market-collect.js records 2 of 6. gold has no live
// source anywhere in this repo -- EIA publishes no gold series, so
// energy-provider.js hardcodes 2050.0 and says so. sp500 and nasdaq need
// ALPHAVANTAGE_API_KEY; oil needs EIA_API_KEY. Without those keys all four
// serve MOCK constants, the collector correctly refuses them, and four of the
// six instruments can never accumulate a single observation. That is the
// binding constraint on the whole market feature, and it is a data problem,
// not a code one.
//
// Stooq serves a one-line CSV per symbol over plain HTTPS with no key, no
// account and no quota headers. That makes it the only source found that can
// close all four gaps at once on a machine with no paid subscriptions.
//
// STATUS: NOT WIRED IN. Probed on the real machine 2026-09-04 and all four
// symbols returned HTTP 404:
//
//   gold    FAIL  xauusd  Stooq HTTP 404
//   sp500   FAIL  ^spx    Stooq HTTP 404
//   nasdaq  FAIL  ^ndx    Stooq HTTP 404
//   oil     FAIL  cl.f    Stooq HTTP 404
//
// So config/trading.json carries no `fallback` for any instrument. This file
// is kept because the parser is correct regardless of which symbols turn out
// to be right, and because the collector's fallback mechanism it was written
// for is tested and working -- re-enabling is one config line per instrument.
//
// WHAT THE 404s DO NOT TELL US: whether the endpoint below is wrong or the
// four codes are. A uniform 404 looks like a bad path, but Stooq may equally
// answer an unknown symbol with 404 rather than the N/D row this parser was
// written for. Fetching a symbol known to exist (aapl.us) at this same URL
// separates the two, and that has not been run. Do not guess a third time:
// measure first.
//
//   node code/providers/stooq-provider.js --probe
//
// Nothing was at risk from the wrong guess, which was the point of the
// design: fetch() surfaces an unknown symbol as an explicit error rather
// than a price, so a bad code cannot quietly become a recorded observation.

// Stooq symbol per instrument. Index symbols carry a leading ^ which must be
// percent-encoded in the query string.
const SYMBOLS = {
  gold:   { code: 'xauusd', unit: 'USD/oz',     note: 'gold spot' },
  sp500:  { code: '^spx',   unit: 'index',      note: 'S&P 500 index' },
  nasdaq: { code: '^ndx',   unit: 'index',      note: 'Nasdaq 100 index' },
  oil:    { code: 'cl.f',   unit: 'USD/barrel', note: 'WTI crude front-month future' },
};

class StooqProvider extends BaseProvider {
  constructor(options = {}) {
    super('stooq', { rateLimit: { requests: 30, window: 60000 } });
    this.baseUrl = options.baseUrl || 'https://stooq.com/q/l/';
    this.timeoutMs = options.timeoutMs || 10000;
    // Injected in tests so nothing here opens a socket. Same pattern as
    // code/watcher.js and code/market-collect.js.
    this.getText = options.getText || this._getText.bind(this);
  }

  static symbols() { return Object.keys(SYMBOLS); }

  url(key) {
    const sym = SYMBOLS[key];
    if (!sym) throw new Error(`Unknown stooq key: ${key}`);
    return `${this.baseUrl}?s=${encodeURIComponent(sym.code)}&f=sd2t2ohlc&h&e=csv`;
  }

  async fetch(key) {
    await this.checkRateLimit();
    const sym = SYMBOLS[key];
    if (!sym) throw new Error(`Unknown stooq key: ${key}`);

    const csv = await this.getText(this.url(key));
    const row = parseQuote(csv, sym.code);

    const result = {
      symbol: key,
      code: sym.code,
      price: row.close,
      open: row.open, high: row.high, low: row.low,
      date: row.date, time: row.time,
      unit: sym.unit,
      timestamp: new Date().toISOString(),
      // The tag market-collect.js checks. Anything but a real source name is
      // refused there, so this is the field that decides whether the number
      // is allowed to become history.
      source: 'stooq',
    };
    this.logRequest(key, 'LIVE', result);
    return result;
  }

  async _getText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'text/csv', 'User-Agent': 'jarvis-x' },
      });
      if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`Stooq timed out after ${this.timeoutMs}ms`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Parse Stooq's two-line CSV: a header row, then one quote row.
 *
 *   Symbol,Date,Time,Open,High,Low,Close
 *   XAUUSD,2026-09-04,01:55:12,3305.10,3312.40,3299.80,3308.75
 *
 * Stooq answers an unknown symbol with a row of "N/D" rather than an HTTP
 * error, so a bad symbol arrives looking exactly like a successful response.
 * That is the case this function exists to catch: it is the difference between
 * "no data" and a NaN recorded as a price.
 */
function parseQuote(csv, expectedCode) {
  const lines = String(csv || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('Stooq returned no quote row');

  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const cells = lines[1].split(',').map(c => c.trim());
  const at = (name) => {
    const i = header.indexOf(name);
    return i === -1 ? undefined : cells[i];
  };

  const symbol = at('symbol');
  if (expectedCode && symbol &&
      symbol.toLowerCase() !== String(expectedCode).toLowerCase()) {
    throw new Error(`Stooq returned ${symbol}, expected ${expectedCode}`);
  }

  const num = (name) => {
    const raw = at(name);
    // "N/D" is Stooq's no-data marker and Number('N/D') is NaN, which would
    // sail straight through a naive parseFloat into the history file.
    if (raw === undefined || raw === '' || /^n\/?d$/i.test(raw)) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const close = num('close');
  if (close === null || close <= 0) {
    throw new Error(`Stooq returned no usable close for ${expectedCode || 'symbol'}`);
  }
  return {
    symbol, close,
    open: num('open'), high: num('high'), low: num('low'),
    date: at('date') || null, time: at('time') || null,
  };
}

module.exports = StooqProvider;
module.exports.parseQuote = parseQuote;
module.exports.SYMBOLS = SYMBOLS;

// `node code/providers/stooq-provider.js --probe` -- the command that confirms
// the symbol table against the live service. Prints what each symbol actually
// returns, including failures, and never writes anything.
if (require.main === module && process.argv.includes('--probe')) {
  const p = new StooqProvider();
  (async () => {
    let ok = 0;
    for (const key of StooqProvider.symbols()) {
      try {
        const r = await p.fetch(key);
        console.log(`${key.padEnd(7)} OK    ${r.code.padEnd(7)} ${r.price} ${r.unit}  (${r.date} ${r.time})`);
        ok++;
      } catch (e) {
        console.log(`${key.padEnd(7)} FAIL  ${SYMBOLS[key].code.padEnd(7)} ${e.message}`);
      }
    }
    console.log(`\n${ok} of ${StooqProvider.symbols().length} symbols resolved.`);
    console.log(ok === 4
      ? 'Symbol table confirmed. These four can now be collected without any API key.'
      : 'Some symbols are wrong or unavailable. Do NOT wire the failing ones in;\nthe collector refuses what it cannot verify, which is the correct outcome.');
    process.exit(0);
  })();
}
