const { guard } = require('./guard.js');
try {
  const r = guard('test', 'write a file', () => 'ACTION RAN');
  console.log('Result:', r);
} catch (e) {
  console.log('Blocked:', e.message);
}
