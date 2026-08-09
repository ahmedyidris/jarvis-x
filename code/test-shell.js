const { run } = require('./shell.js');

function attempt(label, fn) {
  try {
    const r = fn();
    const out = (r.stdout || '').trim().split('\n')[0];
    console.log(`OK      ${label}: [exit ${r.status}] ${out.slice(0, 55)}`);
  } catch (e) {
    console.log(`BLOCKED ${label}: ${e.message}`);
  }
}

attempt('list files',      () => run('ls', ['code']));
attempt('git log',         () => run('git', ['log', '--oneline', '-1']));
attempt('rm not allowed',  () => run('rm', ['-rf', 'logs']));
attempt('curl not allowed',() => run('curl', ['http://example.com']));
attempt('injection via ;', () => run('ls', [';', 'rm', '-rf', '~']));
attempt('injection via &&',() => run('ls', ['&&', 'rm', '-rf', '~']));
