const universal = require('./universal-router.js');

const generateMarketBrief = async () => {
  const timestamp = new Date().toISOString();
  const assets = ['BTC', 'ETH', 'USDT'];
  
  console.log(`📊 Market Brief — ${timestamp}`);
  console.log('═'.repeat(50));
  
  const brief = {
    timestamp,
    assets: {}
  };
  
  for (const asset of assets) {
    const query = `Current USD price of ${asset} crypto and 24h change?`;
    try {
      const answer = await universal.ask(query, 'smart');
      brief.assets[asset] = answer;
      console.log(`\n${asset}:`);
      console.log(`  ${answer}`);
    } catch (err) {
      console.error(`  Error fetching ${asset}:`, err.message);
    }
  }
  
  return brief;
};

module.exports = { generateMarketBrief };

if (require.main === module) {
  generateMarketBrief().then(brief => {
    console.log('\n---');
    console.log('Brief logged.');
  }).catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
