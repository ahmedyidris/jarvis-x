const assert = require('assert');
let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

function finish() {
  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

module.exports = { test, finish, assert };
