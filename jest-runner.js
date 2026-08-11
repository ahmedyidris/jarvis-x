#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, 'code');
const testFiles = fs.readdirSync(testDir)
  .filter(f => f.startsWith('test-') && f.endsWith('.js'));

let passed = 0, failed = 0;

console.log('🧪 Running Jarvis X Test Suite\n');

for (const file of testFiles) {
  const fullPath = path.join(testDir, file);
  process.stdout.write(`▶ ${file} ... `);
  const result = spawnSync('node', [fullPath], { encoding: 'utf8', stdio: 'pipe' });
  const output = result.stdout + result.stderr;

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

console.log(`\nSummary: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
