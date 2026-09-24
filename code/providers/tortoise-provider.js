const BaseProvider = require('./base-provider');

/**
 * TORTOISE VOICE PROVIDER — a registry of intentions, not cloned voices. See
 * piper-provider.js's header for the shared reasoning and the
 * `source: 'mock'` convention.
 *
 * WHY THIS ONE NEEDED MORE THAN A TAG. registerClonedVoice() accepted any
 * `modelPath` string without looking at the filesystem, and fetch() then
 * returned `{ cloned: true }` and logged "Speaking with cloned voice". So a
 * caller could register `./voices/my-voice/model.pt`, a path that does not
 * exist on this machine, and get back a confident claim that a clone of
 * Ahmed's voice had spoken. code/test-voice-full-system.js does exactly that
 * and prints "✓ PASS" for it.
 *
 * Voice cloning is not a detail here: cloning his own Egyptian Arabic voice
 * is a carried-over open item in MASTER_PLAN_v5, waiting on a ~5GB checkpoint
 * he has not sourced. "Registered" must not read as "cloned".
 *
 * So registration now records whether the model file is actually present, and
 * a voice whose model is missing is `cloned: false` with the path named. That
 * is a fact about the filesystem rather than a judgement, so it needs no
 * heuristic and cannot drift.
 */
const fs = require('fs');

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
    if (!voiceConfig.modelPresent) {
      throw new Error(
        `refusing to report speech from a clone that does not exist: `
        + `${voiceId}'s model is not at ${voiceConfig.model}`);
    }

    this.logRequest(voiceId, 'MOCK (no synthesis — use code/voice-router.js)', null);
    return {
      voice: voiceId, engine: 'tortoise', cloned: true, accent: voiceConfig.accent,
      source: 'mock', audio: null,
    };
  }

  async registerClonedVoice(voiceId, config) {
    // Checked at registration rather than only at fetch, so `listClonedVoices`
    // and anything reading the record see the same fact.
    let modelPresent = false;
    try { modelPresent = fs.statSync(config.modelPath).isFile(); } catch { modelPresent = false; }
    this.clonedVoices.set(voiceId, {
      voiceId,
      lang: config.lang,
      accent: config.accent,
      gender: config.gender,
      model: config.modelPath,
      modelPresent,
      registeredAt: new Date().toISOString()
    });
    return { voiceId, modelPresent };
  }

  async listClonedVoices() {
    return Array.from(this.clonedVoices.keys());
  }
}

module.exports = TortoiseProvider;
