/**
 * Tests for agent + data layer integration
 * Run with: npm test code/test-agent-data-integration.js
 */

const assert = require('assert');
const AgentDataIntegration = require('./agent-data-integration');

async function runAgentDataTests() {
  console.log('=== AGENT DATA INTEGRATION TESTS ===\n');

  const agent = new AgentDataIntegration();

  // Test 1: Query resolution
  console.log('[Test 1] Query resolution (Bitcoin)');
  const key1 = await agent.resolveQuery('What is Bitcoin price?');
  assert.strictEqual(key1, 'crypto:btc', 'Resolved to crypto:btc');
  console.log('✓ PASS');

  // Test 2: Query resolution (S&P 500)
  console.log('[Test 2] Query resolution (S&P 500)');
  const key2 = await agent.resolveQuery('How is the stock market?');
  assert.strictEqual(key2, 'market:sp500', 'Resolved to market:sp500');
  console.log('✓ PASS');

  // Test 3: Query resolution (Oil)
  console.log('[Test 3] Query resolution (Oil)');
  const key3 = await agent.resolveQuery('Oil price today');
  assert.strictEqual(key3, 'energy:crude-oil-wti', 'Resolved to energy:crude-oil-wti');
  console.log('✓ PASS');

  // Test 4: Response building
  console.log('[Test 4] Response building');
  const response = await agent.buildResponse('Bitcoin price?');
  assert(response.text, 'Response text generated');
  assert(response.dataKey === 'crypto:btc', 'Data key tracked');
  assert(response.source, 'Source recorded');
  console.log('✓ PASS');

  // Test 5: Graceful degradation (unknown query)
  console.log('[Test 5] Graceful degradation');
  const fallback = await agent.buildResponse('Random nonsense query xyz');
  assert(fallback.text.includes("couldn't find"), 'Fallback response provided');
  assert(fallback.dataKey === null, 'No data key for unknown query');
  console.log('✓ PASS');

  console.log('\n=== ALL AGENT DATA TESTS PASSED ===');
  await agent.dataLayer.close();
}

runAgentDataTests().catch(console.error);
