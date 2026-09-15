// NUMERIC FIDELITY — the port, held to the original.
//
// code/content-fidelity.js is a port of
// automation/phase-b/content_generator.py's check_numeric_fidelity(). Two
// implementations of one rule in two languages WILL drift — the same failure
// as two staleness thresholds for one word, which this repo corrected once
// already. Porting without pinning them would be creating that hazard and
// walking away.
//
// So the centre of this suite is not hand-written expectations: it is
// fixtures/numeric-fidelity-cases.json, GENERATED FROM the Python by
// scripts/gen-fidelity-fixture.py and read by the Python's suite too. Those
// expectations are not opinions about what fidelity should do — they are what
// the original actually does.
//
// The fixture is the authority and whichever implementation leaves it fails
// its own suite — not "both fail", which is the tempting overstatement. Both
// are in CI so a Python change plus a regenerated fixture cannot move the
// goalposts past this port unnoticed.
//
// Everything below the fixture loop is about the port's own edges, not about
// re-litigating the rules.
const fs = require('fs');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const F = require('./content-fidelity.js');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

// --- the pin: every case the Python produces, this port must reproduce ----

const cases = F.loadCases();

test('the fixture exists and is not empty', () => {
  // A silently-empty fixture would make the loop below vacuous — every case
  // passing because there are none. This suite's whole value is that loop.
  assert.ok(Array.isArray(cases), 'fixture has no cases array');
  assert.ok(cases.length >= 10, `only ${cases.length} shared cases — the pin is too thin to mean much`);
});

for (const c of cases) {
  test(`fixture: ${c.name}`, () => {
    const got = F.checkNumericFidelity(c.source, ...c.generated);
    assert.deepStrictEqual(got, c.suspects,
      `port disagrees with automation/phase-b/content_generator.py.\n` +
      `  source:    ${c.source}\n  generated: ${JSON.stringify(c.generated)}\n` +
      `  python:    ${JSON.stringify(c.suspects)}\n  this port: ${JSON.stringify(got)}\n` +
      `  The fixture is authoritative. Fix the port, or change the Python and ` +
      `regenerate with scripts/gen-fidelity-fixture.py — never edit the fixture by hand.`);
  });
}

test('every fixture case is actually exercised above', () => {
  // A loop over a fixture is only as good as the fixture being read. If
  // loadCases() ever returns [] (wrong path, renamed key), the loop silently
  // runs zero assertions and this suite reports success having checked
  // nothing — the vacuous-pass shape code/sweep.js exists to catch.
  assert.ok(cases.every((c) => typeof c.source === 'string' && Array.isArray(c.generated)),
    'a fixture case is malformed, so its assertion proves nothing');
  assert.ok(cases.some((c) => c.suspects.length > 0),
    'no fixture case expects a suspect — the checker could return [] always and pass');
  assert.ok(cases.some((c) => c.suspects.length === 0),
    'no fixture case expects a clean result — the checker could flag everything and pass');
});

// --- the port's own edges -------------------------------------------------

test('normalizeNumber strips thousands separators and trailing punctuation', () => {
  assert.strictEqual(F.normalizeNumber('1,200'), '1200');
  assert.strictEqual(F.normalizeNumber('24.00.'), '24');
  assert.strictEqual(F.normalizeNumber('24.00'), '24');
  assert.strictEqual(F.normalizeNumber('22.25'), '22.25');
});

test('normalizeNumber keeps % significant', () => {
  // 40 and 40% are not interchangeable in a rate claim.
  assert.strictEqual(F.normalizeNumber('40%'), '40%');
  assert.notStrictEqual(F.normalizeNumber('40%'), F.normalizeNumber('40'));
});

test('normalizeNumber returns unparseable input unchanged rather than NaN', () => {
  // A NaN token would compare unequal to itself and flag every text as
  // inventing it.
  assert.strictEqual(F.normalizeNumber('...'), '...');
  assert.strictEqual(F.normalizeNumber(''), '');
  assert.ok(!String(F.normalizeNumber('abc')).includes('NaN'));
});

test('number words are matched on word boundaries, not substrings', () => {
  // "tone" contains "one"; without \b it would contribute the token 1 and
  // make a source mentioning "tone" satisfy a generated "1".
  assert.ok(!F.numericTokens('a measured tone').has('1'));
  assert.ok(F.numericTokens('just one').has('1'));
});

test('a source with no numbers flags every number in the text', () => {
  assert.deepStrictEqual(
    F.checkNumericFidelity('no figures here', 'it rose 12% to 340'), ['12%', '340']);
});

test('suspects keep first-seen order', () => {
  // The order is what a retry prompt quotes back; a stable one makes the
  // retry reproducible.
  assert.deepStrictEqual(
    F.checkNumericFidelity('nothing', 'saw 5 then 3'), ['5', '3']);
});

test('the same invented number ACROSS texts is listed once', () => {
  // Deduplication only bites across generated texts — within one text the
  // token set already collapses repeats, which is why the single-text version
  // of this test let a mutation removing the dedup escape. A retry prompt
  // quoting "5, 5, 5" reads as three separate problems.
  assert.deepStrictEqual(
    F.checkNumericFidelity('nothing', 'saw 5', 'also 5', 'still 5'), ['5']);
  assert.deepStrictEqual(
    F.checkNumericFidelity('nothing', 'saw 5', 'and 7', 'then 5'), ['5', '7']);
});

test('no generated texts means nothing to suspect', () => {
  assert.deepStrictEqual(F.checkNumericFidelity('a source with 42'), []);
});

test('it makes no model call and opens no socket', () => {
  // Template §6's rule applied here: detection must be cheap and
  // deterministic, or it cannot run on every draft. A model call would also
  // make the check flaky, which is worse than not having it.
  const src = fs.readFileSync(path.join(__dirname, 'content-fidelity.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['http', 'https', 'net', 'child_process']) {
    assert.ok(!new RegExp(`require\\(['"]${banned}['"]\\)`).test(src), `requires ${banned}`);
  }
  assert.ok(!/\bfetch\s*\(/.test(src), 'calls fetch');
});

test('THE KNOWN LIMIT is documented, not just absent', () => {
  // A garbled restatement of a number that WAS in the source is not caught,
  // and the dangerous reading of "we have a fidelity check" is that invented
  // content is now impossible. The module must keep saying so.
  const src = fs.readFileSync(path.join(__dirname, 'content-fidelity.js'), 'utf8');
  assert.ok(/DOES NOT CATCH|does not catch/.test(src),
    'the module no longer states what it cannot catch');
  assert.ok(/125/.test(src), 'the concrete example of the limit was removed');
  // And the behaviour itself, so the doc is not the only thing asserting it.
  assert.deepStrictEqual(
    F.checkNumericFidelity('a pause prevents tariffs rising to 125%',
      'a pause on tariffs from 125% to 125%'), []);
});

finish();
