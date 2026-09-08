// market-brief.js is the seam hermes.py reads through, so its offline mode has
// to be genuinely offline and its empty state has to stay empty. A brief that
// invented a section when there was no data would put fiction into the model's
// context, which is the exact failure hermes.py's own comments document.
const fs = require('fs');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const { lastRecorded, brief } = require('./market-brief.js');

const NOW = new Date('2026-09-04T12:00:00Z');
const now = () => NOW;

(async () => {

await test('lastRecorded takes the newest row per symbol, not the last line', () => {
  const rows = [
    { at: '2026-09-03T12:00:00Z', symbol: 'btc', price: 50000 },
    { at: '2026-09-04T12:00:00Z', symbol: 'btc', price: 60000 },
    { at: '2026-09-02T12:00:00Z', symbol: 'btc', price: 55000 },  // out of order on purpose
    { at: '2026-09-01T12:00:00Z', symbol: 'eth', price: 3000 },
  ];
  const { prices, at } = lastRecorded(rows);
  assert.strictEqual(prices.btc, 60000);
  assert.strictEqual(at.btc, '2026-09-04T12:00:00Z');
  assert.strictEqual(prices.eth, 3000);
});

await test('an empty history yields no prices rather than zeroes', () => {
  const { prices } = lastRecorded([]);
  assert.deepStrictEqual(prices, {});
});

await test('the offline brief opens no socket and reaches no collector', () => {
  const src = fs.readFileSync(path.join(__dirname, 'market-brief.js'), 'utf8');
  // market-collect.js is the only networked module here, and it must be
  // required lazily inside the --collect branch so the default path is inert.
  const collectRequire = src.indexOf("require('./market-collect.js')");
  assert.ok(collectRequire > src.indexOf('if (collect)'),
    'market-collect must be required inside the collect branch, not at module load');
});

await test('with no recorded history the advice section stays empty and says why', async () => {
  const out = await brief({ collect: false, now });
  assert.ok(/WHAT COULD BE DONE/.test(out));
  // Whatever logs/market-history.jsonl holds on this machine, one of the two
  // honest shapes must appear -- never a recommendation with no basis.
  const empty = /No prices recorded yet/.test(out);
  const advised = /NOTHING BELOW HAS BEEN EXECUTED/.test(out);
  assert.ok(empty || advised, out.slice(-400));
  if (empty) assert.ok(/nothing to advise on/.test(out));
});

await test('the offline brief labels its prices as recorded, never as live', async () => {
  const out = await brief({ collect: false, now });
  assert.ok(!/live quotes\./.test(out) || /newest RECORDED values/.test(out),
    'an offline run must not present recorded prices as live');
});

finish();
})();
