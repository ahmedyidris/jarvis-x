const localModule = require('./local.js');
const geminiModule = require('./gemini.js');

// Unified interface: one ask() function, auto-tier-selection
const ask = async (question, userTier = 'smart') => {
  const tier = userTier || 'smart';
  const timestamp = new Date().toISOString();
  
  console.log(`[${timestamp}] Routing to tier: ${tier}`);
  
  try {
    switch(tier) {
      case 'local':
        return await askLocal(question);
      case 'fast':
        return await askFast(question);
      case 'smart':
        return await askSmart(question);
      case 'long':
        return await askLong(question);
      default:
        throw new Error(`Unknown tier: ${tier}`);
    }
  } catch (err) {
    console.error(`[ERROR] Tier ${tier} failed:`, err.message);
    throw err;
  }
};

const askLocal = async (q) => {
  console.log('  → local qwen2.5:3b');
  return await localModule.ask(q);
};

const askFast = async (q) => {
  console.log('  → fast: Gemini Flash');
  return await geminiModule.ask(q, 'flash');
};

const askSmart = async (q) => {
  console.log('  → smart: Gemini Flash + fallback');
  return await geminiModule.ask(q, 'flash');
};

const askLong = async (q) => {
  console.log('  → long: Gemini Pro');
  return await geminiModule.ask(q, 'pro');
};

module.exports = { ask, askLocal, askFast, askSmart, askLong };

if (require.main === module) {
  const tier = process.argv[2] || 'smart';
  const question = process.argv.slice(3).join(' ') || 'Hello';
  ask(question, tier).then(answer => {
    console.log('\nAnswer:', answer);
  }).catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
