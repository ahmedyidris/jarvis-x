const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// EVERY TEST FILE THAT IMPORTS THIS AUDITS TO A TEMP LOG, NOT THE REAL ONE.
//
// Done here rather than in each test file for the same reason guard.js
// detects `origin` from argv[1] instead of an env var: it needs no
// cooperation from whoever writes the next test. A new code/test-*.js gets
// this by importing `test`, without knowing the mechanism exists.
//
// WHAT IT COST TO LEARN. logs/actions.jsonl is the machine's audit trail and
// every test run appended to it: 333 `refused-cmd` rows from test-shell.js,
// 30 `boom`/"inner failure" from test-guard.js, 29 `slow-fail`/"gemini 429",
// 21 per run from test-paper-trading, 16 each from test-watcher and
// test-market-collect. 599 of the log's failure rows were fixtures. That is
// why selfdebug.js could not be built until guard.js recorded provenance --
// its first useful report would have said "gemini 429 occurred 29 times,
// investigate the Gemini integration" about a string in test-guard.js.
//
// And provenance alone was not enough: mutation-testing guard.js corrupts a
// log permanently. The "always tag app" mutation ran test-guard.js against
// the live file and seven fixture rows ended up origin:'app' in an
// append-only log, where selfdebug.js reports them as real application
// failures -- uncorrectable without rewriting the audit trail.
//
// Those counts are from the container this was developed in. logs/ is
// gitignored, so every machine keeps its own audit log and none is shared;
// the numbers differ per machine, the cause does not.
//
// .github/workflows/test.yml already stated the principle: "A test qualifies
// when its inputs are arguments rather than the environment." guard.js was
// the one module taking neither, and this closes it for every caller at once.
const TEST_AUDIT_LOG = path.join(os.tmpdir(),
  `jx-audit-${path.basename(process.argv[1] || 'test')}-${process.pid}.jsonl`);
try {
  require('./guard.js').setLogFile(TEST_AUDIT_LOG);
  process.on('exit', () => { try { fs.unlinkSync(TEST_AUDIT_LOG); } catch { /* fine */ } });
} catch (e) {
  // guard.js without the seam (an older checkout, or a partial revert). Tests
  // must still run; they will just append to the real log as they used to.
  console.error(`[test-helper] audit-log redirect unavailable: ${e.message}`);
}

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

module.exports = { test, finish, assert, TEST_AUDIT_LOG };
