const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { propose } = require('./agent.js');

// Record audio using arecord
function record(duration = 5) {
  return new Promise((resolve, reject) => {
    const file = '/tmp/recording.wav';
    const args = ['-d', duration, '-f', 'cd', '-t', 'wav', file];
    const proc = spawn('arecord', args);
    proc.on('close', (code) => {
      if (code === 0) resolve(file);
      else reject(`arecord exited with ${code}`);
    });
    proc.on('error', reject);
  });
}

// Transcribe with faster-whisper. Uses the multilingual "tiny" model (not
// "tiny.en") and lets it auto-detect the spoken language -- this is what
// voiceInteraction() uses to pick which TTS voice/accent to reply with, so
// it needs to know what language it heard, not just assume English.
function transcribe(wavFile) {
  return new Promise((resolve, reject) => {
    const py = spawn('python3', ['-c', `
import sys, json
from faster_whisper import WhisperModel
model = WhisperModel("tiny", device="cpu", compute_type="int8")
segments, info = model.transcribe(sys.argv[1], beam_size=5)
text = " ".join(seg.text for seg in segments).strip()
print(json.dumps({"text": text, "language": info.language}))
`, wavFile]);
    let output = '';
    py.stdout.on('data', d => output += d);
    py.stderr.on('data', d => console.error(d.toString()));
    py.on('close', (code) => {
      if (code !== 0) { reject(`transcribe failed`); return; }
      try { resolve(JSON.parse(output.trim())); }
      catch (e) { reject(`transcribe: could not parse output: ${output}`); }
    });
  });
}

// Synthesize text to a wav file using Piper (no playback -- lets callers verify
// the audio, e.g. by transcribing it back, before ever touching a speaker).
function synthesize(text, voice = 'en_US-amy-medium', outFile = '/tmp/speech.wav') {
  return new Promise((resolve, reject) => {
    const modelPath = path.join(process.env.HOME, '.local/share/piper-tts/voices', voice + '.onnx');
    if (!fs.existsSync(modelPath)) {
      reject(`Voice model not found: ${modelPath}`);
      return;
    }
    const proc = spawn('piper', ['--model', modelPath, '--output_file', outFile]);
    proc.stdin.write(text);
    proc.stdin.end();
    proc.on('close', (code) => {
      if (code === 0) resolve(outFile);
      else reject(`piper exited with ${code}`);
    });
    proc.on('error', reject);
  });
}

// Speak text using Piper
function say(text, voice = 'en_US-amy-medium') {
  return new Promise((resolve, reject) => {
    synthesize(text, voice).then((wav) => {
      const play = spawn('aplay', [wav]);
      play.on('close', (c) => (c === 0 ? resolve() : reject(`aplay exited with ${c}`)));
      play.on('error', reject);
    }, reject);
  });
}

// Which route (see voice-router.js) to reply in, based on the language STT
// detected in what the user said. Assumes the agent replies in the same
// language it was asked in -- true for the fixed strings below, but not
// guaranteed for propose()'s own answers; a real bilingual reply pipeline
// would need the agent to report what language it answered in, not just
// infer it from the question. Config-driven so it's a one-line change to
// point 'ar' at ar-gulf instead of ar-jo, add more languages, etc.
function loadLanguageRoutes() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'voice.json'), 'utf8'));
    return cfg.language_routes || { en: 'en-us' };
  } catch (e) {
    return { en: 'en-us' };
  }
}

// Voice interaction: listen, transcribe (detecting language), run agent,
// speak the result back through voice-router.js in a matching voice.
async function voiceInteraction(duration = 5) {
  // Lazy require: voice-router.js requires this file back (to call Piper),
  // so this can't be a top-level require without creating a cycle -- same
  // pattern already used in code/router.js for gemini.js.
  const { say: routedSay } = require('./voice-router.js');

  console.log('🎤 Listening...');
  const wav = await record(duration);
  console.log('🔄 Transcribing...');
  const { text, language } = await transcribe(wav);
  fs.unlinkSync(wav);
  if (!text) {
    console.log('No speech detected.');
    return;
  }
  console.log(`📝 You said (${language}): "${text}"`);
  const routes = loadLanguageRoutes();
  const route = routes[language] || routes.en || 'en-us';

  const result = await propose(text, { tag: 'voice' });
  if (result.error) {
    console.error('❌', result.error);
    return;
  }
  // Speak the result if it's an answer or has a text field
  if (result.action && result.action.type === 'answer') {
    const reply = result.action.text;
    console.log(`🗣️ Jarvis says: "${reply}"`);
    await routedSay(reply, route);
  } else {
    // For other actions, summarize or just say "Done"
    const summary = `Executed ${result.action?.type || 'action'}`;
    console.log(`✅ ${summary}`);
    await routedSay(summary, route);
  }
}

module.exports = { record, transcribe, synthesize, say, voiceInteraction, loadLanguageRoutes };
