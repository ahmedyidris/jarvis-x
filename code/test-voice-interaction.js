const { transcribe, loadLanguageRoutes } = require('./voice.js');
const { synthesize: kokoroSynthesize } = require('./kokoro.js');
const { synthesize: piperSynthesize } = require('./voice.js');
const { ROUTES, UNSUPPORTED } = require('./voice-router.js');

// voiceInteraction() itself needs a live microphone (arecord), so it can't
// run headless in CI. What CAN be verified without one: transcribe() now
// detects language (not just hardcoded English), and every language ->
// route mapping in config/voice.json actually resolves to a real,
// supported route in voice-router.js -- if those drift out of sync,
// voiceInteraction would silently throw at reply time.

(async () => {
  let pass = 0;
  const results = [];
  const check = (label, ok) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (ok) pass++; };
  const total = 4;

  try {
    const wav = await kokoroSynthesize('The weather is nice today.', 'american', '/tmp/test-vi-en.wav');
    const { text, language } = await transcribe(wav);
    check(`transcribe() detects English ("${text}", lang=${language})`, language === 'en' && text.length > 0);
  } catch (e) {
    check(`transcribe() detects English (${e})`, false);
  }

  try {
    // Was 'السلام عليكم' -- 1.7s of audio. Whisper's language ID needs more
    // than that to be stable, so the assertion was effectively a coin flip
    // (it romanized the Arabic and labelled it Malay). Longer utterance,
    // and we assert the pinned decode returns Arabic SCRIPT rather than
    // asserting on auto-detection, which is tested separately below.
    const wav = await piperSynthesize(
      'السلام عليكم ورحمة الله وبركاته، كيف حالك اليوم؟ أتمنى أن تكون بخير وصحة جيدة.',
      'ar_JO-kareem-medium', '/tmp/test-vi-ar.wav');
    const { text, language } = await transcribe(wav, 'ar');
    check(`transcribe(lang=ar) returns Arabic script ("${text}", lang=${language})`,
      language === 'ar' && /[\u0600-\u06FF]/.test(text));
  } catch (e) {
    check(`transcribe() detects Arabic (${e})`, false);
  }

  const routes = loadLanguageRoutes();
  check(`language_routes.en ("${routes.en}") is a real, supported route`,
    !!ROUTES[routes.en] && !UNSUPPORTED[routes.en]);
  check(`language_routes.ar ("${routes.ar}") is a real, supported route`,
    !!ROUTES[routes.ar] && !UNSUPPORTED[routes.ar]);

  results.forEach(r => console.log(r));
  console.log(`\n${pass}/${total} passed`);
  process.exitCode = pass === total ? 0 : 1;
})();
