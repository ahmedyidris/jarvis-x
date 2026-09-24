const BaseProvider = require('./base-provider');

/**
 * PIPER VOICE PROVIDER — a catalogue, not a synthesizer.
 *
 * IT SYNTHESIZES NOTHING, and now says so in what it returns. It used to log
 * `[Piper] Speaking: en-us-amy` and return `{ voice, engine, status: 'ready' }`
 * with no indication that no audio existed: a success shape and a log line
 * both stating that speech had happened. Every honest provider in this
 * directory tags a fabricated return with `source: 'mock'` and logs it through
 * logRequest as MOCK (see news-provider.js, crypto-provider.js,
 * market-brief-provider.js, energy-provider.js). These three voice providers
 * were the ones that did not.
 *
 * THE REAL SYNTHESIS PATH IS code/voice-router.js, which routes to
 * code/voice.js (Piper) and code/kokoro.js against actual installed model
 * files and throws when one is missing. Nothing in the product imports this
 * class; only code/test-voice-full-system.js does. Kept rather than deleted
 * because the voice LIST is real and independently useful, but the list is
 * all it is.
 */
class PiperProvider extends BaseProvider {
  constructor() {
    super('piper', { rateLimit: { requests: 100, window: 60000 } });
    this.voices = [
      'en-us-danny', 'en-us-john', 'en-us-joe',
      'en-us-amy', 'en-us-lessac',
      'en-gb-thomas', 'en-gb-alba', 'en-gb-jenny',
      'en-au-kevin', 'en-au-kimberly'
    ];
  }

  async fetch(voiceId) {
    await this.checkRateLimit();

    if (!this.voices.includes(voiceId)) {
      throw new Error(`Unknown Piper voice: ${voiceId}`);
    }

    this.logRequest(voiceId, 'MOCK (no synthesis — use code/voice-router.js)', null);
    return {
      voice: voiceId, engine: 'piper', status: 'ready',
      // `status: 'ready'` means the voice is in the catalogue, NOT that audio
      // was produced. The tag is what stops a caller reading it as the latter.
      source: 'mock', audio: null,
    };
  }

  async listVoices() {
    return this.voices;
  }
}

module.exports = PiperProvider;
