/**
 * VoiceLayerManager — routes queries to correct TTS engine by accent
 * Supports: Piper (EN), Coqui (AR/EN), Tortoise (cloning)
 */

const VOICE_MANIFEST = require('./voice-manifest.json');

class VoiceLayerManager {
  constructor() {
    this.manifest = VOICE_MANIFEST;
    this.activeProvider = null;
    this.clonedVoices = new Map();
  }

  /**
   * Get all available voices for a language
   */
  getVoicesByLanguage(lang) {
    if (lang === 'en') {
      return this.manifest.voices.english;
    } else if (lang === 'ar') {
      return this.manifest.voices.arabic;
    }
    return null;
  }

  /**
   * Get specific voice by accent/gender
   */
  getVoice(lang, accent, gender = 'male') {
    const voices = this.getVoicesByLanguage(lang);
    if (!voices || !voices[accent] || !voices[accent][gender]) {
      return null;
    }
    return voices[accent][gender][0]; // Return first voice
  }

  /**
   * List all available accents for a language
   */
  listAccents(lang) {
    const voices = this.getVoicesByLanguage(lang);
    return voices ? Object.keys(voices) : [];
  }

  /**
   * Select voice for TTS
   */
  selectVoice(lang, accent, gender = 'male') {
    const voice = this.getVoice(lang, accent, gender);
    if (!voice) {
      return { error: `Voice not found: ${lang} ${accent} ${gender}` };
    }
    return {
      voiceId: voice.id,
      engine: voice.engine,
      accent,
      gender,
      quality: voice.quality,
      cloned: voice.cloned || false
    };
  }

  /**
   * Register a cloned voice (your voice, custom voices)
   */
  registerClonedVoice(voiceId, config) {
    this.clonedVoices.set(voiceId, {
      ...config,
      engine: 'tortoise',
      cloned: true,
      registered: new Date().toISOString()
    });
    console.log(`[VoiceLayerManager] Registered cloned voice: ${voiceId}`);
  }

  /**
   * Get voice stats
   */
  getStats() {
    const totalVoices = this.countVoices();
    return {
      totalVoices,
      engines: Object.keys(this.manifest.engines),
      languages: ['en', 'ar'],
      clonedVoices: this.clonedVoices.size,
      manifest: {
        english: Object.keys(this.manifest.voices.english),
        arabic: Object.keys(this.manifest.voices.arabic)
      }
    };
  }

  countVoices() {
    let count = 0;
    for (const lang in this.manifest.voices) {
      for (const accent in this.manifest.voices[lang]) {
        for (const gender in this.manifest.voices[lang][accent]) {
          count += this.manifest.voices[lang][accent][gender].length;
        }
      }
    }
    return count;
  }
}

module.exports = VoiceLayerManager;
