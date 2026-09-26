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

/**
 * THE HEARTBEAT, and the hole it closes.
 *
 * `park()` writes only when there are findings — deliberately, and a test
 * pins it ("an empty run must not leave a directory behind as its only
 * trace"). The consequence went unnoticed until 2026-09-14: **a sweep that
 * found nothing is byte-identical to a sweep that never ran.** Both leave an
 * empty logs/. So the control that exists to find rot nobody reported had no
 * way to report that IT had stopped running, which is the same blind spot one
 * level up.
 *
 * Noticed the hard way: the Monday 07:00 UTC cron's first scheduled firing was
 * due at 2026-09-14T07:00Z and, checked at 09:26Z, the only run on record was
 * a manual dispatch. GitHub documents scheduled workflows as best-effort, so
 * that may simply have been a delay — but nothing in this repo could tell the
 * difference between "delayed", "never fired" and "ran and was clean", and
 * that is the part worth fixing.
 *
 * WHAT THIS CAN AND CANNOT SEE, stated precisely because the useful half is
 * narrower than "we now detect missed sweeps":
 *   - It CAN see that no sweep has run ON THIS MACHINE in N days. That is the
 *     case that matters for Ahmed noticing, because the Chromebook's logs/
 *     persists.
 *   - It CANNOT see a missed GitHub run. Runners are ephemeral and logs/ is
 *     gitignored, so a CI heartbeat dies with the job. GitHub's own Actions
 *     page is the only record of whether a scheduled run fired, and no file in
 *     this repo can stand in for it.
 * Writing it anyway on CI costs nothing and keeps one code path.
 */
const HEARTBEAT = path.join(REPO, 'logs', 'sweep-heartbeat.jsonl');

/**
 * The path `beat()` and `lastBeat()` default to, and the seam that keeps tests
 * off the real one.
 *
 * WHY THIS EXISTS, and it is not hypothetical: the first version of the
 * heartbeat took `heartbeatFile` as an option only, and nine of this module's
 * twelve run()-level tests did not pass it. They wrote fixture rows — suite
 * counts of 0 and 1, timestamps from 2026-03-01 — straight into the machine's
 * real heartbeat, where `jj status` reads them as the sweep's actual cadence.
 * That is precisely the defect code/test-helper.js was written to stop for the
 * audit log, reappearing in a new log four days later.
 *
 * Same shape of fix as guard.js's setLogFile(), for the same stated reason:
 * done once, at the top of the suite, so it needs no cooperation from whoever
 * writes the NEXT test. A test below asserts the real path stays untouched, so
 * a future leak fails rather than silently poisoning a control's input.
 */
let heartbeatFilePath = HEARTBEAT;

/** Tests only. Returns the previous path so a caller can restore it. */
function setHeartbeatFile(p) {
  const previous = heartbeatFilePath;
  heartbeatFilePath = p;
  return previous;
}

/** The path beat() will actually write to. */
function currentHeartbeatFile() { return heartbeatFilePath; }

// The docs whose claims are worth checking: evidence and plan files. Not every
// markdown file in the repo -- a DECISION_RECORD_* is a record of what was
// believed at the time and is SUPPOSED to age.
const DEFAULT_DOCS = Object.freeze([
  'AS_BUILT.md', 'docs/PLAN_5.md', 'README.md', 'CLAUDE.md', 'docs/architecture.md',
]);

/**
 * EVERY TRACKED MARKDOWN FILE, for the one check that must not be scoped.
 *
 * WHY THIS EXISTS, 2026-09-26. Detector 4 was added 2026-09-10 so a kill
 * switch documented at the wrong path "cannot recur silently". It could, and
 * it had: DEFAULT_DOCS is five files, and NOTES.md and REMAINING_WORK.md have
 * been naming `~/.jarvis-x/STOP` the whole time -- invisible to the detector
 * because they are not on the list. 27 tracked docs mention a STOP token;
 * the detector was reading 5 of them.
 *
 * That is the same shape as the two other scope failures this repo has found:
 * a suite excluded from CI for a reason nobody re-read, and a pin that greps
 * one file while the mechanism it guards runs through another. A control whose
 * scope is narrower than its reputation is worse than no control, because the
 * reputation is what stops anyone checking by hand.
 *
 * ONLY detector 4 gets this. The others stay on DEFAULT_DOCS deliberately:
 * assertion counts and stale refs are worth tracking in the living documents
 * and would be noise across 100 files, most of them dated session records that
 * are SUPPOSED to describe a repo that has moved on. The kill switch is
 * different in kind -- a wrong path there tells someone trying to STOP Jarvis
 * to create a file that halts nothing, at the moment they most need to be
 * right, and that is just as true in a runbook as in the living plan.
 *
 * archive/ and docs/incoming/ are excluded: both are explicitly historical,
 * and docs/incoming is reference material PLAN_5 §0 says does not set scope.
 */
function allDocs({ repoRoot = REPO } = {}) {
  try {
    const out = require('child_process')
      .execFileSync('git', ['ls-files', '*.md'],
        // stderr ignored: outside a git repo this prints 'not a git
        // repository' on the way to the fallback below, and a fallback that
        // is working as designed should not look like an error.
        { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const docs = out.split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((f) => !f.startsWith('archive/') && !f.startsWith('docs/incoming/'));
    // A git that answers with nothing is a git that is not working here; fall
    // back rather than silently scanning zero documents, which would read as
    // "no findings" -- the reassuring value an unknown must never take.
    return docs.length ? docs : DEFAULT_DOCS;
  } catch {
    return DEFAULT_DOCS;
  }
}

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

// --- detector 3: test files nothing runs ------------------------------------

/**
 * A code/test-*.js that no CI list runs.
 *
 * WHY THIS IS THE SWEEP'S JOB AND NOT sweep.js's. `code/sweep.js` asks whether
 * each suite IN the CI list can report a pass — which means a file outside
 * that list is invisible to it by construction. So the control that hunts
 * zero-assertion suites has a blind spot exactly where a suite has been
 * quietly dropped, and dropping one is the failure this repo has corrected
 * repeatedly (test.yml's own comment: "a tested module CI never runs is the
 * failure this repo keeps correcting").
 *
 * Found by cross-checking the two lists by hand on 2026-09-09: twelve files,
 * of which test.yml documents five as needing local hardware. The other seven
 * were excluded silently, and three of those assert nothing at all.
 *
 * WHAT IT ACTUALLY OBJECTS TO IS SILENCE, NOT EXCLUSION. Ten of the twelve are
 * excluded for good reasons — they need Piper, Kokoro, ollama, live APIs, or
 * are not suites at all. Excluding those is correct. What was wrong is that
 * seven of them were excluded with no reason written anywhere, so nobody could
 * tell a deliberate omission from a suite that fell out of the list.
 *
 * So the rule is: a suite the workflow NAMES is fine, wherever it names it —
 * in the run list or in a comment explaining why it is not in the run list.
 * A suite the workflow never mentions at all is the finding.
 *
 * This is deliberately NOT a second allowlist. An allowlist is a new list that
 * drifts from the workflow; this reads the workflow itself, so the decision
 * and its record live in one file and cannot disagree. Documenting an
 * exclusion is exactly the action the finding is asking for, which makes the
 * finding self-clearing — and a control that goes quiet when you do the right
 * thing is worth far more than one that is permanently red.
 */
function orphanSuites({ repoRoot = REPO, codeDir = null, listed = null } = {}) {
  const dir = codeDir || path.join(repoRoot, 'code');
  const workflowFile = path.join(repoRoot, '.github', 'workflows', 'test.yml');
  let inCI;
  let workflowText = '';
  try {
    inCI = new Set(listed || sweepMod.ciSuites({ workflowFile }));
    // Read the whole file, comments included: naming a suite in a comment that
    // explains why it is excluded is a documented decision, and this detector
    // exists to find UNdocumented ones.
    if (!listed) workflowText = fs.readFileSync(workflowFile, 'utf8');
  } catch {
    return [];                       // no workflow to compare against; say nothing
  }
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const m = /^(test-[a-z0-9-]+)\.js$/.exec(f);
    if (!m) continue;
    const name = m[1];
    if (name === 'test-helper' || inCI.has(name)) continue;
    // Named anywhere in the workflow — including a comment giving the reason —
    // counts as a documented decision rather than a silent drop.
    if (workflowText.includes(name)) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const asserts = (src.match(/assert[.(]/g) || []).length;
    out.push({
      kind: 'suite-not-in-ci', ref: name,
      detail: asserts === 0
        ? `${name}.js is in code/ but no CI list runs it, AND it asserts nothing — ` +
          'invisible to sweep.js, which only checks the listed suites'
        : `${name}.js is in code/ with ${asserts} assertion(s) but no CI list runs it`,
    });
  }
  return out;
}

// --- detector 4: the kill switch, documented at a path that is not it -------

/**
 * A doc naming the kill switch at the wrong path.
 *
 * WHY THIS IS ITS OWN DETECTOR rather than a case of detector 1. That one
 * matches paths by extension (`.js`, `.md`, ...) and the switch file has
 * none, so `~/.jarvis-x/STOP` was invisible to it. It was also invisible to
 * every other control here, and sat wrong in docs/PLAN_5.md -- the living
 * plan -- through an entire session of edits to that same file, including
 * edits by the agent that had already corrected the identical claim in
 * CLAUDE.md. That is the exact shape this module exists for: rot no commit
 * touches and no human happens to re-read.
 *
 * IT MATTERS MORE THAN A NORMAL STALE REF. Most doc drift costs a reader a
 * minute. This one tells someone trying to STOP Jarvis to create a file that
 * halts nothing, at the moment they most need to be right.
 *
 * THE REAL PATH IS READ FROM guard.js's OWN EXPORT, never written here. A
 * detector carrying its own copy of the value it checks is one rename away
 * from confidently enforcing the wrong answer -- and the value it would be
 * enforcing is the one thing in this repo that must not be wrong.
 *
 * THE CONTRAST EXCLUSION, and why it is not prose-guessing. Several docs name
 * the stale path deliberately, to say it is stale ("`.jarvis-x-STOP` at repo
 * root, not `~/.jarvis-x/STOP`"). Flagging those would punish exactly the
 * correction this detector wants. The rule is mechanical rather than
 * interpretive: if the CORRECT path appears within `WINDOW` characters of the
 * wrong one, the mention is a contrast, not a claim. No reading of the prose
 * around it, and no list of blessed phrasings to maintain.
 */
const STOP_TOKEN_RE = /`([^`\n]*STOP[^`\n]*)`/g;
const WINDOW = 300;

function killSwitchDrift({ repoRoot = REPO, docs = null, stopFile = null } = {}) {
  docs = docs || allDocs({ repoRoot });
  // Injected for tests; the default is guard.js's own constant.
  const real = path.basename(stopFile || require('./guard.js').STOP_FILE);
  const out = [];
  for (const doc of docs) {
    const abs = path.join(repoRoot, doc);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    for (const m of text.matchAll(STOP_TOKEN_RE)) {
      const token = m[1];
      // ONLY TOKENS THAT LOOK LIKE A PATH. `STOP_FILE.exists()` in
      // docs/architecture.md is a code expression naming guard.js's constant,
      // which is correct prose and not a path claim at all -- the first run of
      // this detector produced four such findings before this line existed.
      // A path claim contains a separator or is explicitly relative/home-anchored.
      if (!/[/\\]/.test(token) && !/^[.~]/.test(token)) continue;
      // AND A PATH CLAIM IS ONE TOKEN, not a command. Added 2026-09-26 when the
      // doc scope widened (see ALL_DOCS below): a runbook's
      // `test -e ~/jarvis-x/.jarvis-x-STOP && echo ...` and a plan's
      // `STOP_FILE.parent / "..."` both contain a slash, so both passed the
      // rule above, and basename() of a whole shell line is never the real
      // filename -- two false positives, both about code that was CORRECT.
      // The cost is stated rather than hidden: a stale path written with a
      // space in it escapes. No path in this repo has one, and a detector that
      // cries wolf on correct docs gets ignored, which is the worse failure.
      if (/\s/.test(token)) continue;
      if (path.basename(token) === real) continue;
      // The window deliberately EXCLUDES the matched token itself. Including
      // it let the token satisfy its own contrast test — a path that merely
      // contained the real basename excused itself, masking the basename
      // comparison above and making that check unfalsifiable.
      const before = text.slice(Math.max(0, m.index - WINDOW), m.index);
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + WINDOW);
      if (`${before}\n${after}`.includes(real)) continue;   // a contrast, not a claim
      out.push({
        kind: 'kill-switch-path', doc, ref: token,
        detail: `${doc} names the kill switch as \`${token}\`; guard.js uses ${real}`,
      });
    }
  }
  return out;
}

// --- the heartbeat: proof the sweep ran at all ------------------------------

/**
 * One line per run, ALWAYS — clean or not. That is the whole point: the
 * interesting case is the run that found nothing, because that is the one
 * indistinguishable from no run at all.
 *
 * Append-only like every other log here, and it records the counts rather
 * than the findings, so it stays small forever and never becomes a second
 * copy of the inbox to keep in sync.
 */
function beat(result, { file = heartbeatFilePath, now } = {}) {
  const row = {
    at: now.toISOString(),
    suites: result.suite.total,
    assertions: result.suite.assertions,
    findings: result.findings.length,
    parked: result.parked.length,
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  } catch (_e) {
    // A sweep that cannot write its heartbeat must still report its findings.
    // Losing the proof-of-life is strictly better than losing the answer, and
    // the staleness check reads a missing heartbeat as `unknown` rather than
    // as healthy, so the failure surfaces there instead of being swallowed.
  }
  return row;
}

/** The most recent run's row, or null. Used by code/status.js. */
function lastBeat({ file = heartbeatFilePath } = {}) {
  if (!fs.existsSync(file)) return null;
  const rows = fs.readFileSync(file, 'utf8').split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && typeof r.at === 'string');
  return rows.length ? rows[rows.length - 1] : null;
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
  // Detector 4 reads EVERY tracked doc rather than `docs` (see allDocs).
  // Still an argument, because a check whose scope a test cannot set is a
  // check whose scope nobody can verify.
  killSwitchDocs = null,
  runSweep = () => sweepMod.sweep(), inboxFile = INBOX, isIgnored = gitIgnored,
  heartbeatFile = heartbeatFilePath,
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
  const orphans = orphanSuites({ repoRoot });
  const { claims, unchecked } = assertionClaims({ repoRoot, docs });
  const drift = assertionDrift(claims, suite.results);
  // Deliberately NOT `docs`: this one reads every tracked markdown file.
  const killSwitch = killSwitchDrift({ repoRoot, docs: killSwitchDocs });

  const findings = [...suiteFindings, ...refs, ...orphans, ...drift, ...killSwitch];
  const parked = park(findings, { file: inboxFile, now });

  const result = {
    now: now.toISOString(),
    suite: { total: suite.total, assertions: suite.assertions },
    findings,
    parked: parked.fresh,
    repeat: parked.repeat,
    coverage: { claimsChecked: claims.length, claimsUnchecked: unchecked, docs: docs.length },
  };
  // Written LAST and unconditionally, so the heartbeat records a run that
  // completed rather than one that started. A row here means every detector
  // above returned.
  result.heartbeat = beat(result, { file: heartbeatFile, now });
  return result;
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

  // A COUNT BY CATEGORY, because a red run has to be legible in one line.
  // In CI the inbox starts empty on every run (logs/ is gitignored, the runner
  // is ephemeral), so EVERY finding reads as new and the job is red for as
  // long as any rot exists. With a backlog that needs human triage, that means
  // red every week — the "perpetually-red badge nobody trusts" test.yml's own
  // comment warns about. This does not change the pass/fail rule, which is a
  // judgement about how Ahmed wants to be notified and not mine to make; it
  // makes the red legible, so "did something newly break?" is answerable
  // without reading the list.
  const byKind = {};
  for (const f of r.findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  if (r.findings.length) {
    L.push(`  by kind: ${Object.entries(byKind).map(([k, n]) => `${k}=${n}`).join('  ')}`);
    const broken = (byKind['suite-cannot-report'] || 0) + (byKind['suite-failing'] || 0);
    L.push(broken
      ? `  ${broken} CONTROL(S) BROKEN — a suite cannot report, or is failing. Read these first.`
      : '  no control is broken: nothing here means a check stopped working.');
    L.push('  the rest is backlog awaiting a human decision, not an incident.');
    L.push('');
  }

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
  killSwitchDrift, beat, lastBeat, HEARTBEAT,
  setHeartbeatFile, currentHeartbeatFile,
  run, format, exitCode, staleRefs, assertionClaims, assertionDrift, orphanSuites,
  sentences, park, readInbox, fingerprint, gitIgnored,
  DEFAULT_DOCS, allDocs, INBOX, PATH_RE, SUITE_RE, COUNT_RE,
};

if (require.main === module) {
  const report = run();
  console.log(format(report));
  process.exit(exitCode(report));
}
