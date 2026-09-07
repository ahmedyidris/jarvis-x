#!/usr/bin/env node

const MODEL = 'qwen2.5:3b';

// Exported so the eval can say what its own repeated runs mean. At 0 the
// decode is near-deterministic, which makes N runs a check that the HARNESS
// is deterministic -- not a sampling error bar. Reported rather than assumed,
// because it was assumed once: REMAINING_WORK.md P0.1 read "variance is near
// zero on this evidence" off two identical runs, which was true and told us
// nothing about sampling.
const DEFAULT_TEMPERATURE = 0;

async function ask(prompt, opts = {}) {
  const res = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // format:'json' constrains Ollama's decoding to valid JSON. qwen2.5:3b
    // was emitting bare {"query":"..."} with no wrapper at all; this makes
    // malformed output structurally impossible. temperature 0 so eval runs
    // are reproducible.
    body: JSON.stringify({
      model: MODEL, prompt, stream: false,
      format: opts.json ? 'json' : undefined,
      options: { temperature: opts.temperature ?? DEFAULT_TEMPERATURE }
    })
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = await res.json();
  return data.response.trim();
}

async function main() {
  const prompt = process.argv.slice(2).join(' ') || 'Introduce yourself in one sentence.';
  console.log(`\n[${MODEL}] thinking...\n`);
  try {
    console.log(await ask(prompt));
  } catch (err) {
    console.error('Local model unavailable:', err.message);
    console.error('Is ollama running? Try: ollama serve');
  }
  console.log('');
}

if (require.main === module) main();
module.exports = { ask, MODEL, DEFAULT_TEMPERATURE };
