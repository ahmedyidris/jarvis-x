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

// Transcribe with faster-whisper
function transcribe(wavFile) {
  return new Promise((resolve, reject) => {
    const py = spawn('python3', ['-c', `
import sys
from faster_whisper import WhisperModel
model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
segments, info = model.transcribe(sys.argv[1], beam_size=5)
print(" ".join(seg.text for seg in segments))
`, wavFile]);
    let output = '';
    py.stdout.on('data', d => output += d);
    py.stderr.on('data', d => console.error(d.toString()));
    py.on('close', (code) => {
      if (code === 0) resolve(output.trim());
      else reject(`transcribe failed`);
    });
  });
}

// Speak text using Piper
function say(text, voice = 'en_US-amy-medium') {
  return new Promise((resolve, reject) => {
    const modelPath = path.join(process.env.HOME, '.local/share/piper-tts/voices', voice + '.onnx');
    if (!fs.existsSync(modelPath)) {
      reject(`Voice model not found: ${modelPath}`);
      return;
    }
    const proc = spawn('piper', ['--model', modelPath, '--output_file', '/tmp/speech.wav']);
    proc.stdin.write(text);
    proc.stdin.end();
    proc.on('close', (code) => {
      if (code !== 0) { reject(`piper exited with ${code}`); return; }
      const play = spawn('aplay', ['/tmp/speech.wav']);
      play.on('close', (c) => {
        if (c === 0) resolve();
        else reject(`aplay exited with ${c}`);
      });
    });
  });
}

// Voice interaction: listen, transcribe, run agent, speak result
async function voiceInteraction(duration = 5) {
  console.log('🎤 Listening...');
  const wav = await record(duration);
  console.log('🔄 Transcribing...');
  const text = await transcribe(wav);
  fs.unlinkSync(wav);
  if (!text) {
    console.log('No speech detected.');
    return;
  }
  console.log(`📝 You said: "${text}"`);
  const result = await propose(text);
  if (result.error) {
    console.error('❌', result.error);
    return;
  }
  // Speak the result if it's an answer or has a text field
  if (result.action && result.action.type === 'answer') {
    const reply = result.action.text;
    console.log(`🗣️ Jarvis says: "${reply}"`);
    await say(reply);
  } else {
    // For other actions, summarize or just say "Done"
    const summary = `Executed ${result.action?.type || 'action'}`;
    console.log(`✅ ${summary}`);
    await say(summary);
  }
}

module.exports = { record, transcribe, say, voiceInteraction };
