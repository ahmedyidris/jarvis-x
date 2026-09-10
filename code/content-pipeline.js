/**
 * CONTENT PIPELINE, PHASE 1 — the two gates, and the machine that enforces them.
 *
 * PLAN_5 §7 item 5 / §6.2. The ruling there is one sentence: **Ahmed owns the
 * idea and the narrative; Jarvis owns everything downstream of it.** In flow
 * terms:
 *
 *   prompt/link -> research -> outline -> script draft in his voice
 *              -> [HIS EDIT]                      <- GATE 1
 *              -> render -> thumbnail/title/description
 *              -> [HIS APPROVAL OF THE CUT]       <- GATE 2
 *              -> queue -> post
 *
 * WHY THE GATE IS AT THE SCRIPT, in §6.2's own reasoning: that is where saying
 * no is cheapest. The flood Ahmed described -- "text overcame me for its
 * generated" -- was generated text arriving with no gate at all. Automating
 * production while gating the narrative is the shape that fixes it; automating
 * the narrative and gating production would be the shape that caused it.
 *
 * WHAT THIS FILE IS AND IS NOT. It is the state machine and the two gates: the
 * part where correctness matters and the part that needs no credentials.
 * Research, scripting, rendering and posting are INJECTED FUNCTIONS -- this
 * module opens no socket, calls no model, and publishes nothing. That is the
 * same rule every other module in this repo follows (`memory-sweep`'s
 * repairFn, `memory-embed`'s embedder, `status`'s fetch), and it is what lets
 * the whole suite run on a CI box with no Higgsfield key and no ollama.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE FOUR RULES, each of which a naive implementation gets wrong
 * ────────────────────────────────────────────────────────────────────────
 *
 * 1. AN APPROVAL IS BOUND TO THE ARTIFACT IT APPROVED. This is the rule that
 *    matters most and the one most easily missed. If Ahmed approves a script
 *    and the script is then regenerated, the approval must NOT carry over --
 *    otherwise "approve, then swap" publishes something he never read, and the
 *    gate becomes decorative while still reporting green. Every approval
 *    records the SHA-256 of the exact artifact text; advancing re-hashes the
 *    current artifact and refuses on any mismatch. Same mechanism as
 *    `source_hash` in the memory store, for the same reason.
 *
 * 2. AN APPROVAL NAMES ITS GATE. A `script` approval must not satisfy the
 *    `cut` gate. This is not hypothetical caution: the integration test for
 *    bitemporal memory found exactly this class of bug one module over, where
 *    layer 4 collapsed two distinct intents into one token and layer 7 then
 *    re-submitted the wrong one. Both layers' own suites stayed green. So the
 *    gate name is part of the approval and is checked, not assumed.
 *
 * 3. ABSENCE OF AN APPROVAL IS NEVER APPROVAL. Verdicts come from
 *    `guard.js`'s three-valued `gateVerdict()` -- approved / refused /
 *    **unknown** -- not a boolean. A missing row, a malformed row and a
 *    rejection are all "not approved", but only an explicit rejection is
 *    `refused`; the rest are `unknown`, and both block. A boolean here would
 *    make "we never asked" indistinguishable from "he said yes".
 *
 * 4. POSTING IS THE ONE THING THAT CANNOT BE REACHED WITHOUT GATE 2. §6.2:
 *    "Posting automated, publishing gated on his approval of the cut." So
 *    `post()` refuses on any job not in QUEUED, and QUEUED is reachable only
 *    through the cut gate. A test drives every other state at it.
 *
 * ────────────────────────────────────────────────────────────────────────
 *
 * APPEND-ONLY, like `logs/actions.jsonl` and `memory/facts.jsonl`. A job's
 * state is a fold over its rows, never a mutated field, so "what did he
 * approve and when" survives every later change. Nothing is deleted.
 *
 * EVERY STATE CHANGE RUNS INSIDE `guard()`, so `.jarvis-x-STOP` halts the
 * pipeline through the same door as every other agent action, and each
 * transition leaves a schema-v5 audit row. There is no second write path to
 * keep locked -- the one-writer rule this repo applies to memory, applied
 * here.
 *
 * NOT WIRED INTO `code/scheduler.js`. Deliberate, and pinned by a test rather
 * than promised in a commit message.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { guard, gateVerdict, APPROVERS, SCHEMA, normalizeClaim } = require('./guard.js');

const REPO = path.join(__dirname, '..');
const DEFAULT_FILE = path.join(REPO, 'logs', 'content-jobs.jsonl');

/**
 * The two gates, by name. Frozen and exported because rule 2 turns on these
 * being distinct tokens that both sides spell the same way.
 */
const GATES = Object.freeze({ SCRIPT: 'script', CUT: 'cut' });

/**
 * States. The two REVIEW states are the only ones a human acts on; everything
 * else is Jarvis's to advance.
 */
const STATES = Object.freeze({
  DRAFTING: 'drafting',
  SCRIPT_REVIEW: 'script-review',
  PRODUCING: 'producing',
  CUT_REVIEW: 'cut-review',
  QUEUED: 'queued',
  POSTED: 'posted',
  REJECTED: 'rejected',
});

/**
 * Which artifact each gate approves. Advancing past a gate re-hashes THIS
 * field and compares it to the hash on the approval — rule 1. Keeping the
 * mapping here rather than at each call site means a new gate cannot be added
 * without saying what it binds to.
 */
const GATE_ARTIFACT = Object.freeze({
  [GATES.SCRIPT]: 'script',
  [GATES.CUT]: 'cut',
});

/** The state a job must be in for a gate to be answerable at all. */
const GATE_STATE = Object.freeze({
  [GATES.SCRIPT]: STATES.SCRIPT_REVIEW,
  [GATES.CUT]: STATES.CUT_REVIEW,
});

const hash = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');

function readRows(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function openPipeline({ file = DEFAULT_FILE, clock = { iso: () => new Date().toISOString() } } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const all = () => readRows(file);
  const rowsFor = (jobId) => all().filter((r) => r.job_id === jobId);

  function append(row) {
    const full = { ...row, at: clock.iso() };
    fs.appendFileSync(file, JSON.stringify(full) + '\n');
    return full;
  }

  /**
   * A job's current shape, folded from its rows. Deliberately recomputed on
   * every read rather than cached: a cache is a second source of truth, and
   * the whole point of the append-only log is that there is exactly one.
   */
  function get(jobId) {
    const rows = rowsFor(jobId);
    if (!rows.length) return null;
    const job = {
      id: jobId, state: STATES.DRAFTING, brief: null,
      script: null, cut: null, metadata: null,
      approvals: [], rejections: [], history: rows,
    };
    for (const r of rows) {
      if (r.kind === 'start') { job.brief = r.brief; job.state = STATES.DRAFTING; }
      if (r.kind === 'attach') { job[r.field] = r.value; }
      if (r.kind === 'state') { job.state = r.state; }
      if (r.kind === 'approve') { job.approvals.push(r); }
      if (r.kind === 'reject') { job.rejections.push(r); }
    }
    return job;
  }

  const list = () => [...new Set(all().map((r) => r.job_id))].map(get);
  /** What is sitting on Ahmed's desk right now. */
  const pending = () => list().filter(
    (j) => j.state === STATES.SCRIPT_REVIEW || j.state === STATES.CUT_REVIEW);

  /**
   * A new job. The brief is Ahmed's -- a prompt, a subject, or a reference
   * link (§6.2's left-hand column). Jarvis never invents one, which is why
   * there is no default.
   */
  function start({ brief, id = null }) {
    if (typeof brief !== 'string' || !brief.trim()) {
      throw new Error('a content job needs a brief — the idea is Ahmed\'s, not Jarvis\'s');
    }
    const jobId = id || crypto.randomUUID();
    if (rowsFor(jobId).length) throw new Error(`job ${jobId} already exists`);
    return guard('content-start', jobId,
      () => { append({ job_id: jobId, kind: 'start', brief }); return get(jobId); });
  }

  /**
   * Attach a produced artifact (script, cut, metadata). Always allowed and
   * never itself a state change: producing a new script is exactly the event
   * that must INVALIDATE a prior approval, so it is recorded plainly and the
   * hash comparison at the gate does the rest. Blocking re-attachment instead
   * would just push the same problem into a place with no audit row.
   */
  function attach(jobId, field, value) {
    const job = get(jobId);
    if (!job) throw new Error(`no such job: ${jobId}`);
    if (!['script', 'cut', 'metadata'].includes(field)) {
      throw new Error(`unknown artifact "${field}"`);
    }
    return guard('content-attach', `${jobId}/${field}`,
      () => { append({ job_id: jobId, kind: 'attach', field, value }); return get(jobId); });
  }

  /** Move a job into a review state, i.e. hand it to Ahmed. */
  function submit(jobId, gate) {
    const job = get(jobId);
    if (!job) throw new Error(`no such job: ${jobId}`);
    const target = GATE_STATE[gate];
    if (!target) throw new Error(`unknown gate "${gate}"`);
    const artifact = job[GATE_ARTIFACT[gate]];
    if (!artifact) {
      return { ok: false, why: `nothing to review: job has no ${GATE_ARTIFACT[gate]} attached` };
    }
    guard('content-submit', `${jobId}/${gate}`,
      () => append({ job_id: jobId, kind: 'state', state: target, gate }));
    return { ok: true, state: target, job: get(jobId) };
  }

  /**
   * AHMED APPROVES. The approval is stamped with the hash of exactly what he
   * saw (rule 1) and the gate he answered (rule 2), and carries the v5 claim
   * fields so `gateVerdict()` can read it (rule 3).
   *
   * `by` defaults to nothing. A default of 'human' would let a code path that
   * forgot to say who approved something produce a human approval, which is
   * the forging shape guard.js's own header was corrected for.
   */
  function approve(jobId, gate, { by, confidence = 1 } = {}) {
    const job = get(jobId);
    if (!job) throw new Error(`no such job: ${jobId}`);
    if (!GATE_STATE[gate]) throw new Error(`unknown gate "${gate}"`);
    if (job.state !== GATE_STATE[gate]) {
      return { ok: false, why: `job is ${job.state}, not ${GATE_STATE[gate]} — nothing is awaiting the ${gate} gate` };
    }
    if (!APPROVERS.includes(by)) {
      return { ok: false, why: `"${by}" is not an approver (${APPROVERS.join('|')})` };
    }
    const artifact = job[GATE_ARTIFACT[gate]];
    guard('content-approve', `${jobId}/${gate}`, () => append({
      job_id: jobId, kind: 'approve', gate,
      artifact_hash: hash(artifact),
      // THE CLAIM FIELDS ARE BUILT BY guard.js, NOT BY US, and the schema
      // stamp is its exported constant rather than a literal.
      //
      // Why go through normalizeClaim(): gateVerdict() reads these, and a
      // second copy of the validation here would be a second definition of
      // "approved" — the same failure as two staleness thresholds for one
      // word. It also means a malformed approver is rejected by the same code
      // that rejects one in the audit log.
      //
      // Why stamping `schema` is legitimate HERE and is forgery in the audit
      // log: this is our own file and we are its writer, so the stamp states
      // the shape we actually wrote. guard.js's append() had a hole where a
      // CALLER could stamp v5 on a row guard was writing, which is different
      // — there the stamp asserted something about a writer that was not the
      // one making the claim. The derived fields go LAST here for the same
      // reason they were moved last there: a caller-supplied `by` must never
      // be able to overwrite them.
      ...normalizeClaim({ approved_by: by, confidence }),
      schema: SCHEMA,
    }), { approved_by: by, confidence });
    return { ok: true, job: get(jobId) };
  }

  /** AHMED SAYS NO. Explicit, and distinguishable from silence. */
  function reject(jobId, gate, { by, why = '' } = {}) {
    const job = get(jobId);
    if (!job) throw new Error(`no such job: ${jobId}`);
    if (!GATE_STATE[gate]) throw new Error(`unknown gate "${gate}"`);
    if (!APPROVERS.includes(by)) {
      return { ok: false, why: `"${by}" is not an approver (${APPROVERS.join('|')})` };
    }
    guard('content-reject', `${jobId}/${gate}`, () => {
      append({ job_id: jobId, kind: 'reject', gate, by, why });
      append({ job_id: jobId, kind: 'state', state: STATES.REJECTED });
    });
    return { ok: true, job: get(jobId) };
  }

  /**
   * THE GATE ITSELF. Read-only: it answers "may this job pass?" and changes
   * nothing, so it is safe to call from a UI, a status line, or a test.
   *
   * Returns `{ verdict, why }` where verdict is guard.js's three-valued
   * result. The `why` is for a human reading a queue, and names which of the
   * four rules blocked it.
   */
  function checkGate(jobId, gate) {
    const job = get(jobId);
    if (!job) throw new Error(`no such job: ${jobId}`);
    if (!GATE_STATE[gate]) throw new Error(`unknown gate "${gate}"`);
    if (job.state === STATES.REJECTED) {
      return { verdict: 'refused', why: 'the job was rejected' };
    }
    const artifact = job[GATE_ARTIFACT[gate]];
    if (!artifact) return { verdict: 'unknown', why: `no ${GATE_ARTIFACT[gate]} attached` };

    // Rule 2: only approvals naming THIS gate count. Latest wins, because a
    // re-approval after a re-draft is the normal path.
    const mine = job.approvals.filter((a) => a.gate === gate);
    if (!mine.length) return { verdict: 'unknown', why: `no approval for the ${gate} gate` };
    const latest = mine[mine.length - 1];

    // Rule 3: the verdict is guard.js's, not a boolean of our own.
    const verdict = gateVerdict(latest);
    if (verdict !== 'approved') {
      return { verdict, why: `the ${gate} approval reads "${verdict}"` };
    }

    // Rule 1: bound to the artifact. Checked LAST so that a stale approval is
    // reported as stale rather than as a missing one.
    if (latest.artifact_hash !== hash(artifact)) {
      return {
        verdict: 'unknown',
        why: `the ${GATE_ARTIFACT[gate]} changed after it was approved — that approval is void`,
      };
    }
    return { verdict: 'approved', why: `approved by ${latest.approved_by}` };
  }

  /**
   * Advance past a gate. The only route from SCRIPT_REVIEW to PRODUCING and
   * from CUT_REVIEW to QUEUED, and it refuses on anything but `approved`.
   */
  function advance(jobId, gate) {
    const job = get(jobId);
    if (!job) throw new Error(`no such job: ${jobId}`);
    if (!GATE_STATE[gate]) throw new Error(`unknown gate "${gate}"`);
    if (job.state !== GATE_STATE[gate]) {
      return { ok: false, why: `job is ${job.state}, not ${GATE_STATE[gate]}` };
    }
    const { verdict, why } = checkGate(jobId, gate);
    if (verdict !== 'approved') return { ok: false, verdict, why };
    const next = gate === GATES.SCRIPT ? STATES.PRODUCING : STATES.QUEUED;
    guard('content-advance', `${jobId}/${gate}`,
      () => append({ job_id: jobId, kind: 'state', state: next, gate }));
    return { ok: true, state: next, job: get(jobId) };
  }

  /**
   * POST. Rule 4: reachable only from QUEUED, which is reachable only through
   * the cut gate. `poster` is injected and this module never supplies a
   * default — there is no code path from here to YouTube that a test could
   * accidentally trigger, by construction rather than by care.
   */
  async function post(jobId, poster) {
    const job = get(jobId);
    if (!job) throw new Error(`no such job: ${jobId}`);
    if (typeof poster !== 'function') throw new Error('post() needs a poster function');
    if (job.state !== STATES.QUEUED) {
      return { ok: false, why: `refusing to post a job in state "${job.state}" — only ${STATES.QUEUED} may post` };
    }
    // Re-check the cut gate at the moment of posting, not just at queueing.
    // Between queue and post the cut can be re-attached, and rule 1 has to
    // hold at the last possible instant or it holds at none.
    const { verdict, why } = checkGate(jobId, GATES.CUT);
    if (verdict !== 'approved') return { ok: false, verdict, why };

    const result = await guard('content-post', jobId, () => poster(job),
      { approved_by: 'human', confidence: 1 });
    append({ job_id: jobId, kind: 'state', state: STATES.POSTED, result: result ?? null });
    return { ok: true, result, job: get(jobId) };
  }

  return {
    file, clock,
    start, attach, submit, approve, reject, checkGate, advance, post,
    get, list, pending, all,
  };
}

module.exports = {
  openPipeline, GATES, STATES, GATE_ARTIFACT, GATE_STATE, DEFAULT_FILE, hash,
};
