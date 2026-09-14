/**
 * NUMERIC FIDELITY — a port, and the lesson it carries.
 *
 * PLAN_5 §6.2's content pipeline drafts a script from sourced material. The
 * failure that costs most there is not a bad sentence, it is a CONFIDENT
 * INVENTED NUMBER: an LLM restating a sourced claim and quietly adding a
 * statistic that was never in it.
 *
 * THIS IS NOT A HYPOTHETICAL AND IT IS NOT NEW. `REMAINING_WORK.md` §P4
 * records at least four confirmed occurrences in this repo's OTHER content
 * pipeline (`automation/phase-b/`): two fabricated digits at build time
 * ("40%", "29.5%"), then two garbled restatements in a single later batch.
 * Each was caught by a human reading generated JSON against its source. The
 * Python fix — `content_generator.py`'s `check_numeric_fidelity()` — is the
 * original, and every rule in it documents a FALSE POSITIVE that once made
 * the enforcer refuse to ship correct content.
 *
 * So the JS content path could either re-learn all of that, or inherit it.
 * This is the inheriting.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TWO IMPLEMENTATIONS IS A DRIFT HAZARD, AND HERE IS THE PIN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A second copy of a rule in a second language will drift from the first —
 * that is the same failure as two staleness thresholds for one word, which
 * this repo already corrected once. Porting without addressing it would be
 * creating the hazard and walking away.
 *
 * So both implementations are held to ONE file: `fixtures/numeric-fidelity-
 * cases.json`, generated FROM the Python by `scripts/gen-fidelity-fixture.py`
 * and read by both suites. The expectations there are not opinions about what
 * fidelity should do — they are what the original actually does.
 *
 * PRECISELY WHAT THAT BUYS, because the tempting summary overstates it: the
 * fixture is the authority, and whichever implementation leaves it fails its
 * own suite. Demonstrated both ways rather than assumed — breaking `%`
 * significance here reddens this suite and correctly leaves the Python green,
 * and breaking the same rule in the Python reddens the Python's.
 *
 * The one gap it cannot close on its own: changing the Python AND regenerating
 * the fixture without re-running this port's suite would move the goalposts
 * silently. That is why BOTH suites are in CI — the next push catches it — and
 * why `scripts/gen-fidelity-fixture.py` says in its own docstring that a
 * changed expectation wants explaining in the commit message rather than
 * absorbing.
 *
 * Same idea as `sweep.js` reading the CI list out of `test.yml` rather than
 * keeping its own copy: the two cannot disagree because there is only one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IT DELIBERATELY DOES NOT CATCH
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A number that was ALREADY in the source but is restated into nonsense. The
 * Python's own docstring names the real example: "a 90-day pause... from 125%
 * to 125%" — 125 is genuine, and the bug is that the sentence states no change
 * happened. A token diff cannot see that; it needs semantic judgment, which in
 * Phase B is a separate Gemini judge.
 *
 * This is stated loudly, and a fixture case pins it, because the dangerous
 * reading of "we have a fidelity check" is that invented content is now
 * impossible. It is not. This catches a number appearing from nowhere, cheaply
 * and deterministically, with no model call and therefore no added flakiness.
 */
const fs = require('fs');
const path = require('path');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'numeric-fidelity-cases.json');

/** Mirrors the Python's `_NUMBER_WORDS`. One to twenty, as it has. */
const NUMBER_WORDS = Object.freeze({
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14',
  fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20',
});

/**
 * '24.00.' -> '24', '1,200' -> '1200', '40%' -> '40%'.
 *
 * Compares numeric VALUE, not string. The Python's comment explains what this
 * costs to get wrong: a regex that swallowed trailing sentence punctuation
 * turned a faithful "costs EGP 24.00." into the token '24.00.', absent from a
 * source saying '24.00', and therefore reported as invented — burning the
 * retries and then refusing to ship correct content.
 *
 * `%` stays significant: 40 and 40% are not interchangeable in a rate claim.
 */
function normalizeNumber(raw) {
  const pct = raw.endsWith('%');
  let body = pct ? raw.slice(0, -1) : raw;
  body = body.replace(/,/g, '').replace(/\.+$/, '');
  if (!body) return raw;
  const val = Number(body);
  if (!Number.isFinite(val)) return raw;
  const out = Number.isInteger(val) ? String(val) : String(val);
  return pct ? `${out}%` : out;
}

/**
 * Number-like tokens, normalized so punctuation and insignificant zeros do
 * not create spurious mismatches.
 *
 * The two rewrites before tokenizing are both load-bearing, and both are the
 * Python's:
 *   1. "percent"/"pct"/"percentage points" -> "%", BEFORE range expansion,
 *      because the token regex only recognises the symbol. Without it, a
 *      spelled-out restatement tokenizes bare and cannot match a source that
 *      used '%'.
 *   2. In a range the unit is written once and governs both endpoints —
 *      "3.5% to 3.75%", "3.5-3.75%". Without expansion the leading number
 *      tokenizes bare and a faithful restatement is flagged. The strict case
 *      survives: a standalone 24% still will not match a bare 24.
 */
function numericTokens(text) {
  const withSymbol = String(text).replace(
    /(\d)\s*(?:percentage points?|percent|pct)\b/gi, '$1%');
  const ranged = withSymbol.replace(
    /(\d[\d,]*(?:\.\d+)?)(\s*(?:--|-|to|and)\s*)(\d[\d,]*(?:\.\d+)?)(\s*(?:%|percent))/gi,
    '$1$4$2$3$4');
  const raw = ranged.match(/\d[\d,]*(?:\.\d+)?%?/g) || [];
  const tokens = new Set(raw.map(normalizeNumber));
  const lower = withSymbol.toLowerCase();
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) tokens.add(digit);
  }
  return tokens;
}

/**
 * Numbers present in `generatedTexts` but absent from `sourceFact`.
 *
 * Returns an ARRAY in first-seen order rather than a Set, because the order is
 * what a retry prompt quotes back and a stable one makes the retry
 * reproducible. Matches the Python's return shape exactly — the fixture
 * compares them element by element.
 */
function checkNumericFidelity(sourceFact, ...generatedTexts) {
  const sourceTokens = numericTokens(sourceFact);
  const suspects = [];
  for (const text of generatedTexts) {
    for (const tok of numericTokens(text)) {
      if (!sourceTokens.has(tok) && !suspects.includes(tok)) suspects.push(tok);
    }
  }
  return suspects;
}

/**
 * The shared ground truth. Read by this module's suite AND by the Python's,
 * so a disagreement fails both rather than silently favouring one.
 */
function loadCases(file = FIXTURE) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).cases;
}

module.exports = {
  checkNumericFidelity, numericTokens, normalizeNumber, loadCases,
  NUMBER_WORDS, FIXTURE,
};
