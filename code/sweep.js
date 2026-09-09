#!/usr/bin/env node
// THE ZERO-ASSERTION SWEEP.
//
// A broken build turns CI red. A check that quietly stopped checking signals
// nothing at all, and that asymmetry has cost this repo six findings, every
// one of them located by hand:
//
//   test-data-layer.js            exited 0 with the module it tested deleted
//   test-shell.js                 emptying shell.js's allowlist left it green
//   test-guard.js                 zero assertions, printed "Result: ACTION RAN"
//   test-agent-data-integration.js  requireNet() at the top skipped everything
//   test-helper.js                in the CI list, emits 0 bytes, 0 assertions
//   status.sh "shell.js routes via guard"  grepped a string the file never writes
//
// Nothing in the repo detects the class. This does, and it fails CI rather
// than printing a warning nobody reads.
//
// WHAT IT CHECKS, and what it deliberately does not. CI already reports a
// suite that FAILS. The gap is a suite that cannot fail: one that reports no
// assertion count, or reports zero. So a finding here is "this file cannot
// tell you whether it passed", which is a different and quieter defect than
// "this file failed".
//
// THE TRAP THIS AVOIDS. The obvious implementation greps for one output
// format, and it would get the two known cases exactly backwards:
//
//   test-scheduler.js  prints "8/8 passed"        -> 8 real checks, exits 1
//                                                    when mutated. FINE.
//   test-helper.js     prints nothing at all      -> a library, not a test.
//                                                    BROKEN.
//
// A `grep "Passed:"` sweep clears the broken one and flags the working one.
// So this keys on an assertion count parsed from ANY known format, plus the
// exit code -- never on a single hardcoded string.
//
// ONE LIST, NOT TWO. The suites are read out of .github/workflows/test.yml,
// because a second copy of that list in this file would drift from it and the
// drift would be silent -- which is the very failure mode being swept for.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const WORKFLOW = path.join(REPO, '.github', 'workflows', 'test.yml');

// Known "how a suite reports its own count" formats, most specific first.
// Adding a format here is how a new harness gets supported; the point is that
// the set is explicit and testable, not that it is one string.
const COUNT_FORMATS = Object.freeze([
  // test-helper.js's finish(): "Passed: 37, Failed: 0"
  { name: 'passed-failed', re: /^Passed:\s*(\d+)\s*,\s*Failed:\s*(\d+)/m,
    count: m => Number(m[1]) + Number(m[2]) },
  // test-scheduler.js's own checker: "8/8 passed", "6/8 passed"
  { name: 'n-of-n', re: /^(\d+)\/(\d+)\s+passed/m, count: m => Number(m[2]) },
]);

/** The CI suite list, read from the workflow's own `for f in ...; do` loop.
 *  Returns bare names ('test-guard'), in file order. */
function ciSuites({ workflowFile = WORKFLOW } = {}) {
  const yml = fs.readFileSync(workflowFile, 'utf8');
  // The list is a shell loop spanning several lines with `\` continuations.
  const m = yml.match(/for\s+f\s+in\s+([\s\S]*?);\s*do/);
  if (!m) throw new Error(`no "for f in ...; do" suite list found in ${workflowFile}`);
  return m[1]
    .replace(/\\\s*\n/g, ' ')   // join continuations
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Pull an assertion count out of a suite's stdout, trying every known format.
 *  null means "this suite did not report a count", which IS the finding. */
function parseCount(output) {
  if (typeof output !== 'string') return null;
  for (const fmt of COUNT_FORMATS) {
    const m = output.match(fmt.re);
    if (m) {
      const count = fmt.count(m);
      if (Number.isFinite(count)) return { count, format: fmt.name };
    }
  }
  return null;
}

/** spawnSync sets status to null when it KILLS the child -- a timeout, or a
 *  signal. Both `r.status || 0` and `!r.status` read that as success, so the
 *  mapping gets its own name and its own test rather than living inline where
 *  a mutation to it goes unnoticed. (It did: this was extracted after a
 *  mutation run showed `r.status === null ? -1 : r.status` -> `r.status || 0`
 *  escaping every assertion in test-sweep.js.) */
function normalizeExit(status) {
  return status === null || status === undefined ? -1 : status;
}

function defaultRunner(file) {
  const r = spawnSync(process.execPath, [file], {
    cwd: REPO, timeout: 120000, maxBuffer: 10 * 1024 * 1024,
  });
  return {
    exitCode: normalizeExit(r.status),
    output: `${r.stdout || ''}${r.stderr || ''}`,
  };
}

/** 'ok' | 'no-count' | 'zero-count' | 'missing' | 'failed' */
function classify({ exists, exitCode, parsed }) {
  if (!exists) return 'missing';
  if (parsed === null) return 'no-count';
  if (parsed.count === 0) return 'zero-count';
  // Reported a real count. A non-zero exit is a genuine test failure, which is
  // CI's job to shout about -- reported, but not this sweep's finding.
  if (exitCode !== 0) return 'failed';
  return 'ok';
}

// Which verdicts mean "this file cannot tell you whether it passed". Only
// these fail the sweep. 'failed' is a working test reporting bad news.
const SWEEP_FINDINGS = Object.freeze(['no-count', 'zero-count', 'missing']);

const WHY = Object.freeze({
  'no-count': 'reports no assertion count, so it cannot fail visibly — a ' +
              'library in the suite list, or a harness that prints nothing',
  'zero-count': 'ran and asserted nothing — exits 0 no matter what the code does',
  'missing': 'named in the CI list but the file does not exist',
  'failed': 'a real failure: it asserted and the assertions did not hold',
});

function sweep({ workflowFile = WORKFLOW, codeDir = path.join(REPO, 'code'),
                 runner = defaultRunner, suites = null } = {}) {
  const names = suites || ciSuites({ workflowFile });
  const results = names.map(name => {
    const file = path.join(codeDir, `${name}.js`);
    const exists = fs.existsSync(file);
    const { exitCode, output } = exists
      ? runner(file)
      : { exitCode: -1, output: '' };
    const parsed = parseCount(output);
    const verdict = classify({ exists, exitCode, parsed });
    return {
      name, verdict, exitCode,
      count: parsed ? parsed.count : null,
      format: parsed ? parsed.format : null,
    };
  });
  const findings = results.filter(r => SWEEP_FINDINGS.includes(r.verdict));
  return {
    results, findings,
    failures: results.filter(r => r.verdict === 'failed'),
    total: results.length,
    assertions: results.reduce((n, r) => n + (r.count || 0), 0),
  };
}

function format(report) {
  const L = [''];
  L.push('ZERO-ASSERTION SWEEP — can each CI suite report whether it passed?');
  L.push('');
  for (const r of report.results) {
    const mark = r.verdict === 'ok' ? 'ok  '
               : r.verdict === 'failed' ? 'FAIL' : '>>>>';
    const detail = r.count === null ? 'NO ASSERTION COUNT'
                 : `${r.count} (${r.format})`;
    L.push(`  ${mark} ${r.name.padEnd(32)} ${detail}`);
  }
  L.push('');
  L.push(`${report.total} suites, ${report.assertions} assertions counted.`);
  if (report.failures.length) {
    L.push('');
    for (const r of report.failures) {
      L.push(`FAILING: ${r.name} — ${WHY.failed} (exit ${r.exitCode})`);
    }
  }
  if (!report.findings.length) {
    L.push('');
    L.push('Every listed suite reports a non-zero assertion count.');
    L.push('');
    return L.join('\n');
  }
  L.push('');
  L.push(`${report.findings.length} suite(s) CANNOT REPORT WHETHER THEY PASSED:`);
  L.push('');
  for (const r of report.findings) {
    L.push(`  ${r.name} — ${WHY[r.verdict]}`);
  }
  L.push('');
  L.push('Fix by giving it real assertions, or by removing it from the CI list');
  L.push('in .github/workflows/test.yml if it is not a test. Leaving it counts a');
  L.push('file that can never fail toward the suite total.');
  L.push('');
  return L.join('\n');
}

if (require.main === module) {
  const report = sweep();
  process.stdout.write(format(report));
  // Findings fail the build. A warning here would be a check that quietly
  // stopped checking, which is the thing this file exists to catch.
  process.exit(report.findings.length ? 1 : 0);
}

module.exports = { sweep, format, ciSuites, parseCount, classify, normalizeExit,
                   defaultRunner, COUNT_FORMATS, SWEEP_FINDINGS, WHY, WORKFLOW };
