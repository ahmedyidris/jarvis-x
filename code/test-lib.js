// lib.js's execute() is the single dispatch point for every action the agent
// takes, and it had NO TEST until 2026-09-07.
//
// This file does not attempt to cover all of execute(). It covers the two
// things it ENFORCES, because both were reachable-by-accident:
//
//   1. THE OFF-LIMITS SET. validate.js refuses a write to the constraint
//      files, but execute() never calls validate() -- it has its own path
//      jail -- so `execute({type:'write', path:'memory/rules.md'})` went
//      straight through. Demonstrated 2026-09-07: the authoritative rules
//      file came back reading "PWNED" and was restored from a copy. The check
//      now runs here too, for the reason shell.js gives about the kill
//      switch: a control left to validate() depends on every future caller
//      routing through validate() first, and this one does not.
//
//   2. THE KILL SWITCH. lib.js's own comment records that agent.js's path
//      "previously had no kill-switch check at all -- scheduler.js was the
//      only caller that actually respected it".
//
// Both are offline. Nothing here reaches a model or the network, and every
// write goes to a scratch path under logs/ that is removed afterwards.
const fs = require('fs');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
// FUSE. A hung await drains the event loop and exits 0 having printed no
// tally -- a vacuous pass that reads as green, and the exact shape sweep.js
// exists to catch. finish() calls process.exit() explicitly, so this default
// only survives when finish() was never reached. Found by mutation-testing
// code/status.js; see code/test-status.js for the full account.
process.exitCode = 1;

const { execute } = require('./lib.js');
const { OFF_LIMITS } = require('./validate.js');
const { BASE } = require('./exec.js');
const { STOP_FILE } = require('./guard.js');

const SCRATCH = 'logs/test-lib-scratch.txt';

function cleanup() {
  const full = path.join(BASE, SCRATCH);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

/** MUST be async and MUST await fn(). The first version of this was sync and
 *  returned fn() from a try/finally, so with an async body the finally
 *  deleted STOP_FILE before the promise settled and every assertion ran with
 *  the switch already off -- "Missing expected rejection" on a kill switch
 *  that works fine. Exactly the shape guard.js documents about itself:
 *  "async callers were logged the moment the promise was CREATED". */
async function withKillSwitch(fn) {
  const had = fs.existsSync(STOP_FILE);
  try {
    if (!had) fs.writeFileSync(STOP_FILE, 'test');
    return await fn();
  } finally {
    if (!had && fs.existsSync(STOP_FILE)) fs.unlinkSync(STOP_FILE);
  }
}

/** Hash the on-disk bytes, so "it was not modified" is checked rather than
 *  inferred from the absence of an error. */
function digest(rel) {
  return require('crypto').createHash('sha256')
    .update(fs.readFileSync(path.join(BASE, rel))).digest('hex');
}

(async () => {

// ── the off-limits set, enforced at the dispatch point ────────────────────
// A NOTE ON WHY THIS WRITES THE FILE'S OWN BYTES BACK.
//
// The first version of these two tests posted content 'PWNED' to all seven
// protected paths and relied on the gate to stop it. That is backwards: a
// test must not depend on the control it is testing to avoid doing damage.
// It cost real files. Mutation-testing the gate with `if (false)` on
// 2026-09-07 let the writes through, and CONSTITUTION.md, Guidelines.md,
// memory/rules.md, guard.js, exec.js and shell.js were all truncated to the
// word PWNED. Recovered with `git checkout --`, which is the only reason
// this is a footnote rather than an incident.
//
// So the sweep over all seven now writes each file's CURRENT bytes. A
// working gate refuses; a broken gate performs a write that changes nothing.
// The "did it write before throwing" question needs distinct content, so it
// is asked of ONE file, with the original captured first and restored in a
// finally that verifies the restore.
await test('execute() refuses a write to every off-limits file', async () => {
  for (const p of OFF_LIMITS) {
    const ownBytes = fs.readFileSync(path.join(BASE, p), 'utf8');
    await assert.rejects(
      () => execute({ type: 'write', path: p, content: ownBytes }),
      /off-limits/,
      `${p} is writable through execute()`);
    assert.strictEqual(digest(p), require('crypto').createHash('sha256')
      .update(ownBytes).digest('hex'), `${p} changed — restore it from git`);
  }
});

await test('the refusal happens BEFORE the write, not after', async () => {
  // The assertion that actually matters: a gate that throws after
  // fs.writeFileSync would satisfy the test above and still have destroyed
  // the file. Bounded to one file, with a verified restore.
  const rel = 'memory/rules.md';   // the file the demonstrated bypass hit
  const full = path.join(BASE, rel);
  const original = fs.readFileSync(full);
  try {
    await assert.rejects(
      () => execute({ type: 'write', path: rel, content: 'SENTINEL-DO-NOT-COMMIT' }),
      /off-limits/);
    assert.ok(!/SENTINEL/.test(fs.readFileSync(full, 'utf8')),
      'the gate threw but the write had already landed');
  } finally {
    if (!fs.readFileSync(full).equals(original)) fs.writeFileSync(full, original);
    assert.ok(fs.readFileSync(full).equals(original), `FAILED TO RESTORE ${rel}`);
  }
});

await test('the refusal is a REFUSED error, distinguishable from an I/O failure', async () => {
  // Own bytes, like the sweep above. This test only inspects the error
  // message, so it has no reason to risk distinct content -- and the first
  // version of it passed 'x'. It was the one destructive write left after
  // the other two were converted, and it truncated memory/rules.md to a
  // single character during the mutation run that followed.
  const ownBytes = fs.readFileSync(path.join(BASE, 'memory', 'rules.md'), 'utf8');
  await assert.rejects(
    () => execute({ type: 'write', path: 'memory/rules.md', content: ownBytes }),
    (e) => /REFUSED/.test(e.message) && /durable rule 2/.test(e.message),
    'a caller must be able to tell a policy refusal from a disk error');
});

await test('execute() reads the list from validate.js rather than keeping its own', async () => {
  // Two lists drift. The failure that matters is the one where a file is
  // added to validate.js's list and stays writable through execute().
  const raw = fs.readFileSync(path.join(__dirname, 'lib.js'), 'utf8');
  assert.ok(/require\('\.\/validate\.js'\)/.test(raw), 'it must import the real list');
  // Comments must be stripped first. lib.js's comment legitimately names
  // memory/rules.md as the path the bypass overwrote, and the first version
  // of this test failed on that -- a true statement about the text and a
  // false one about the code.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const p of OFF_LIMITS) {
    assert.ok(!code.includes(`'${p}'`), `lib.js restates ${p} in code instead of importing it`);
  }
  assert.ok(!/OFF_LIMITS\s*=/.test(code), 'and must not declare a list of its own');
});

await test('reading an off-limits file through execute() still works', async () => {
  const out = await execute({ type: 'read', path: 'memory/rules.md' });
  assert.ok(out.length > 0, 'the agent must be able to read its own constraints');
  assert.ok(!/PWNED/.test(out), 'and this is the file the bypass overwrote — check it is clean');
});

await test('an ordinary write is unaffected', async () => {
  cleanup();
  try {
    const r = await execute({ type: 'write', path: SCRATCH, content: 'hello' });
    assert.ok(/Written to/.test(r), r);
    assert.strictEqual(fs.readFileSync(path.join(BASE, SCRATCH), 'utf8'), 'hello');
  } finally {
    cleanup();
  }
});

await test('a symlink at a writable name pointing to a protected file is refused', async () => {
  const link = path.join(BASE, 'logs', 'test-lib-link.md');
  try {
    try { fs.unlinkSync(link); } catch { /* not there */ }
    fs.symlinkSync(path.join(BASE, 'memory', 'rules.md'), link);
    // Own bytes again: if the symlink resolution regresses, this write lands
    // on memory/rules.md, and it must be harmless when it does.
    const ownBytes = fs.readFileSync(path.join(BASE, 'memory', 'rules.md'), 'utf8');
    const before = digest('memory/rules.md');
    await assert.rejects(
      () => execute({ type: 'write', path: 'logs/test-lib-link.md', content: ownBytes }),
      /off-limits/);
    assert.strictEqual(digest('memory/rules.md'), before);
  } finally {
    try { fs.unlinkSync(link); } catch { /* already gone */ }
  }
});

// ── the path jail, which execute() enforces for itself ────────────────────
await test('a path escaping the jail is refused before any directory is made', async () => {
  await assert.rejects(
    () => execute({ type: 'write', path: '../escaped.txt', content: 'x' }),
    /escapes the jail/);
  assert.strictEqual(fs.existsSync(path.join(BASE, '..', 'escaped.txt')), false);
});

// ── the kill switch ───────────────────────────────────────────────────────
await test('the kill switch blocks a write execute() would otherwise allow', async () => {
  cleanup();
  try {
    await execute({ type: 'write', path: SCRATCH, content: 'allowed while off' });
    assert.ok(fs.existsSync(path.join(BASE, SCRATCH)));
    cleanup();
    await withKillSwitch(async () => {
      await assert.rejects(
        () => execute({ type: 'write', path: SCRATCH, content: 'during' }),
        /Kill switch/i);
    });
    assert.strictEqual(fs.existsSync(path.join(BASE, SCRATCH)), false,
      'nothing may be written while the switch is on');
  } finally {
    cleanup();
  }
});

await test('the kill switch blocks reads and lists too, not only writes', async () => {
  // lib.js's comment says "every action type is blocked while the STOP file
  // exists". Pinned, because a read-only escape hatch is how a blocked agent
  // keeps working.
  await withKillSwitch(async () => {
    await assert.rejects(() => execute({ type: 'read', path: 'package.json' }), /Kill switch/i);
    await assert.rejects(() => execute({ type: 'list', path: 'code' }), /Kill switch/i);
  });
});

await test('the kill switch is checked before the action is dispatched', async () => {
  const src = fs.readFileSync(path.join(__dirname, 'lib.js'), 'utf8');
  assert.ok(src.indexOf('isStopped()') < src.indexOf('switch (type)'),
    'it must be checked above the dispatch, not inside one case');
});

// ── this file's own safety ────────────────────────────────────────────────
await test('no test here writes distinct content to a protected path', () => {
  // I got this wrong twice on 2026-09-07. First all seven paths were written
  // 'PWNED'; mutating the gate to `if (false)` let it through and truncated
  // CONSTITUTION.md, Guidelines.md, memory/rules.md, guard.js, exec.js and
  // shell.js -- including the file holding the control itself, so the
  // implementation had to be rebuilt. Then, after converting the sweep and
  // the sentinel test, ONE write with content 'x' was left behind and
  // truncated memory/rules.md on the next mutation run.
  //
  // A test must not rely on the control it is testing to avoid doing damage.
  // So: every execute() write here targeting a protected path must pass
  // either `ownBytes` (a content no-op if the gate fails) or a variable
  // captured with a verified restore in a finally.
  // Checked per test BLOCK, not per file. Distinct content is legitimate when
  // the same block captures the original and restores it in a finally that
  // verifies the restore -- that is what the write-before-throw test needs,
  // and banning it outright would delete the only check that catches a gate
  // throwing AFTER fs.writeFileSync.
  const src = fs.readFileSync(__filename, 'utf8');
  const blocks = src.split(/await test\(/).slice(1);
  const writeCall = /execute\(\{\s*type:\s*'write',\s*path:\s*([^,]+),\s*content:\s*([^}]+)\}/g;
  const offenders = [];
  let protectedWrites = 0;
  for (const block of blocks) {
    const name = (block.match(/^\s*'([^']+)'/) || [undefined, '?'])[1];
    for (const m of block.matchAll(writeCall)) {
      const pathArg = m[1].trim(), contentArg = m[2].trim();
      // Polarity matters: a path this check does not RECOGNISE is treated as
      // protected, not as safe. The first version matched only literals from
      // OFF_LIMITS -- and did so with a broken regex whose end anchor had
      // been escaped into a literal '$', so the quotes were never stripped
      // and nothing ever matched. The sweep, whose path is the loop variable
      // `p`, went uncounted, and the guard reported all-clear over the very
      // write that had done the damage. A safety check defaults to suspicion.
      const isScratch = pathArg === 'SCRATCH'
        || (/^'logs\/[^']*'$/.test(pathArg) && !/link/i.test(pathArg))
        || /escaped/.test(pathArg);
      if (isScratch) continue;
      protectedWrites++;
      const contentIsNoop = /ownBytes/.test(contentArg);
      const blockRestores = /FAILED TO RESTORE/.test(block) && /finally/.test(block);
      if (!contentIsNoop && !blockRestores) {
        offenders.push(`"${name}": path ${pathArg}, content ${contentArg}`);
      }
    }
  }
  assert.deepStrictEqual(offenders, [],
    'a literal content string aimed at a protected path destroys it whenever ' +
    'the gate is broken — which is exactly when this suite runs');
  assert.ok(protectedWrites >= 4,
    `only ${protectedWrites} protected writes found — did the pattern change?`);
  assert.ok(src.includes('ownBytes'), 'the own-bytes pattern must still be in use');
});

finish();
})();
