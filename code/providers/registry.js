/**
 * Universal model layer -- one interface over every available provider.
 *
 * code/models.js was an empty file where this was meant to live. Until now
 * each provider had its own call path: router.py for Ollama, gemini.js for
 * Gemini, local.js duplicating Ollama in JS. Nothing tracked quota, so a
 * free-tier exhaustion surfaced as a raw 429 mid-task.
 *
 * Hard rule from the project's goals: Jarvis X boots and works with ZERO
 * cloud keys. Ollama is always present and is the final fallback; every
 * remote provider is optional and self-disables when its key is absent.
 *
 * Model IDs below were confirmed live 2026-08-24, not copied from a plan.
 * Free-tier catalogs churn -- `node code/providers/registry.js --probe`
 * re-verifies every tier and reports what actually answers.
 */
const fs = require('fs');
const path = require('path');

const ENV_FILES = [
  path.join(process.env.HOME, '.jarvis-x', '.env'),
  path.join(__dirname, '..', '..', '.env'),
];

function loadKey(name) {
  for (const f of ENV_FILES) {
    try {
      const line = fs.readFileSync(f, 'utf8').split('\n')
        .find(l => l.startsWith(name + '='));
      if (line) {
        const v = line.slice(name.length + 1).trim();
        // A placeholder is worse than an absent key: it passes a presence
        // check and fails at the API with a confusing auth error.
        if (v && !/^(your|xxx|changeme|placeholder)/i.test(v)) return v;
      }
    } catch { /* file may not exist */ }
  }
  return null;
}

// Models that emit visible chain-of-thought (qwen3.6, nemotron) are
// deliberately not default-routed -- their reasoning leaks into the answer.
const PROVIDERS = {
  ollama: {
    key: null,                       // never needs one
    url: 'http://127.0.0.1:11434/api/generate',
    models: { local: 'qwen2.5:3b', localBig: 'qwen2.5:7b' },
    dailyLimit: null,                // unmetered, it's your CPU
    native: true,
  },
  groq: {
    key: 'GROQ_API_KEY',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    models: { fast: 'groq/compound-mini', smart: 'openai/gpt-oss-120b' },
    dailyLimit: 1000,
  },
  openrouter: {
    key: 'OPENROUTER_API_KEY',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    models: { fast: 'google/gemma-4-31b-it:free', smart: 'nvidia/nemotron-3-super-120b-a12b:free' },
    dailyLimit: 50,
  },
  gemini: {
    key: 'GEMINI_API_KEY',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    models: { quality: 'gemini-3.6-flash' },
    dailyLimit: 20,                  // measured, not documented: GenerateRequestsPerDayPerProjectPerModel-FreeTier
    gemini: true,
  },
};

// Tier -> ordered provider attempts. Local last on every remote tier so
// exhaustion degrades to a working answer instead of an error.
const TIERS = {
  local:   [['ollama', 'local']],
  fast:    [['groq', 'fast'], ['openrouter', 'fast'], ['ollama', 'local']],
  smart:   [['groq', 'smart'], ['openrouter', 'smart'], ['ollama', 'localBig']],
  quality: [['gemini', 'quality'], ['groq', 'smart'], ['ollama', 'localBig']],
};

function available(name) {
  const p = PROVIDERS[name];
  return p && (!p.key || loadKey(p.key) !== null);
}

module.exports = { PROVIDERS, TIERS, loadKey, available };

// --- quota ---------------------------------------------------------------
// On disk, not in memory: every CLI invocation is a fresh process, which is
// exactly how Gemini's 20/day got burned without anyone noticing until a
// 429 landed mid-run.
const QUOTA_FILE = path.join(__dirname, '..', '..', 'logs', '.provider-quota.json');

function today() { return new Date().toISOString().slice(0, 10); }

function readQuota() {
  try {
    const q = JSON.parse(fs.readFileSync(QUOTA_FILE, 'utf8'));
    return q.date === today() ? q : { date: today(), counts: {} };
  } catch { return { date: today(), counts: {} }; }
}

function bumpQuota(provider) {
  const q = readQuota();
  q.counts[provider] = (q.counts[provider] || 0) + 1;
  try {
    fs.mkdirSync(path.dirname(QUOTA_FILE), { recursive: true });
    fs.writeFileSync(QUOTA_FILE, JSON.stringify(q));
  } catch { /* never fail a call over bookkeeping */ }
  return q.counts[provider];
}

function quotaLeft(provider) {
  const limit = PROVIDERS[provider].dailyLimit;
  if (limit === null) return Infinity;
  return limit - (readQuota().counts[provider] || 0);
}

// --- calling -------------------------------------------------------------
async function callProvider(name, modelKey, prompt, { timeout = 60000 } = {}) {
  const p = PROVIDERS[name];
  const model = p.models[modelKey];
  if (!model) throw new Error(`${name} has no model for "${modelKey}"`);
  const key = p.key ? loadKey(p.key) : null;
  if (p.key && !key) throw new Error(`${name}: no API key`);
  if (quotaLeft(name) <= 0) throw new Error(`${name}: daily quota exhausted (${p.dailyLimit})`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    let url = p.url, headers = { 'content-type': 'application/json' }, body;
    if (p.native) {                                  // Ollama
      body = { model, prompt, stream: false };
    } else if (p.gemini) {                           // Gemini's own shape
      url = p.url.replace('{model}', model);
      headers['x-goog-api-key'] = key;
      body = { contents: [{ parts: [{ text: prompt }] }] };
    } else {                                         // OpenAI-compatible
      headers['authorization'] = `Bearer ${key}`;
      body = { model, messages: [{ role: 'user', content: prompt }] };
    }

    const res = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal,
    });
    bumpQuota(name);
    if (!res.ok) throw new Error(`${name} HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const d = await res.json();

    const text = p.native ? d.response
      : p.gemini ? d.candidates?.[0]?.content?.parts?.[0]?.text
      : d.choices?.[0]?.message?.content;
    if (!text || !text.trim()) throw new Error(`${name}: empty response`);
    return { text: text.trim(), provider: name, model };
  } finally { clearTimeout(timer); }
}

/** Try each provider for `tier` in order; the last is always local. */
async function ask(prompt, tier = 'fast', opts = {}) {
  const chain = TIERS[tier];
  if (!chain) throw new Error(`Unknown tier "${tier}". Known: ${Object.keys(TIERS).join(', ')}`);
  const tried = [];
  for (const [name, modelKey] of chain) {
    if (!available(name)) { tried.push(`${name}(no key)`); continue; }
    try { return await callProvider(name, modelKey, prompt, opts); }
    catch (e) { tried.push(`${name}(${String(e.message).slice(0, 60)})`); }
  }
  throw new Error(`All providers failed for tier "${tier}": ${tried.join(' | ')}`);
}

module.exports.ask = ask;
module.exports.callProvider = callProvider;
module.exports.quotaLeft = quotaLeft;
module.exports.readQuota = readQuota;

if (require.main === module) {
  (async () => {
    console.log('quota today:', JSON.stringify(readQuota().counts));
    for (const t of Object.keys(TIERS)) {
      process.stdout.write(`  ${t.padEnd(8)} `);
      try { const r = await ask('Reply with exactly: OK', t);
            console.log(`ok  ${r.provider}/${r.model} -> ${r.text.slice(0, 30)}`); }
      catch (e) { console.log(`FAIL ${String(e.message).slice(0, 90)}`); }
    }
    console.log('quota after:', JSON.stringify(readQuota().counts));
  })();
}
