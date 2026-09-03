// Fully offline: every fetch is injected. watcher.js takes a `fetcher` for
// exactly this reason -- test-agent-data-integration.js fails in CI because it
// reaches CoinGecko for real, and adding a second test with that problem would
// be a step backwards.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const w = require('./watcher.js');

const page = (body) => `<html><head><style>.a{color:red}</style>
<script>var analytics=${Math.random()}</script></head>
<body><h1>Prices</h1>${body}</body></html>`;

(async () => {
// -------------------------------------------------------------- extractText
  await test('strips tags down to readable text', () => {
  const text = w.extractText('<p>Hello</p><div>World</div>');
  assert.ok(text.includes('Hello') && text.includes('World'), text);
  assert.ok(!text.includes('<'), 'no markup should survive');
});

  await test('script and style bodies are removed, not just their tags', () => {
  const text = w.extractText('<style>.x{color:red}</style><script>var a=1</script><p>Real</p>');
  assert.ok(text.includes('Real'));
  assert.ok(!text.includes('color:red'), 'style body leaked');
  assert.ok(!text.includes('var a=1'), 'script body leaked');
});

  await test('a changing analytics blob does not change the text', () => {
  // The whole point of stripping scripts: otherwise every check reports a change.
  assert.strictEqual(
    w.fingerprint(w.extractText(page('<p>$100</p>'))),
    w.fingerprint(w.extractText(page('<p>$100</p>'))));
});

  await test('decodes the common entities', () => {
  const text = w.extractText('<p>Tom&nbsp;&amp;&nbsp;Jerry &lt;3 &quot;x&quot;</p>');
  assert.ok(text.includes('Tom & Jerry'), text);
  assert.ok(text.includes('<3'), text);
});

// -------------------------------------------------------------------- narrow
  await test('include pattern narrows to the region that matters', () => {
  const text = 'Sidebar noise\nPrice: $42.00\nFooter junk';
  assert.strictEqual(w.narrow(text, 'Price: \\$[0-9.]+'), 'Price: $42.00');
});

  await test('include pattern matching nothing yields empty, not the whole page', () => {
  assert.strictEqual(w.narrow('a\nb', 'Price'), '');
});

  await test('no include pattern leaves the text alone', () => {
  assert.strictEqual(w.narrow('a\nb'), 'a\nb');
});

// ----------------------------------------------------------------- lifecycle
const watchers = [{ id: 'prices', url: 'https://example.invalid/p' }];

  await test('first check is a baseline, never a change', async () => {
  const out = await w.checkAll({
    watchers, state: {}, fetcher: async () => page('<p>$100</p>'),
  });
  assert.strictEqual(out.results[0].status, 'baseline');
  assert.ok(out.state.prices.hash, 'baseline must record a fingerprint');
});

  await test('identical content reports unchanged', async () => {
  const fetcher = async () => page('<p>$100</p>');
  const first = await w.checkAll({ watchers, state: {}, fetcher });
  const second = await w.checkAll({ watchers, state: first.state, fetcher });
  assert.strictEqual(second.results[0].status, 'unchanged');
});

  await test('changed content reports changed, with a diff', async () => {
  const first = await w.checkAll({
    watchers, state: {}, fetcher: async () => page('<p>$100</p>') });
  const second = await w.checkAll({
    watchers, state: first.state, fetcher: async () => page('<p>$250</p>') });
  const r = second.results[0];
  assert.strictEqual(r.status, 'changed');
  assert.ok(r.diff.added >= 1, 'should count added lines');
  assert.ok(JSON.stringify(r.diff.sample_added).includes('250'),
    'diff should quote the new value: ' + JSON.stringify(r.diff));
});

  await test('a fetch failure is an error, not a change', async () => {
  const first = await w.checkAll({
    watchers, state: {}, fetcher: async () => page('<p>$100</p>') });
  const second = await w.checkAll({
    watchers, state: first.state,
    fetcher: async () => { throw new Error('HTTP 429'); } });
  assert.strictEqual(second.results[0].status, 'error');
  assert.ok(second.results[0].error.includes('429'));
  // Crying wolf on a rate-limit would make the digest useless.
  assert.strictEqual(second.state.prices.hash, first.state.prices.hash,
    'prior fingerprint must survive a failed fetch');
});

  await test('an error does not lose the baseline for the next check', async () => {
  const first = await w.checkAll({
    watchers, state: {}, fetcher: async () => page('<p>$100</p>') });
  const errored = await w.checkAll({
    watchers, state: first.state,
    fetcher: async () => { throw new Error('boom'); } });
  const recovered = await w.checkAll({
    watchers, state: errored.state, fetcher: async () => page('<p>$100</p>') });
  assert.strictEqual(recovered.results[0].status, 'unchanged');
});

// -------------------------------------------------------------------- config
  await test('loadWatchers accepts a bare array and a {watchers:[]} wrapper', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-watch-'));
  const a = path.join(dir, 'a.json'), b = path.join(dir, 'b.json');
  fs.writeFileSync(a, JSON.stringify([{ url: 'https://x.invalid' }]));
  fs.writeFileSync(b, JSON.stringify({ watchers: [{ url: 'https://y.invalid' }] }));
  assert.strictEqual(w.loadWatchers(a).length, 1);
  assert.strictEqual(w.loadWatchers(b).length, 1);
});

  await test('loadWatchers skips disabled entries and junk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-watch-'));
  const f = path.join(dir, 'c.json');
  fs.writeFileSync(f, JSON.stringify([
    { url: 'https://a.invalid' },
    { url: 'https://b.invalid', enabled: false },
    { nourl: true },
    null,
  ]));
  assert.strictEqual(w.loadWatchers(f).length, 1);
});

  await test('a missing or malformed config yields no watchers, not a crash', () => {
  assert.deepStrictEqual(w.loadWatchers('/nonexistent/watchers.json'), []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-watch-'));
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{not json');
  assert.deepStrictEqual(w.loadWatchers(bad), []);
});

// ------------------------------------------------------------------- persist
  await test('persist writes state and appends only changed events', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-watch-'));
  const stateFile = path.join(dir, 'state.json');
  const eventsFile = path.join(dir, 'events.jsonl');

  const first = await w.checkAll({
    watchers, state: {}, fetcher: async () => page('<p>$100</p>') });
  assert.strictEqual(w.persist(first, { stateFile, eventsFile }), 0,
    'a baseline is not an event');

  const second = await w.checkAll({
    watchers, state: first.state, fetcher: async () => page('<p>$250</p>') });
  assert.strictEqual(w.persist(second, { stateFile, eventsFile }), 1);

  assert.ok(fs.existsSync(stateFile), 'state file written');
  const lines = fs.readFileSync(eventsFile, 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(JSON.parse(lines[0]).status, 'changed');
});

// -------------------------------------------------------------------- digest
  await test('digest counts everything and quotes only what changed', async () => {
  const many = [
    { id: 'a', url: 'https://a.invalid' },
    { id: 'b', url: 'https://b.invalid' },
  ];
  const first = await w.checkAll({
    watchers: many, state: {}, fetcher: async () => page('<p>$100</p>') });
  const second = await w.checkAll({
    watchers: many, state: first.state,
    // Match the host exactly: 'b.invalid' also contains an 'a'.
    fetcher: async (url) => url === 'https://a.invalid'
      ? page('<p>$999</p>') : page('<p>$100</p>') });
  const text = w.digest(second.results);
  assert.ok(text.includes('1 changed'), text);
  assert.ok(text.includes('CHANGED  a'), text);
  assert.ok(!text.includes('CHANGED  b'), 'unchanged watcher must not be listed');
});

  finish();
})();
