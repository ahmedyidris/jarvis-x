const { spawn } = require('child_process');
const path = require('path');

// Kokoro-82M: local, offline, CPU-viable English TTS (American + British).
// Model files (not checked into git — see .gitignore) live in models/kokoro/,
// downloaded from https://github.com/thewh1teagle/kokoro-onnx releases.
const MODEL_DIR = path.join(__dirname, '..', 'models', 'kokoro');
const MODEL_PATH = path.join(MODEL_DIR, 'kokoro-v1.0.onnx');
const VOICES_PATH = path.join(MODEL_DIR, 'voices-v1.0.bin');

// Kokoro-82M ships American and British English voices only.
// There is no native Australian voice — the build plan's claim that Kokoro
// "natively covers American, British, Australian" does not hold; verified
// against k.get_voices() on 2026-08-12 (52 voices, prefixes a/b/e/f/h/i/j/p/z,
// no distinct AU accent exists). Australian requests fall back to British
// with a warning until a dedicated model is added.
const ACCENTS = {
  american: { voice: 'af_heart', lang: 'en-us' },
  british: { voice: 'bm_george', lang: 'en-gb' },
  australian: { voice: 'bm_george', lang: 'en-gb', fallback: true },
};

function synthesize(text, accent = 'american', outFile = '/tmp/kokoro-speech.wav') {
  return new Promise((resolve, reject) => {
    const cfg = ACCENTS[accent];
    if (!cfg) {
      reject(`Unknown accent: ${accent}. Known: ${Object.keys(ACCENTS).join(', ')}`);
      return;
    }
    if (cfg.fallback) {
      console.warn(`⚠️  No native Kokoro voice for "${accent}" — using British (${cfg.voice}) instead.`);
    }
    const py = spawn('python3', ['-c', `
import sys, soundfile as sf
from kokoro_onnx import Kokoro
k = Kokoro(sys.argv[1], sys.argv[2])
samples, sr = k.create(sys.argv[3], voice=sys.argv[4], lang=sys.argv[5])
sf.write(sys.argv[6], samples, sr)
`, MODEL_PATH, VOICES_PATH, text, cfg.voice, cfg.lang, outFile]);
    let err = '';
    py.stderr.on('data', d => err += d);
    py.on('close', (code) => {
      if (code === 0) resolve(outFile);
      else reject(`kokoro synth failed (exit ${code}): ${err.trim().split('\n').slice(-3).join(' | ')}`);
    });
    py.on('error', reject);
  });
}

function say(text, accent = 'american') {
  return new Promise((resolve, reject) => {
    synthesize(text, accent).then((wav) => {
      const play = spawn('aplay', [wav]);
      play.on('close', (c) => (c === 0 ? resolve() : reject(`aplay exited with ${c}`)));
      play.on('error', reject);
    }, reject);
  });
}

module.exports = { synthesize, say, ACCENTS };
