#!/usr/bin/env node
// One command that answers "what do the six instruments look like, and what
// could I do about it" -- and the single entry point hermes.py shells out to,
// so the arithmetic lives in one language and cannot drift between two.
//
//   node code/market-brief.js             offline: reads recorded history only
//   node code/market-brief.js --collect   fetch live prices and record first
//
// Without --collect nothing touches the network. The "current" price is then
// the newest one this repo recorded, and the output says so rather than
// implying a live quote.
const { load, report, format: formatReport, series } = require('./market-analyst.js');
const { advise, format: formatAdvice } = require('./trade-advisor.js');
const { PaperBook } = require('./paper-trading.js');

/** Newest recorded price per symbol, with the timestamp so staleness is visible. */
function lastRecorded(rows) {
  const out = {}, at = {};
  for (const r of rows) {
    if (!at[r.symbol] || new Date(r.at) > new Date(at[r.symbol])) {
      at[r.symbol] = r.at; out[r.symbol] = r.price;
    }
  }
  return { prices: out, at };
}

async function brief({ collect = false, now = () => new Date() } = {}) {
  const sections = [];

  if (collect) {
    const C = require('./market-collect.js');
    const { results, written } = await C.collect();
    sections.push('── COLLECTION ' + '─'.repeat(50));
    sections.push(C.format(results, written));
  }

  const rows = load();
  const { prices, at } = lastRecorded(rows);

  sections.push('── WHERE PRICES SIT ' + '─'.repeat(44));
  sections.push(formatReport(report(rows, { now })));

  sections.push('');
  sections.push('── WHAT COULD BE DONE ' + '─'.repeat(42));
  if (!Object.keys(prices).length) {
    sections.push('No prices recorded yet. Run with --collect, daily, until each');
    sections.push('instrument has 20 observations. Until then there is nothing to advise on');
    sections.push('and this section will stay empty rather than invent something.');
  } else {
    const book = new PaperBook({ now });
    sections.push(formatAdvice(advise({ book, rows, prices, now })));
    const stale = Object.entries(at)
      .map(([s, t]) => `${s} ${t}`).sort();
    sections.push('');
    sections.push(collect
      ? 'Prices above are this run\'s live quotes.'
      : 'Prices above are the newest RECORDED values, not live quotes:');
    if (!collect) for (const s of stale) sections.push(`  ${s}`);
  }

  return sections.join('\n');
}

module.exports = { brief, lastRecorded };

if (require.main === module) {
  brief({ collect: process.argv.includes('--collect') })
    .then(t => { console.log(t); process.exit(0); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
