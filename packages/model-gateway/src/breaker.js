function createBreaker({ failureThreshold = 3, cooldownMs = 30_000, maxCooldownMs = cooldownMs * 8, now = () => Date.now() } = {}) {
  const state = new Map();

  function get(provider) {
    if (!state.has(provider)) {
      state.set(provider, { status: 'CLOSED', consecutiveFailures: 0, openCount: 0, openedAt: null });
    }
    return state.get(provider);
  }

  function effectiveCooldown(openCount) {
    const backoff = cooldownMs * Math.pow(2, Math.max(0, openCount - 1));
    return Math.min(backoff, maxCooldownMs);
  }

  function isOpen(provider) {
    const s = get(provider);
    if (s.status === 'OPEN' && now() - s.openedAt >= effectiveCooldown(s.openCount)) {
      s.status = 'HALF_OPEN';
    }
    return s.status === 'OPEN';
  }

  function recordSuccess(provider) {
    const s = get(provider);
    s.status = 'CLOSED';
    s.consecutiveFailures = 0;
    s.openCount = 0;
    s.openedAt = null;
  }

  function recordFailure(provider) {
    const s = get(provider);
    if (s.status === 'HALF_OPEN') {
      s.openCount += 1;
      s.status = 'OPEN';
      s.openedAt = now();
      return;
    }
    s.consecutiveFailures += 1;
    if (s.consecutiveFailures >= failureThreshold) {
      s.openCount += 1;
      s.status = 'OPEN';
      s.openedAt = now();
    }
  }

  function snapshot() {
    const out = {};
    for (const [provider, s] of state.entries()) out[provider] = { ...s };
    return out;
  }

  function load(snap) {
    for (const [provider, s] of Object.entries(snap || {})) state.set(provider, { ...s });
  }

  return { isOpen, recordSuccess, recordFailure, snapshot, load };
}

module.exports = { createBreaker };
