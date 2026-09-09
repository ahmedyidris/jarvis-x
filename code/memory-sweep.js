/**
 * BITEMPORAL MEMORY, LAYER 6 — the sweep, and the case the whole design exists for.
 *
 * docs/incoming/MEMORY_TEMPLATE.txt §1 sets out the asymmetry: a memory that
 * was never true is easy to catch, because it contradicts something and
 * retrieval scores it badly. **A memory that WAS true is the dangerous one.**
 * It embedded perfectly, it retrieves with the highest score, and the model
 * states it with total confidence — because until recently nothing about it
 * was wrong.
 *
 * Facts go stale two ways. Somebody says something new, which is easy: an
 * event fires and layer 4 decides. Or **nobody says anything at all** — the
 * fact outlived its shelf life while no one mentioned it. Every purely
 * event-driven design is blind to that second case by construction, because
 * there is no event to fire on. This module is the answer to it, and it is the
 * same argument `code/weekly-sweep.js` makes about code: a broken build turns
 * CI red; a fact that quietly went out of date signals nothing.
 *
 * IT NEVER RETIRES ON AGE. This is the rule that matters most here, and it is
 * easy to get backwards. Age weakens *belief*; it does not falsify. The
 * template's own table is explicit — an aging fact "stays open, belief
 * weakens, still retrieved, flagged". A sweep that retired facts for being old
 * would destroy information on a timer, and it would do it precisely to the
 * facts nobody has mentioned lately rather than to the wrong ones. So the only
 * proposals this module makes are:
 *
 *   flag  a fact past its shelf life -> needs_verification, STILL RETRIEVED
 *   end   a fact whose own valid_to has already passed -> closed
 *
 * The second is not a judgement, it is arithmetic: the interval already said
 * the fact stops being true at that instant, and nothing marked it.
 *
 * DETECTION SPENDS NOTHING. Template §6: detection is pure lookups over our
 * own metadata, no model calls, which is what makes running it continuously
 * affordable on a free tier. Nothing in this file calls a model, opens a
 * socket, or reads a source document. Only a *repair* should ever cost money,
 * and only when confidence is genuinely ambiguous.
 *
 * IT WRITES NOTHING ITSELF. Every proposal goes through layer 5
 * (`code/memory-repair.js`), the one writer — so the kill switch and the v5
 * audit row cover the timer-driven path exactly as they cover the arrival
 * path, with no second door to keep locked. That is the template's "both paths
 * converge on one writer" made literal.
 */
const { freshness, THRESHOLDS, STATUS } = require('./memory-bitemporal.js');

/** What the sweep can propose. Deliberately excludes anything that retires. */
const SWEEP_ACTIONS = Object.freeze(['flag', 'end']);

/**
 * Facts that have quietly gone bad. Pure lookups against the store's own
 * metadata — no model calls, no network, no source re-reads.
 *
 * @param facts  currently-believed rows: store.current()
 * @param nowISO injected clock, per test.yml's house rule
 */
function detect(facts, nowISO, { floor = THRESHOLDS.freshnessFloor } = {}) {
  const findings = [];
  for (const f of facts || []) {
    if (!f || !f.id) continue;

    // 1. The window closed and nothing marked it. Arithmetic, not judgement,
    //    and checked FIRST: a fact whose valid_to has passed is not stale, it
    //    is over, and flagging it for verification would ask a human to
    //    re-confirm something that has already ended.
    if (f.valid_to && f.valid_to < nowISO && f.status !== STATUS.EXPIRED
        && f.status !== STATUS.SUPERSEDED) {
      findings.push({ kind: 'window-closed', id: f.id, fact: f, at: f.valid_to,
                      why: `valid_to ${f.valid_to} has passed and nothing closed it` });
      continue;
    }

    // 2. Past its shelf life. Only ACTIVE facts are candidates.
    //
    //    NEEDS_VERIFICATION is excluded by this line too, and that exclusion
    //    is load-bearing rather than incidental: re-flagging a flagged fact
    //    every night is how a signal becomes wallpaper. It is worth saying so
    //    here because a flagged fact IS still live and still retrieved, so
    //    widening this check to include it would look like a correction --
    //    and would silently remove that protection. An earlier draft had a
    //    separate `=== NEEDS_VERIFICATION` guard above; mutation testing
    //    showed it was dead code this line already covered, so the guard is
    //    gone and the reasoning stayed.
    if (f.status !== STATUS.ACTIVE) continue;

    const fresh = freshness(f, nowISO);
    if (fresh < floor) {
      findings.push({ kind: 'stale', id: f.id, fact: f, freshness: Number(fresh.toFixed(4)),
                      why: `freshness ${fresh.toFixed(2)} is below the floor ${floor} ` +
                           `(${f.volatility}, last verified ${f.last_verified_at})` });
    }
  }
  return findings;
}

/**
 * Turn findings into decisions layer 5 can apply.
 *
 * Both are routed `auto`, and that is defensible precisely because neither
 * destroys anything: flagging leaves the fact retrievable, and ending states
 * what the fact's own interval already said. Anything that WOULD destroy
 * information stays with layer 4 and its two thresholds.
 */
function propose(findings) {
  return (findings || []).map((f) => ({
    finding: f,
    candidate: f.fact,
    decision: f.kind === 'window-closed'
      ? { action: 'end', targetId: f.id, at: f.at, routing: 'auto', why: [f.why] }
      : { action: 'flag', targetId: f.id, routing: 'auto', why: [f.why] },
  }));
}

/**
 * Detect, propose, and route every proposal through the one writer.
 *
 * @param repairFn injected — `require('./memory-repair.js').repair` in
 *   production. Injected so a test can prove this module never writes by any
 *   other route, and so the sweep can be exercised without a store at all.
 */
function sweep({ store, repairFn, now = () => new Date(), approvedBy = 'jarvis',
                 inboxFile, floor = THRESHOLDS.freshnessFloor } = {}) {
  if (!store || typeof repairFn !== 'function') {
    throw new Error('sweep needs a store and a repair function; it must not write by any other route');
  }
  const nowISO = now().toISOString();
  const findings = detect(store.current(), nowISO, { floor });
  const proposals = propose(findings);

  const results = proposals.map(({ finding, candidate, decision }) => ({
    finding,
    result: repairFn({ decision, candidate, store, approvedBy, inboxFile, now }),
  }));

  return {
    now: nowISO,
    scanned: store.current().length,
    findings: findings.length,
    flagged: results.filter((r) => r.finding.kind === 'stale' && r.result.outcome === 'applied').length,
    ended: results.filter((r) => r.finding.kind === 'window-closed' && r.result.outcome === 'applied').length,
    refused: results.filter((r) => r.result.outcome === 'refused'),
    results,
  };
}

function format(r) {
  const L = ['', 'MEMORY SWEEP — facts nobody mentioned', ''];
  L.push(`  scanned ${r.scanned} fact(s) at ${r.now}`);
  if (!r.findings) {
    L.push('  nothing has gone stale');
  } else {
    for (const { finding, result } of r.results) {
      L.push(`  ${finding.kind.padEnd(14)} ${result.outcome.padEnd(8)} ${finding.id}: ${finding.why}`);
    }
  }
  L.push('');
  L.push(`  ${r.flagged} flagged for verification (still retrieved), ${r.ended} closed`);
  if (r.refused.length) L.push(`  ${r.refused.length} refused by the writer`);
  L.push('');
  // Printed every run: the thing this module must never be mistaken for.
  L.push('  Nothing was retired. Age weakens belief; it does not falsify — a flagged');
  L.push('  fact is still returned by recall(), carrying its freshness.');
  return L.join('\n');
}

module.exports = { detect, propose, sweep, format, SWEEP_ACTIONS };
