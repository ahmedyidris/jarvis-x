const assert = require('assert');
let passed = 0, failed = 0;

function test(name, fn) {
  function onPass() {
    console.log(`✅ ${name}`);
    passed++;
  }
  function onFail(e) {
    console.error(`❌ ${name}: ${e.message}`);
    failed++;
  }

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      // Async test: return the promise so the caller can await it, and make
      // sure a rejection is caught/counted the same way a sync throw is.
      return result.then(onPass, onFail);
    }
    onPass();
  } catch (e) {
    onFail(e);
  }
}

function finish() {
  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

module.exports = { test, finish, assert };
