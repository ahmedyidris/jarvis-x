/**
 * Accessible TTS wrapper around Hermes
 * Adds: SSML markup, captions, screen reader hooks, AR synthesis
 */

class AccessibleTTS {
  constructor() {
    this.hermesPath = process.env.HERMES_PATH || 'python3 code/hermes.py';
    this.enabled = true;
    this.captionCallback = null;
  }

  /**
   * Speak text with accessibility features
   * - Converts to SSML for prosody control
   * - Fires captions to screen readers
   * - Auto-detects language (EN/AR)
   */
  async speak(text, options = {}) {
    const { lang = this.detectLanguage(text), rate = 1.0, pitch = 1.0 } = options;

    // 1. Convert to SSML for better prosody
    const ssml = this.textToSSML(text, { lang, rate, pitch });

    // 2. Announce to screen readers
    this.announceToScreenReader(text);

    // 3. Display captions
    if (this.captionCallback) {
      this.captionCallback(text);
    }

    // 4. Speak via Hermes
    return this.speakSSML(ssml, lang);
  }

  /**
   * Detect language from text (simple heuristic)
   * Arabic script detection
   */
  detectLanguage(text) {
    // Arabic Unicode range: U+0600 to U+06FF
    const arabicRegex = /[\u0600-\u06FF]/g;
    const arabicChars = (text.match(arabicRegex) || []).length;
    return arabicChars > text.length * 0.3 ? 'ar' : 'en';
  }

  /**
   * Convert plain text to SSML for prosody control
   */
  textToSSML(text, options) {
    const { rate, pitch } = options;
    const prosody = `rate="${rate * 100}%" pitch="${pitch * 100}%"`;
    
    let ssml = `<speak><prosody ${prosody}>`;
    
    // Break into sentences for better pausing
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    sentences.forEach((sent) => {
      ssml += `<s>${sent.trim()}</s>`;
    });

    ssml += '</prosody></speak>';
    return ssml;
  }

  /**
   * Announce to screen readers via aria-live
   */
  announceToScreenReader(text) {
    if (typeof window === 'undefined') return; // Node.js environment

    const ariaLive = document.createElement('div');
    ariaLive.setAttribute('aria-live', 'polite');
    ariaLive.setAttribute('aria-atomic', 'true');
    ariaLive.className = 'sr-only'; // visually hidden
    ariaLive.textContent = text;
    document.body.appendChild(ariaLive);

    setTimeout(() => ariaLive.remove(), 5000);
  }

  /**
   * Speak SSML via Hermes (or fallback to system TTS)
   */
  async speakSSML(ssml, lang) {
    // Strip SSML for Hermes (it doesn't understand SSML yet)
    const plainText = ssml.replace(/<[^>]+>/g, '').trim();

    return new Promise((resolve, _reject) => {
      // Use existing Hermes TTS
      // For now: just log it (Hermes integration in agent loop will handle actual TTS)
      console.log(`[TTS] ${lang.toUpperCase()}: ${plainText}`);
      resolve({ text: plainText, lang });
    });
  }

  /**
   * Register callback for captions
   */
  onCaption(callback) {
    this.captionCallback = callback;
  }
}

module.exports = AccessibleTTS;
