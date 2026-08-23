require('dotenv').config();
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

// Invariants for the live-data snapshot that feeds the dashboard.
// These hold whether APIs are up, rate-limited, or keyless -- so the test
// catches real regressions without flaking when a free tier caps out.
async function runTests() {
  console.log('\n=== LIVE DATA SNAPSHOT TESTS ===\n');

  const script = path.join(__dirname, '..', 'scripts', 'live-data.js');

  console.log('[Test 1] Script emits parseable JSON on stdout');
  const stdout = execFileSync('node', [script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 60000,
    cwd: path.join(__dirname, '..'),
  });
  let snap;
  try {
    snap = JSON.parse(stdout);
  } catch (err) {
    assert(false, `stdout was not JSON (logs leaking to stdout?): ${stdout.slice(0, 120)}`);
  }
  console.log('✓ PASS');

  console.log('[Test 2] Snapshot shape');
  assert(Array.isArray(snap.items), 'items is an array');
  assert(snap.items.length > 0, 'at least one item');
  assert(typeof snap.total === 'number', 'total is a number');
  assert(snap.total === snap.items.length, 'total matches item count');
  console.log('✓ PASS');

  console.log('[Test 3] Every item declares its origin');
  for (const it of snap.items) {
    assert(typeof it.id === 'string' && it.id, `item has id`);
    assert(typeof it.origin === 'string' && it.origin, `${it.id} declares origin`);
    assert(typeof it.live === 'boolean', `${it.id} declares live as boolean`);
  }
  console.log('✓ PASS');

  console.log('[Test 4] live=true never means mock or error');
  for (const it of snap.items) {
    if (it.live) {
      assert(it.origin !== 'mock', `${it.id} claims live but origin is mock`);
      assert(it.origin !== 'error', `${it.id} claims live but origin is error`);
      assert(it.error === null, `${it.id} claims live but carries an error`);
    }
  }
  console.log('✓ PASS');

  console.log('[Test 5] Live items carry usable data');
  for (const it of snap.items) {
    if (!it.live) continue;
    const hasValue = typeof it.value === 'number' && Number.isFinite(it.value);
    const hasHeadline = typeof it.headline === 'string' && it.headline.length > 0;
    assert(hasValue || hasHeadline, `${it.id} is live but has neither value nor headline`);
    if (hasValue) assert(it.value !== 0, `${it.id} live value is suspiciously zero`);
    assert(it.asOf, `${it.id} is live but has no asOf timestamp`);
  }
  console.log('✓ PASS');

  console.log('[Test 6] Failed items degrade honestly');
  for (const it of snap.items) {
    if (it.origin === 'error') {
      assert(it.live === false, `${it.id} errored but still claims live`);
      assert(it.error, `${it.id} errored but gives no reason`);
      assert(it.value === null, `${it.id} errored but still reports a value`);
    }
  }
  console.log('✓ PASS');

  console.log('[Test 7] live_count matches reality');
  const actual = snap.items.filter(i => i.live).length;
  assert(snap.live_count === actual, `live_count ${snap.live_count} != actual ${actual}`);
  console.log('✓ PASS');

  const live = snap.items.filter(i => i.live).map(i => i.id);
  const mock = snap.items.filter(i => !i.live).map(i => i.id);
  console.log(`\nlive (${live.length}): ${live.join(', ') || 'none'}`);
  console.log(`not live (${mock.length}): ${mock.join(', ') || 'none'}`);
  console.log('\n=== ALL TESTS PASSED ===');
}

runTests().catch(err => {
  console.error(err.message);
  process.exit(1);
});
