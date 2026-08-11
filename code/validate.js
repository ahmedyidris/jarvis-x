const validateAction = (action) => {
  if (!action || typeof action !== 'object') return { valid: false, reason: 'Not an object' };
  if (!action.type) return { valid: false, reason: 'Missing type' };
  
  const allowed = ['query', 'write', 'shell', 'note', 'plan', 'list', 'read', 'git_log', 'git_status', 'answer'];
  if (!allowed.includes(action.type)) return { valid: false, reason: `Unknown action: ${action.type}` };
  
  if (action.type === 'write' && (!action.file || !action.content)) {
    return { valid: false, reason: 'Write requires file and content' };
  }
  
  return { valid: true };
};

module.exports = { validateAction };

if (require.main === module) {
  // Run tests
  const tests = [
    { action: null, expect: false },
    { action: { type: 'query', q: 'test' }, expect: true },
    { action: { type: 'write', file: 'test.txt' }, expect: false }
  ];
  
  let pass = 0;
  tests.forEach(t => {
    const result = validateAction(t.action);
    const ok = result.valid === t.expect;
    pass += ok ? 1 : 0;
    console.log(`${ok ? '✓' : '✗'} ${JSON.stringify(t.action).slice(0, 40).padEnd(42)} → ${result.reason || 'valid'}`);
  });
  console.log(`\n${pass}/${tests.length} passed`);
}
