const { spawn } = require('child_process');
const { synthesize, resolveRoute } = require('./voice-router.js');

// Step 3 self-test per the build plan: feed the router several inputs,
// confirm each is routed to the right engine, and confirm the resulting
// audio is actually correct (round-tripped through STT), not just "no error".
function transcribe(wavFile, language) {
  return new Promise((resolve, reject) => {
    const py = spawn('python3', ['-c', `
import sys
from faster_whisper import WhisperModel
model = WhisperModel("tiny" if sys.argv[2] != "en" else "tiny.en", device="cpu", compute_type="int8")
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
  const total = 8;

  // --- routing correctness (pure, no audio) ---
  check('en-us routes to kokoro/american', (() => {
    try { const r = resolveRoute('en-us'); return r.engine === 'kokoro' && r.accent === 'american'; } catch { return false; }
  })());
  check('ar (default) routes to piper/ar_JO-kareem-medium', (() => {
    try { const r = resolveRoute('ar'); return r.engine === 'piper' && r.voice === 'ar_JO-kareem-medium'; } catch { return false; }
  })());
  check('ar-eg is rejected, not silently misrouted', (() => {
    try { resolveRoute('ar-eg'); return false; } catch (e) { return /no cpu-viable/i.test(e.message); }
  })());
  check('unknown code is rejected', (() => {
    try { resolveRoute('xx-yy'); return false; } catch { return true; }
  })());

  // --- end-to-end: routed audio is actually correct ---
  const cases = [
    { code: 'en-us', text: 'The quick brown fox jumps over the lazy dog.', lang: 'en', match: h => ['quick', 'brown', 'fox'].every(w => h.includes(w)) },
    { code: 'en-gb', text: 'The quick brown fox jumps over the lazy dog.', lang: 'en', match: h => ['quick', 'brown', 'fox'].every(w => h.includes(w)) },
    { code: 'ar-jo', text: 'مرحبا كيف حالك اليوم', lang: 'ar', match: h => h.includes('حالك') || h.includes('اليوم') },
    { code: 'ar-gulf', text: 'السلام عليكم', lang: 'ar', match: h => h.includes('السلام') && h.includes('عليكم') },
  ];

  for (const c of cases) {
    try {
      const wav = await synthesize(c.text, c.code, `/tmp/test-router-${c.code}.wav`);
      const heard = await transcribe(wav, c.lang);
      check(`${c.code} routes end-to-end to correct audio ("${heard}")`, c.match(heard.toLowerCase()));
    } catch (e) {
      check(`${c.code} routes end-to-end to correct audio (${e})`, false);
    }
  }

  results.forEach(r => console.log(r));
  console.log(`\n${pass}/${total} passed`);
  process.exitCode = pass === total ? 0 : 1;
})();
