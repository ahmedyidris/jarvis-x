/**
 * Live caption layer for Hermes TTS output
 * Displays real-time captions for deaf/hard-of-hearing users
 */

class CaptionLayer {
  constructor() {
    this.caption = null;
    this.queue = [];
    this.enabled = localStorage.getItem('captions_enabled') !== 'false';
  }

  init() {
    const container = document.createElement('div');
    container.id = 'caption-container';
    container.style.cssText = `
      position: fixed; bottom: 60px; left: 0; right: 0;
      background: rgba(0,0,0,0.8); color: white;
      padding: 12px 20px; text-align: center;
      font-size: 16px; font-family: Arial, sans-serif;
      max-height: 80px; overflow-y: auto;
      display: ${this.enabled ? 'block' : 'none'};
    `;
    document.body.appendChild(container);
    this.caption = container;
  }

  add(text) {
    if (!this.enabled || !this.caption) return;
    this.caption.textContent = text;
    this.caption.setAttribute('aria-live', 'polite');
  }

  clear() {
    if (this.caption) {
      this.caption.textContent = '';
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('captions_enabled', this.enabled);
    if (this.caption) {
      this.caption.style.display = this.enabled ? 'block' : 'none';
    }
  }

  // Wire to TTS output: call this after every Hermes response
  wireToTTS(hermesResponse) {
    if (hermesResponse.text) {
      this.add(hermesResponse.text);
      // Auto-clear after audio duration (estimate 150 words/min)
      const estimatedDuration = (hermesResponse.text.split(' ').length / 150) * 60000;
      setTimeout(() => this.clear(), Math.max(estimatedDuration, 2000));
    }
  }
}

module.exports = CaptionLayer;
