#!/usr/bin/env node

const MODEL = 'qwen2.5:1.5b';

async function ask(prompt) {
  const res = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, stream: false })
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
module.exports = { ask, MODEL };
