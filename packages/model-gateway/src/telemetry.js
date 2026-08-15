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
    // One malformed/partial line (e.g. process killed mid-append) used to
    // throw and take down the whole read; skip just that line instead,
    // matching code/memory.js's readObserved().
    return fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  }

  return { record, readAll };
}

module.exports = { createTelemetry };
