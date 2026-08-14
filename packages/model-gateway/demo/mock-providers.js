function createMockProvider({ name, latencyMs = 50, failureRate = 0, forceFailure = false, cost = 0.001 }) {
  let callCount = 0;
  return {
    name,
    async call(input) {
      callCount += 1;
      if (latencyMs > 0) await new Promise(resolve => setTimeout(resolve, latencyMs));
      if (forceFailure || (failureRate > 0 && Math.random() < failureRate)) {
        throw new Error(`${name} simulated failure (call #${callCount})`);
      }
      return { text: `[${name}] response to: ${String(input).slice(0, 40)}`, cost };
    },
  };
}

module.exports = { createMockProvider };
