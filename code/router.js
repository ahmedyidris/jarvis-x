// Tier routing. Rules, not a model — a model deciding routing is one more
// thing that can be confidently wrong.
const CONSEQUENTIAL = new Set(['write', 'shell', 'trade']);
const HARD_HINTS = /\b(plan|design|debug|why|analyz|strateg|refactor|architect|compare)\b/i;

function classify({ action = null, prompt = '' } = {}) {
  if (action && CONSEQUENTIAL.has(action)) return 'consequential';
  if (HARD_HINTS.test(prompt) || prompt.length > 600) return 'hard';
  return 'quick';
}

// tier -> backend. opus has no key yet, so consequential falls back to pro
// AND still hits the human gate. Degrading to a weaker model must never
// silently skip the gate.
// Ordered fallback chains. Best first, degrade rightward.
const ROUTE = {
  quick:        { via: 'gemini', chain: ['flash'] },
  hard:         { via: 'gemini', chain: ['pro', 'flash'] },
  consequential:{ via: 'gemini', chain: ['max', 'pro', 'flash'],
                  gate: true, wanted: 'claude-opus' },
};

function route(input) {
  const level = classify(input);
  return { level, ...ROUTE[level] };
}

// Execute a routed call. Returns which model actually answered and whether
// it degraded. gate is decided by LEVEL, never by which model responded --
// a fallback must not become a shortcut past human review.
async function run(input) {
  const { askFallback } = require('./gemini');
  const r = route(input);
  const res = await askFallback(input.prompt, r.chain);
  return { level: r.level, gate: !!r.gate, tier: res.tier,
           degraded: res.degraded, text: res.text };
}

module.exports = { classify, route, run };

if (require.main === module) {
  const tests = [
    { prompt: 'what time is it' },
    { prompt: 'why is the agent picking the wrong action' },
    { action: 'write', prompt: 'save notes' },
    { action: 'trade', prompt: 'buy 10 shares' },
  ];
  for (const t of tests) console.log(JSON.stringify(t), '->', JSON.stringify(route(t)));
}
