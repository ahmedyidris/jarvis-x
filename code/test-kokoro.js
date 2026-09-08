const fs = require('fs');
const { spawn } = require('child_process');
const { synthesize, ACCENTS } = require('./kokoro.js');

// Round-trip through the STT already wired into voice.js/stt.js. A file
// existing and playing back is not proof it says the right thing --
// transcribing it back and comparing content is.
function transcribe(wavFile) {
  return new Promise((resolve, reject) => {
    const py = spawn('python3', ['-c', `
import sys
from faster_whisper import WhisperModel
model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
segments, info = model.transcribe(sys.argv[1], beam_size=5)
print(" ".join(seg.text for seg in segments))
`, wavFile]);
    let out = '', err = '';
    py.stdout.on('data', d => out += d);
    py.stderr.on('data', d => err += d);
    py.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(err)));
  });
}

const wordsMatch = (heard, expectedWords) => {
  const h = heard.toLowerCase();
  return expectedWords.every(w => h.includes(w));
};

(async () => {
  let pass = 0;
  const results = [];
  const check = (label, ok) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (ok) pass++; };

  const total = 5;

  check('model files present', fs.existsSync(require('path').join(__dirname, '..', 'models', 'kokoro', 'kokoro-v1.0.onnx')));

  check('australian falls back to a real voice (no native AU voice exists)',
    ACCENTS.australian.fallback === true && ACCENTS.australian.voice === ACCENTS.british.voice);

  try {
    const usWav = await synthesize('The quick brown fox jumps over the lazy dog near the harbor.', 'american', '/tmp/test-kokoro-us.wav');
    const usHeard = await transcribe(usWav);
    check(`american accent round-trips ("${usHeard}")`, wordsMatch(usHeard, ['quick', 'brown', 'fox', 'lazy', 'dog']));
  } catch (e) {
    check(`american accent round-trips (${e})`, false);
  }

  try {
    const gbWav = await synthesize('The quick brown fox jumps over the lazy dog near the harbour.', 'british', '/tmp/test-kokoro-gb.wav');
    const gbHeard = await transcribe(gbWav);
    check(`british accent round-trips ("${gbHeard}")`, wordsMatch(gbHeard, ['quick', 'brown', 'fox', 'lazy', 'dog']));
  } catch (e) {
    check(`british accent round-trips (${e})`, false);
  }

  try {
    await synthesize('bad voice test', 'klingon', '/tmp/test-kokoro-bad.wav');
    check('unknown accent is rejected', false);
  } catch (_e) {
    check('unknown accent is rejected', true);
  }

  results.forEach(r => console.log(r));
  console.log(`\n${pass}/${total} passed`);
  process.exitCode = pass === total ? 0 : 1;
})();
