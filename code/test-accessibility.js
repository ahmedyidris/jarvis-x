// Accessibility features: i18n strings and the ARIA label builder.
//
// CONVERTED 2026-09-09 FROM A SUITE THAT COULD NOT FAIL. It ended in
// `runAccessibilityTests().catch(console.error)`, so an AssertionError was
// caught, printed, and the process exited 0 — proven by breaking
// accessibility-utils.js's `aria-label` key and watching the suite print
// "ALL ACCESSIBILITY TESTS PASSED" alongside the AssertionError, then exit 0.
//
// That is instance seven of the exact defect this repo keeps finding, and
// .github/workflows/test.yml already documents the identical line in
// test-data-layer.js: "it ended in `runTests().catch(console.error)` so it
// exited 0 even when the module under test was gone entirely."
//
// It was also invisible to every control: sweep.js only checks suites IN the
// CI list, and this one was not in it. code/weekly-sweep.js's orphan detector
// is what surfaced it.
//
// Every assertion below is the original, unchanged. The only edits are the
// harness (so a failure exits non-zero and a count is reported) and the fuse.
const { test, finish, assert } = require('./test-helper.js');
const i18next = require('./i18n-config');
const A11Y = require('./accessibility-utils');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

test('i18n resolves English', () => {
  assert.strictEqual(i18next.t('submit', { lng: 'en' }), 'Submit');
});

test('i18n resolves Arabic', () => {
  assert.strictEqual(i18next.t('submit', { lng: 'ar' }), 'إرسال');
});

test('the ARIA label builder sets both aria-label and role', () => {
  const label = A11Y.label('Submit query');
  assert.strictEqual(label['aria-label'], 'Submit query');
  assert.strictEqual(label.role, 'button');
});

// The original skipped this outside a browser and printed SKIP. A skip that
// prints and asserts nothing is indistinguishable from a pass, so the handler
// is exercised with a stub event instead — it needs only `.key` and
// `.preventDefault`, not a DOM. (I first stubbed just `.key` and the converted
// harness immediately failed on the missing preventDefault, which is the whole
// point of a suite that can fail.)
const keyEvent = (key) => {
  let prevented = false;
  return { key, preventDefault: () => { prevented = true; }, wasPrevented: () => prevented };
};

test('the key handler fires on Enter, and suppresses the default action', () => {
  let called = false;
  const e = keyEvent('Enter');
  A11Y.onKeyHandler(() => { called = true; })(e);
  assert.strictEqual(called, true);
  assert.strictEqual(e.wasPrevented(), true,
    'Enter on a button must not also submit the surrounding form');
});

test('Space activates too — a button is not keyboard-accessible on Enter alone', () => {
  let called = false;
  A11Y.onKeyHandler(() => { called = true; })(keyEvent(' '));
  assert.strictEqual(called, true);
});

test('the key handler ignores other keys', () => {
  let called = false;
  const e = keyEvent('a');
  A11Y.onKeyHandler(() => { called = true; })(e);
  assert.strictEqual(called, false, 'every keypress must not trigger the action');
  assert.strictEqual(e.wasPrevented(), false, 'and must not suppress ordinary typing');
});

finish();
