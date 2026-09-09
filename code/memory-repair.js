/**
 * BITEMPORAL MEMORY, LAYER 5 — THE ONE WRITER.
 *
 * docs/incoming/MEMORY_TEMPLATE.txt §3 calls this "the single most reusable
 * idea in the whole guide": both paths — arrival (a message arrived) and sweep
 * (a timer fired) — converge on one writer, so there is one place to enforce
 * every rule and one place to write the audit trail. §8 item 5 puts it here in
 * the build order: "Everything before this proposes; only this applies."
 *
 * That is the whole contract. `code/memory-policy.js` (layer 4) decides and
 * writes nothing. `code/memory-bitemporal.js` (layer 2) is a data structure
 * that can write but does not decide. This module is the only thing that
 * turns a decision into a stored fact, and everything it does passes three
 * gates on the way.
 *
 * GATE 1 — THE KILL SWITCH, and a real gap this closes. `memory-bitemporal.js`
 * writes with `fs.appendFileSync` and does not import `guard.js`, so
 * `.jarvis-x-STOP` does not reach it: with the switch pulled, a direct call to
 * `store.born()` would still write. That is correct for layer 2 — it is a data
 * structure, and CONSTITUTION.md §VI is about halting *actions* — but it means
 * the gating has to live at the layer that performs the action. It lives here.
 * Every application runs inside `guard()`, so a pulled switch blocks the write
 * AND records the block, which §VI requires and is the single event most worth
 * auditing.
 *
 * GATE 2 — THE AUDIT ROW. `guard()` writes schema v5, so every applied repair
 * carries `confidence` and `approved_by` (CONSTITUTION.md §V's `human|jarvis`).
 * A repair with no confidence claim reads as `not-claimed` rather than as a
 * fabricated 1.0 — the rule guard.js's header sets out, inherited here for
 * free by not working around it.
 *
 * GATE 3 — ROUTING. A decision routed `parked` is NEVER applied, at any
 * confidence, by any caller. It goes to the human inbox instead. The template's
 * §7: propose, don't auto-merge, on anything above the risk bar.
 *
 * THE STALE-DECISION PROBLEM, which is the subtle one. Layer 4 decides every
 * candidate against ONE snapshot of the store — deliberately, because deciding
 * against a store it was mutating would make it a writer. So by the time a
 * decision reaches this module, the fact it targets may already have been
 * superseded by an earlier decision in the same batch, or by another caller.
 * Applying it anyway would open a second successor to one predecessor and
 * leave the store with two "current" facts at one (topic, scope) — precisely
 * the self-contradiction layer 4 refuses to add a third opinion to. So every
 * application re-validates its target against the store as it is NOW, and
 * refuses rather than guessing.
 */
const fs = require('fs');
const path = require('path');
const { guard, APPROVERS } = require('./guard.js');
const { STATUS } = require('./memory-bitemporal.js');

const REPO = path.join(__dirname, '..');
const INBOX = path.join(REPO, 'memory', 'repair-inbox.jsonl');

/** Outcomes of an attempted repair. Closed set, same reasoning as layer 4's. */
const OUTCOMES = Object.freeze(['applied', 'parked', 'refused']);

/**
 * Park a proposal for a human. Append-only, like every other record here.
 * The template calls the inbox "a view over the audit table, not a second copy
 * of the data"; this is a separate file because logs/actions.jsonl is written
 * by guard() in a fixed shape and a proposal is not an action that happened.
 * What matters is the property they share: nothing in it is ever rewritten.
 */
function park(entry, { file = INBOX, now }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ ...entry, parked_at: now })}\n`);
  return entry;
}

function readInbox(file = INBOX) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/** The current version of a fact, or null. */
function currentFact(store, id) {
  return store.current().find((f) => f.id === id) || null;
}

/**
 * Apply exactly one decision.
 *
 * @param decision  from memory-policy.decideFact()
 * @param candidate the fact the decision is about
 * @param store     an openStore() handle — the ONLY module that should hold one
 * @param approvedBy 'human' | 'jarvis' (CONSTITUTION.md §V)
 * @returns {{outcome: string, factId: ?string, why: string}}
 */
function repair({ decision, candidate, store, approvedBy = 'jarvis',
                  inboxFile = INBOX, now = () => new Date() } = {}) {
  const stamp = now().toISOString();
  const refuse = (why) => ({ outcome: 'refused', factId: null, why });

  if (!decision || !candidate || !store) return refuse('repair needs a decision, a candidate and a store');
  if (!APPROVERS.includes(approvedBy)) {
    // Not a default: an unrecognised approver means the caller does not know
    // who authorised this, and writing it as `jarvis` would invent an answer.
    return refuse(`approved_by must be one of ${APPROVERS.join('|')} (CONSTITUTION.md §V), got "${approvedBy}"`);
  }

  // GATE 3. Before anything else, and with no confidence override: a parked
  // decision is not a weak yes.
  if (decision.routing !== 'auto') {
    park({ kind: 'proposal', action: decision.action, candidate, why: decision.why,
           targetId: decision.targetId }, { file: inboxFile, now: stamp });
    return { outcome: 'parked', factId: null,
             why: `routed to the human inbox: ${decision.why.join('; ')}` };
  }

  const claim = { confidence: candidate.confidence, approved_by: approvedBy };

  // THE STALE-DECISION CHECK. Re-read the target as the store is NOW, not as
  // layer 4 saw it.
  if (decision.targetId) {
    const target = currentFact(store, decision.targetId);
    if (!target) return refuse(`target ${decision.targetId} is not in the store any more`);
    if (target.status === STATUS.SUPERSEDED || target.status === STATUS.EXPIRED) {
      return refuse(`target ${decision.targetId} is already ${target.status}; ` +
                    'this decision was made against an older snapshot');
    }
  }

  switch (decision.action) {
    case 'born': {
      // Re-check that nothing comparable appeared since the decision, or two
      // callers racing both "correctly" open a fact at the same (topic, scope).
      const clash = store.current().find(
        (f) => f.topic === candidate.topic && (f.scope || '') === (candidate.scope || '')
               && f.status === STATUS.ACTIVE);
      if (clash) {
        return refuse(`a fact already exists at topic "${candidate.topic}" scope ` +
                      `"${candidate.scope || ''}" (${clash.id}); the decision predates it`);
      }
      const f = guard('memory-repair-born', `${candidate.topic}/${candidate.scope || '-'}`,
        () => store.born(candidate), claim);
      return { outcome: 'applied', factId: f.id, why: 'opened a new interval' };
    }
    case 'reaffirm': {
      const f = guard('memory-repair-reaffirm', decision.targetId,
        () => store.reaffirm(decision.targetId), claim);
      return { outcome: 'applied', factId: f.id, why: 'fresh evidence; freshness reset' };
    }
    case 'replace': {
      const f = guard('memory-repair-replace', `${decision.targetId} -> ${candidate.topic}`,
        () => store.replace(decision.targetId, candidate), claim);
      return { outcome: 'applied', factId: f.id,
               why: `superseded ${decision.targetId}` };
    }
    default:
      // 'park' and 'coexist' should have been routed above or resolved into a
      // 'born' by layer 4. Reaching here means the two layers disagree about
      // the action vocabulary, which is worth refusing loudly rather than
      // interpreting.
      return refuse(`layer 5 cannot apply action "${decision.action}"`);
  }
}

/**
 * Apply a batch from memory-policy.extractWith(), in order.
 *
 * Each is applied against the store AS IT IS AFTER THE PREVIOUS ONE, which is
 * the necessary counterpart to layer 4 deciding all of them against a single
 * snapshot. Two candidates contradicting the same stored fact therefore end
 * with the first applied and the second REFUSED as stale — rather than both
 * "succeeding" and leaving two successors to one predecessor.
 */
function repairAll(results, opts = {}) {
  return (results || []).map(({ candidate, decision }) =>
    ({ candidate, decision, result: repair({ ...opts, decision, candidate }) }));
}

function format(applied) {
  const L = ['', 'MEMORY REPAIR — the one writer', ''];
  if (!applied.length) L.push('  (nothing to apply)');
  for (const { candidate, result } of applied) {
    L.push(`  ${result.outcome.toUpperCase().padEnd(8)} ${candidate.topic}/${candidate.scope || '-'}: ` +
           `${candidate.text ?? candidate.value}`);
    L.push(`      ${result.why}`);
  }
  const parked = applied.filter((a) => a.result.outcome === 'parked').length;
  L.push('');
  L.push(parked
    ? `  ${parked} proposal(s) parked in memory/repair-inbox.jsonl for review — not applied`
    : '  nothing parked');
  return L.join('\n');
}

module.exports = { repair, repairAll, park, readInbox, currentFact, format, OUTCOMES, INBOX };
