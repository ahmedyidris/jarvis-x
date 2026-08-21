const BaseProvider = require('./base-provider');

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

    // Mock: Real implementation calls piper CLI
    console.log(`[Piper] Speaking: ${voiceId}`);
    return { voice: voiceId, engine: 'piper', status: 'ready' };
  }

  async listVoices() {
    return this.voices;
  }
}

module.exports = PiperProvider;
