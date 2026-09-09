/**
 * BITEMPORAL MEMORY — layers 1 and 2 of the template's build order.
 *
 * PLAN_5 §7 Tier 3 item 10 / §3 item 4. The design is
 * docs/incoming/MEMORY_TEMPLATE.txt (the verbatim extraction of
 * SelfRepairing_Memory_Architecture_Template.pdf); its §8 gives a bottom-up
 * build order and says each layer should be usable on its own before the next
 * one starts. This file is layers 1 (clock) and 2 (store + bitemporal
 * read/write helpers), and nothing above them:
 *
 *   1. clock abstraction          <- here
 *   2. store + read/write helpers <- here
 *   3. embed + recall             not built
 *   4. extract + classify + policy  not built
 *   5. repair (the one writer)      not built
 *   6. detect + propose + sweep     not built
 *   7. human inbox                  not built
 *
 * It is deliberately NOT wired into anything yet. `code/memory.js` (the flat
 * observed.jsonl log) keeps its one consumer, `code/scheduler.js`, untouched;
 * swapping that over needs layers 4-5, which decide what a new fact does to an
 * old one. Building the store first and leaving it unwired is the template's
 * instruction, not an omission -- see the note at the end of this comment.
 *
 * THE PROBLEM IT SOLVES (template §1), because it is not the obvious one. A
 * memory that was never true is easy to catch: it contradicts something and
 * retrieval scores it badly. A memory that WAS true is the dangerous case --
 * it embedded perfectly, retrieves with the highest score, and gets stated
 * with total confidence, because until recently nothing about it was wrong.
 * Facts go stale two ways: somebody says something new (easy, event-driven),
 * or nobody says anything at all and the fact outlives its shelf life. Every
 * purely event-driven design is blind to the second, because there is no event
 * to fire on. That is the same asymmetry code/weekly-sweep.js exists for, one
 * domain over.
 *
 * THE MODEL (template §2): a memory is not a row, it is an interval with a
 * belief attached. Two independent time axes:
 *   valid time       -- when the claim was true in the world
 *   transaction time -- when this system believed it
 * They come apart constantly: you learn on the 10th that someone moved on the
 * 3rd. Keeping both is what lets the store answer "what is true now?" and
 * "what did I believe in April?" separately.
 *
 * NOTHING IS EVER DELETED OR EDITED. That is the one decision everything else
 * protects: deletion destroys the ability to answer "what did I believe in
 * March". The file is an append-only log of row VERSIONS, exactly like
 * logs/actions.jsonl, and every change appends rather than mutates.
 *
 * ONE DELIBERATE DEVIATION FROM THE TEMPLATE'S SCHEMA, and the reason for it.
 * Template §5 lists `expired_at` as a stored column -- the transaction-time
 * close. In an append-only file it cannot be stored, because closing version N
 * would mean going back and editing a row already written, which is the one
 * thing this store must never do. So `expired_at` is DERIVED on read: version
 * N's transaction time ends exactly where version N+1's begins, and the latest
 * version reads OPEN. Same information, same queries, no mutation. The stored
 * column would have been a value we then had to edit, which is strictly worse
 * than deriving it. `valid_from`/`valid_to` ARE stored, because those are
 * claims about the world asserted at write time, not facts about the log.
 *
 * WHY IT IS NOT SQLITE. The template is stack-agnostic and says to adapt. This
 * repo's every durable record is JSONL (logs/actions.jsonl,
 * memory/observed.jsonl), read with a full scan; a personal assistant's fact
 * store is thousands of rows, not millions. A second storage engine would be a
 * second thing to back up, corrupt, and reason about, for no gain at this size.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const DEFAULT_FILE = path.join(REPO, 'memory', 'facts.jsonl');

/**
 * "Still open", as a deliberate far-future timestamp rather than null
 * (template §5). Null forces every query into IS NULL handling, and the
 * template's own warning is that the two predicates drift apart -- one query
 * checks `valid_to IS NULL`, another checks `valid_to > now`, and a row is
 * visible to one and not the other. A sentinel makes every comparison a plain
 * `<`, so there is only one predicate shape in the whole file.
 */
const OPEN = '9999-12-31T23:59:59.999Z';

/**
 * Volatility classes and shelf lives (template §4). The numbers are this
 * project's to pick; the categories are what transfers.
 *
 * `stable` decays over a decade rather than never: the template is explicit
 * that stable facts stay visible to the sweep so they are not a *silent*
 * exemption. A class that literally never ages would drop out of the sweep's
 * view entirely, which is the failure the wording is guarding against.
 */
const VOLATILITY = Object.freeze({
  stable: { halfLifeDays: 3650 },   // name, birthday, ID — years
  slow: { halfLifeDays: 365 },      // employer, city — a multi-year horizon
  fast: { halfLifeDays: 30 },       // "my current project" — weeks
  scheduled: { halfLifeDays: null },// an appointment: does not decay, it ends
});

/**
 * Two thresholds, not one (template §4). The asymmetry IS the point: being
 * wrong when you retire a fact loses information; being wrong when you add one
 * just leaves a duplicate. Destroying information must require more confidence
 * than adding it.
 */
const THRESHOLDS = Object.freeze({
  retire: 0.80,
  add: 0.60,
  /**
   * One number for "stale", used by BOTH the read path and the sweep. The
   * template calls this out specifically: two different thresholds for the
   * same word will contradict each other in front of a user -- retrieval says
   * "may be out of date" while the sweep considers it fine, or the reverse.
   */
  freshnessFloor: 0.5,
});

const STATUS = Object.freeze({
  ACTIVE: 'active',
  NEEDS_VERIFICATION: 'needs_verification',
  SUPERSEDED: 'superseded',
  EXPIRED: 'expired',
});

// --- layer 1: the clock ----------------------------------------------------

/**
 * Injected everywhere, never called from business logic (template §8 item 1,
 * and .github/workflows/test.yml's own house rule). This is what lets a test
 * prove "six months of decay" in one run instead of waiting six months.
 */
function makeClock(startISO = new Date().toISOString()) {
  let t = Date.parse(startISO);
  if (Number.isNaN(t)) throw new Error(`makeClock: unparseable time ${startISO}`);
  return {
    now: () => new Date(t),
    iso: () => new Date(t).toISOString(),
    /** Move time forward. Days are the unit every shelf life is expressed in. */
    advanceDays(d) { t += d * 86400000; return this; },
    advanceMs(ms) { t += ms; return this; },
  };
}

const systemClock = () => ({
  now: () => new Date(),
  iso: () => new Date().toISOString(),
});

// --- layer 2: the store ----------------------------------------------------

const DAY_MS = 86400000;

function days(fromISO, toISO) {
  return (Date.parse(toISO) - Date.parse(fromISO)) / DAY_MS;
}

/**
 * Exponential decay from the last time there was EVIDENCE the fact still
 * holds -- last_verified_at, not recorded_at. The template is emphatic about
 * the distinction and it is the single most useful field in the schema: a fact
 * learned two years ago and reconfirmed last week is fresh, while one learned
 * last week and never mentioned since is already rotting. Measuring age from
 * recorded_at gets both backwards.
 *
 * @returns {number} 1 at the moment of verification, 0.5 after one half-life.
 */
function freshness(row, nowISO) {
  const half = VOLATILITY[row.volatility]?.halfLifeDays;
  if (half === null || half === undefined) return 1;   // scheduled: ends, never ages
  const age = days(row.last_verified_at, nowISO);
  if (age <= 0) return 1;
  return 2 ** (-age / half);
}

/**
 * The confidence gate (template §4 and §7). Returns 'auto' or 'parked'.
 *
 * Never a boolean: the caller must not be able to treat "parked" as a soft no
 * and proceed anyway, and a named routing value is what the audit row records.
 */
function decide({ action, confidence, volatility, contradicts = false }) {
  // Any contradiction on a stable fact parks, at ANY confidence. The template's
  // reasoning, which is worth keeping verbatim in spirit: a contradiction on a
  // name, birthday or ID is more often an extraction error than a real change.
  // High model confidence is exactly what an extraction error looks like.
  if (contradicts && volatility === 'stable') return 'parked';
  const bar = action === 'retire' ? THRESHOLDS.retire : THRESHOLDS.add;
  return confidence >= bar ? 'auto' : 'parked';
}

function hashSource(text) {
  return crypto.createHash('sha256').update(text ?? '', 'utf8').digest('hex').slice(0, 16);
}

function readVersions(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/**
 * The store. Every method that changes anything APPENDS a version; none edits
 * or removes. `file` and `clock` are both injected, so the whole layer is
 * testable offline against a temp path and a frozen clock.
 */
function openStore({ file = DEFAULT_FILE, clock = systemClock() } = {}) {
  const append = (row) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
    return row;
  };

  /** Every version ever written, in write order. */
  const all = () => readVersions(file);

  /**
   * Latest version per id, with transaction time derived. Version N's
   * expired_at is version N+1's recorded_at; the newest reads OPEN.
   */
  function current() {
    const latest = new Map();
    for (const r of all()) latest.set(r.id, r);      // write order == version order
    return [...latest.values()].map((r) => ({ ...r, expired_at: OPEN }));
  }

  /** Every version of one fact, oldest first, each with its derived close. */
  function history(id) {
    const vs = all().filter((r) => r.id === id);
    return vs.map((r, i) => ({
      ...r,
      expired_at: i + 1 < vs.length ? vs[i + 1].recorded_at : OPEN,
    }));
  }

  /**
   * "What did I believe at time T?" — the transaction-time axis. For each id,
   * the version whose [recorded_at, expired_at) window contains T.
   */
  function asOf(tISO) {
    const out = [];
    for (const id of new Set(all().map((r) => r.id))) {
      const v = history(id).find((r) => r.recorded_at <= tISO && tISO < r.expired_at);
      if (v) out.push(v);
    }
    return out;
  }

  /**
   * "What was true in the world at time T?" — the valid-time axis, as believed
   * at `asOfISO` (default: now). Both axes, which is the whole point of
   * keeping them separate.
   */
  function validAt(tISO, { asOf: asOfISO = clock.iso() } = {}) {
    // THE INTERVAL IS THE ONLY CRITERION, and status deliberately plays no
    // part. An earlier draft also excluded `superseded` and `expired`, which
    // is wrong twice over and its own test caught it: a superseded fact was
    // still TRUE during its valid interval -- "I live in Pune" on June 2nd is
    // not retroactively false because they moved on the 3rd. Asking the store
    // what was true on the 2nd returned nothing at all.
    //
    // Status is a lifecycle label. Whether a fact is currently true is already
    // encoded in valid_to, which replace() and end() close; filtering on
    // status as well is redundant for "now" and actively destroys the past.
    return asOf(asOfISO).filter((r) => r.valid_from <= tISO && tISO < r.valid_to);
  }

  /** Currently-true facts, each carrying its freshness so the caller can flag it. */
  function recall({ topic = null, now = clock.iso() } = {}) {
    return validAt(now)
      .filter((r) => topic === null || r.topic === topic)
      .map((r) => ({ ...r, freshness: freshness(r, now), stale: freshness(r, now) < THRESHOLDS.freshnessFloor }))
      .sort((a, b) => b.freshness - a.freshness);
  }

  /**
   * Facts that have quietly gone bad — the sweep's input (template §6). Pure
   * lookups over our own metadata: no model calls, which is what makes running
   * it continuously affordable.
   */
  function stale({ now = clock.iso() } = {}) {
    return validAt(now).filter((r) => freshness(r, now) < THRESHOLDS.freshnessFloor);
  }

  const nextVersion = (id) => all().filter((r) => r.id === id).length + 1;

  /** BORN: opens an interval, no end. */
  function born({
    topic, scope = '', text, value = null, volatility = 'slow',
    confidence = 1, user_id = 'ahmed', valid_from = null,
    source_kind = 'stated', source_ref = null, source_text = '',
  }) {
    if (!VOLATILITY[volatility]) throw new Error(`unknown volatility class "${volatility}"`);
    if (!topic) throw new Error('a fact needs a topic');
    const now = clock.iso();
    return append({
      id: crypto.randomUUID(), version: 1,
      user_id, topic, scope,
      text, value, volatility, confidence,
      valid_from: valid_from || now, valid_to: OPEN,
      recorded_at: now,
      last_verified_at: now,
      superseded_by: null, status: STATUS.ACTIVE,
      source_kind, source_ref, source_hash: hashSource(source_text),
    });
  }

  const latestOf = (id) => {
    const vs = all().filter((r) => r.id === id);
    if (!vs.length) throw new Error(`no such fact: ${id}`);
    return vs[vs.length - 1];
  };

  /** AGES, reset: new evidence the fact still holds. Freshness returns to 1. */
  function reaffirm(id, { source_text = '' } = {}) {
    const prev = latestOf(id);
    const now = clock.iso();
    return append({
      ...prev, version: nextVersion(id), recorded_at: now,
      last_verified_at: now, status: STATUS.ACTIVE,
      source_hash: source_text ? hashSource(source_text) : prev.source_hash,
    });
  }

  /** Flag without retiring — what the sweep does to something below the floor. */
  function flagForVerification(id) {
    const prev = latestOf(id);
    return append({
      ...prev, version: nextVersion(id), recorded_at: clock.iso(),
      status: STATUS.NEEDS_VERIFICATION,
    });
  }

  /**
   * REPLACED: the old interval closes EXACTLY where its successor opens. Not
   * "at now" -- if you learn on the 10th that someone moved on the 3rd, the old
   * fact stopped being true on the 3rd, and closing it at the 10th would leave
   * a week in which the store reports both as true.
   */
  function replace(id, newFact) {
    const prev = latestOf(id);
    const now = clock.iso();
    const successor = born({ ...newFact, valid_from: newFact.valid_from || now });
    append({
      ...prev, version: nextVersion(id), recorded_at: now,
      valid_to: successor.valid_from,
      superseded_by: successor.id, status: STATUS.SUPERSEDED,
    });
    return successor;
  }

  /** ENDS: closes with nothing succeeding it. The appointment happened. */
  function end(id, { at = null } = {}) {
    const prev = latestOf(id);
    const now = clock.iso();
    return append({
      ...prev, version: nextVersion(id), recorded_at: now,
      valid_to: at || now, status: STATUS.EXPIRED,
    });
  }

  return {
    file, clock,
    born, reaffirm, replace, end, flagForVerification,
    current, history, asOf, validAt, recall, stale, all,
  };
}

module.exports = {
  openStore, makeClock, systemClock, freshness, decide, hashSource,
  OPEN, VOLATILITY, THRESHOLDS, STATUS, DEFAULT_FILE, days,
};
