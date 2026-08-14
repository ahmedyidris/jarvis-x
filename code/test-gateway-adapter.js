// code/test-gateway-adapter.js
const { test, finish, assert } = require('./test-helper.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const STOP_FILE = path.join(__dirname, '..', '.jarvis-x-STOP');
if (fs.existsSync(STOP_FILE)) fs.unlinkSync(STOP_FILE); // clean slate

// Fresh module + fresh on-disk state per require, so tests don't share a
// singleton Gateway (and don't touch the real logs/ directory).
function freshAdapter() {
  delete require.cache[require.resolve('./gateway-adapter.js')];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-adapter-test-'));
  process.env.JX_GATEWAY_STATE_DIR = dir;
  return require('./gateway-adapter.js');
}

test('classifyTier ports router.js\'s heuristic: consequential action wins', () => {
  const { classifyTier } = freshAdapter();
  assert.strictEqual(classifyTier({ action: 'shell', prompt: 'rm something' }), 'consequential');
});

test('classifyTier: hard hints route to "hard"', () => {
  const { classifyTier } = freshAdapter();
  assert.strictEqual(classifyTier({ prompt: 'why is the agent picking the wrong action' }), 'hard');
});

test('classifyTier: plain prompts default to "quick"', () => {
  const { classifyTier } = freshAdapter();
  assert.strictEqual(classifyTier({ prompt: 'what time is it' }), 'quick');
});

test('classifyTier: an explicit level short-circuits the heuristic, including "local"', () => {
  const { classifyTier } = freshAdapter();
  assert.strictEqual(classifyTier({ prompt: 'anything', level: 'local' }), 'local');
});

test('ask() blocks and never touches a provider when the STOP file is present', async () => {
  const { ask } = freshAdapter();
  fs.writeFileSync(STOP_FILE, '');
  try {
    const result = await ask({ prompt: 'hi', level: 'quick' }, { tag: 'test' });
    assert.strictEqual(result.blocked, true);
    assert.strictEqual(result.reason, 'STOP file present');
  } finally {
    fs.unlinkSync(STOP_FILE);
  }
});

finish();
