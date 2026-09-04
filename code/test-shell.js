// shell.js is the command allowlist and the path jail on shell arguments --
// the boundary between the agent and arbitrary execution on this machine.
//
// WHAT WAS HERE BEFORE: a file with zero assertions that printed lines like
//
//   OK      rm not allowed: [exit undefined]
//   OK      curl not allowed: [exit undefined] <!doctype html><html lang="en">...
//
// and exited 0 unconditionally. Three things wrong at once. It read `r.status`
// but run() returns `exit_code`, hence "[exit undefined]" on every line. Its
// labels were stale -- `rm` and `curl` are both deliberately allowlisted, so
// "not allowed" was printed directly above the HTML curl had just fetched. And
// with no assertions it could not fail: demonstrated 2026-09-04 by emptying
// ALLOWED entirely, a total failure of the command control, after which this
// file still exited 0. It was in the CI list the whole time.
//
// The old file is in git history; this replaces it, because CI runs it under
// this name.
//
// Every test here is local and offline -- the allowlisted commands used are
// `pwd`, `echo`, `ls`, `wc` and `cat`. Nothing reaches the network, which is
// also why `curl` appears only as a name in an allowlist assertion.
const fs = require('fs');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const { run } = require('./shell.js');
const { BASE } = require('./exec.js');
const { STOP_FILE } = require('./guard.js');

function withKillSwitch(fn) {
  const had = fs.existsSync(STOP_FILE);
  try {
    if (!had) fs.writeFileSync(STOP_FILE, 'test');
    return fn();
  } finally {
    if (!had && fs.existsSync(STOP_FILE)) fs.unlinkSync(STOP_FILE);
  }
}

(async () => {

// ── the allowlist ─────────────────────────────────────────────────────────
await test('an allowlisted command runs and returns exit_code, not status', () => {
  const r = run('echo', ['hello']);
  // The old file read r.status and printed "[exit undefined]" every time --
  // it was reporting a field this function has never returned.
  assert.strictEqual(r.exit_code, 0, 'the field is exit_code');
  assert.strictEqual(r.status, undefined, 'and there is no status field to read');
  assert.strictEqual(r.stdout.trim(), 'hello');
});

await test('a command outside the allowlist is refused', () => {
  assert.throws(() => run('git', ['log']), /REFUSED.*not in allowlist/);
});

await test('the refusal happens before anything is executed', () => {
  // `git status` would succeed if it ran. It must not.
  assert.throws(() => run('git', ['status']), /not in allowlist/);
});

await test('rm and curl ARE allowlisted, whatever an old label said', () => {
  // The previous file printed "rm not allowed" and "curl not allowed". Both
  // are deliberately in the set -- see shell.js's own grouping comments. A
  // test asserting the opposite would fail on correct code.
  // run() RETURNS a non-zero exit rather than throwing, so the assertion is
  // about the allowlist specifically: whatever else happens, none of these
  // may come back as "not in allowlist". (A missing binary throws ENOENT,
  // which is also not an allowlist refusal, and is fine here.)
  for (const cmd of ['rm', 'curl', 'wget', 'bash', 'python', 'node']) {
    let err = null;
    try { run(cmd, ['--definitely-not-a-real-flag-xyz']); } catch (e) { err = e; }
    assert.ok(!(err && /not in allowlist/.test(err.message)),
      `${cmd} must not be refused by the allowlist, got: ${err && err.message}`);
  }
});

await test('a non-string command is refused rather than coerced', () => {
  for (const bad of [null, undefined, 42, {}, ['ls']]) {
    assert.throws(() => run(bad, []), /REFUSED/, `${JSON.stringify(bad)} must be refused`);
  }
});

// ── argument validation ───────────────────────────────────────────────────
await test('args must be an array of strings', () => {
  assert.throws(() => run('echo', 'not-an-array'), /args must be an array/);
  assert.throws(() => run('echo', ['ok', 42]), /args must be an array/);
  assert.throws(() => run('echo', ['ok', null]), /args must be an array/);
});

await test('omitting args entirely is allowed', () => {
  assert.strictEqual(run('pwd').exit_code, 0);
});

// ── the path jail ─────────────────────────────────────────────────────────
await test('an argument escaping the jail is refused', () => {
  assert.throws(() => run('cat', ['../../../etc/passwd']), /.+/,
    'a traversal must not reach the filesystem');
});

await test('an absolute path outside the jail is refused', () => {
  assert.throws(() => run('cat', ['/etc/passwd']), /.+/);
});

await test('a path inside the jail is allowed through', () => {
  const r = run('wc', ['-l', 'code/guard.js']);
  assert.strictEqual(r.exit_code, 0);
  assert.ok(/\d+/.test(r.stdout), r.stdout);
});

await test('flags are not treated as paths', () => {
  // '-la' contains no slash, but the rule that skips leading '-' is what
  // stops a future flag like '--path=/x' being jailed as a filename.
  assert.strictEqual(run('ls', ['-la']).exit_code, 0);
});

await test('a URL is exempt from the path jail', () => {
  // Otherwise 'https://x/y' would be jailed as a relative path because it
  // contains slashes. Asserted without making a request: a refused URL
  // throws before spawn, so reaching the spawn at all proves the exemption.
  let msg = '';
  try { run('curl', ['--max-time', '0.001', 'https://example.invalid/a/b']); }
  catch (e) { msg = e.message; }
  assert.ok(!/outside|escape|jail|REFUSED/i.test(msg),
    `the URL must not be rejected as a path, got: ${msg}`);
});

// ── the working directory ─────────────────────────────────────────────────
await test('commands execute inside the jail, not the caller\'s cwd', () => {
  // The jail escape this fixed: args were resolved against BASE but the
  // command ran wherever the caller happened to be, so a path safePath()
  // approved as in-jail could be written outside it.
  //
  // MUST run from somewhere else. The first version of this test called pwd
  // from the repo root, so it passed even with `cwd: BASE` deleted -- the
  // process cwd happened to be the jail. It asserted nothing. Verified by
  // mutation: dropping cwd now fails here and did not before.
  const elsewhere = fs.mkdtempSync(path.join(require('os').tmpdir(), 'jx-cwd-'));
  const original = process.cwd();
  let out;
  try {
    process.chdir(elsewhere);
    out = run('pwd').stdout.trim();
  } finally {
    process.chdir(original);
  }
  assert.strictEqual(fs.realpathSync(out), fs.realpathSync(BASE),
    `ran in ${out}, not the jail`);
  assert.notStrictEqual(fs.realpathSync(out), fs.realpathSync(elsewhere),
    'and specifically not in the caller\'s directory');
});

await test('a relative path is read from the jail even when called from elsewhere', () => {
  // The other half of the same escape: the arg check resolves against BASE,
  // so the command must too or they disagree about what a path means.
  const elsewhere = fs.mkdtempSync(path.join(require('os').tmpdir(), 'jx-cwd-'));
  fs.writeFileSync(path.join(elsewhere, 'package.json'), '{"name":"DECOY"}');
  const original = process.cwd();
  let r;
  try {
    process.chdir(elsewhere);
    r = run('cat', ['package.json']);
  } finally {
    process.chdir(original);
  }
  assert.ok(!/DECOY/.test(r.stdout),
    'it read the caller\'s file, not the jail\'s — the paths disagree');
  assert.ok(/jarvis/i.test(r.stdout), 'it must be the repo package.json');
});

await test('a relative path resolves against the jail root', () => {
  const r = run('cat', ['package.json']);
  assert.strictEqual(r.exit_code, 0);
  assert.ok(/"name"/.test(r.stdout), 'it read the repo root package.json');
});

// ── the kill switch ───────────────────────────────────────────────────────
await test('the kill switch blocks a command this module would otherwise allow', () => {
  assert.strictEqual(run('echo', ['before']).exit_code, 0, 'allowed while off');
  withKillSwitch(() => {
    assert.throws(() => run('echo', ['during']), /Kill switch/i);
  });
  assert.strictEqual(run('echo', ['after']).exit_code, 0, 'allowed again once cleared');
});

await test('the kill switch is checked by this module, not left to its caller', () => {
  // lib.js's execute() also checks, but that made enforcement depend on every
  // future caller routing through it. run() is called directly in places.
  const src = fs.readFileSync(path.join(__dirname, 'shell.js'), 'utf8');
  assert.ok(/isStopped\(\)/.test(src), 'shell.js must check for itself');
  assert.ok(src.indexOf('isStopped()') < src.indexOf('ALLOWED.has'),
    'and must check before it even considers the allowlist');
});

// ── failure and output handling ───────────────────────────────────────────
await test('a non-zero exit is returned, not thrown', () => {
  const r = run('ls', ['definitely-no-such-path-xyz']);
  assert.notStrictEqual(r.exit_code, 0, 'the failure is reported...');
  assert.ok(r.stderr.length > 0, '...with stderr kept for the caller');
});

await test('stdout and stderr are separate', () => {
  const r = run('ls', ['-d', '.']);
  assert.ok(r.stdout.length > 0);
  assert.strictEqual(r.stderr, '');
});

await test('a refused command is recorded in the audit log', () => {
  const { LOG_FILE } = require('./guard.js');
  const before = fs.existsSync(LOG_FILE)
    ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).length : 0;
  try { run('git', ['log']); } catch { /* expected */ }
  const rows = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean)
    .slice(before).map(l => JSON.parse(l));
  assert.strictEqual(rows.length, 1, 'a refusal must leave a trace');
  assert.strictEqual(rows[0].action, 'refused-cmd');
  assert.strictEqual(rows[0].allowed, false);
});

await test('an executed command is recorded with its exit code', () => {
  const { LOG_FILE } = require('./guard.js');
  const before = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).length;
  run('echo', ['audited']);
  const rows = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean)
    .slice(before).map(l => JSON.parse(l));
  assert.strictEqual(rows[0].action, 'cmd-exec');
  assert.strictEqual(rows[0].allowed, true);
  assert.strictEqual(rows[0].exit_code, 0);
});

finish();
})();
