const assert = require('assert');
const { validateAction } = require('./validate');
const { execute } = require('./lib');

// Regression guard for the three graded failures where models answered
// "what models do you have available" with {"type":"list","path":"models"}
// -- there was no way to enumerate models, so they reached for the
// filesystem and failed validation.
async function runTests() {
  console.log('\n=== LIST_MODELS TESTS ===\n');

  console.log('[Test 1] Validator accepts bare list_models');
  const v = validateAction({ type: 'list_models' });
  assert(v.valid, `should be valid, got: ${v.reason}`);
  console.log('✓ PASS');

  console.log('[Test 2] Extra fields are harmless (no path required)');
  assert(validateAction({ type: 'list_models', path: 'ignored' }).valid,
    'extra fields should not invalidate');
  console.log('✓ PASS');

  console.log('[Test 3] Unknown types still rejected');
  const bad = validateAction({ type: 'list_modelz' });
  assert(!bad.valid, 'typo variant must be rejected');
  assert(/unknown action type/.test(bad.reason), `expected unknown-type reason, got: ${bad.reason}`);
  console.log('✓ PASS');

  console.log('[Test 4] Executor returns real installed models');
  let out;
  try {
    out = await execute({ type: 'list_models' });
  } catch (err) {
    console.log(`⊘ SKIP (Ollama unreachable: ${err.message})`);
    console.log('\n=== TESTS PASSED (executor skipped) ===');
    return;
  }
  assert(typeof out === 'string' && out.length > 0, 'returns a non-empty string');
  assert(!out.includes('[object Promise]'), 'result was not awaited');
  assert(/Available models \(\d+\)|No models installed/.test(out),
    `unexpected shape: ${out.slice(0, 80)}`);
  console.log('✓ PASS');

  console.log('[Test 5] Reports models Ollama actually has');
  const res = await fetch('http://localhost:11434/api/tags');
  const real = (await res.json()).models.map(m => m.name);
  for (const name of real) {
    assert(out.includes(name), `missing installed model in output: ${name}`);
  }
  console.log(`✓ PASS (${real.length} models)`);

  console.log('\n=== ALL TESTS PASSED ===');
}

runTests().catch(err => {
  console.error(err.message);
  process.exit(1);
});
