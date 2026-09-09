/**
 * BITEMPORAL MEMORY, LAYER 7 — the human inbox.
 *
 * docs/incoming/MEMORY_TEMPLATE.txt §7: whenever the repair step is not
 * confident enough to act alone, it parks the proposed change instead of
 * applying it, and a human clears the queue asynchronously. §8 puts this last,
 * "once there's something worth reviewing" — which is now, because layers 4-6
 * all park.
 *
 * WHAT THIS IS AND IS NOT. The template says "review UI". This is the review
 * *surface*: list what is open, resolve one item, see what was decided. A web
 * UI on top of it is a afternoon's work and is not the interesting part; the
 * interesting part is that approving a proposal goes back through layer 5
 * rather than round it, so a human-approved change is gated, audited and
 * kill-switchable exactly like an automatic one. Building a UI that wrote
 * directly to the store would be the whole design undone at the last step.
 *
 * APPROVING IS NOT A SHORTCUT. `resolve()` with 'approve' does not write the
 * fact. It re-submits the parked decision to `memory-repair.repair()` with
 * `routing: 'auto'` and `approved_by: 'human'` — so the stale-decision check
 * still runs, the kill switch still applies, and the audit row records that a
 * human authorised it. A proposal parked in March and approved in June is
 * re-validated against the store as it is in June, and refused if the world
 * moved on. That refusal is the feature: it is exactly the case a review queue
 * creates and a naive one ignores.
 *
 * APPEND-ONLY, LIKE EVERY OTHER RECORD HERE. A resolution is a NEW row
 * referencing the proposal's id; the proposal itself is never rewritten or
 * removed. So "what is open" is a fold over the file rather than a state
 * stored in it, and the queue can always answer "what did I decide in March
 * and why" — the same reason nothing in the fact store is ever deleted.
 */
const fs = require('fs');
const { repair, readInbox, INBOX } = require('./memory-repair.js');

/** A reviewer's answer. Closed set: an open one is unauditable. */
const VERDICTS = Object.freeze(['approve', 'reject']);

/**
 * Fold the append-only file into {open, resolved}.
 *
 * A proposal with a resolution row is closed; everything else is open. First
 * resolution wins — a second one for the same proposal is ignored rather than
 * overwriting, for the same reason the trading journal keeps the first close:
 * in an append-only record a later line disagreeing with a recorded decision
 * is suspect, not a correction.
 */
function fold(rows) {
  const proposals = [];
  const resolutions = new Map();
  for (const r of rows || []) {
    if (!r || !r.id) continue;
    if (r.kind === 'resolution') {
      if (!resolutions.has(r.proposalId)) resolutions.set(r.proposalId, r);
    } else if (r.kind === 'proposal') {
      proposals.push(r);
    }
  }
  const open = proposals.filter((p) => !resolutions.has(p.id));
  const resolved = proposals
    .filter((p) => resolutions.has(p.id))
    .map((p) => ({ proposal: p, resolution: resolutions.get(p.id) }));
  return { open, resolved };
}

/**
 * What is waiting for a human, oldest first — the order a queue should be
 * worked in, so nothing sits at the bottom forever.
 */
function list({ file = INBOX, now = () => new Date() } = {}) {
  const { open, resolved } = fold(readInbox(file));
  const nowMs = now().getTime();
  const withAge = open
    .map((p) => ({
      ...p,
      ageDays: Number(((nowMs - Date.parse(p.parked_at)) / 86400000).toFixed(2)),
    }))
    .sort((a, b) => String(a.parked_at).localeCompare(String(b.parked_at)));
  return { open: withAge, resolvedCount: resolved.length, resolved };
}

function appendResolution(file, row) {
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  return row;
}

/**
 * Resolve exactly one parked proposal.
 *
 * @param verdict 'approve' -> re-submit through layer 5 as a human decision
 *                'reject'  -> record the refusal and change nothing
 * @returns {{outcome: string, why: string, repair?: object}}
 */
function resolve({ id, verdict, store, file = INBOX, now = () => new Date(), note = '' } = {}) {
  const stamp = now().toISOString();
  const fail = (why) => ({ outcome: 'refused', why });

  if (!VERDICTS.includes(verdict)) return fail(`verdict must be one of ${VERDICTS.join('|')}`);
  const { open } = fold(readInbox(file));
  const proposal = open.find((p) => p.id === id);
  if (!proposal) {
    // Distinguish "never existed" from "already dealt with": a reviewer
    // double-clicking should be told the difference.
    const everything = fold(readInbox(file));
    const already = everything.resolved.find((r) => r.proposal.id === id);
    return fail(already
      ? `proposal ${id} was already ${already.resolution.verdict}d at ${already.resolution.at}`
      : `no open proposal ${id}`);
  }

  if (verdict === 'reject') {
    appendResolution(file, { kind: 'resolution', id: `r-${id}`, proposalId: id,
                             verdict, note, at: stamp });
    return { outcome: 'rejected', why: 'recorded; the store is unchanged' };
  }

  if (!store) return fail('approving needs a store — the change goes through the writer, not round it');

  // BACK THROUGH LAYER 5. Not a shortcut: the stale-decision check, the kill
  // switch and the audit row all still apply, and approved_by records that a
  // human authorised this rather than the agent.
  const decision = { action: proposal.action, targetId: proposal.targetId,
                     at: proposal.at, routing: 'auto', why: [`approved by human: ${note || 'no note'}`] };
  const result = repair({ decision, candidate: proposal.candidate, store,
                          approvedBy: 'human', inboxFile: file, now });

  appendResolution(file, { kind: 'resolution', id: `r-${id}`, proposalId: id, verdict,
                           note, at: stamp, outcome: result.outcome, why: result.why });

  return result.outcome === 'applied'
    ? { outcome: 'applied', why: result.why, repair: result }
    // A proposal parked in March and approved in June, whose target moved in
    // April, lands here. The refusal is the point of re-validating.
    : { outcome: 'refused', why: `the writer refused: ${result.why}`, repair: result };
}

function format(l) {
  const L = ['', 'MEMORY INBOX — waiting for a human', ''];
  if (!l.open.length) {
    L.push('  nothing open');
  } else {
    for (const p of l.open) {
      L.push(`  ${p.id.slice(0, 8)}  ${String(p.action).padEnd(8)} ${p.ageDays}d  ` +
             `${p.candidate?.topic ?? '?'}: ${p.candidate?.text ?? p.candidate?.value ?? ''}`);
      for (const w of p.why || []) L.push(`      ${w}`);
    }
  }
  L.push('');
  L.push(`  ${l.open.length} open, ${l.resolvedCount} resolved`);
  L.push('');
  L.push('  Approving re-submits through the writer: the staleness check, the kill');
  L.push('  switch and the audit row all still apply, and a proposal whose target has');
  L.push('  moved since it was parked is refused rather than forced.');
  return L.join('\n');
}

module.exports = { list, resolve, fold, format, VERDICTS, INBOX };

if (require.main === module) console.log(format(list()));
