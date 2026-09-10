/**
 * What `jj status` reports, and why it can now fail.
 *
 * THE DEFECT THIS CLOSES (PLAN_5 §7 Tier 3 item 7). `bin/jj status` printed
 * "✅ Jarvis X ready" and exited 0 unconditionally -- three console.log calls
 * that inspected nothing. It said "ready" with the daemon down, with every
 * model missing, and with the kill switch pulled. A status command that cannot
 * report a problem is worse than none: it converts "nobody is checking" into
 * "something is checking", which is the more dangerous of the two. Same
 * reasoning as sweep.js, one layer up.
 *
 * WHAT IT IS NOT. scripts/status.sh already audits the *machine* -- os, ram,
 * disk, which binaries parse, .env permissions. This is not a Node port of it.
 * This answers the narrower question a caller actually has before shelling out
 * to `jj ask`: **can Jarvis answer right now, and on which tiers?** The two
 * overlap only on "is ollama up", and they disagree usefully -- status.sh asks
 * whether the daemon responds, this asks whether the specific models the tier
 * table names are installed on it.
 *
 * NOTHING HERE IS A SECOND COPY OF A FACT THAT LIVES ELSEWHERE.
 *   - the kill-switch path comes from guard.js's STOP_FILE export, not from a
 *     path literal. That is deliberate and load-bearing: CLAUDE.md documented
 *     this path *wrong* (`~/.jarvis-x/STOP`) until 2026-09-09 while the code
 *     used `.jarvis-x-STOP` at the repo root. A status command that recomputed
 *     the path could report on a file the guard does not read, which is the
 *     one failure mode that would make it lie in the exact situation it exists
 *     for.
 *   - the required ollama models are derived by walking TIERS and collecting
 *     every model the chains actually name. Not a list. `moondream` and
 *     `nomic-embed-text` are pulled on the real box and are deliberately NOT
 *     required, because no tier routes to them -- CLAUDE.md says as much about
 *     nomic-embed-text ("available, not wired in"). A hardcoded list would
 *     have to be kept in step with the router by hand, and would fail the
 *     first time someone added a tier.
 *   - the ollama endpoint is derived from PROVIDERS.ollama.url's origin.
 *
 * OFFLINE BY CONSTRUCTION. collect() takes its registry, its fetch and its
 * paths as arguments, per .github/workflows/test.yml's rule -- "a test
 * qualifies when its inputs are arguments rather than the environment". No
 * test in code/test-status.js opens a socket.
 */
const fs = require('fs');
const path = require('path');

// Levels, worst last. A check's level decides the exit code via worstOf().
const LEVELS = ['ok', 'info', 'warn', 'fail'];

function worstOf(checks) {
  return checks.reduce(
    (w, c) => (LEVELS.indexOf(c.level) > LEVELS.indexOf(w) ? c.level : w),
    'ok',
  );
}

/**
 * Every ollama model some tier can actually route to, derived from the tier
 * table rather than listed. Returns e.g. ['qwen2.5:3b', 'qwen2.5:7b'].
 */
function requiredOllamaModels(registry) {
  const { TIERS, PROVIDERS } = registry;
  const wanted = new Set();
  for (const chain of Object.values(TIERS)) {
    for (const [provider, modelKey] of chain) {
      if (provider !== 'ollama') continue;
      const model = PROVIDERS.ollama.models[modelKey];
      // A tier naming a model key ollama does not define is a router bug, not
      // a host problem -- surfaced by the caller, not silently skipped.
      if (model) wanted.add(model);
    }
  }
  return [...wanted];
}

/** `http://127.0.0.1:11434/api/generate` -> `http://127.0.0.1:11434/api/tags` */
function ollamaTagsUrl(registry) {
  return new URL('/api/tags', registry.PROVIDERS.ollama.url).toString();
}

/**
 * Ask the daemon what it has. Returns {up, models, error}. Never throws: an
 * unreachable daemon is a finding to report, not an exception to propagate --
 * `jj status` has to keep going and report the other checks too.
 */
async function probeOllama(registry, fetchFn, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetchFn(ollamaTagsUrl(registry), { signal: ctrl.signal });
    if (!res.ok) return { up: false, models: [], error: `HTTP ${res.status}` };
    const body = await res.json();
    // Tags carry the tag suffix ("qwen2.5:3b"); a model pulled without one is
    // reported by ollama as "name:latest", so compare both forms.
    const models = (body.models || []).map((m) => m.name).filter(Boolean);
    return { up: true, models, error: null };
  } catch (e) {
    const msg = e.name === 'AbortError' ? `no response in ${timeout}ms` : e.message;
    return { up: false, models: [], error: msg };
  } finally {
    clearTimeout(timer);
  }
}

function hasModel(installed, wanted) {
  return installed.some((m) => m === wanted || m === `${wanted}:latest`);
}

/**
 * Walk up until something exists. Used to ask "could logs/ be created here?"
 * without creating it. Terminates at the filesystem root, which always exists.
 */
function nearestExisting(dir) {
  let d = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(d)) return d;
    const up = path.dirname(d);
    if (up === d) return d;
    d = up;
  }
}

/**
 * Whether each tier has at least one provider that could answer right now.
 * Mirrors registry.ask()'s walk: same chain, same order, same availability
 * rule -- plus the two things ask() only discovers by failing, namely a dead
 * daemon and a model that is routed to but not pulled.
 */
function evaluateTiers(registry, ollama) {
  const { TIERS, PROVIDERS, available, quotaLeft } = registry;
  return Object.entries(TIERS).map(([tier, chain]) => {
    const usable = [];
    const blocked = [];
    for (const [provider, modelKey] of chain) {
      const model = PROVIDERS[provider].models[modelKey];
      const label = `${provider}/${model || modelKey}`;
      if (!model) { blocked.push(`${label} (no such model key)`); continue; }
      if (!available(provider)) { blocked.push(`${label} (no key)`); continue; }
      if (quotaLeft(provider) <= 0) { blocked.push(`${label} (quota spent)`); continue; }
      if (provider === 'ollama') {
        if (!ollama.up) { blocked.push(`${label} (daemon down)`); continue; }
        if (!hasModel(ollama.models, model)) { blocked.push(`${label} (not pulled)`); continue; }
      }
      usable.push(label);
    }
    return { tier, usable, blocked, ok: usable.length > 0 };
  });
}

/**
 * The whole report. Injectable throughout; the defaults are the real thing.
 *
 * @returns {{checks: Array, tiers: Array, level: string, ok: boolean}}
 */
async function collect(opts = {}) {
  // Lazily, so a fully-injected call (every test in code/test-status.js) never
  // loads the real registry or the real guard -- and therefore cannot read the
  // real ~/.jarvis-x/.env or the real audit log just by being run.
  let _guard = opts.guard;
  const guard = () => (_guard ||= require('./guard.js'));
  const registry = opts.registry || require('./providers/registry.js');
  const fetchFn = opts.fetchFn || globalThis.fetch;
  const timeout = opts.timeout ?? 3000;
  const stopFile = opts.stopFile || guard().STOP_FILE;
  const logFile = opts.logFile || guard().LOG_FILE;

  const checks = [];

  // 1. The kill switch, first and loudest. If it is pulled, everything below
  //    may look healthy and Jarvis is still deliberately halted -- reporting
  //    that as "ready" is the single worst thing this command could do.
  const halted = fs.existsSync(stopFile);
  checks.push(halted
    ? { name: 'kill switch', level: 'fail',
        detail: `HALTED — ${stopFile} exists. Agent autonomy is stopped. Remove it to resume.` }
    : { name: 'kill switch', level: 'ok', detail: `clear (${stopFile})` });

  // 2. Ollama: the one provider that never needs a key and is the last link in
  //    every tier chain. If it is down, the "works with zero cloud keys"
  //    guarantee registry.js states in its header is broken, whatever else
  //    happens to be reachable.
  const ollama = await probeOllama(registry, fetchFn, timeout);
  checks.push(ollama.up
    ? { name: 'ollama daemon', level: 'ok',
        detail: `up, ${ollama.models.length} model(s) installed` }
    : { name: 'ollama daemon', level: 'fail',
        detail: `unreachable at ${ollamaTagsUrl(registry)} — ${ollama.error}` });

  // 3. The models the tier table actually routes to.
  const required = requiredOllamaModels(registry);
  if (ollama.up) {
    const missing = required.filter((m) => !hasModel(ollama.models, m));
    checks.push(missing.length === 0
      ? { name: 'routed models', level: 'ok', detail: required.join(', ') }
      : { name: 'routed models', level: 'warn',
          detail: `missing: ${missing.join(', ')} — run: ${missing.map((m) => `ollama pull ${m}`).join('; ')}` });
  }

  // 4. Remote providers. An absent key is INFO, never a failure: booting and
  //    working with zero cloud keys is a hard rule, so reporting "fail" here
  //    would make the documented, supported configuration look broken.
  for (const [name, p] of Object.entries(registry.PROVIDERS)) {
    if (!p.key) continue;
    if (!registry.available(name)) {
      checks.push({ name: `provider ${name}`, level: 'info', detail: `disabled (no ${p.key})` });
      continue;
    }
    const left = registry.quotaLeft(name);
    checks.push(left > 0
      ? { name: `provider ${name}`, level: 'ok', detail: `enabled, ${left}/${p.dailyLimit} left today` }
      : { name: `provider ${name}`, level: 'warn', detail: `daily quota spent (${p.dailyLimit})` });
  }

  // 5. The audit trail. A missing actions.jsonl is normal -- guard.js creates
  //    it on first write, and CLAUDE.md records that on a fresh box it simply
  //    has not been written yet. An unwritable logs/ is not normal: every
  //    gated action would fail to record, and the append-only trail is the
  //    thing the whole governance story rests on.
  //    Checked without creating anything: a status command that mkdir'd its
  //    way to a passing result would be reporting on a directory it had just
  //    made. If logs/ does not exist yet, the question is whether the nearest
  //    directory that DOES exist would let the logger create it.
  const logDir = path.dirname(logFile);
  const probeDir = nearestExisting(logDir);
  try {
    fs.accessSync(probeDir, fs.constants.W_OK);
    checks.push({ name: 'audit log', level: 'ok',
      detail: fs.existsSync(logFile) ? logFile : `${logFile} (not yet written — normal on a fresh box)` });
  } catch (e) {
    checks.push({ name: 'audit log', level: 'fail', detail: `${probeDir} not writable — ${e.message}` });
  }

  // 6. Tiers, derived last because they depend on the probe above.
  const tiers = evaluateTiers(registry, ollama);
  for (const t of tiers) {
    checks.push(t.ok
      ? { name: `tier ${t.tier}`, level: 'ok', detail: `via ${t.usable[0]}` }
      : { name: `tier ${t.tier}`, level: 'fail', detail: `no usable provider — ${t.blocked.join(', ')}` });
  }

  const level = worstOf(checks);
  return { checks, tiers, level, ok: level !== 'fail' };
}

const GLYPH = { ok: '✅', info: 'ℹ️ ', warn: '⚠️ ', fail: '❌' };

function format(report) {
  const lines = report.checks.map(
    (c) => `${GLYPH[c.level]} ${c.name.padEnd(18)} ${c.detail}`,
  );
  const usable = report.tiers.filter((t) => t.ok).map((t) => t.tier);
  lines.push('');
  lines.push(report.ok
    ? `Jarvis X ready — tiers: ${usable.join(' | ') || 'none'}`
    : `Jarvis X NOT ready — usable tiers: ${usable.join(' | ') || 'none'}`);
  if (usable.length) lines.push(`Usage: jj ask "<q>" --tier ${usable[0]}`);
  return lines.join('\n');
}

/** 0 only when nothing failed. This is the entire point of the exercise. */
function exitCode(report) {
  return report.ok ? 0 : 1;
}

module.exports = {
  collect, format, exitCode, worstOf,
  requiredOllamaModels, ollamaTagsUrl, evaluateTiers, probeOllama, hasModel,
  nearestExisting, LEVELS,
};
