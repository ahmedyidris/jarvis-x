const BaseProvider = require('./base-provider');

/**
 * COQUI VOICE PROVIDER — a catalogue, not a synthesizer. See
 * piper-provider.js's header for the shared reasoning and for the
 * `source: 'mock'` convention the rest of this directory already follows.
 *
 * ONE THING HERE IS WORSE THAN A GENERIC FAKE SUCCESS, and it is the reason
 * this file is worth reading twice. Its catalogue advertises `ar-eg-male` and
 * `ar-eg-female`, and it used to return `status: 'ready'` for them.
 * code/voice-router.js — the real router, with its verification history in
 * commits bbf3b43 and 4161b5a — lists `ar-eg` under UNSUPPORTED and THROWS
 * for it, with an explicit reason: "Egyptian Arabic has no CPU-viable local
 * model yet -- Habibi-TTS/NAMAA were both ruled out". Its own comment says
 * `ar-eg` must fail loudly rather than be "silently misrouted to a different
 * dialect".
 *
 * Egyptian Arabic in Ahmed's own voice is a carried-over open item in
 * MASTER_PLAN_v5, waiting on a ~5GB checkpoint he has not sourced
 * (code/tts_worker.py's `voices/chatterbox-eg`). So this was the one voice in
 * the repo where a fabricated "ready" contradicted a documented, verified
 * refusal — and it contradicted it about the thing he is actually waiting on.
 *
 * The catalogue keeps the ar-eg entries, because listing a voice someone
 * wants is not a claim that it works. What it no longer does is report them
 * ready without a tag.
 */
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

    this.logRequest(voiceId, 'MOCK (no synthesis — use code/voice-router.js)', null);
    return {
      voice: voiceId, engine: 'coqui', status: 'ready',
      source: 'mock', audio: null,
    };
  }

  async listVoices(lang = 'ar') {
    return lang === 'ar' ? this.arabicVoices : this.englishVoices;
  }
}

module.exports = CoquiProvider;
