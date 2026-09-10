/**
 * TRADING PHASE 1 — the honest performance measurement.
 *
 * PLAN_5 §6.1 lists phase 1 as "bot trader, TradingView signals, local models
 * on analysis, paper execution on the six instruments, and **the honest
 * performance measurement that makes phase 2 a decision rather than a guess**."
 * Execution exists (code/paper-trading.js, 22 assertions, six instruments,
 * enforced limits). This is the last clause, and it is the one phase 2 hangs
 * off: Ahmed's ruling was "1 then 2", so the real-money question does not get
 * asked until there is a measured result to ask it against.
 *
 * READS ONLY. This module opens no socket, places no order, and imports
 * nothing that can. It reads logs/trading-journal.jsonl and computes. There is
 * no code path from here to a broker, which is the same property
 * DECISION_RECORD_paper-trading.md records for the executor.
 *
 * WHAT "HONEST" HAS TO MEAN HERE, because a performance report is the easiest
 * document in software to lie with by accident. Every rule below exists to
 * defeat a specific way a paper-trading result flatters itself:
 *
 *   1. A WIN RATE ON SEVEN TRADES IS NOT A WIN RATE. Five wins out of seven is
 *      71% and means nothing at all. The report therefore leads with a
 *      VERDICT, and the default verdict is `insufficient-evidence` — the
 *      hardest of the three to escape.
 *   2. REALIZED-ONLY P&L FLATTERS A BOOK THAT NEVER CLOSES LOSERS. Holding
 *      every loser open and banking every winner produces a beautiful realized
 *      curve and a portfolio full of wreckage. Open exposure is reported
 *      separately and never netted into the headline.
 *   3. A PROFIT INSIDE THE NOISE IS NOT A PROFIT. Expectancy is reported next
 *      to the dispersion that would swamp it.
 *   4. ZERO STOP-OUTS MEANS THE RISK MODEL IS UNTESTED, not that it works.
 *      config/trading.json derives every position size from the stop distance;
 *      if no stop has ever been hit, that derivation has never been exercised
 *      and the sizing is unvalidated however good the P&L looks.
 *   5. THE WINDOW MUST BE STATED. A result over an unstated period is a
 *      cherry-pick waiting to happen.
 *
 * THE STRONGEST VERDICT THIS MODULE CAN EVER RETURN IS `promising`. There is
 * deliberately no 'ready', 'approved' or 'go' value. Authorising real money is
 * a CONSTITUTION.md §IV amendment that only Ahmed can make, and a report that
 * could print its own approval would be doing his job for him. Same shape as
 * guard.js's gate, one domain over: the absence of evidence must never read as
 * evidence, so it gets its own value rather than defaulting either way.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JOURNAL = path.join(ROOT, 'logs', 'trading-journal.jsonl');

/**
 * The bars a run must clear before its numbers mean anything. Not tuned --
 * chosen, and stated here so the choice is arguable rather than buried.
 */
const EVIDENCE = Object.freeze({
  /** Below this, a win rate is sampling noise wearing a percentage sign. */
  minClosed: 30,
  /** A month of calendar time. Thirty trades in one afternoon is one market
   *  condition sampled thirty times, not thirty independent observations. */
  minDays: 30,
  /** If open exposure is this multiple of realized P&L or more, the realized
   *  figure is not describing the book — rule 2 above. */
  openDominatesRatio: 1.0,
});

const VERDICTS = Object.freeze(['insufficient-evidence', 'unprofitable', 'promising']);

// --- reading the journal ----------------------------------------------------

function readJournal(file = JOURNAL) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/**
 * Fold the append-only journal into positions.
 *
 * Deduplicated by (event, id): the journal is append-only and a replayed or
 * double-written line must not become a second trade. Counting one close twice
 * doubles its contribution to every statistic below it, which is the quietest
 * possible way for this report to be wrong.
 */
function reconstruct(rows) {
  const opens = new Map();
  const closes = new Map();
  for (const r of rows) {
    if (!r || !r.id) continue;
    if (r.event === 'open' && !opens.has(r.id)) opens.set(r.id, r);
    if (r.event === 'close' && !closes.has(r.id)) closes.set(r.id, r);
  }
  const closed = [...closes.values()].sort(
    (a, b) => String(a.closedAt).localeCompare(String(b.closedAt)));
  const open = [...opens.values()].filter((o) => !closes.has(o.id));
  return { closed, open, duplicates: rows.filter((r) => r && r.id).length - (opens.size + closes.size) };
}

// --- statistics -------------------------------------------------------------

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);

/** Population standard deviation of per-trade P&L. */
function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/**
 * Largest peak-to-trough fall of the realized equity curve, as a positive
 * number. Reported because a run that ends up is not the same as a run that
 * was survivable on the way: the same final P&L with a 40% drawdown is a
 * different proposition to one with 4%, and phase 2 is about risking real money.
 */
function maxDrawdown(closed, startingCapital) {
  let equity = startingCapital;
  let peak = startingCapital;
  let worst = 0;
  for (const t of closed) {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    const fall = peak - equity;
    if (fall > worst) worst = fall;
  }
  return worst;
}

/** Unrealized P&L of still-open positions, at the prices supplied. */
function markToMarket(open, prices) {
  let known = 0;
  let unpriced = 0;
  let pnl = 0;
  for (const pos of open) {
    const p = prices[pos.symbol];
    if (typeof p !== 'number' || !Number.isFinite(p)) { unpriced++; continue; }
    const direction = pos.side === 'BUY' ? 1 : -1;
    pnl += (p - pos.price) * pos.quantity * direction;
    known++;
  }
  return { pnl, known, unpriced };
}

const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

// --- the measurement --------------------------------------------------------

/**
 * @param {object[]} rows   journal rows (injected, so no test reads the real one)
 * @param {object}   prices symbol -> current price, for open positions only
 * @returns a report whose `verdict` is one of VERDICTS and whose `why` says
 *          exactly which bar decided it.
 */
function measure(rows, { prices = {}, startingCapital = 10000, evidence = EVIDENCE } = {}) {
  const { closed, open, duplicates } = reconstruct(rows);
  const pnls = closed.map((t) => t.pnl).filter((n) => typeof n === 'number' && Number.isFinite(n));
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const realized = sum(pnls);

  const from = closed.length ? closed[0].openedAt || closed[0].closedAt : null;
  const to = closed.length ? closed[closed.length - 1].closedAt : null;
  const spanDays = from && to ? daysBetween(from, to) : 0;

  const mtm = markToMarket(open, prices);
  const stoppedOut = closed.filter((t) => t.stoppedOut).length;

  const report = {
    window: { from, to, days: Number(spanDays.toFixed(2)) },
    counts: {
      closed: closed.length, open: open.length,
      wins: wins.length, losses: losses.length,
      breakEven: pnls.length - wins.length - losses.length,
      stoppedOut, duplicatesIgnored: Math.max(0, duplicates),
    },
    realized: {
      pnl: round(realized),
      returnPct: round((realized / startingCapital) * 100, 3),
      // Reported next to expectancy, per rule 3: a positive expectancy that is
      // a fraction of its own dispersion is not yet a finding.
      expectancy: round(mean(pnls)),
      dispersion: round(stdev(pnls)),
      avgWin: round(mean(wins)),
      avgLoss: round(mean(losses)),
      winRate: pnls.length ? round(wins.length / pnls.length, 4) : null,
      maxDrawdown: round(maxDrawdown(closed, startingCapital)),
    },
    // NEVER netted into `realized`. Rule 2.
    unrealized: { pnl: round(mtm.pnl), priced: mtm.known, unpriced: mtm.unpriced },
    caveats: [],
    verdict: 'insufficient-evidence',
    why: [],
  };

  // --- the bars, each naming itself when it fails --------------------------
  const blockers = [];
  if (closed.length < evidence.minClosed) {
    blockers.push(`only ${closed.length} closed trade(s); ${evidence.minClosed} is the bar ` +
                  'below which a win rate is sampling noise');
  }
  if (spanDays < evidence.minDays) {
    blockers.push(`the run spans ${spanDays.toFixed(1)} day(s); ${evidence.minDays} is the bar — ` +
                  'many trades in a short window is one market condition sampled repeatedly');
  }
  if (Math.abs(mtm.pnl) >= Math.abs(realized) * evidence.openDominatesRatio && open.length > 0) {
    blockers.push(`open exposure (${round(mtm.pnl)}) is at least as large as realized ` +
                  `(${round(realized)}), so the realized figure is not describing this book`);
  }
  if (mtm.unpriced > 0) {
    blockers.push(`${mtm.unpriced} open position(s) have no price, so the book cannot be valued`);
  }

  if (blockers.length) {
    report.verdict = 'insufficient-evidence';
    report.why = blockers;
  } else if (realized <= 0) {
    report.verdict = 'unprofitable';
    report.why = [`realized P&L is ${round(realized)} over ${closed.length} closed trade(s)`];
  } else {
    report.verdict = 'promising';
    report.why = [`realized ${round(realized)} over ${closed.length} closed trade(s) ` +
                  `across ${spanDays.toFixed(0)} days`];
  }

  // --- caveats: true regardless of verdict, and never upgrade it ------------
  if (closed.length && stoppedOut === 0) {
    report.caveats.push(
      'no position has ever been stopped out, so the stop-derived position sizing in ' +
      'config/trading.json is UNVALIDATED however good the P&L looks');
  }
  if (pnls.length >= 2 && Math.abs(mean(pnls)) < stdev(pnls)) {
    report.caveats.push(
      `per-trade expectancy (${round(mean(pnls))}) is smaller than its dispersion ` +
      `(${round(stdev(pnls))}) — the edge, if any, is inside the noise`);
  }
  if (report.counts.duplicatesIgnored > 0) {
    report.caveats.push(
      `${report.counts.duplicatesIgnored} duplicate journal line(s) ignored`);
  }

  return report;
}

function round(n, dp = 2) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Number(n.toFixed(dp));
}

function format(r) {
  const L = ['', 'PAPER TRADING — PHASE 1 MEASUREMENT', ''];
  L.push(`  verdict: ${r.verdict.toUpperCase()}`);
  for (const w of r.why) L.push(`    - ${w}`);
  L.push('');
  L.push(`  window   ${r.window.from || '(none)'} -> ${r.window.to || '(none)'}  (${r.window.days} days)`);
  L.push(`  closed   ${r.counts.closed}  (${r.counts.wins}W / ${r.counts.losses}L / ${r.counts.breakEven}BE, ` +
         `${r.counts.stoppedOut} stopped out)`);
  L.push(`  open     ${r.counts.open}`);
  L.push('');
  L.push(`  realized     ${r.realized.pnl}  (${r.realized.returnPct}%)`);
  L.push(`  expectancy   ${r.realized.expectancy} per trade, dispersion ${r.realized.dispersion}`);
  L.push(`  win rate     ${r.realized.winRate === null ? 'n/a' : `${(r.realized.winRate * 100).toFixed(1)}%`}`);
  L.push(`  max drawdown ${r.realized.maxDrawdown}`);
  L.push(`  unrealized   ${r.unrealized.pnl}  (${r.unrealized.priced} priced, ${r.unrealized.unpriced} unpriced)` +
         '   [never netted into realized]');
  if (r.caveats.length) {
    L.push('');
    L.push('  caveats:');
    for (const c of r.caveats) L.push(`    ! ${c}`);
  }
  L.push('');
  // Stated on every run, including a `promising` one. This module cannot
  // authorise anything and should not be quotable as though it had.
  L.push('  "promising" is the strongest verdict this report can return. It is not');
  L.push('  authorisation: real-money trading requires a CONSTITUTION.md §IV amendment,');
  L.push('  which is Ahmed\'s to make and no one else\'s.');
  return L.join('\n');
}

module.exports = {
  measure, format, reconstruct, readJournal,
  maxDrawdown, markToMarket, stdev, round, daysBetween,
  EVIDENCE, VERDICTS, JOURNAL,
};

if (require.main === module) {
  console.log(format(measure(readJournal())));
}
