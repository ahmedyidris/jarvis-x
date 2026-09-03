#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, 'code');
const testFiles = fs.readdirSync(testDir)
  .filter(f => f.startsWith('test-') && f.endsWith('.js'))
  // Helpers, not suites: test-helper.js is the assertion library and
  // test-net.js is the JX_NET gate. Neither asserts anything on its own.
  .filter(f => f !== 'test-net.js');

let passed = 0, failed = 0, skipped = 0;
const { SKIP_MARKER } = require('./code/test-net.js');

console.log('🧪 Running Jarvis X Test Suite\n');

for (const file of testFiles) {
  const fullPath = path.join(testDir, file);
  process.stdout.write(`▶ ${file} ... `);
  const result = spawnSync('node', [fullPath], { encoding: 'utf8', stdio: 'pipe' });
  const output = result.stdout + result.stderr;

  // A gated network test opts out by printing SKIP_MARKER and exiting 0.
  // Checked BEFORE the pass branch: a skip must never be counted as a pass,
  // or gating turns into a way to inflate the number.
  if (output.includes(SKIP_MARKER)) {
    const why = (output.split(SKIP_MARKER + ':')[1] || '').trim().split('\n')[0];
    console.log(`⏭  SKIP  ${why}`);
    skipped++;
    continue;
  }

  // If the test file exits with 0, we consider it passed.
  // But we also check stderr for any "Error" or "FAIL" to be safe.
  const hasError = /Error|FAIL|❌/.test(output) && !/✅/.test(output);
  const success = result.status === 0 && !hasError;

  if (success) {
    console.log('✅ PASS');
    passed++;
  } else {
    console.log('❌ FAIL');
    console.log(output.trim());
    failed++;
  }
}

const skipNote = skipped ? `, ${skipped} skipped` : '';
console.log(`\nSummary: ${passed} passed, ${failed} failed${skipNote}`);
if (skipped) {
  console.log(`(${skipped} skipped — run \`npm run test:net\` to include network tests)`);
}
process.exit(failed === 0 ? 0 : 1);
