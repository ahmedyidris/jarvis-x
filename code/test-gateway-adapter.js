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

(async () => {
  await test('classifyTier ports router.js\'s heuristic: consequential action wins', () => {
    const { classifyTier } = freshAdapter();
    assert.strictEqual(classifyTier({ action: 'shell', prompt: 'rm something' }), 'consequential');
  });

  await test('classifyTier: hard hints route to "hard"', () => {
    const { classifyTier } = freshAdapter();
    assert.strictEqual(classifyTier({ prompt: 'why is the agent picking the wrong action' }), 'hard');
  });

  await test('classifyTier: plain prompts default to "quick"', () => {
    const { classifyTier } = freshAdapter();
    assert.strictEqual(classifyTier({ prompt: 'what time is it' }), 'quick');
  });

  await test('classifyTier: an explicit level short-circuits the heuristic, including "local"', () => {
    const { classifyTier } = freshAdapter();
    assert.strictEqual(classifyTier({ prompt: 'anything', level: 'local' }), 'local');
  });

  await test('classifyTier accepts a bare string and applies the heuristic to it (not just objects)', () => {
    const { classifyTier } = freshAdapter();
    assert.strictEqual(classifyTier('why is this broken'), 'hard');
  });

  await test('ask() rejects an unknown tier before guardCheck/budget/route: blocked, no exception, no provider call, no guard log entry', async () => {
    const { ask } = freshAdapter();
    const guardLog = path.join(__dirname, '..', 'logs', 'actions.jsonl');
    const before = fs.existsSync(guardLog) ? fs.readFileSync(guardLog, 'utf8').split('\n').filter(Boolean).length : 0;

    const result = await ask({ prompt: 'hi', level: 'not-a-real-tier' }, { tag: 'test' });

    assert.strictEqual(result.blocked, true);
    assert.match(result.reason, /^invalid tier: not-a-real-tier$/);
    assert.strictEqual(result.provider, null, 'no provider should ever be reached for an invalid tier');

    const after = fs.existsSync(guardLog) ? fs.readFileSync(guardLog, 'utf8').split('\n').filter(Boolean).length : 0;
    assert.strictEqual(after, before, 'guardCheck must never run (and thus never log) for an invalid tier');
  });

  await test('ask() blocks and never touches a provider when the STOP file is present', async () => {
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
})();
