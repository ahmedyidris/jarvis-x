/**
 * Wire accessibility components into agent
 * Called on app init
 */

const i18next = require('./i18n-config');
const A11Y = require('./accessibility-utils');
const CaptionLayer = require('./caption-layer');
const ScreenReaderTest = require('./screen-reader-test');

class AccessibilityIntegration {
  static async init() {
    console.log('[A11Y] Initializing accessibility...');

    // 1. i18n
    await i18next.init();
    console.log(`[A11Y] i18n ready (language: ${i18next.language})`);

    // 2. Captions
    const captions = new CaptionLayer();
    captions.init();
    window.captions = captions;
    console.log('[A11Y] Caption layer ready');

    // 3. Keyboard help
    document.addEventListener('keydown', (e) => {
      if (e.key === '?') {
        A11Y.showKeyboardHelp();
      }
    });
    console.log('[A11Y] Keyboard shortcuts enabled (press ? for help)');

    // 4. Screen reader audit available
    console.log('[A11Y] Run ScreenReaderTest.audit() in console for accessibility audit');

    // 5. Announce ready state
    A11Y.announce(i18next.t('accessibility') + ' features loaded', 'assertive');
  }

  // Called after every Hermes TTS response
  static wireTTSCaption(hermesResponse) {
    if (window.captions) {
      window.captions.wireToTTS(hermesResponse);
    }
  }
}

module.exports = AccessibilityIntegration;
