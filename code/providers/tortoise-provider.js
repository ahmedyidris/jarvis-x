const BaseProvider = require('./base-provider');

class TortoiseProvider extends BaseProvider {
  constructor() {
    super('tortoise', { rateLimit: { requests: 10, window: 60000 } });
    this.clonedVoices = new Map();
  }

  async fetch(voiceId) {
    await this.checkRateLimit();
    
    if (!this.clonedVoices.has(voiceId)) {
      throw new Error(`Cloned voice not found: ${voiceId}`);
    }

    const voiceConfig = this.clonedVoices.get(voiceId);
    console.log(`[Tortoise] Speaking with cloned voice: ${voiceId} (${voiceConfig.accent})`);
    return { voice: voiceId, engine: 'tortoise', cloned: true, accent: voiceConfig.accent };
  }

  async registerClonedVoice(voiceId, config) {
    this.clonedVoices.set(voiceId, {
      voiceId,
      lang: config.lang,
      accent: config.accent,
      gender: config.gender,
      model: config.modelPath,
      registeredAt: new Date().toISOString()
    });
    console.log(`[Tortoise] Registered cloned voice: ${voiceId}`);
  }

  async listClonedVoices() {
    return Array.from(this.clonedVoices.keys());
  }
}

module.exports = TortoiseProvider;
