const kokoro = require('./kokoro.js');
const piper = require('./voice.js');

// Routes a (text, langAccent) request to whichever local TTS engine actually
// covers that language/accent. Each call spawns one short-lived subprocess --
// no engine is ever kept resident, so there's never more than one model
// loaded in memory at a time (hardware constraint from the build plan).
//
// Coverage as of 2026-08-12 -- see commits bbf3b43 and 4161b5a for how each
// entry was verified (or ruled out) before being wired in here:
//   en-us          -> Kokoro-82M, native
//   en-gb          -> Kokoro-82M, native
//   en-au          -> Kokoro-82M, falls back to British (no native AU voice
//                     exists in Kokoro-82M -- the build plan's claim that it
//                     does was wrong, corrected in code/kokoro.js)
//   ar, ar-jo      -> Piper ar_JO-kareem (Jordanian; verified solid quality)
//   ar-gulf        -> Piper ar-AE-emirati-female (Emirati; verified, but an
//                     early "quality:train" checkpoint -- short phrases only)
//   ar-eg          -> NOT SUPPORTED (see UNSUPPORTED below), not silently
//                     misrouted to a different dialect
const ROUTES = {
  'en-us': { engine: 'kokoro', accent: 'american' },
  'en-gb': { engine: 'kokoro', accent: 'british' },
  'en-au': { engine: 'kokoro', accent: 'australian' },
  'ar': { engine: 'piper', voice: 'ar_JO-kareem-medium' },
  'ar-jo': { engine: 'piper', voice: 'ar_JO-kareem-medium' },
  'ar-gulf': { engine: 'piper', voice: 'ar-AE-emirati-female' },
};

// Known-missing coverage, called out explicitly so a request for it fails
// loudly with an explanation instead of falling through to "no route" or,
// worse, silently landing on the wrong dialect.
const UNSUPPORTED = {
  'ar-eg': 'Egyptian Arabic has no CPU-viable local model yet -- Habibi-TTS/NAMAA were both ruled out (diffusion architecture too slow, or too large for this machine\'s disk). Use ar-gulf or ar-jo for now, or add a model and a ROUTES entry once one is found.',
};

function resolveRoute(langAccent) {
  if (UNSUPPORTED[langAccent]) throw new Error(UNSUPPORTED[langAccent]);
  const route = ROUTES[langAccent];
  if (!route) throw new Error(`No route for "${langAccent}". Known: ${Object.keys(ROUTES).join(', ')}`);
  return route;
}

function dispatch(route, fn) {
  if (route.engine === 'kokoro') return fn(kokoro, route.accent);
  if (route.engine === 'piper') return fn(piper, route.voice);
  return Promise.reject(`Unknown engine "${route.engine}"`);
}

function synthesize(text, langAccent, outFile) {
  return new Promise((resolve, reject) => {
    let route;
    try { route = resolveRoute(langAccent); } catch (e) { reject(e.message); return; }
    dispatch(route, (engine, voiceOrAccent) => engine.synthesize(text, voiceOrAccent, outFile)).then(resolve, reject);
  });
}

function say(text, langAccent) {
  return new Promise((resolve, reject) => {
    let route;
    try { route = resolveRoute(langAccent); } catch (e) { reject(e.message); return; }
    dispatch(route, (engine, voiceOrAccent) => engine.say(text, voiceOrAccent)).then(resolve, reject);
  });
}

module.exports = { synthesize, say, resolveRoute, ROUTES, UNSUPPORTED };
