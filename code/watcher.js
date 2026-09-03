#!/usr/bin/env node
// Watches URLs and reports what changed -- the job changedetection.io does,
// implemented against this repo's own conventions instead of running a second
// web app beside Jarvis. See CAPABILITIES.md for why native rather than bolted
// on, and for the upgrade path if the full UI is ever wanted.
//
// Two rules this module holds itself to:
//   1. It checks isStopped() itself. Callers are not trusted to do it -- the
//      same reasoning shell.js documents for its own kill-switch check.
//   2. No new dependencies. Fetch is injectable, so the test suite never
//      touches the network.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isStopped, logAction } = require('./guard.js');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'watchers.json');
const STATE = path.join(ROOT, 'logs', 'watch-state.json');
const EVENTS = path.join(ROOT, 'logs', 'watch-events.jsonl');

const MAX_BODY = 2_000_000;   // a watched page that big is a misconfiguration
const SAMPLE_LINES = 3;       // changed lines quoted in an event

// Strip markup down to the text a human would actually read. Script and style
// bodies go first: a page whose analytics blob changes every load would
// otherwise report a change on every single check.
function extractText(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .split('\n')
    .map(line => line.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// An `include` pattern narrows the watch to the part of the page that matters,
// so a news sidebar rotating does not read as a price change.
function narrow(text, include) {
  if (!include) return text;
  const re = new RegExp(include, 'gim');
  const hits = text.match(re);
  return hits ? hits.join('\n') : '';
}

function fingerprint(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function diffLines(before, after) {
  const oldLines = new Set(String(before || '').split('\n'));
  const newLines = new Set(String(after || '').split('\n'));
  const added = [...newLines].filter(l => !oldLines.has(l));
  const removed = [...oldLines].filter(l => !newLines.has(l));
  return {
    added: added.length,
    removed: removed.length,
    sample_added: added.slice(0, SAMPLE_LINES),
    sample_removed: removed.slice(0, SAMPLE_LINES),
  };
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function loadWatchers(file = CONFIG) {
  const raw = readJSON(file, null);
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : raw.watchers;
  if (!Array.isArray(list)) return [];
  return list.filter(w => w && typeof w.url === 'string' && w.enabled !== false);
}

async function defaultFetcher(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'jarvis-x-watcher/1.0' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  return body.slice(0, MAX_BODY);
}

/**
 * Check every configured watcher once.
 *
 * @param fetcher  async (url) => html. Injected so tests stay offline.
 * @param state    prior fingerprints; omit to read logs/watch-state.json.
 * @returns {{results: Array, state: Object}}
 */
async function checkAll({ watchers, fetcher = defaultFetcher, state, now = () => new Date().toISOString() } = {}) {
  if (isStopped()) {
    logAction('refused-watch', 'watcher.checkAll', { allowed: false, outcome: 'killswitch' });
    throw new Error('Kill switch active - action blocked');
  }

  const list = watchers || loadWatchers();
  const prior = state || readJSON(STATE, {});
  const nextState = { ...prior };
  const results = [];

  for (const w of list) {
    const id = w.id || w.url;
    const entry = { id, url: w.url, checked_at: now() };
    try {
      const html = await fetcher(w.url);
      const text = narrow(extractText(html), w.include);
      const hash = fingerprint(text);
      const seen = prior[id];

      if (!seen) {
        entry.status = 'baseline';
      } else if (seen.hash === hash) {
        entry.status = 'unchanged';
      } else {
        entry.status = 'changed';
        entry.diff = diffLines(seen.text, text);
      }
      nextState[id] = { hash, text, checked_at: entry.checked_at };
    } catch (err) {
      // A fetch failure is not a change. Reporting it as one would cry wolf
      // every time a site rate-limits, so the prior fingerprint is kept.
      entry.status = 'error';
      entry.error = err.message;
    }
    results.push(entry);
    logAction('watch-check', `${id} ${entry.status}`,
      { allowed: true, outcome: entry.status });
  }

  return { results, state: nextState };
}

function persist({ state, results }, { stateFile = STATE, eventsFile = EVENTS } = {}) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  const changed = (results || []).filter(r => r.status === 'changed');
  if (changed.length) {
    fs.appendFileSync(eventsFile,
      changed.map(c => JSON.stringify(c)).join('\n') + '\n');
  }
  return changed.length;
}

// A digest is what actually gets read -- a list of every check is noise, so
// unchanged watchers are counted, not listed.
function digest(results) {
  const changed = results.filter(r => r.status === 'changed');
  const errors = results.filter(r => r.status === 'error');
  const baseline = results.filter(r => r.status === 'baseline');
  const lines = [];
  lines.push(`${changed.length} changed, ${results.length - changed.length - errors.length - baseline.length} unchanged, ` +
             `${baseline.length} new, ${errors.length} failed`);
  for (const c of changed) {
    lines.push(`\nCHANGED  ${c.id}`);
    lines.push(`  +${c.diff.added} / -${c.diff.removed} lines`);
    for (const s of c.diff.sample_added) lines.push(`  + ${s.slice(0, 100)}`);
    for (const s of c.diff.sample_removed) lines.push(`  - ${s.slice(0, 100)}`);
  }
  for (const e of errors) lines.push(`\nFAILED   ${e.id}: ${e.error}`);
  return lines.join('\n');
}

module.exports = {
  extractText, narrow, fingerprint, diffLines,
  loadWatchers, checkAll, persist, digest,
  CONFIG, STATE, EVENTS,
};

if (require.main === module) {
  checkAll()
    .then(out => {
      const n = persist(out);
      console.log(digest(out.results));
      process.exit(n > 0 ? 0 : 0);
    })
    .catch(err => { console.error('Error:', err.message); process.exit(1); });
}
