/**
 * Full voice system test
 * Tests: manifest, manager, providers, accents
 */

const assert = require('assert');
const VoiceLayerManager = require('./voice-layer-manager');
const PiperProvider = require('./providers/piper-provider');
const CoquiProvider = require('./providers/coqui-provider');
const TortoiseProvider = require('./providers/tortoise-provider');

async function testFullVoiceSystem() {
  console.log('=== FULL VOICE SYSTEM TEST ===\n');

  const manager = new VoiceLayerManager();

  // Test 1: List English accents
  console.log('[Test 1] English accents');
  const enAccents = manager.listAccents('en');
  assert(enAccents.includes('us'));
  assert(enAccents.includes('uk'));
  assert(enAccents.includes('au'));
  console.log(`✓ PASS (${enAccents.length} accents: ${enAccents.join(', ')})`);

  // Test 2: List Arabic accents
  console.log('[Test 2] Arabic accents');
  const arAccents = manager.listAccents('ar');
  assert(arAccents.includes('fusha'));
  assert(arAccents.includes('egyptian'));
  assert(arAccents.includes('gulf'));
  assert(arAccents.includes('levantine'));
  console.log(`✓ PASS (${arAccents.length} accents: ${arAccents.join(', ')})`);

  // Test 3: Select English voice
  console.log('[Test 3] Select English voice (US male)');
  const enVoice = manager.selectVoice('en', 'us', 'male');
  assert.strictEqual(enVoice.engine, 'piper');
  assert.strictEqual(enVoice.gender, 'male');
  console.log('✓ PASS');

  // Test 4: Select Arabic voice (Egyptian)
  console.log('[Test 4] Select Arabic voice (Egyptian male)');
  const arVoice = manager.selectVoice('ar', 'egyptian', 'male');
  assert.strictEqual(arVoice.engine, 'coqui');
  assert.strictEqual(arVoice.accent, 'egyptian');
  console.log('✓ PASS');

  // Test 5: Register cloned voice
  console.log('[Test 5] Register cloned voice (Your Egyptian voice)');
  manager.registerClonedVoice('my-voice-egyptian', {
    lang: 'ar',
    accent: 'egyptian',
    gender: 'male',
    modelPath: './voices/my-voice/model.pt'
  });
  const clonedVoice = manager.selectVoice('ar', 'egyptian', 'male'); // Should find cloned version
  assert(clonedVoice);
  console.log('✓ PASS');

  // Test 6: Voice stats
  console.log('[Test 6] Voice system stats');
  const stats = manager.getStats();
  assert(stats.totalVoices > 10);
  console.log(`✓ PASS (${stats.totalVoices} total voices, ${stats.clonedVoices} cloned)`);

  // Test 7: Piper provider
  console.log('[Test 7] Piper provider');
  const piper = new PiperProvider();
  const piperVoices = await piper.listVoices();
  assert(piperVoices.length > 5);
  console.log(`✓ PASS (${piperVoices.length} English voices)`);

  // Test 8: Coqui provider
  console.log('[Test 8] Coqui provider (Arabic)');
  const coqui = new CoquiProvider();
  const coquiArabic = await coqui.listVoices('ar');
  assert(coquiArabic.length > 4);
  console.log(`✓ PASS (${coquiArabic.length} Arabic voices)`);

  // Test 9: Tortoise provider (cloning)
  console.log('[Test 9] Tortoise provider (cloning)');
  const tortoise = new TortoiseProvider();
  await tortoise.registerClonedVoice('my-voice-eg', {
    lang: 'ar',
    accent: 'egyptian',
    gender: 'male',
    modelPath: './voices/my-voice/model.pt'
  });
  const clonedVoices = await tortoise.listClonedVoices();
  assert(clonedVoices.includes('my-voice-eg'));
  console.log('✓ PASS');

  console.log('\n=== ALL VOICE SYSTEM TESTS PASSED ===');
  console.log(`Total voices: ${stats.totalVoices}`);
  console.log(`English accents: ${enAccents.join(', ')}`);
  console.log(`Arabic accents: ${arAccents.join(', ')}`);
  console.log(`Cloned voices: my-voice-egyptian`);
}

testFullVoiceSystem().catch(console.error);
