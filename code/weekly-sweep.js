/**
 * THE WEEKLY SWEEP — the time-driven path of PLAN_5 §3's diagram.
 *
 *   arrival  (event-driven)  change made -> tests run -> evidence updates ─┐
 *                                                                          ├─> one writer
 *   sweep    (time-driven)   timer fires -> find rot nobody reported ──────┘
 *
 * WHY A SECOND SWEEP. `code/sweep.js` answers one question every CI run: can
 * each listed suite report whether it passed? That is the arrival path -- it
 * fires when something changes. This is the other half, and PLAN_5 §3 states
 * the asymmetry it exists for: a broken build turns CI red; a check that
 * quietly stopped checking signals nothing. Rot that no commit touches is
 * invisible to an event-driven control by construction, because there is no
 * event to fire on. Five instances in this repo were found by hand and none by
 * tooling. This runs on a clock instead.
 *
 * WHAT IT WILL NOT DO. It never fixes, never rewrites a doc, never deletes.
 * Detection is pure lookups -- no model calls, per §6, which is what makes it
 * affordable to run always-on. Everything it finds is *parked* in an
 * append-only inbox for Ahmed (§7): propose, don't auto-merge.
 *
 * THE HONESTY REQUIREMENT, which is most of the design. A drift detector that
 * scrapes prose will either miss claims or invent them, and for a control the
 * second is far worse -- "no drift found" would then mean "found nothing"
 * rather than "checked everything". So every detector here reports its own
 * blind spot: `claimsUnchecked` counts the numeric claims it SAW and could not
 * verify, and the report prints that number next to the findings, every run.
 * A claim is only checked when its shape is unambiguous; anything else is
 * counted, not guessed at. Same reasoning as sweep.js keying on exit code plus
 * a parsed count rather than on one output string.
 *
 * INJECTED, NOT CALLED. The clock is a parameter (test.yml's house rule), and
 * so are the repo root, the doc list, the ignore oracle and the suite runner --
 * so code/test-weekly-sweep.js exercises the whole thing offline without
 * spawning a suite or touching the real inbox.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const sweepMod = require('./sweep.js');

const REPO = path.join(__dirname, '..');
const INBOX = path.join(REPO, 'logs', 'sweep-inbox.jsonl');

// The docs whose claims are worth checking: evidence and plan files. Not every
// markdown file in the repo -- a DECISION_RECORD_* is a record of what was
// believed at the time and is SUPPOSED to age.
const DEFAULT_DOCS = Object.freeze([
  'AS_BUILT.md', 'docs/PLAN_5.md', 'README.md', 'CLAUDE.md', 'docs/architecture.md',
]);

// --- detector 1: doc references to files that no longer exist --------------

const PATH_RE = /`([A-Za-z0-9_./-]+\.(?:js|py|json|md|sh|yml|yaml))`/g;

/**
 * Paths a doc names in backticks that do not exist on disk.
 *
 * Two exclusions, both load-bearing:
 *   - a bare filename with no directory (`guard.js`) is skipped: that is
 *     usually prose about a module, and resolving it against the repo root
 *     would invent findings for every module discussed by name.
 *
 * A KNOWN LIMITATION, hit immediately by this module's own paperwork: a doc
 * that *reports* a missing file, in backticks, is itself flagged -- writing up
 * the gateway-adapter finding in PLAN_5 made PLAN_5 a second finding for the
 * same underlying rot. The detector is not wrong (the path really is not
 * there), it just cannot tell a stale pointer from a deliberate mention. The
 * fix is in the prose, not here: name such a file WITHOUT backticks, since
 * backticks are precisely what marks it as a live path. Teaching the detector
 * to spot "does not exist" nearby would be the prose-guessing this module
 * exists to avoid, and it would be one more rule to be subtly wrong.
 *   - a gitignored path is skipped. `logs/.judge-cache.json` is referenced by
 *     AS_BUILT.md and is *supposed* to be absent from a fresh checkout -- it is
 *     created at runtime. Flagging it would be a false positive on every single
 *     run, and a control that cries wolf weekly gets ignored, which costs more
 *     than not having the control at all.
 */
function staleRefs({ repoRoot = REPO, docs = DEFAULT_DOCS, isIgnored = gitIgnored } = {}) {
  const out = [];
  for (const doc of docs) {
    const abs = path.join(repoRoot, doc);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    for (const ref of new Set([...text.matchAll(PATH_RE)].map((m) => m[1]))) {
      if (!ref.includes('/')) continue;
      if (fs.existsSync(path.join(repoRoot, ref))) continue;
      if (isIgnored(ref, repoRoot)) continue;
      out.push({
        kind: 'stale-ref', doc, ref,
        detail: `${doc} references \`${ref}\`, which does not exist`,
      });
    }
  }
  return out;
}

/** git's own answer, so this sweep and .gitignore can never drift apart. */
function gitIgnored(ref, repoRoot) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', ref],
      { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;              // exit 1 = not ignored; git absent = not ignored
  }
}

// --- detector 2: assertion counts a doc claims vs. what the suite reports ---

const SUITE_RE = /\b(?:code\/)?(test-[a-z0-9-]+)(?:\.js)?\b/g;
const COUNT_RE = /\b(\d{1,4})\s+assertions?\b/g;

/**
 * Split into sentence-ish spans. Crude on purpose: the scope only has to be
 * tight enough that a claim and its subject are genuinely adjacent, and
 * anything split wrongly becomes an `unchecked` count rather than a wrong
 * finding -- the failure mode is deliberately biased toward under-claiming.
 */
function sentences(text) {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[.!?;:])\s+|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Claims of the form "<suite> ... N assertions", scoped to one sentence.
 *
 * Checkable only when the sentence names exactly ONE suite and carries exactly
 * ONE count. "test-guard and test-shell already have 37 and 22 assertions"
 * names two of each and is deliberately left UNCHECKED rather than paired by
 * position -- left-to-right pairing is right often enough to be trusted and
 * wrong often enough to be dangerous, which is the worst combination for a
 * control.
 */
function assertionClaims({ repoRoot = REPO, docs = DEFAULT_DOCS } = {}) {
  const claims = [];
  let unchecked = 0;
  for (const doc of docs) {
    const abs = path.join(repoRoot, doc);
    if (!fs.existsSync(abs)) continue;
    for (const s of sentences(fs.readFileSync(abs, 'utf8'))) {
      const counts = [...s.matchAll(COUNT_RE)].map((m) => Number(m[1]));
      if (counts.length === 0) continue;
      const suites = [...new Set([...s.matchAll(SUITE_RE)].map((m) => m[1]))];
      if (suites.length === 1 && counts.length === 1) {
        claims.push({ doc, suite: suites[0], claimed: counts[0] });
      } else {
        unchecked += counts.length;
      }
    }
  }
  return { claims, unchecked };
}

/** Claims whose number no longer matches what the suite actually reports. */
function assertionDrift(claims, suiteResults) {
  const actual = new Map(suiteResults.map((r) => [r.name, r.count]));
  const out = [];
  for (const c of claims) {
    // A suite not in the CI list was not re-run, so there is no fresh number to
    // compare against. Silence here is correct: reporting "drift" from a count
    // we never measured would be the detector inventing a finding.
    if (!actual.has(c.suite)) continue;
    const now = actual.get(c.suite);
    if (now === null || now === c.claimed) continue;
    out.push({
      kind: 'assertion-drift', doc: c.doc, ref: c.suite,
      detail: `${c.doc} says ${c.suite} has ${c.claimed} assertions; it reports ${now}`,
    });
  }
  return out;
}

// --- the inbox: park, never fix --------------------------------------------

/** Stable across runs, so a finding parked last week is not parked again. */
function fingerprint(f) {
  return `${f.kind}:${f.doc || ''}:${f.ref || ''}`;
}

function readInbox(file = INBOX) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/**
 * Append the findings this run has not parked before. Append-only: nothing is
 * ever rewritten or removed, the same discipline as logs/actions.jsonl and for
 * the same reason -- a record you can edit is not a record.
 */
function park(findings, { file = INBOX, now } = {}) {
  const already = new Set(readInbox(file).map((r) => r.fingerprint));
  const fresh = findings.filter((f) => !already.has(fingerprint(f)));
  if (fresh.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${fresh
      .map((f) => JSON.stringify({
        ...f, fingerprint: fingerprint(f), parked_at: now.toISOString(),
      }))
      .join('\n')}\n`);
  }
  return { fresh, repeat: findings.length - fresh.length };
}

// --- the run ---------------------------------------------------------------

/**
 * @param {Date}     opts.now       injected clock -- nothing here calls Date.now()
 * @param {Function} opts.runSweep  () => a sweep.js report; injected so a test
 *                                  never spawns 21 node processes
 */
function run({
  repoRoot = REPO, docs = DEFAULT_DOCS, now = new Date(),
  runSweep = () => sweepMod.sweep(), inboxFile = INBOX, isIgnored = gitIgnored,
} = {}) {
  const suite = runSweep();

  // Both a suite that cannot report and one reporting failure are rot worth
  // surfacing weekly -- CI already shouts about the second, but a weekly pass
  // is also the thing that notices CI has been red for a week.
  const suiteFindings = [
    ...suite.findings.map((r) => ({
      kind: 'suite-cannot-report', ref: r.name,
      detail: `${r.name}: ${sweepMod.WHY[r.verdict]}`,
    })),
    ...suite.failures.map((r) => ({
      kind: 'suite-failing', ref: r.name,
      detail: `${r.name}: exits ${r.exitCode} — its assertions do not hold`,
    })),
  ];

  const refs = staleRefs({ repoRoot, docs, isIgnored });
  const { claims, unchecked } = assertionClaims({ repoRoot, docs });
  const drift = assertionDrift(claims, suite.results);

  const findings = [...suiteFindings, ...refs, ...drift];
  const parked = park(findings, { file: inboxFile, now });

  return {
    now: now.toISOString(),
    suite: { total: suite.total, assertions: suite.assertions },
    findings,
    parked: parked.fresh,
    repeat: parked.repeat,
    coverage: { claimsChecked: claims.length, claimsUnchecked: unchecked, docs: docs.length },
  };
}

function format(r) {
  const fresh = new Set(r.parked.map(fingerprint));
  const L = ['', 'WEEKLY SWEEP — rot nobody reported', ''];
  L.push(`  ${r.suite.total} suites, ${r.suite.assertions} assertions, at ${r.now}`);
  L.push('');
  if (r.findings.length === 0) {
    L.push('  no findings');
  } else {
    for (const f of r.findings) {
      L.push(`  ${fresh.has(fingerprint(f)) ? 'NEW ' : 'open'}  ${f.kind.padEnd(20)} ${f.detail}`);
    }
  }
  L.push('');
  // Printed on every run, findings or not: "no findings" must never be read as
  // "everything verified".
  L.push(`  coverage: ${r.coverage.claimsChecked} assertion claim(s) checked across ` +
         `${r.coverage.docs} doc(s); ${r.coverage.claimsUnchecked} numeric claim(s) ` +
         'seen but too ambiguous to verify');
  if (r.repeat) L.push(`  ${r.repeat} finding(s) already parked by an earlier run`);
  L.push('');
  L.push(r.parked.length
    ? `${r.parked.length} new finding(s) parked in logs/sweep-inbox.jsonl — nothing was changed`
    : 'nothing new to park');
  return L.join('\n');
}

/**
 * Non-zero only for NEW findings. A weekly job's exit code is its notification,
 * and re-reporting last week's parked item every week is how a control trains
 * you to ignore it.
 */
function exitCode(r) { return r.parked.length ? 1 : 0; }

module.exports = {
  run, format, exitCode, staleRefs, assertionClaims, assertionDrift,
  sentences, park, readInbox, fingerprint, gitIgnored,
  DEFAULT_DOCS, INBOX, PATH_RE, SUITE_RE, COUNT_RE,
};

if (require.main === module) {
  const report = run();
  console.log(format(report));
  process.exit(exitCode(report));
}
