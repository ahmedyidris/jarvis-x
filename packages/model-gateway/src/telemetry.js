const fs = require('node:fs');

function createTelemetry(filePath) {
  function record(entry) {
    try {
      fs.appendFileSync(filePath, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n');
    } catch (e) {
      console.error('model-gateway telemetry: write failed (call still happened):', e.message);
    }
  }

  function readAll() {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  }

  return { record, readAll };
}

module.exports = { createTelemetry };
