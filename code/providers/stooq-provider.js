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
// written for. This comment used to end by naming the experiment that
// separates the two -- fetch a symbol known to exist at the same URL -- and
// saying "do not guess a third time: measure first". Correct, and it stayed
// un-run for three weeks because the discriminating fetch was a thing a human
// had to remember to do by hand.
//
// SO THE CONTROL IS NOW PART OF THE PROBE, 2026-09-25. It fetches CONTROL
// (a symbol Stooq is known to carry) before the four, and diagnose() below
// turns the pair of outcomes into ONE of four verdicts -- no-network,
// endpoint-wrong, symbols-wrong, or confirmed -- instead of a table of FAILs
// that all look alike. One run now answers the question rather than raising
// it again.
//
//   node code/providers/stooq-provider.js --probe
//
// ATTEMPTED FROM THE CLOUD SESSION 2026-09-25 AND IT IS NOT RUNNABLE THERE.
// Every request to stooq.com:443 dies as `ws_closed_mid_exchange` after 11s
// through that container's egress proxy -- including the control, and
// including plain curl. That is a fact about the container, not about Stooq,
// and it means the lone `cl.f HTTP 404` seen in the same run proves nothing
// either. THE PROBE HAS TO RUN ON THE CHROMEBOOK.
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

/**
 * A SYMBOL STOOQ IS KNOWN TO CARRY, fetched before the four as a control.
 *
 * It is not an instrument and is never collected -- it exists only so a
 * failure can be attributed. Without it, "our four codes are wrong" and "the
 * URL is wrong" and "this machine has no route to stooq.com" all present as
 * the same FAIL, which is how the 2026-09-04 probe ended in a question rather
 * than an answer.
 *
 * `aapl.us` is chosen because it is the most ordinary thing on the service:
 * a US equity in Stooq's documented `<ticker>.us` form. If Stooq ever drops
 * it the probe reports endpoint-wrong when the endpoint is fine, which is the
 * safe direction to be wrong in -- it stops a wiring, it cannot cause one.
 */
const CONTROL = { code: 'aapl.us', note: 'control — a symbol Stooq is known to carry' };

/**
 * Classify one failure so the verdict can tell causes apart. Network failures
 * say nothing about symbols; HTTP and parse failures say nothing about the
 * network.
 */
function classify(message) {
  const m = String(message || '');
  if (/timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network/i.test(m)) {
    return 'network';
  }
  if (/HTTP \d+/.test(m)) return 'http';
  return 'parse';
}

/**
 * THE WHOLE POINT OF THE CONTROL, as a pure function over outcomes.
 *
 * Pure so it is testable without a socket, and so the decision table is
 * readable in one place rather than spread through the printing.
 *
 * @param control  { ok: boolean, error?: string }
 * @param results  [{ key, ok, error? }]
 */
function diagnose(control, results) {
  const failed = results.filter((r) => !r.ok);
  const passed = results.length - failed.length;

  if (!control.ok) {
    // A symbol Stooq is known to carry also failed, so nothing here is
    // evidence about OUR symbols -- whatever the four did.
    const kind = classify(control.error);
    if (kind === 'network') {
      return {
        verdict: 'no-network',
        why: `this machine cannot reach Stooq (${control.error}) — nothing is learned about the symbols`,
        actionable: false,
      };
    }
    return {
      verdict: 'endpoint-wrong',
      why: `the control symbol ${CONTROL.code} also failed (${control.error}), so the URL or the request shape is wrong, not the four codes`,
      actionable: true,
    };
  }

  if (passed === results.length) {
    return { verdict: 'confirmed', why: 'every symbol resolved against a live service', actionable: true };
  }
  if (passed > 0) {
    return {
      verdict: 'partial',
      why: `${passed} of ${results.length} resolved; the control passed, so the failures are those codes and not the endpoint`,
      actionable: true,
    };
  }
  return {
    verdict: 'symbols-wrong',
    why: `the control symbol ${CONTROL.code} resolved and all ${results.length} instrument codes failed — the endpoint is fine and these codes are wrong`,
    actionable: true,
  };
}

/** What to do about each verdict, so the probe ends in an instruction. */
const NEXT_STEP = Object.freeze({
  'no-network': 'Run this on a machine that can reach stooq.com. The cloud session cannot:\n'
    + '  every request there dies as ws_closed_mid_exchange through its egress proxy.',
  'endpoint-wrong': 'Fix the URL or the query shape in this file, then re-probe. Do NOT\n'
    + '  touch the symbol table yet — this run says nothing about it.',
  'symbols-wrong': 'Find the right Stooq codes for these four and re-probe. The parser and\n'
    + '  the endpoint are both fine. Do NOT wire any fallback in until a probe passes.',
  partial: 'Wire ONLY the passing symbols into config/trading.json as `fallback`,\n'
    + '  one line each. Leave the failures out — the collector refuses what it\n'
    + '  cannot verify, which is the correct outcome.',
  confirmed: 'Wire all four into config/trading.json as `fallback`, one line each.\n'
    + '  These can then be collected with no API key.',
});

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
    return this.urlFor(sym.code);
  }

  /**
   * The same URL for any code. Split out so the control fetch goes through
   * the IDENTICAL path as the instruments -- a control built a different way
   * tests a different thing and proves nothing about the four.
   */
  urlFor(code) {
    return `${this.baseUrl}?s=${encodeURIComponent(code)}&f=sd2t2ohlc&h&e=csv`;
  }

  /** Fetch the control. Resolves either way; the outcome is the datum. */
  async probeControl() {
    try {
      const csv = await this.getText(this.urlFor(CONTROL.code));
      parseQuote(csv, CONTROL.code);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
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
module.exports.CONTROL = CONTROL;
module.exports.diagnose = diagnose;
module.exports.classify = classify;
module.exports.NEXT_STEP = NEXT_STEP;

// `node code/providers/stooq-provider.js --probe` -- the command that confirms
// the symbol table against the live service. Prints what each symbol actually
// returns, including failures, and never writes anything.
if (require.main === module && process.argv.includes('--probe')) {
  const p = new StooqProvider();
  (async () => {
    // THE CONTROL GOES FIRST, and its result is what makes the rest readable.
    const control = await p.probeControl();
    console.log(`control ${control.ok ? 'OK  ' : 'FAIL'}  ${CONTROL.code.padEnd(7)} `
      + `${control.ok ? 'Stooq is reachable and this request shape works' : control.error}`);
    console.log('');

    const results = [];
    for (const key of StooqProvider.symbols()) {
      try {
        const r = await p.fetch(key);
        console.log(`${key.padEnd(7)} OK    ${r.code.padEnd(7)} ${r.price} ${r.unit}  (${r.date} ${r.time})`);
        results.push({ key, ok: true });
      } catch (e) {
        console.log(`${key.padEnd(7)} FAIL  ${SYMBOLS[key].code.padEnd(7)} ${e.message}`);
        results.push({ key, ok: false, error: e.message });
      }
    }

    const d = diagnose(control, results);
    console.log(`\n${results.filter((r) => r.ok).length} of ${results.length} symbols resolved.`);
    console.log(`VERDICT: ${d.verdict} — ${d.why}`);
    console.log(`\nNEXT: ${NEXT_STEP[d.verdict]}`);
    process.exit(0);
  })();
}
