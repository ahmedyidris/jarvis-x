/**
 * BITEMPORAL MEMORY, LAYER 4 — what a new fact does to an old one.
 *
 * docs/incoming/MEMORY_TEMPLATE.txt §8 item 4: "extract + classify + policy --
 * turn a message into structured facts, and decide what a new fact does to an
 * old one (replace / age / coexist)."
 *
 * THIS FILE IS THE POLICY HALF ONLY, and the split is not arbitrary.
 * Extraction — turning "I moved to Bengaluru last week" into
 * {topic:'city', value:'Bengaluru', valid_from:...} — needs a model.
 * Deciding what that fact does to the one already stored does not: it is a
 * comparison against the store plus a confidence gate. Separating them means
 * the decision logic is exhaustively testable offline and the model only ever
 * feeds it, which is the same seam market-collect.js uses for its fetcher.
 * `extractWith()` below takes the extractor as an argument; there is no
 * default, because a default would quietly become the one nobody replaced.
 *
 * WHAT LAYER 3 STILL OWES. The template's layer 3 is "retrieval that returns a
 * fact's age/confidence alongside its content". `openStore().recall()` already
 * does exactly that — every row comes back with `freshness` and a `stale`
 * flag against the shared floor. The half that is missing is SEMANTIC
 * retrieval, which needs `nomic-embed-text` through ollama; CLAUDE.md records
 * that model as pulled but wired into nothing, and this container has no
 * ollama at all. Recall here is therefore exact-match on (topic, scope), which
 * is honest rather than complete: it will miss "where I live" against a fact
 * stored under topic 'city', and that is a real limit, not a rounding error.
 *
 * NOTHING HERE WRITES. Every function returns a DECISION. Layer 5 (the repair
 * writer, not built) is the only thing that should ever apply one — the
 * template's "one writer" rule, and the same shape as trade-advisor.js, which
 * proposes and refuses to execute.
 */
const { decide, VOLATILITY, THRESHOLDS } = require('./memory-bitemporal.js');

/**
 * What can happen to the store when a candidate fact arrives. One of these
 * exactly — a closed set, because an open one turns the layer-5 writer into a
 * switch statement with a default nobody thought about.
 *
 *   born      nothing comparable is stored; open a new interval
 *   reaffirm  the stored fact says the same thing; it is evidence, not news
 *   replace   the stored fact is contradicted; close it where this one opens
 *   coexist   both can be true at once (different scope)
 *   park      there is nothing coherent to propose at all
 *
 * `action` and `routing` are ORTHOGONAL, and an earlier draft conflated them:
 * a low-confidence contradiction returned `action: 'park'`, which threw away
 * WHAT was being proposed. That only broke once all seven layers ran together
 * -- layer 7 re-submits a parked proposal when a human approves it, and the
 * writer received `action: 'park'` and refused, so no human-approved change
 * could ever be applied. Every layer's own tests passed throughout, which is
 * the whole reason code/test-memory-integration.js exists.
 *
 * So `action` now always says what was proposed and `routing` says whether the
 * agent may do it alone. `park` survives as an action only where there is
 * genuinely nothing to propose -- no topic, an unknown volatility class, a
 * store already contradicting itself -- and those are exactly the ones a human
 * cannot approve into existence either.
 */
const ACTIONS = Object.freeze(['born', 'reaffirm', 'replace', 'coexist', 'park']);

/**
 * Facts comparable to a candidate: same topic AND same scope.
 *
 * Scope is what stops "works at Acme (weekdays)" from replacing "works at Beta
 * (weekends)". The template flags topic-vs-scope as where the ambiguity bugs
 * live, and this is the line where that matters: get it wrong and a policy
 * either replaces facts that should coexist, or accumulates duplicates that
 * should have replaced each other.
 */
function comparable(candidate, facts) {
  return facts.filter((f) => f.topic === candidate.topic && (f.scope || '') === (candidate.scope || ''));
}

/** Same claim, restated. Compared on `value` when both have one, else on text. */
function saysTheSame(a, b) {
  if (a.value !== null && a.value !== undefined && b.value !== null && b.value !== undefined) {
    return String(a.value).trim().toLowerCase() === String(b.value).trim().toLowerCase();
  }
  return String(a.text || '').trim().toLowerCase() === String(b.text || '').trim().toLowerCase();
}

/**
 * Decide what a candidate fact does to what is already stored.
 *
 * @param candidate {topic, scope, text, value, volatility, confidence, valid_from}
 * @param current   the store's currently-true facts (openStore().recall() or validAt())
 * @returns {{action: string, targetId: ?string, routing: 'auto'|'parked', why: string[]}}
 */
function decideFact(candidate, current = []) {
  const why = [];
  if (!candidate || !candidate.topic) {
    return { action: 'park', targetId: null, routing: 'parked',
             why: ['a candidate with no topic cannot be filed or compared'] };
  }
  const volatility = candidate.volatility || 'slow';
  if (!VOLATILITY[volatility]) {
    return { action: 'park', targetId: null, routing: 'parked',
             why: [`unknown volatility class "${volatility}"`] };
  }
  const confidence = typeof candidate.confidence === 'number' ? candidate.confidence : 0;

  const rivals = comparable(candidate, current);
  const others = current.filter((f) => f.topic === candidate.topic && !rivals.includes(f));

  // 1. Nothing comparable stored. Adding is the cheap direction, so it clears
  //    the LOWER of the two thresholds -- being wrong here leaves a duplicate,
  //    not a hole.
  if (rivals.length === 0) {
    const routing = decide({ action: 'add', confidence, volatility });
    why.push(others.length
      ? `nothing stored under topic "${candidate.topic}" at scope "${candidate.scope || ''}" ` +
        `(${others.length} fact(s) at other scopes are unaffected)`
      : `nothing stored under topic "${candidate.topic}"`);
    if (routing === 'parked') why.push(`confidence ${confidence} is below the add bar ${THRESHOLDS.add}`);
    return { action: 'born', targetId: null, routing, why };
  }

  // More than one comparable fact means the store already disagrees with
  // itself at this (topic, scope). Do not add a third opinion.
  if (rivals.length > 1) {
    return { action: 'park', targetId: null, routing: 'parked',
             why: [`${rivals.length} facts are already active at topic "${candidate.topic}" ` +
                   `scope "${candidate.scope || ''}"; the store contradicts itself and a ` +
                   'policy decision would compound it'] };
  }

  const rival = rivals[0];

  // 2. It says the same thing. This is EVIDENCE, not news -- the single most
  //    valuable event in the whole design, because last_verified_at is what
  //    freshness decays from. A fact reconfirmed today is fresh however old it
  //    is. Ungated: restating what is already stored destroys nothing.
  if (saysTheSame(candidate, rival)) {
    return { action: 'reaffirm', targetId: rival.id, routing: 'auto',
             why: [`restates the stored fact, so it is fresh evidence rather than a change`] };
  }

  // 3. A contradiction. Replacing RETIRES information, so it must clear the
  //    HIGHER bar -- and a contradiction on a stable fact parks at ANY
  //    confidence, because on a name or birthday that is more often an
  //    extraction error than a real change, and high model confidence is
  //    exactly what such an error looks like from the inside.
  const routing = decide({ action: 'retire', confidence, volatility, contradicts: true });
  why.push(`contradicts the stored "${rival.text ?? rival.value}" at the same topic and scope`);
  if (routing === 'parked') {
    why.push(volatility === 'stable'
      ? 'a contradiction on a stable fact always parks — more often an extraction error than a real change'
      : `confidence ${confidence} is below the retire bar ${THRESHOLDS.retire}`);
  }
  return { action: 'replace', targetId: rival.id, routing, why };
}

/**
 * A candidate at a DIFFERENT scope under the same topic coexists rather than
 * replacing. Exposed separately because it is the judgement most likely to be
 * wrong in a way nobody notices: it is the difference between a store that
 * remembers you work two jobs and one that thinks you keep changing jobs.
 */
function wouldCoexist(candidate, current = []) {
  const sameTopic = current.filter((f) => f.topic === candidate.topic);
  return sameTopic.length > 0 && comparable(candidate, current).length === 0;
}

/**
 * Run an injected extractor over a message and decide on each fact it yields.
 *
 * The extractor is a REQUIRED argument with no default. A default would become
 * the implementation nobody replaced, and an extractor is exactly the piece
 * that has to be a real model to be worth anything.
 *
 * @param extract (message) => candidate[]   may be async
 */
async function extractWith(extract, message, current = []) {
  if (typeof extract !== 'function') {
    throw new Error('extractWith needs an extractor function; there is deliberately no default');
  }
  const candidates = (await extract(message)) || [];
  if (!Array.isArray(candidates)) {
    throw new Error(`extractor must return an array of candidates, got ${typeof candidates}`);
  }
  // Decided against the SAME snapshot of the store, not against each other.
  // Applying decision N before deciding N+1 is layer 5's job; doing it here
  // would make this function a writer, which it must not be.
  return candidates.map((c) => ({ candidate: c, decision: decideFact(c, current) }));
}

function format(results) {
  const L = ['', 'MEMORY POLICY — proposals, none applied', ''];
  if (!results.length) L.push('  (no candidates)');
  for (const { candidate, decision } of results) {
    L.push(`  ${decision.action.toUpperCase().padEnd(9)} ${decision.routing.padEnd(7)} ` +
           `${candidate.topic}/${candidate.scope || '-'}: ${candidate.text ?? candidate.value}`);
    for (const w of decision.why) L.push(`      ${w}`);
  }
  L.push('');
  L.push('  Nothing here has been written. Layer 5 (the repair writer) is the only');
  L.push('  thing that may apply a decision, and it is not built.');
  return L.join('\n');
}

module.exports = { decideFact, extractWith, comparable, saysTheSame, wouldCoexist, format, ACTIONS };
