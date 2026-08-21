const BaseProvider = require('./base-provider');

class CoquiProvider extends BaseProvider {
  constructor() {
    super('coqui', { rateLimit: { requests: 50, window: 60000 } });
    this.arabicVoices = [
      'ar-fusha-male', 'ar-fusha-female',
      'ar-eg-male', 'ar-eg-female',
      'ar-gulf-male', 'ar-gulf-female',
      'ar-lev-male', 'ar-lev-female'
    ];
    this.englishVoices = ['en-us-glow', 'en-gb-cmu'];
  }

  async fetch(voiceId) {
    await this.checkRateLimit();
    
    const allVoices = [...this.arabicVoices, ...this.englishVoices];
    if (!allVoices.includes(voiceId)) {
      throw new Error(`Unknown Coqui voice: ${voiceId}`);
    }

    // Mock: Real implementation calls coqui TTS
    console.log(`[Coqui] Speaking: ${voiceId}`);
    return { voice: voiceId, engine: 'coqui', status: 'ready' };
  }

  async listVoices(lang = 'ar') {
    return lang === 'ar' ? this.arabicVoices : this.englishVoices;
  }
}

module.exports = CoquiProvider;
