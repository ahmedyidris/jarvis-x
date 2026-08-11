const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Voice configuration
const VOICES = {
  'en_US-amy': { lang: 'en', gender: 'female', accent: 'us', quality: 'medium' },
  'ar_JO-kareem': { lang: 'ar', gender: 'male', accent: 'jordanian', quality: 'medium' }
};

const VOICES_DIR = path.join(os.homedir(), '.local/share/piper-tts/voices');

const DEFAULT_VOICE = 'en_US-amy';

// STT: Speech to Text (Faster-Whisper)
const transcribe = async (audioFile) => {
  return new Promise((resolve, reject) => {
    const proc = spawn('faster-whisper', [audioFile, '--model', 'base', '--language', 'en,ar']);
    let output = '';
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(`Transcription failed: ${output}`));
      }
    });
  });
};

// TTS: Text to Speech (Piper)
const synthesize = async (text, voiceKey = DEFAULT_VOICE) => {
  if (!VOICES[voiceKey]) {
    throw new Error(`Unknown voice: ${voiceKey}. Available: ${Object.keys(VOICES).join(', ')}`);
  }
  
  return new Promise((resolve, reject) => {
    const fileBase = `${voiceKey}-${VOICES[voiceKey].quality}`;
    const modelPath = path.join(VOICES_DIR, `${fileBase}.onnx`);
    const configPath = path.join(VOICES_DIR, `${fileBase}.onnx.json`);
    const outputFile = path.join(__dirname, `../tmp-output-${Date.now()}.wav`);

    if (!fs.existsSync(modelPath)) {
      reject(new Error(`Voice model not found: ${modelPath}`));
      return;
    }
    if (!fs.existsSync(configPath)) {
      reject(new Error(`Voice config not found: ${configPath}`));
      return;
    }

    const proc = spawn('piper', [
      '--model', modelPath,
      '--config', configPath,
      '--output-file', outputFile
    ]);
    
    proc.stdin.write(text);
    proc.stdin.end();
    
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputFile)) {
        resolve(outputFile);
      } else {
        reject(new Error(`TTS synthesis failed with code ${code}`));
      }
    });
  });
};

// List available voices
const listVoices = () => {
  return Object.entries(VOICES).map(([key, config]) => ({
    key,
    lang: config.lang,
    gender: config.gender,
    accent: config.accent
  }));
};

module.exports = { transcribe, synthesize, listVoices, VOICES, DEFAULT_VOICE };

if (require.main === module) {
  console.log('Available voices:');
  listVoices().forEach(v => {
    console.log(`  ${v.key}: ${v.lang} (${v.gender}, ${v.accent})`);
  });
}
