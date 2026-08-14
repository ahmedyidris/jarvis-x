// code/gateway-adapter.js
const path = require('path');
const { Gateway } = require('../packages/model-gateway/src/gateway.js');
const { createTierPolicy } = require('../packages/model-gateway/src/tier-policy.js');
const { createBreaker } = require('../packages/model-gateway/src/breaker.js');
const { createBudget } = require('../packages/model-gateway/src/budget.js');
const { createStore } = require('../packages/model-gateway/src/store.js');
const { createTelemetry } = require('../packages/model-gateway/src/telemetry.js');
const { guard } = require('./guard.js');

// Ported verbatim from code/router.js -- tier *classification* is jarvis-x
// business logic (the design spec keeps it out of the package), but the
// *behavior* per tier (chain + gate) is exactly router.js's old ROUTE table.
const CONSEQUENTIAL = new Set(['write', 'shell', 'trade']);
const HARD_HINTS = /\b(plan|design|debug|why|analyz|strateg|refactor|architect|compare)\b/i;

function classifyTier(input) {
  const { action = null, prompt = '', level = null } =
    typeof input === 'string' ? { prompt: input } : (input || {});
  if (level) return level; // caller (or an explicit 'local') wins outright
  if (action && CONSEQUENTIAL.has(action)) return 'consequential';
  if (HARD_HINTS.test(prompt) || prompt.length > 600) return 'hard';
  return 'quick';
}

const JARVIS_TIER_POLICY = {
  quick: { chain: ['flash'], gate: false },
  hard: { chain: ['pro', 'flash'], gate: false },
  consequential: { chain: ['max', 'pro', 'flash'], gate: true },
  local: { chain: ['local'], gate: false },
};

// Static per-call cost table -- spec's Non-goals explicitly rules out real
// cost estimation for v1, so these are rough $/call placeholders, not
// $/token accounting.
const COST_PER_CALL = { flash: 0.0001, pro: 0.001, max: 0.01, local: 0 };

function makeGeminiProvider(tier) {
  const { ask } = require('./gemini.js');
  return {
    async call(prompt) {
      const text = await ask(prompt, tier);
      return { text, cost: COST_PER_CALL[tier] };
    },
  };
}

function makeLocalProvider() {
  const { ask } = require('./local.js');
  return {
    async call(prompt) {
      const text = await ask(prompt);
      return { text, cost: COST_PER_CALL.local };
    },
  };
}

function makeGuardCheck() {
  return ({ tier, tag }) => guard(tag || 'gateway_call', tier);
}

function stateDir() {
  return process.env.JX_GATEWAY_STATE_DIR || path.join(__dirname, '..', 'logs');
}

let gatewayInstance = null;

function getGateway() {
  if (gatewayInstance) return gatewayInstance;
  const dir = stateDir();
  require('fs').mkdirSync(dir, { recursive: true });
  gatewayInstance = new Gateway({
    tierPolicy: createTierPolicy(JARVIS_TIER_POLICY),
    guardCheck: makeGuardCheck(),
    breaker: createBreaker(),
    budget: createBudget(),
    store: createStore(path.join(dir, 'gateway-state.db')),
    telemetry: createTelemetry(path.join(dir, 'gateway-telemetry.jsonl')),
    providers: new Map([
      ['flash', makeGeminiProvider('flash')],
      ['pro', makeGeminiProvider('pro')],
      ['max', makeGeminiProvider('max')],
      ['local', makeLocalProvider()],
    ]),
  });
  return gatewayInstance;
}

async function ask(input, options = {}) {
  const tier = classifyTier(input);
  if (!Object.keys(JARVIS_TIER_POLICY).includes(tier)) {
    // Invalid tier: bail out before guardCheck/budget so a typo'd or unknown
    // tier name produces zero side effects (no log entry, no reserved budget).
    return { text: null, provider: null, degraded: false, gated: false, blocked: true, reason: `invalid tier: ${tier}`, cost: 0 };
  }
  const prompt = typeof input === 'string' ? input : input.prompt;
  return getGateway().route(prompt, tier, options);
}

module.exports = { ask, classifyTier, JARVIS_TIER_POLICY, getGateway };
