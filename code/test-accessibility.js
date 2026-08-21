/**
 * Unit tests for accessibility features
 * Run with: npm test code/test-accessibility.js
 */

const assert = require('assert');
const i18next = require('./i18n-config');
const A11Y = require('./accessibility-utils');

async function runAccessibilityTests() {
  console.log('=== ACCESSIBILITY TESTS ===\n');

  // Test 1: i18n English
  console.log('[Test 1] i18n English');
  const enSubmit = i18next.t('submit', { lng: 'en' });
  assert.strictEqual(enSubmit, 'Submit');
  console.log('✓ PASS');

  // Test 2: i18n Arabic
  console.log('[Test 2] i18n Arabic');
  const arSubmit = i18next.t('submit', { lng: 'ar' });
  assert.strictEqual(arSubmit, 'إرسال');
  console.log('✓ PASS');

  // Test 3: ARIA label builder
  console.log('[Test 3] ARIA label builder');
  const label = A11Y.label('Submit query');
  assert(label['aria-label'] === 'Submit query');
  assert(label.role === 'button');
  console.log('✓ PASS');

  // Test 4: Keyboard handler (skip in Node.js, browser-only)
  if (typeof KeyboardEvent !== 'undefined') {
    console.log('[Test 4] Keyboard handler');
    let called = false;
    const handler = A11Y.onKeyHandler(() => { called = true; });
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
    handler(enterEvent);
    assert(called);
    console.log('✓ PASS');
  } else {
    console.log('[Test 4] Keyboard handler — SKIP (browser-only test)');
  }

  console.log('\n=== ALL ACCESSIBILITY TESTS PASSED ===');
}

runAccessibilityTests().catch(console.error);
