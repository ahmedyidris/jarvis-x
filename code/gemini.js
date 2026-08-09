const fs = require('fs');
const path = require('path');
const { guard } = require('./guard');

const ENV = path.join(process.env.HOME, '.jarvis-x', '.env');

function loadKey() {
  if (!fs.existsSync(ENV)) throw new Error('no .env at ' + ENV);
  const line = fs.readFileSync(ENV, 'utf8')
    .split('\n').find(l => l.startsWith('GEMINI_API_KEY='));
  if (!line) throw new Error('GEMINI_API_KEY not found in .env');
  const key = line.slice('GEMINI_API_KEY='.length).trim();
  if (!key || key === 'paste_new_key_here') throw new Error('key placeholder not replaced');
  return key;
}

const MODELS = {
  flash: 'gemini-3.6-flash',        // quick turns
  pro:   'gemini-3.5-flash',        // "hard" tier: stronger on agentic/tool tasks
  max:   'gemini-3.1-pro-preview',  // pure reasoning; needs billing, 429 on free tier
};

// Try tiers in order, return the first that answers. Never fail silently:
// the caller is told which model actually responded.
async function askFallback(prompt, tiers) {
  const errs = [];
  for (const t of tiers) {
    try { return { text: await ask(prompt, t), tier: t, degraded: t !== tiers[0] }; }
    catch (e) { errs.push(`${t}: ${e.message.slice(0,80)}`); }
  }
  throw new Error('all tiers failed -> ' + errs.join(' | '));
}

async function ask(prompt, tier = 'flash') {
  const model = MODELS[tier];
  if (!model) throw new Error('unknown tier: ' + tier);

  return guard('gemini_call', `${tier}:${model}`, async () => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': loadKey() },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('no text in response');
    return text;
  });
}

module.exports = { ask, askFallback, MODELS };

if (require.main === module) {
  const tier = process.argv[2] === 'pro' ? 'pro' : 'flash';
  const prompt = process.argv.slice(3).join(' ') || 'Say OK and nothing else.';
  ask(prompt, tier).then(t => console.log(t)).catch(e => console.error('ERR:', e.message));
}
