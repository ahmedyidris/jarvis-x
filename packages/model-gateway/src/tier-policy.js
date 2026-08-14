function createTierPolicy(config) {
  function resolve(tierName) {
    const entry = config[tierName];
    if (!entry) throw new Error('unknown tier: ' + tierName);
    return { chain: entry.chain.slice(), gate: !!entry.gate };
  }
  return { resolve };
}

module.exports = { createTierPolicy };
