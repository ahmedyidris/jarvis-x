#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, 'code');
const testFiles = fs.readdirSync(testDir).filter(f => f.startsWith('test-') && f.endsWith('.js'));

let total = 0, passed = 0, failed = 0;

for (const file of testFiles) {
  const fullPath = path.join(testDir, file);
  console.log(`\n▶ ${file}`);
  const result = spawnSync('node', [fullPath], { encoding: 'utf8', stdio: 'pipe' });
  const output = result.stdout + result.stderr;
  console.log(output);

  // Count lines that start with "✅" or "❌" if our helper is used,
  // or we can count "OK" and "BLOCKED"/"reject".
  // For now, we use a simple heuristic: if output contains "BLOCKED" or "reject" or "FAIL", it's a failure.
  const hasFailure = /BLOCKED|reject|FAIL|❌/.test(output);
  const hasSuccess = /OK|✅/.test(output);
  // If there's any failure marker, mark as fail; else if success marker, pass.
  // If neither, assume pass? But we need to be conservative.
  if (hasFailure) {
    console.error(`❌ ${file} FAILED`);
    failed++;
  } else if (hasSuccess) {
    console.log(`✅ ${file} PASSED`);
    passed++;
  } else {
    // No clear markers – assume pass if exit code 0, else fail.
    if (result.status === 0) {
      console.log(`✅ ${file} PASSED (exit 0)`);
      passed++;
    } else {
      console.error(`❌ ${file} FAILED (exit ${result.status})`);
      failed++;
    }
  }
  total++;
}

console.log(`\nSummary: ${passed} passed, ${failed} failed, ${total} total`);
process.exit(failed === 0 ? 0 : 1);
