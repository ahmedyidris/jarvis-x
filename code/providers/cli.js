#!/usr/bin/env node
// Thin stdout bridge so hermes.py can reach registry.js. Emits the same
// {"response": "..."} shape Ollama's /api/generate returns, so hermes.py's
// existing parse path needs no special case.
const { ask } = require('./registry.js');
const [tier, ...rest] = process.argv.slice(2);
ask(rest.join(' '), tier)
  .then(r => { console.log(JSON.stringify({ response: r.text, _provider: r.provider, _model: r.model })); })
  .catch(e => { console.error(String(e.message)); process.exit(1); });
