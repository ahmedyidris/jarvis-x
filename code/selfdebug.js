#!/usr/bin/env node
// selfdebug: read Jarvis's own audit log, group its failures, and say what
// each one probably is. NOTES.md deferred this file with:
//
//   "agent reads its own errors and proposes fixes. Do not build while
//    accuracy is 77%. A self-modifying loop plus a model that picks the
//    right action three times in four is how a repo ends up editing its own
//    constraints. Revisit when the accuracy number is boring."
//
// Both halves of that gate are now closed. Routing measured 41/41 held-out
// on 2026-09-07 (REMAINING_WORK.md P0.2), and "editing its own constraints"
// stopped being possible the same day (P0.4: OFF_LIMITS in validate.js,
// gated in validate() and execute()).
//
// WHAT THIS IS NOT:
//   - It is not a fixer. It never writes a file and never runs a command.
//     There is no code path here that could. `diagnose()` returns findings;
//     a human reads them. Same posture as trade-advisor.js, which proposes
//     trades and cannot open one.
//   - It is not a model. Every judgement below is a rule over log rows, so
//     the same log always yields the same findings and the whole thing is
//     testable offline. A model would add plausible-sounding fixes that
//     nothing could verify, which is the opposite of what this repo needs.
//   - It is not a claim that unattributable rows are fine. It says how many
//     it cannot classify, every time.
//
// THE PROBLEM THIS FILE HAD TO SOLVE FIRST. logs/actions.jsonl held 2810
// rows on 2026-09-07 and 599 of them looked like failures. Almost all were
// test fixtures -- tests call guard() and it appends to the real log. The
// first useful version of this tool would have reported "gemini 429 occurred
// 29 times, investigate the Gemini integration" about a string that exists
// only in test-guard.js. guard.js now records `origin` and stamps rows v3;
// v2 rows are reported as UNATTRIBUTABLE rather than guessed at.
const fs = require('fs');
const path = require('path');

// Deliberately NOT imported: lib.js (execute), shell.js (run), exec.js
// (writeFile). This module holds no reference to anything that can change
// the machine. test-selfdebug.js asserts that from the source.
const { LOG_FILE } = require('./guard.js');

const DEFAULT_WINDOW_HOURS = 24 * 7;

/** Read the audit log. Tolerant of a truncated final line -- the log is
 *  appended to by live processes, so a partial row is normal, not corrupt. */
function load({ logFile = LOG_FILE } = {}) {
  if (!fs.existsSync(logFile)) return { rows: [], unparseable: 0 };
  const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
  const rows = [];
  let unparseable = 0;
  for (const line of lines) {
    try { rows.push(JSON.parse(line)); } catch { unparseable++; }
  }
  return { rows, unparseable };
}

/** 'test' | 'app' | 'unknown'. Anything below v3 is unknown: guard.js only
 *  started recording provenance on 2026-09-07, and nothing can work out
 *  after the fact whether an older row came from a test. */
function originOf(row) {
  if (row.origin === 'test' || row.origin === 'app') return row.origin;
  return 'unknown';
}

function isFailure(row) {
  return row.outcome === 'error' || row.allowed === false;
}

/** What KIND of failure, from the fields guard.js actually writes. */
function classify(row) {
  if (row.outcome === 'killswitch') return 'killswitch';
  if (row.action === 'refused-cmd') return 'refused-command';
  if (row.outcome === 'refused') return 'refused';
  if (row.outcome === 'error') return 'error';
  if (row.allowed === false) return 'denied';
  return 'other';
}

/** Group key. Two failures belong together when the same action failed for
 *  the same reason.
 *
 *  The error text is normalised first, or every occurrence looks unique and
 *  the report becomes a list of ones. Numbers, quoted strings, paths, hex
 *  ids and ISO timestamps all vary between otherwise identical failures --
 *  "Ollama returned 404" and "Ollama returned 500" are the same finding for
 *  a reader, and "no such file: logs/a" and "no such file: logs/b" are too.
 *  `level` is NOT part of the key: guard.js's own comment records that
 *  callers put whole command strings in that slot, so it is high-cardinality
 *  free text that would fragment every group. */
function normalizeError(text) {
  return String(text ?? '')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/(['"])(?:(?!\1).)*\1/g, '<str>')
    .replace(/\/[\w./-]+/g, '<path>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

function signature(row) {
  return `${classify(row)}|${row.action ?? '(no action)'}|${normalizeError(row.error)}`;
}

// A finding says what to look at, never what to write. Each entry is keyed
// by the failure kind, so a new kind gets a generic suggestion rather than a
// confident wrong one.
const SUGGESTIONS = {
  'refused-command': 'A command outside shell.js\'s allowlist was proposed. ' +
    'Expected when the model reaches for something it does not have; a burst ' +
    'of these on ONE command is worth reading as a capability the agent keeps ' +
    'wanting. The refusal itself is the control working.',
  killswitch: 'Actions were attempted while .jarvis-x-STOP existed. If that ' +
    'was not deliberate, something is running unattended that should not be.',
  error: 'The action threw. The normalised message is the group key; read the ' +
    'sample rows for the exact text before changing anything.',
  refused: 'The action was refused by a policy check rather than failing.',
  denied: 'Logged with allowed:false and no outcome. Pre-v2 callers did this; ' +
    'a NEW one means a caller is not recording its verdict.',
  other: 'Failure with no recognised shape. Read the sample rows.',
};

/**
 * Group the failures in the log and describe each group.
 *
 * Returns { findings, counted, skipped, unattributable, unparseable, window }.
 * Writes nothing. Runs nothing. Consults no model.
 */
function diagnose({
  logFile = LOG_FILE,
  now = new Date(),
  windowHours = DEFAULT_WINDOW_HOURS,
  includeTests = false,
  minCount = 1,
} = {}) {
  const { rows, unparseable } = load({ logFile });
  const cutoff = new Date(now.getTime() - windowHours * 3600 * 1000);

  const groups = new Map();
  let counted = 0, skippedTest = 0, unattributable = 0, outsideWindow = 0;

  for (const row of rows) {
    // Never diagnose our own output. supervisor.js shipped with exactly this
    // bug: its skip entries landed in the log it read, and left unclassified
    // they made a goal look stagnant BECAUSE it had been skipped. This module
    // writes nothing today, so the filter is precautionary -- and cheap.
    if (typeof row.action === 'string' && row.action.startsWith('selfdebug')) continue;

    const ts = Date.parse(row.timestamp);
    if (Number.isFinite(ts) && ts < cutoff.getTime()) { outsideWindow++; continue; }
    if (!isFailure(row)) continue;

    const origin = originOf(row);
    if (origin === 'test' && !includeTests) { skippedTest++; continue; }
    if (origin === 'unknown') { unattributable++; if (!includeTests) continue; }

    counted++;
    const sig = signature(row);
    if (!groups.has(sig)) {
      groups.set(sig, {
        signature: sig, kind: classify(row), action: row.action ?? null,
        error: row.error ? normalizeError(row.error) : null,
        count: 0, firstSeen: row.timestamp, lastSeen: row.timestamp,
        origins: new Set(), samples: [],
      });
    }
    const g = groups.get(sig);
    g.count++;
    g.origins.add(origin);
    if (Date.parse(row.timestamp) < Date.parse(g.firstSeen)) g.firstSeen = row.timestamp;
    if (Date.parse(row.timestamp) > Date.parse(g.lastSeen)) g.lastSeen = row.timestamp;
    if (g.samples.length < 3) g.samples.push(row);
  }

  const findings = [...groups.values()]
    .filter(g => g.count >= minCount)
    .map(g => ({
      ...g,
      origins: [...g.origins].sort(),
      suggestion: SUGGESTIONS[g.kind] ?? SUGGESTIONS.other,
    }))
    .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature));

  return {
    findings, counted, skippedTest, unattributable, unparseable, outsideWindow,
    totalRows: rows.length,
    window: { hours: windowHours, since: cutoff.toISOString(), now: now.toISOString() },
    includeTests,
  };
}

function format(report) {
  const L = [];
  L.push('');
  L.push('SELFDEBUG — nothing here has been changed, run, or fixed.');
  L.push('This reads logs/actions.jsonl and groups failures. Every line below');
  L.push('is a place to look, not an action taken.');
  L.push('');
  L.push(`window: last ${report.window.hours}h (since ${report.window.since})`);
  L.push(`log: ${report.totalRows} rows, ${report.counted} failures counted`);

  if (report.skippedTest) {
    L.push(`      ${report.skippedTest} test-origin failures skipped ` +
           `(tests call guard() against the real log; --include-tests to see them)`);
  }
  if (report.unattributable) {
    L.push(`      ${report.unattributable} UNATTRIBUTABLE (schema < v3, before ` +
           `guard.js recorded origin — cannot tell test from real, so not counted)`);
  }
  if (report.unparseable) {
    L.push(`      ${report.unparseable} unparseable line(s) — a truncated tail is normal`);
  }
  L.push('');

  if (!report.findings.length) {
    L.push('No failures in this window that could be attributed to the app.');
    if (report.unattributable) {
      L.push('That is not the same as "no failures": see UNATTRIBUTABLE above.');
    }
    L.push('');
    return L.join('\n');
  }

  for (const f of report.findings) {
    L.push(`[${f.kind}] ${f.action ?? '(no action)'} — ${f.count}x`);
    if (f.error) L.push(`  error:  ${f.error}`);
    L.push(`  window: ${f.firstSeen} .. ${f.lastSeen}`);
    L.push(`  origin: ${f.origins.join(', ')}`);
    L.push(`  look:   ${f.suggestion}`);
    if (f.samples.length) {
      L.push(`  sample: ${JSON.stringify(f.samples[0]).slice(0, 160)}`);
    }
    L.push('');
  }
  L.push(`${report.findings.length} finding(s). No file was written and no command was run.`);
  L.push('');
  return L.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const num = (flag, dflt) => {
    const i = args.indexOf(flag);
    if (i === -1) return dflt;
    const v = Number(args[i + 1]);
    return Number.isFinite(v) ? v : dflt;
  };
  const report = diagnose({
    windowHours: num('--hours', DEFAULT_WINDOW_HOURS),
    minCount: num('--min', 1),
    includeTests: args.includes('--include-tests'),
  });
  process.stdout.write(format(report));
  // Exit 0 regardless. Findings are information, not a build failure -- and a
  // non-zero exit here would make any wrapper treat "the agent had errors
  // last week" as "selfdebug is broken".
}

module.exports = {
  diagnose, format, load, classify, signature, normalizeError, originOf,
  isFailure, SUGGESTIONS, DEFAULT_WINDOW_HOURS,
};
