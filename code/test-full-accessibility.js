// The full accessibility stack: i18n, TTS language detection and SSML, STT,
// and keyboard navigation.
//
// CONVERTED 2026-09-09 FROM A SUITE THAT COULD NOT FAIL, for the same reason
// as code/test-accessibility.js: it ended in
// `runFullAccessibilityTests().catch(console.error)`, so an AssertionError was
// caught, printed, and the process exited 0. Instance eight of the defect
// .github/workflows/test.yml already documents in test-data-layer.js.
//
// Invisible to every control until now: sweep.js only checks suites IN the CI
// list, and this was not in it. code/weekly-sweep.js's orphan detector found it.
//
// Every assertion below is the original, unchanged. The additions are the
// harness, the fuse, and the async IIFE — Test 4 awaits, and an unawaited
// async test is the truncation bug all over again.
const { test, finish, assert } = require('./test-helper.js');
const i18next = require('./i18n-config');
const AccessibleTTS = require('./accessible-tts');
const AccessibleSTT = require('./accessible-stt');
const KeyboardNav = require('./keyboard-nav');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

(async () => {

await test('i18n resolves the same key in English and Arabic', () => {
  assert.strictEqual(i18next.t('submit', { lng: 'en' }), 'Submit');
  assert.strictEqual(i18next.t('submit', { lng: 'ar' }), 'إرسال');
});

await test('TTS detects language from the text itself', () => {
  const tts = new AccessibleTTS();
  assert.strictEqual(tts.detectLanguage('Hello world'), 'en');
  assert.strictEqual(tts.detectLanguage('السلام عليكم'), 'ar');
});

await test('SSML carries both the speak envelope and prosody', () => {
  const ssml = new AccessibleTTS().textToSSML('Hello world', { lang: 'en', rate: 1.0 });
  assert.ok(ssml.includes('<speak>'), `no <speak> in: ${ssml.slice(0, 80)}`);
  assert.ok(ssml.includes('<prosody'), `no <prosody> in: ${ssml.slice(0, 80)}`);
});

await test('STT reports the language it was asked for', async () => {
  const result = await new AccessibleSTT().transcribe(null, { lang: 'ar' });
  assert.strictEqual(result.language, 'ar');
});

await test('keyboard navigation registers its hotkeys', () => {
  const kb = new KeyboardNav();
  for (const key of ['?', 'Escape', 'Enter']) {
    assert.ok(kb.hotkeys.has(key), `hotkey "${key}" is not registered`);
  }
});

finish();
})();
