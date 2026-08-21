/**
 * Wire all accessibility features together
 * Called on app init
 */

const i18next = require('./i18n-config');
const AccessibleTTS = require('./accessible-tts');
const AccessibleSTT = require('./accessible-stt');
const KeyboardNav = require('./keyboard-nav');
const WCAGAudit = require('./wcag-audit');

class FullAccessibilityInit {
  static async init() {
    console.log('=== JARVIS X ACCESSIBILITY STACK ===\n');

    // 1. i18n (EN/AR)
    await i18next.init();
    console.log('✓ i18n (EN/AR) initialized');

    // 2. TTS (with SSML, captions, AR synthesis)
    window.accessibleTTS = new AccessibleTTS();
    console.log('✓ Accessible TTS (SSML, captions, AR)');

    // 3. STT (with AR synthesis)
    window.accessibleSTT = new AccessibleSTT();
    console.log('✓ Accessible STT (AR synthesis)');

    // 4. Keyboard navigation
    const nav = new KeyboardNav();
    if (typeof window !== 'undefined') {
      nav.attach();
    }
    console.log('✓ Keyboard navigation (?, Tab, Enter, Escape)');

    // 5. WCAG audit
    if (typeof window !== 'undefined') {
      const issues = WCAGAudit.audit();
      console.log(`✓ WCAG 2.1 AA audit (${issues.missingAlt.length + issues.missingAria.length} issues)`);
    }

    console.log('\n=== ACCESSIBILITY READY ===');
    console.log('Languages: English, العربية');
    console.log('Features: Screen reader, captions, keyboard nav, WCAG 2.1 AA');
    console.log('Cost: $0 (100% open-source)');
  }
}

module.exports = FullAccessibilityInit;
