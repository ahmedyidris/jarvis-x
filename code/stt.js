const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Record 5 seconds of audio using arecord (Crostini has it)
const record = (duration = 5) => {
  return new Promise((resolve, reject) => {
    const file = '/tmp/recording.wav';
    const args = ['-d', duration, '-f', 'cd', '-t', 'wav', file];
    const proc = spawn('arecord', args);
    proc.on('close', (code) => {
      if (code === 0) resolve(file);
      else reject(`arecord exited with ${code}`);
    });
  });
};

// Transcribe with faster-whisper (via Python script)
const transcribe = (wavFile) => {
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
};

(async () => {
  console.log('Recording 5 seconds...');
  const wav = await record(5);
  console.log('Transcribing...');
  const text = await transcribe(wav);
  console.log('You said:', text);
  fs.unlinkSync(wav);
})();
