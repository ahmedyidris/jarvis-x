/**
 * TRADINGVIEW SIGNALS — the consumer for a log that had none.
 *
 * `app.py`'s `/api/tradingview/webhook` appends a row to
 * `logs/trading-signals.jsonl` for every alert TradingView fires. As of
 * 2026-09-24 nothing read that file. MASTER_PLAN_v5 Tier 2 task 5 is marked
 * DONE as "TradingView data integration"; a write-only log is not an
 * integration, and this is the half that was missing.
 *
 * WHAT IT IS ALLOWED TO DO, against CONSTITUTION.md rather than against
 * intent. §III gates "Proposing a paper trade" on a human tap — so a signal
 * source that feeds a human-gated proposal is permitted, and this module is
 * narrower than that: it reads, validates and reports. It never proposes,
 * never opens, never closes. `code/test-trading-signals.js` asserts that it
 * imports no executor and touches no book.
 *
 * EVERY ROW IS UNTRUSTED INPUT, and that is not paranoia about a hypothetical.
 * The webhook's own check reads:
 *
 *     expected_passphrase = os.environ.get("TRADINGVIEW_PASSPHRASE")
 *     if expected_passphrase and signal.passphrase != expected_passphrase:
 *
 * With the variable unset — and `~/.jarvis-x/.env` is still unfilled — the
 * comparison is skipped entirely and the endpoint accepts anything posted to
 * it, while reading as though it authenticates. `app.py` binds to 127.0.0.1
 * today, so this is latent rather than open; it stops being latent the moment
 * that changes, and the consumer is the wrong place to find out. So this
 * module treats the file as attacker-writable by construction: shape, symbol
 * and price are all validated, a bad row is REPORTED rather than dropped, and
 * nothing here can act on a row even if every check passed.
 *
 * A DROPPED ROW IS AN UNKNOWN PRETENDING TO BE AN ABSENCE. Rejected rows come
 * back in `rejected` with the reason, because a webhook quietly discarding
 * half its input looks identical to a webhook nobody is firing — and the
 * difference matters when Ahmed is deciding whether his alerts are wired up.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', 'logs', 'trading-signals.jsonl');
const TRADING_CONFIG = path.join(__dirname, '..', 'config', 'trading.json');

/**
 * How long a signal stays current. Past this it is `stale: true` rather than
 * absent — "the alert fired three days ago" and "no alert has ever fired" are
 * different facts and must not collapse into the reassuring one.
 *
 * Six hours because TradingView alerts here are intraday-to-daily and the
 * scheduler's own cadence is 30 minutes; a signal older than a quarter of a
 * day is describing a different market than the one the price came from.
 */
const MAX_AGE_HOURS = 6;

/** The only actions a row may carry. Anything else is a rejected row. */
const ACTIONS = Object.freeze(['BUY', 'SELL', 'CLOSE', 'NEUTRAL']);

/**
 * TradingView's tickers mapped to the six instruments config/trading.json
 * allows. §IV forbids "Holding any instrument outside config/trading.json's
 * six", so a signal for anything else is not a signal this system may act on
 * and is rejected by name rather than passed through for someone downstream
 * to catch.
 *
 * The right-hand side is checked against the config at load, so adding a
 * ticker here for an instrument the config does not list fails loudly instead
 * of creating a seventh tradeable symbol by the back door.
 */
const TICKERS = Object.freeze({
  xauusd: 'gold', gold: 'gold', gc1: 'gold',
  spx: 'sp500', sp500: 'sp500', es1: 'sp500', spy: 'sp500',
  ndx: 'nasdaq', nasdaq: 'nasdaq', nq1: 'nasdaq', qqq: 'nasdaq',
  usoil: 'oil', wtico: 'oil', cl1: 'oil', oil: 'oil',
  btcusd: 'btc', btcusdt: 'btc', btc: 'btc',
  ethusd: 'eth', ethusdt: 'eth', eth: 'eth',
});

function allowedInstruments(configPath = TRADING_CONFIG) {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return Object.keys(cfg.instruments);
}

/**
 * Validate one row. Returns `{ ok: true, signal }` or `{ ok: false, why }`.
 *
 * Split out and exported so the suite can drive every rejection directly —
 * a validator only ever exercised through a file read is one whose branches
 * are hard to reach, and unreachable defensive branches are indistinguishable
 * from broken ones.
 */
function validate(row, { allowed, now, maxAgeHours = MAX_AGE_HOURS }) {
  if (!row || typeof row !== 'object') return { ok: false, why: 'not an object' };

  const symbol = TICKERS[String(row.symbol ?? '').trim().toLowerCase()];
  if (!symbol) {
    return { ok: false, why: `unknown ticker ${JSON.stringify(row.symbol)} — not one of the six instruments` };
  }
  // The map and the config must agree. If they ever do not, the map is
  // inventing a tradeable instrument, which is a §IV problem rather than a
  // typo, so it fails rather than skipping the row.
  if (!allowed.includes(symbol)) {
    throw new Error(`TICKERS maps to "${symbol}", which config/trading.json does not list — `
      + `that would make it a seventh tradeable instrument`);
  }

  const action = String(row.action ?? '').trim().toUpperCase();
  if (!ACTIONS.includes(action)) {
    return { ok: false, why: `unknown action ${JSON.stringify(row.action)} (expected ${ACTIONS.join('/')})` };
  }

  // Number(null) is 0 and Number('') is 0, so the typeof check comes first:
  // a missing price must not read as a price of zero.
  const price = typeof row.price === 'number' ? row.price : Number.NaN;
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, why: `price ${JSON.stringify(row.price)} is not a positive finite number` };
  }

  const at = Date.parse(row.timestamp ?? '');
  if (!Number.isFinite(at)) {
    return { ok: false, why: `timestamp ${JSON.stringify(row.timestamp)} is not a date` };
  }
  const ageHours = (now.getTime() - at) / 3_600_000;
  // A row from the future is a clock problem or a forged row; either way it
  // must not be treated as the freshest thing in the file.
  if (ageHours < 0) return { ok: false, why: `timestamp ${row.timestamp} is in the future` };

  return {
    ok: true,
    signal: {
      symbol, action, price,
      at: new Date(at).toISOString(),
      ageHours: Number(ageHours.toFixed(3)),
      stale: ageHours > maxAgeHours,
      timeframe: typeof row.timeframe === 'string' ? row.timeframe : null,
      source: 'tradingview',
    },
  };
}

/**
 * Read the log and fold it to the latest signal per instrument.
 *
 * `file`, `now` and `configPath` are all arguments with no environment reads,
 * so this opens no socket and a test never touches the machine's real log.
 */
function read({ file = DEFAULT_FILE, now = new Date(), maxAgeHours = MAX_AGE_HOURS,
                configPath = TRADING_CONFIG } = {}) {
  const allowed = allowedInstruments(configPath);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    // No file is a real answer: the webhook has never fired on this machine.
    // Distinct from an empty file, and distinct from every row being rejected.
    return { latest: {}, rejected: [], rows: 0, fileMissing: true };
  }

  const latest = {};
  const rejected = [];
  let rows = 0;

  for (const [i, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    rows++;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      rejected.push({ line: i + 1, why: 'not valid JSON' });
      continue;
    }
    const v = validate(parsed, { allowed, now, maxAgeHours });
    if (!v.ok) { rejected.push({ line: i + 1, why: v.why }); continue; }

    // Latest by the row's OWN timestamp, not by file order. The log is
    // append-only but rows can arrive out of order (a retried webhook, a
    // queued alert), and taking the last line would let a late-delivered old
    // alert overwrite a newer one.
    const held = latest[v.signal.symbol];
    if (!held || Date.parse(v.signal.at) >= Date.parse(held.at)) latest[v.signal.symbol] = v.signal;
  }

  return { latest, rejected, rows, fileMissing: false };
}

/**
 * How a signal relates to what the analyst independently concluded.
 *
 * Deliberately NOT a decision. It returns one of `corroborates`, `contradicts`
 * or `unrelated` for a human to read, and nothing consumes it to change a
 * recommendation. An external feed that could flip a verdict would be a
 * second opinion with no accountability — nobody in this repo can say why
 * TradingView fired, and "the alert said so" is not a reason Ahmed can check
 * at a gate.
 */
function agreement(signal, verdict) {
  if (!signal || signal.stale) return 'unrelated';
  if (signal.action === 'BUY') return verdict === 'near-low' ? 'corroborates' : verdict === 'near-high' ? 'contradicts' : 'unrelated';
  if (signal.action === 'SELL') return verdict === 'near-high' ? 'corroborates' : verdict === 'near-low' ? 'contradicts' : 'unrelated';
  return 'unrelated';
}

/** One line per instrument, plus the rejects, for `jj`. */
function format(result) {
  const lines = ['TRADINGVIEW SIGNALS'];
  if (result.fileMissing) {
    lines.push('', '  no signal log on this machine — the webhook has never fired here');
    return lines.join('\n');
  }
  const symbols = Object.keys(result.latest).sort();
  lines.push('', `  ${result.rows} row(s) read`);
  if (!symbols.length) {
    lines.push('  no usable signal for any of the six instruments');
  } else {
    for (const s of symbols) {
      const sig = result.latest[s];
      lines.push(`  ${s.padEnd(7)} ${sig.action.padEnd(8)} @ ${sig.price}`
        + `  ${sig.ageHours}h ago${sig.stale ? '  (STALE — not current)' : ''}`);
    }
  }
  if (result.rejected.length) {
    lines.push('', `  ${result.rejected.length} row(s) rejected:`);
    for (const r of result.rejected.slice(0, 10)) lines.push(`    line ${r.line}: ${r.why}`);
    if (result.rejected.length > 10) lines.push(`    … and ${result.rejected.length - 10} more`);
  }
  return lines.join('\n');
}

module.exports = {
  read, validate, agreement, format,
  TICKERS, ACTIONS, MAX_AGE_HOURS, DEFAULT_FILE,
};
