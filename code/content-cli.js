/**
 * `jj content` — the surface Ahmed actually operates the two gates through.
 *
 * `code/content-pipeline.js` enforces the gates; without this they are a
 * library nobody can reach. Split the same way `status.js` and `bin/jj` are:
 * all logic and formatting here, behind a pure function, so it is testable
 * without a terminal; `bin/jj` is a thin shim that supplies the real
 * pipeline and the real TTY flag.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHAT THE GATE DEFENDS AGAINST, AND WHAT IT DOES NOT
 * ────────────────────────────────────────────────────────────────────────
 *
 * Worth stating precisely, because the honest boundary is narrower than the
 * word "gate" suggests and the difference matters.
 *
 * IT DEFENDS AGAINST: the pipeline advancing on its own; a produced artifact
 * reaching YouTube without Ahmed having read it; an approval silently
 * carrying over to a re-drafted script; drift, in the sense of a control that
 * stops working while still reporting green. Those are the realistic failure
 * modes and they are all covered, each by a test.
 *
 * IT DOES NOT DEFEND AGAINST A HOSTILE LOCAL AGENT, and cannot at this layer.
 * `code/shell.js`'s allowlist includes `node` and `bash`, so an agent that
 * can run shell commands can bypass this CLI entirely --
 * `node -e "require('./code/content-pipeline.js')..."` reaches `approve()`
 * directly. A TTY check here would stop the accidental and automated paths
 * but would be theatre against that one, and calling it a security boundary
 * would be a false claim of the kind this repo keeps correcting.
 *
 * So: the interactive check below is a SPEED BUMP, described as one. The real
 * mitigation is that every approval writes an audit row carrying `actor` and
 * `origin` (guard.js v4/v5), so an approval minted by a script is visible
 * afterwards even though it is not prevented beforehand. Detection, not
 * prevention, and named as such.
 *
 * `interactive` is an ARGUMENT rather than a `process.stdin.isTTY` read, for
 * the usual reason: a module that reads the environment cannot be tested
 * against both answers.
 */
const { GATES, STATES, hash } = require('./content-pipeline.js');

/** Which gate a job is currently waiting on, or null if it waits on neither. */
function gateFor(job) {
  if (job.state === STATES.SCRIPT_REVIEW) return GATES.SCRIPT;
  if (job.state === STATES.CUT_REVIEW) return GATES.CUT;
  return null;
}

const short = (h) => String(h).slice(0, 8);
const oneLine = (s, n = 60) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function renderQueue(jobs) {
  if (!jobs.length) return 'Nothing waiting on you.';
  const lines = ['On your desk:', ''];
  for (const j of jobs) {
    const gate = gateFor(j);
    lines.push(`  ${j.id.slice(0, 8)}  ${gate.padEnd(6)}  ${oneLine(j.brief)}`);
  }
  lines.push('', `  jj content show <id>     read it in full`);
  lines.push(`  jj content approve <id>  open the gate`);
  lines.push(`  jj content reject <id> "<why>"`);
  return lines.join('\n');
}

function renderShow(job) {
  const gate = gateFor(job);
  const lines = [
    `job     ${job.id}`,
    `state   ${job.state}`,
    `brief   ${job.brief}`,
    '',
  ];
  // SOURCES FIRST, and before the script. The gate asks Ahmed "is this mine
  // and is it true"; the second half is unanswerable without the material it
  // was drafted from, and a reader scrolling past 400 words of script to reach
  // the evidence will not go back for it.
  for (const field of ['sources', 'script', 'cut', 'metadata']) {
    if (job[field] == null) continue;
    const value = typeof job[field] === 'string' ? job[field] : JSON.stringify(job[field], null, 2);
    lines.push(`── ${field} ── (${short(hash(value))})`, value, '');
  }
  if (gate) {
    // The hash is printed so an approval in the log can be matched back to
    // exactly these bytes by eye, without re-deriving it.
    lines.push(`Waiting on the ${gate} gate. Approving binds to ${short(hash(job[gate === GATES.SCRIPT ? 'script' : 'cut']))}.`);
  } else {
    lines.push(`Not waiting on you (${job.state}).`);
  }
  for (const r of job.rejections) {
    lines.push(`Rejected at the ${r.gate} gate by ${r.by}${r.why ? `: ${r.why}` : ''}`);
  }
  return lines.join('\n');
}

/**
 * Resolve a short id prefix to a full one. Refuses on ambiguity rather than
 * picking the first match — approving the wrong job is exactly the mistake a
 * convenience feature should not be able to cause.
 */
function resolveId(pipe, prefix) {
  const ids = [...new Set(pipe.all().map((r) => r.job_id))];
  // An EXACT id wins outright. Without this, a job whose id is a prefix of
  // another's becomes unaddressable — "abc" would report itself ambiguous
  // against "abcdef" even though the user named it exactly.
  if (ids.includes(prefix)) return { id: prefix };
  const hits = ids.filter((id) => id.startsWith(prefix));
  if (!hits.length) return { error: `no job matches "${prefix}"` };
  if (hits.length > 1) return { error: `"${prefix}" matches ${hits.length} jobs — use more characters` };
  return { id: hits[0] };
}

/**
 * The whole command surface. Returns `{ text, exitCode }` and never calls
 * console or process.exit, so a test can assert on both.
 */
function run(pipe, argv, { interactive = false } = {}) {
  const [sub, ...rest] = argv;

  if (!sub || sub === 'help') {
    return {
      exitCode: sub ? 0 : 1,
      text: [
        'Usage: jj content <command>',
        '',
        '  queue                    what is waiting on you',
        '  list                     every job and its state',
        '  show <id>                read a job in full',
        '  approve <id>             open the gate it is waiting on',
        '  reject <id> "<why>"      send it back',
      ].join('\n'),
    };
  }

  if (sub === 'queue') return { text: renderQueue(pipe.pending()), exitCode: 0 };

  if (sub === 'list') {
    const jobs = pipe.list();
    if (!jobs.length) return { text: 'No content jobs yet.', exitCode: 0 };
    return {
      exitCode: 0,
      text: jobs.map((j) => `  ${j.id.slice(0, 8)}  ${j.state.padEnd(13)}  ${oneLine(j.brief)}`).join('\n'),
    };
  }

  // Validate the SUBCOMMAND before touching the id. Falling through meant a
  // typo'd command was reported as "no job matches <id>", which blames the
  // argument the user got right.
  if (!['show', 'approve', 'reject'].includes(sub)) {
    return { text: `unknown command "${sub}" — try: jj content help`, exitCode: 1 };
  }
  if (!rest.length) return { text: `${sub} needs a job id`, exitCode: 1 };
  const resolved = resolveId(pipe, rest[0]);
  if (resolved.error) return { text: resolved.error, exitCode: 1 };
  const job = pipe.get(resolved.id);

  if (sub === 'show') return { text: renderShow(job), exitCode: 0 };

  if (sub === 'approve' || sub === 'reject') {
    const gate = gateFor(job);
    if (!gate) {
      return { text: `job ${job.id.slice(0, 8)} is ${job.state} — no gate is waiting on you`, exitCode: 1 };
    }
    if (!interactive) {
      // A speed bump, not a boundary — see this module's header. It stops the
      // accidental and scripted paths; it does not stop an agent that calls
      // the pipeline module directly, and nothing here claims otherwise.
      return {
        exitCode: 1,
        text: [
          `Refusing to ${sub} without an interactive terminal.`,
          '',
          `An approval records "a human said yes". Minting one from a script`,
          `would make that false, so this path is closed by default.`,
          '',
          `Note this is a speed bump and not a security boundary: an agent with`,
          `shell access can call code/content-pipeline.js directly. Every`,
          `approval writes an audit row carrying actor and origin, so a minted`,
          `one is DETECTABLE afterwards rather than prevented beforehand.`,
        ].join('\n'),
      };
    }
    if (sub === 'approve') {
      const r = pipe.approve(job.id, gate, { by: 'human' });
      if (!r.ok) return { text: `refused: ${r.why}`, exitCode: 1 };
      const adv = pipe.advance(job.id, gate);
      if (!adv.ok) return { text: `approved, but could not advance: ${adv.why}`, exitCode: 1 };
      return { text: `${gate} gate opened — job is now ${adv.state}`, exitCode: 0 };
    }
    const why = rest.slice(1).join(' ');
    const r = pipe.reject(job.id, gate, { by: 'human', why });
    if (!r.ok) return { text: `refused: ${r.why}`, exitCode: 1 };
    return { text: `sent back${why ? `: ${why}` : ''}`, exitCode: 0 };
  }

  // Unreachable: the subcommand allowlist above is exhaustive. Kept as a
  // fail-closed default rather than an implicit `undefined` return, so
  // adding a command to the allowlist and forgetting to handle it errors
  // instead of silently succeeding.
  return { text: `unknown command "${sub}" — try: jj content help`, exitCode: 1 };
}

module.exports = { run, gateFor, renderQueue, renderShow, resolveId };
