const { spawn } = require('child_process');
const { synthesize } = require('./voice.js');

// Round-trip through faster-whisper to prove the audio actually says the
// right thing, not just that a wav file got written. Same discipline as
// test-kokoro.js. Uses the multilingual "tiny" model (not "tiny.en") so
// Arabic can be checked too.
function transcribe(wavFile, language) {
  return new Promise((resolve, reject) => {
    const py = spawn('python3', ['-c', `
import sys
from faster_whisper import WhisperModel
model = WhisperModel("tiny", device="cpu", compute_type="int8")
segments, info = model.transcribe(sys.argv[1], beam_size=5, language=sys.argv[2])
print(" ".join(seg.text for seg in segments))
`, wavFile, language]);
    let out = '', err = '';
    py.stdout.on('data', d => out += d);
    py.stderr.on('data', d => err += d);
    py.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(err)));
  });
}

(async () => {
  let pass = 0;
  const results = [];
  const check = (label, ok) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (ok) pass++; };
  const total = 2;

  try {
    const wav = await synthesize('The quick brown fox jumps over the lazy dog.', 'en_US-amy-medium', '/tmp/test-voice-en.wav');
    const heard = await transcribe(wav, 'en');
    const h = heard.toLowerCase();
    check(`en_US-amy round-trips ("${heard}")`, ['quick', 'brown', 'fox', 'lazy', 'dog'].every(w => h.includes(w)));
  } catch (e) {
    check(`en_US-amy round-trips (${e})`, false);
  }

  try {
    const wav = await synthesize('مرحبا كيف حالك اليوم', 'ar_JO-kareem-medium', '/tmp/test-voice-ar.wav');
    const heard = await transcribe(wav, 'ar');
    // Loose check: any of the source words (with/without trailing hamza variants) came back.
    const ok = ['حالك', 'اليوم', 'مرحب'].some(w => heard.includes(w));
    check(`ar_JO-kareem round-trips ("${heard}")`, ok);
  } catch (e) {
    check(`ar_JO-kareem round-trips (${e})`, false);
  }

  results.forEach(r => console.log(r));
  console.log(`\n${pass}/${total} passed`);
  process.exitCode = pass === total ? 0 : 1;
})();
