// status.js is what `jj status` reports. Like sweep.js it is a CONTROL, so
// the assertions that matter most are the ones pinning the failures the old
// implementation could not express:
//
//   kill switch pulled        -> old: "✅ ready", exit 0.  now: fail, exit 1.
//   ollama daemon down        -> old: "✅ ready", exit 0.  now: fail, exit 1.
//   a routed model not pulled -> old: "✅ ready", exit 0.  now: reported.
//
// Each of those has a test below that asserts the exit code, not just the
// text -- a status command is consumed by scripts, and prose that says "NOT
// ready" while exiting 0 is the same defect wearing a different hat.
//
// EVERYTHING HERE IS OFFLINE. collect() takes its registry, its fetch, its
// stop-file path and its log path as arguments, so no test opens a socket,
// reads the real ~/.jarvis-x/.env, or touches the real audit log. The two
// tests that deliberately use the REAL registry are marked as such, and they
// still inject fetch -- they assert wiring (that the derivations run against
// the shipped tier table), never reachability.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const S = require('./status.js');

// --- fixtures ------------------------------------------------------------

// Shaped like the real registry, small enough to reason about. `enabled` and
// `quota` are the two seams the real one reads off disk.
function fakeRegistry({ enabled = {}, quota = {}, tiers, models } = {}) {
  const PROVIDERS = {
    ollama: {
      key: null,
      url: 'http://127.0.0.1:11434/api/generate',
      models: models || { local: 'qwen2.5:3b', localBig: 'qwen2.5:7b' },
      dailyLimit: null,
    },
    groq: {
      key: 'GROQ_API_KEY',
      url: 'https://api.groq.example/v1/chat',
      models: { fast: 'g-fast', smart: 'g-smart' },
      dailyLimit: 1000,
    },
  };
  const TIERS = tiers || {
    local: [['ollama', 'local']],
    fast: [['groq', 'fast'], ['ollama', 'local']],
    smart: [['groq', 'smart'], ['ollama', 'localBig']],
  };
  return {
    PROVIDERS,
    TIERS,
    available: (n) => (PROVIDERS[n].key ? enabled[n] === true : true),
    quotaLeft: (n) => (n in quota ? quota[n] : Infinity),
  };
}

/** A fetch that answers /api/tags with the named models. */
function fetchWithModels(names) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ models: names.map((n) => ({ name: n })) }),
  });
}

const fetchRefused = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:11434'); };
const fetchHangs = (_url, { signal } = {}) => new Promise((_res, rej) => {
  signal?.addEventListener('abort', () => {
    const e = new Error('aborted'); e.name = 'AbortError'; rej(e);
  });
});

// A scratch dir per test file, so a stop-file fixture never lands next to the
// real .jarvis-x-STOP.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-status-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

// A FUSE AGAINST THE ONE MUTATION THAT ESCAPED THIS SUITE.
//
// Mutating status.js so the probe's abort timer never fires did not make the
// run red -- it made it *stop*. The awaited test never settled, the event loop
// drained, and node exited 0 having printed neither the remaining checks nor
// the "Passed: N" tally. A suite that truncates silently and exits 0 is the
// exact failure sweep.js was built to find, and finding it in the sweep's own
// neighbour is not a reason to leave it.
//
// finish() calls process.exit() explicitly, so this default only survives when
// finish() was never reached.
process.exitCode = 1;

/** Fail a test that hangs, instead of letting it end the run early. */
function within(ms, promise, what) {
  return Promise.race([
    promise,
    // Deliberately NOT unref'd. An unref'd watchdog does not hold the event
    // loop open, so the loop drains and the process exits before the watchdog
    // can fire -- the fuse above would still catch it, but the run would end
    // with no named failure. Holding the loop open costs nothing: finish()
    // exits the process outright, so a still-pending timer never delays a
    // passing run.
    new Promise((_r, rej) => setTimeout(
      () => rej(new Error(`${what} did not settle within ${ms}ms`)), ms)),
  ]);
}

const NO_STOP = path.join(TMP, 'absent-STOP');
const LOG = path.join(TMP, 'logs', 'actions.jsonl');

/** A healthy call, with any one thing overridden. */
// A fixed "now" and a heartbeat two days old: the default fixture is a box
// that HAS swept recently, because that is what a healthy box looks like.
// Leaving it out would make every test below run against a box with an
// unknown sweep state, which is a different baseline than the one these
// assertions describe.
const NOW = Date.parse('2026-09-14T12:00:00.000Z');
const SWEPT_RECENTLY = { at: '2026-09-12T07:00:00.000Z', suites: 36, assertions: 793, findings: 0, parked: 0 };

function collectWith(over = {}) {
  return S.collect({
    registry: fakeRegistry(over.reg || {}),
    fetchFn: over.fetchFn || fetchWithModels(['qwen2.5:3b', 'qwen2.5:7b']),
    stopFile: over.stopFile || NO_STOP,
    logFile: over.logFile || LOG,
    timeout: over.timeout ?? 50,
    now: over.now ?? NOW,
    sweepBeat: over.sweepBeat || (() => (over.beat === undefined ? SWEPT_RECENTLY : over.beat)),
  });
}

const byName = (r, n) => r.checks.find((c) => c.name === n);

// --- the regressions: things the old `jj status` reported as ready ---------

(async () => {

await test('healthy box: ok, exit 0 — the baseline the failures below deviate from', async () => {
  const r = await collectWith();
  assert.strictEqual(r.ok, true, `expected ok, got: ${JSON.stringify(r.checks)}`);
  assert.strictEqual(S.exitCode(r), 0);
  // The worst level is `info`, not `ok`, and that is the correct answer: groq
  // has no key on this fixture. `info` is deliberately below the exit-code
  // threshold, because a keyless box is the supported configuration and not a
  // degraded one -- see the "no cloud keys" test below for the rule itself.
  assert.strictEqual(r.level, 'info');

  const keyed = await collectWith({ reg: { enabled: { groq: true } } });
  assert.strictEqual(keyed.level, 'ok', 'with every provider keyed, nothing should be noteworthy');
  assert.strictEqual(S.exitCode(keyed), 0);
});

await test('REGRESSION: kill switch pulled is a failure, not "✅ ready"', async () => {
  const stop = path.join(TMP, 'pulled-STOP');
  fs.writeFileSync(stop, '');
  const r = await collectWith({ stopFile: stop });
  const c = byName(r, 'kill switch');
  assert.strictEqual(c.level, 'fail');
  assert.match(c.detail, /HALTED/);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(S.exitCode(r), 1, 'a halted Jarvis must not exit 0');
  fs.unlinkSync(stop);
});

await test('REGRESSION: the reported kill-switch path is the one guard.js reads', async () => {
  // Not a style point. CLAUDE.md documented ~/.jarvis-x/STOP while guard.js
  // read .jarvis-x-STOP at the repo root, and the two disagreed for weeks. If
  // status.js recomputed the path it could report "clear" about a file the
  // guard never consults -- a lie in exactly the situation the switch is for.
  const guard = require('./guard.js');
  const r = await S.collect({
    registry: fakeRegistry(), fetchFn: fetchRefused, logFile: LOG, timeout: 50,
  });
  assert.ok(byName(r, 'kill switch').detail.includes(guard.STOP_FILE),
    `status reported a path guard.js does not use: ${byName(r, 'kill switch').detail}`);
  assert.strictEqual(path.basename(guard.STOP_FILE), '.jarvis-x-STOP');
});

await test('REGRESSION: ollama unreachable is a failure, not "✅ ready"', async () => {
  const r = await collectWith({ fetchFn: fetchRefused });
  const c = byName(r, 'ollama daemon');
  assert.strictEqual(c.level, 'fail');
  assert.match(c.detail, /ECONNREFUSED/);
  assert.strictEqual(S.exitCode(r), 1);
});

await test('REGRESSION: a routed model that is not pulled is reported', async () => {
  const r = await collectWith({ fetchFn: fetchWithModels(['qwen2.5:3b']) });
  const c = byName(r, 'routed models');
  assert.strictEqual(c.level, 'warn');
  assert.match(c.detail, /qwen2\.5:7b/);
  assert.match(c.detail, /ollama pull qwen2\.5:7b/, 'should say how to fix it');
});

await test('a tier whose whole chain is unusable fails, and names why per link', async () => {
  // 3b missing and no groq key: `local` has nothing left at all.
  const r = await collectWith({ fetchFn: fetchWithModels(['qwen2.5:7b']) });
  const local = r.tiers.find((t) => t.tier === 'local');
  assert.strictEqual(local.ok, false);
  assert.deepStrictEqual(local.blocked, ['ollama/qwen2.5:3b (not pulled)']);
  assert.strictEqual(byName(r, 'tier local').level, 'fail');
  assert.strictEqual(S.exitCode(r), 1);
});

// --- the rule that must NOT fire: zero cloud keys is supported -------------

await test('no cloud keys is INFO, never a failure — booting keyless is a hard rule', async () => {
  const r = await collectWith();                    // groq disabled by default
  const c = byName(r, 'provider groq');
  assert.strictEqual(c.level, 'info');
  assert.match(c.detail, /no GROQ_API_KEY/);
  assert.strictEqual(r.ok, true, 'a keyless box is the supported configuration');
});

await test('an enabled provider reports its remaining quota; a spent one warns', async () => {
  const ok = await collectWith({ reg: { enabled: { groq: true }, quota: { groq: 940 } } });
  assert.strictEqual(byName(ok, 'provider groq').level, 'ok');
  assert.match(byName(ok, 'provider groq').detail, /940\/1000/);

  const spent = await collectWith({ reg: { enabled: { groq: true }, quota: { groq: 0 } } });
  assert.strictEqual(byName(spent, 'provider groq').level, 'warn');
  // Still not a hard failure: ollama is last on the fast/smart chains.
  assert.strictEqual(spent.ok, true);
  assert.ok(spent.tiers.find((t) => t.tier === 'fast').blocked
    .some((b) => /quota spent/.test(b)), 'the spent step should be named in the chain');
});

// --- derivation, not duplication ------------------------------------------

await test('required models are derived by walking TIERS, not from a list', async () => {
  // Add a tier naming a third model. A hardcoded list cannot notice this; the
  // derivation must. This is the mutation that catches a future regression to
  // a literal.
  const reg = fakeRegistry({
    models: { local: 'qwen2.5:3b', localBig: 'qwen2.5:7b', tiny: 'newmodel:1b' },
    tiers: { local: [['ollama', 'local']], experimental: [['ollama', 'tiny']] },
  });
  assert.deepStrictEqual(S.requiredOllamaModels(reg).sort(),
    ['newmodel:1b', 'qwen2.5:3b']);
  assert.ok(!S.requiredOllamaModels(reg).includes('qwen2.5:7b'),
    'localBig is defined but no tier routes to it — it must not be required');
});

await test('REAL registry: required models are exactly what the shipped tiers name', async () => {
  const real = require('./providers/registry.js');
  const required = S.requiredOllamaModels(real);
  assert.ok(required.length > 0, 'the real tier table must route to some local model');
  for (const m of required) {
    assert.ok(Object.values(real.PROVIDERS.ollama.models).includes(m),
      `${m} is required but is not one of ollama's declared models`);
  }
  // CLAUDE.md: nomic-embed-text is pulled but "available, not wired in", and
  // moondream is vision-only. Requiring either would make a correct box fail.
  assert.ok(!required.includes('nomic-embed-text'));
  assert.ok(!required.includes('moondream'));
});

await test('the tags URL is derived from the registry endpoint, not written twice', async () => {
  const reg = fakeRegistry();
  reg.PROVIDERS.ollama.url = 'http://192.168.1.9:9999/api/generate';
  assert.strictEqual(S.ollamaTagsUrl(reg), 'http://192.168.1.9:9999/api/tags');
  // And against the real one, so a moved endpoint cannot leave this behind.
  const real = require('./providers/registry.js');
  assert.strictEqual(S.ollamaTagsUrl(real),
    new URL('/api/tags', real.PROVIDERS.ollama.url).toString());
});

await test('evaluateTiers mirrors registry.ask()\'s chain order — first usable wins', async () => {
  const reg = fakeRegistry({ enabled: { groq: true } });
  const tiers = S.evaluateTiers(reg, { up: true, models: ['qwen2.5:3b', 'qwen2.5:7b'] });
  const fast = tiers.find((t) => t.tier === 'fast');
  assert.strictEqual(fast.usable[0], 'groq/g-fast',
    'groq precedes ollama in the fast chain, so it must be reported first');
  assert.ok(fast.usable.includes('ollama/qwen2.5:3b'), 'the local fallback is still usable');
});

await test('a tier naming a model key the provider does not define is reported, not skipped', async () => {
  const reg = fakeRegistry({ tiers: { broken: [['ollama', 'nosuchkey']] } });
  const tiers = S.evaluateTiers(reg, { up: true, models: ['qwen2.5:3b'] });
  assert.strictEqual(tiers[0].ok, false);
  assert.match(tiers[0].blocked[0], /no such model key/);
});

// --- probe behaviour -------------------------------------------------------

await test('probeOllama never throws: a refused connection is a finding', async () => {
  const p = await S.probeOllama(fakeRegistry(), fetchRefused, 50);
  assert.strictEqual(p.up, false);
  assert.match(p.error, /ECONNREFUSED/);
  assert.deepStrictEqual(p.models, []);
});

await test('probeOllama gives up rather than hanging the status command', async () => {
  const started = Date.now();
  // Raced, not merely awaited: if the abort does not fire, the fetch fixture
  // never settles and an un-raced await would end the whole run silently
  // rather than reporting this test as failed. See the fuse at the top.
  const p = await within(2000, S.probeOllama(fakeRegistry(), fetchHangs, 60),
    'probeOllama against a hanging daemon');
  assert.strictEqual(p.up, false);
  assert.match(p.error, /no response in 60ms/);
  assert.ok(Date.now() - started < 2000, 'the abort must actually fire');
});

await test('probeOllama treats a non-2xx as down, with the status in the detail', async () => {
  const p = await S.probeOllama(fakeRegistry(), async () => ({ ok: false, status: 503 }), 50);
  assert.strictEqual(p.up, false);
  assert.strictEqual(p.error, 'HTTP 503');
});

await test('a model pulled without an explicit tag matches its :latest form', async () => {
  assert.ok(S.hasModel(['moondream:latest'], 'moondream'));
  assert.ok(S.hasModel(['qwen2.5:3b'], 'qwen2.5:3b'));
  assert.ok(!S.hasModel(['qwen2.5:7b'], 'qwen2.5:3b'), 'must not match on prefix');
});

// --- audit log, and the read-only promise ----------------------------------

await test('a missing actions.jsonl is normal; an unwritable logs/ parent is not', async () => {
  const ok = await collectWith({ logFile: path.join(TMP, 'fresh', 'actions.jsonl') });
  assert.strictEqual(byName(ok, 'audit log').level, 'ok');
  assert.match(byName(ok, 'audit log').detail, /not yet written/);

  const locked = path.join(TMP, 'locked');
  fs.mkdirSync(locked, { recursive: true });
  fs.chmodSync(locked, 0o500);
  const bad = await collectWith({ logFile: path.join(locked, 'logs', 'actions.jsonl') });
  // Running as root defeats a permission bit, so only assert when it bites.
  if (process.getuid && process.getuid() !== 0) {
    assert.strictEqual(byName(bad, 'audit log').level, 'fail');
    assert.strictEqual(S.exitCode(bad), 1);
  }
  fs.chmodSync(locked, 0o700);
});

await test('collect() creates nothing — a status command must not mutate the box', async () => {
  const probe = path.join(TMP, 'must-not-appear');
  await collectWith({ logFile: path.join(probe, 'logs', 'actions.jsonl') });
  assert.ok(!fs.existsSync(probe),
    'collect() created a directory to check whether it could create a directory');
});

await test('nearestExisting walks up to something real and terminates at the root', async () => {
  assert.strictEqual(S.nearestExisting(TMP), TMP);
  assert.strictEqual(S.nearestExisting(path.join(TMP, 'a', 'b', 'c')), TMP);
  assert.ok(fs.existsSync(S.nearestExisting('/no/such/path/anywhere')));
});

// --- exit code and rendering ----------------------------------------------

await test('worstOf ranks levels; only fail is non-zero', async () => {
  assert.strictEqual(S.worstOf([{ level: 'ok' }, { level: 'info' }]), 'info');
  assert.strictEqual(S.worstOf([{ level: 'warn' }, { level: 'ok' }]), 'warn');
  assert.strictEqual(S.worstOf([{ level: 'fail' }, { level: 'warn' }]), 'fail');
  assert.strictEqual(S.exitCode({ ok: true }), 0);
  assert.strictEqual(S.exitCode({ ok: false }), 1);
  assert.deepStrictEqual(S.LEVELS, ['ok', 'info', 'warn', 'fail']);
});

await test('format() never prints "ready" for a report that exits non-zero', async () => {
  const bad = await collectWith({ fetchFn: fetchRefused });
  const text = S.format(bad);
  assert.match(text, /NOT ready/);
  assert.ok(!/^Jarvis X ready/m.test(text),
    'the prose and the exit code must not disagree — that is the original defect');

  const good = S.format(await collectWith());
  assert.match(good, /^Jarvis X ready/m);
});

await test('format() advertises only tiers that are actually usable', async () => {
  // The old command advertised "local | fast | smart | long" unconditionally,
  // including "long", which no tier table has ever defined.
  const text = S.format(await collectWith({ fetchFn: fetchWithModels(['qwen2.5:3b']) }));
  assert.ok(!/long/.test(text), 'the phantom "long" tier must not come back');
  assert.match(text, /tiers: local \| fast/);
});

// --- the wiring, so this cannot pass while `jj status` stays broken ---------

await test('bin/jj wires status through this module and exits on its code', async () => {
  const jj = fs.readFileSync(path.join(__dirname, '..', 'bin', 'jj'), 'utf8');
  assert.ok(/status\.js/.test(jj), 'bin/jj must require code/status.js');
  assert.ok(/status\.exitCode\(/.test(jj), 'bin/jj must exit on the report, not always 0');
  assert.ok(!/console\.log\('✅ Jarvis X ready'\)/.test(jj),
    'the unconditional success line is back in bin/jj');
});

// --- has the sweep run? (added 2026-09-14) --------------------------------
//
// park() writes only when there are findings, so a clean sweep left an empty
// logs/ — byte-identical to a sweep that never ran. The control that finds
// rot nobody reported had no way to report that IT had stopped.

await test('a recent sweep reads ok and names its age', async () => {
  const r = await collectWith();
  const c = byName(r, 'weekly sweep');
  assert.strictEqual(c.level, 'ok');
  assert.match(c.detail, /2\.\d days ago/);
});

await test('NEVER swept reads info, never ok — absence is not health', async () => {
  const c = byName(await collectWith({ beat: null }), 'weekly sweep');
  assert.notStrictEqual(c.level, 'ok', 'a box that never swept reported as healthy');
  assert.strictEqual(c.level, 'info');
  assert.match(c.detail, /never run/);
});

await test('a sweep older than the threshold warns', async () => {
  const old = { ...SWEPT_RECENTLY, at: '2026-09-01T07:00:00.000Z' };  // 13 days
  const c = byName(await collectWith({ beat: old }), 'weekly sweep');
  assert.strictEqual(c.level, 'warn');
  assert.match(c.detail, /may have stopped firing/);
});

await test('one delayed week is not an alarm, two missed weeks is', async () => {
  // The threshold has to tolerate a late cron or a machine that was off on
  // Monday. A control that cries wolf gets ignored.
  const days = (n) => ({ ...SWEPT_RECENTLY, at: new Date(NOW - n * 86400000).toISOString() });
  assert.strictEqual(byName(await collectWith({ beat: days(9) }), 'weekly sweep').level, 'ok');
  assert.strictEqual(byName(await collectWith({ beat: days(11) }), 'weekly sweep').level, 'warn');
  assert.strictEqual(S.SWEEP_STALE_DAYS, 10, 'the threshold moved without these cases moving with it');
});

await test('an unreadable heartbeat timestamp warns rather than reading as fresh', async () => {
  // Date.parse of junk is NaN, and NaN > threshold is false — which would
  // have silently reported a corrupt heartbeat as a healthy one.
  const c = byName(await collectWith({ beat: { ...SWEPT_RECENTLY, at: 'not a date' } }), 'weekly sweep');
  assert.strictEqual(c.level, 'warn');
  assert.match(c.detail, /unreadable timestamp/);
});

await test('a stale sweep does not by itself fail the exit code', async () => {
  // It is a warning, not an incident: the sweep not having run does not mean
  // Jarvis cannot answer, which is what the exit code is for.
  const r = await collectWith({ beat: { ...SWEPT_RECENTLY, at: '2026-08-01T07:00:00.000Z' } });
  assert.strictEqual(S.exitCode(r), 0);
  assert.strictEqual(r.ok, true);
});

finish();
})();
