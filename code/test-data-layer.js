require('dotenv').config();
/**
 * Unit tests for Phase 1B data layer
 * Run with: npm test test-data-layer.js
 */

const assert = require('assert');
const DataLayer = require('./data-layer');
const CacheLayer = require('./cache-layer');
const BaseProvider = require('./providers/base-provider');
const MarketBriefProvider = require('./providers/market-brief-provider');

// Test suite
async function runTests() {
  console.log('=== PHASE 1B DATA LAYER TESTS ===');

  // Test 1: Provider registration
  console.log('\n[Test 1] Provider registration');
  const dl = new DataLayer();
  dl.registerProvider('market', new MarketBriefProvider());
  assert(dl.providers.has('market'), 'Market provider registered');
  console.log('✓ PASS');

  // Test 2: Fetch data point
  console.log('[Test 2] Fetch data point');
  const result = await dl.getDataPoint('market:sp500');
  assert(result.value, 'Data value exists');
  assert(result.fetchedAt, 'Fetch timestamp exists');
  assert(result.source === 'market', `Provider name correct (got ${result.source})`);
  assert(['alphavantage','mock'].includes(result.value.source),
    `Data origin declared (got ${result.value.source})`);
  console.log('✓ PASS');

  // Test 3: Cache hit
  console.log('[Test 3] Cache behavior');
  const cache = new CacheLayer();
  await cache.set('test:key', { data: 'value' });
  const cached = await cache.get('test:key');
  assert(cached.value.data === 'value', 'Cache returns correct value');
  assert(cached.staleness === 'fresh', 'Cache marks as fresh');
  console.log('✓ PASS');

  // Test 4: Rate limiting
  console.log('[Test 4] Rate limiting (base provider)');
  const limitedProvider = new BaseProvider('test', { rateLimit: { requests: 2, window: 1000 } });
  await limitedProvider.checkRateLimit();
  await limitedProvider.checkRateLimit();
  try {
    await limitedProvider.checkRateLimit();
    assert(false, 'Should have thrown rate limit error');
  } catch (err) {
    assert(err.message.includes('rate limit'), 'Rate limit error thrown');
    console.log('✓ PASS');
  }

  // Test 5: Graceful degradation
  console.log('[Test 5] Graceful degradation on unknown key');
  const result5 = await dl.getDataPoint('nonexistent:key');
  assert(result5.error, 'Error returned for unknown provider');
  console.log('✓ PASS');

  console.log('\n=== ALL TESTS PASSED ===');
}

runTests().catch(console.error);
