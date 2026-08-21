const assert = require('assert');
const i18next = require('./i18n-config');
const AccessibleTTS = require('./accessible-tts');
const AccessibleSTT = require('./accessible-stt');
const KeyboardNav = require('./keyboard-nav');

async function runFullAccessibilityTests() {
  console.log('=== FULL ACCESSIBILITY TESTS ===\n');

  // Test 1: i18n EN/AR
  console.log('[Test 1] i18n EN/AR');
  assert.strictEqual(i18next.t('submit', { lng: 'en' }), 'Submit');
  assert.strictEqual(i18next.t('submit', { lng: 'ar' }), 'إرسال');
  console.log('✓ PASS');

  // Test 2: Language detection
  console.log('[Test 2] Language detection');
  const tts = new AccessibleTTS();
  assert.strictEqual(tts.detectLanguage('Hello world'), 'en');
  assert.strictEqual(tts.detectLanguage('السلام عليكم'), 'ar');
  console.log('✓ PASS');

  // Test 3: SSML generation
  console.log('[Test 3] SSML generation');
  const ssml = tts.textToSSML('Hello world', { lang: 'en', rate: 1.0 });
  assert(ssml.includes('<speak>'));
  assert(ssml.includes('<prosody'));
  console.log('✓ PASS');

  // Test 4: STT AR synthesis
  console.log('[Test 4] STT AR synthesis');
  const stt = new AccessibleSTT();
  const result = await stt.transcribe(null, { lang: 'ar' });
  assert.strictEqual(result.language, 'ar');
  console.log('✓ PASS');

  // Test 5: Keyboard hotkeys
  console.log('[Test 5] Keyboard hotkeys');
  const kb = new KeyboardNav();
  assert(kb.hotkeys.has('?'));
  assert(kb.hotkeys.has('Escape'));
  assert(kb.hotkeys.has('Enter'));
  console.log('✓ PASS');

  console.log('\n=== ALL FULL ACCESSIBILITY TESTS PASSED ===');
}

runFullAccessibilityTests().catch(console.error);
