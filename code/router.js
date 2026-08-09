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
const ROUTE = {
  quick:        { via: 'gemini', tier: 'flash' },
  hard:         { via: 'gemini', tier: 'pro' },
  consequential:{ via: 'gemini', tier: 'pro', gate: true, wanted: 'claude-opus' },
};

function route(input) {
  const level = classify(input);
  return { level, ...ROUTE[level] };
}

module.exports = { classify, route };

if (require.main === module) {
  const tests = [
    { prompt: 'what time is it' },
    { prompt: 'why is the agent picking the wrong action' },
    { action: 'write', prompt: 'save notes' },
    { action: 'trade', prompt: 'buy 10 shares' },
  ];
  for (const t of tests) console.log(JSON.stringify(t), '->', JSON.stringify(route(t)));
}
