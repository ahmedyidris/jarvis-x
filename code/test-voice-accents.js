// ARABIC DIALECT ROUTING — and a table that contradicted the real router.
//
// SAME TWO DEFECTS AS test-voice-full-system.js, which see for the full
// write-up. This file ended in `testVoiceAccents().catch(console.error)`, so
// it exited 0 on any failure: with every assertion in it forced false it
// still exited 0. And test.yml excluded it as needing "local
// Piper/Kokoro/Ollama and real audio" when it imports nothing at all.
//
// THE PART SPECIFIC TO THIS FILE IS WORSE THAN A MISSING FUSE. It defined its
// own `selectVoiceByAccent()` lookup table, inside the test, and asserted
// against it:
//
//     'ar:egyptian:male': { engine: 'coqui', accent: 'egyptian', ... ultimate: true }
//
// then printed "✓ PASS". code/voice-router.js — the real router, verified in
// commits bbf3b43 and 4161b5a — lists `ar-eg` under UNSUPPORTED and throws
// for it, precisely so Egyptian Arabic "fails loudly" rather than being
// "silently misrouted to a different dialect". So a suite that could not fail
// was reporting a green Egyptian Arabic voice, against a table that shipped
// nowhere, while the product refused that exact request. Egyptian Arabic in
// Ahmed's own voice is the carried-over open item this was standing in for.
//
// Neither `detectArabicDialect` nor `selectVoiceByAccent` existed anywhere
// outside this file, so the routing half tested a private copy of a rule the
// product holds elsewhere and disagrees with. That half is gone: routing is
// code/voice-router.js's, and code/test-voice-router.js already covers it —
// including the case this file got backwards. What is asserted here now is
// the real router's answer, so the two can no longer drift apart silently.
//
// The dialect detector is kept, because detecting Egyptian from text is a
// real thing Ahmed will want and this is the only implementation of it in the
// repo. It is marked plainly for what it is: a prototype living in a test,
// with no product caller. Tested rather than deleted so it is still there
// when something needs it, and honest about being unwired so nobody counts it
// as shipped.
const { test, finish, assert } = require('./test-helper.js');
const voiceRouter = require('./voice-router.js');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

/**
 * PROTOTYPE, NOT PRODUCT. Nothing outside this file calls this, and a test
 * below fails if that stops being true without the function moving into
 * code/ where a prototype's limits get reviewed. Marker-counting is a crude
 * approach that would misread a sentence mixing registers; it is good enough
 * to tell a clearly-colloquial line from a clearly-formal one and nothing
 * more is claimed for it.
 */
function detectArabicDialect(text) {
  const egyptianMarkers = ['إزيك', 'يا صاحب', 'كويس', 'ماشي', 'تمام'];
  const fushaMarkers = ['السلام عليكم', 'ورحمة الله', 'بركاته', 'الحمد لله'];

  const egyptianCount = egyptianMarkers.filter(m => text.includes(m)).length;
  const fushaCount = fushaMarkers.filter(m => text.includes(m)).length;

  return fushaCount > egyptianCount ? 'fusha' : 'egyptian';
}

(async () => {

// ─── the dialect prototype ─────────────────────────────────────────────────

await test('colloquial Egyptian is detected as egyptian', () => {
  assert.strictEqual(detectArabicDialect('إزيك يا صاحب؟'), 'egyptian');
});

await test('formal MSA is detected as fusha', () => {
  assert.strictEqual(detectArabicDialect('السلام عليكم ورحمة الله وبركاته'), 'fusha');
});

await test('the detector DEFAULTS to egyptian on text with no markers at all', () => {
  // Not a bug report, a limit worth being explicit about: `fushaCount >
  // egyptianCount` is false at 0-0, so anything unmarked — including an empty
  // string or English — comes back "egyptian" with full confidence. It is a
  // two-way guess with no "don't know", which is the one thing this repo
  // keeps saying an unknown must have. Pinned so the gap is visible to
  // whoever promotes this out of a test file.
  assert.strictEqual(detectArabicDialect(''), 'egyptian');
  assert.strictEqual(detectArabicDialect('hello there'), 'egyptian');
});

await test('the detector is still a prototype with no product caller', () => {
  const fs = require('fs');
  const path = require('path');
  const importers = [];
  for (const f of fs.readdirSync(__dirname)) {
    if (!f.endsWith('.js') || f.startsWith('test-')) continue;
    if (/detectArabicDialect/.test(fs.readFileSync(path.join(__dirname, f), 'utf8'))) {
      importers.push(f);
    }
  }
  assert.deepStrictEqual(importers, [],
    `detectArabicDialect now has product callers (${importers.join(', ')}) — `
    + 'move it out of this test file, where its limits above can be reviewed');
});

// ─── routing: the REAL router's answers, not a private table's ─────────────

await test('Egyptian Arabic is REFUSED by the router, loudly and with a reason', () => {
  // The assertion this file previously had backwards. The refusal is the
  // feature: a silent fallback to Jordanian or Gulf would hand Ahmed a voice
  // that is not his dialect while reporting success.
  assert.throws(() => voiceRouter.resolveRoute('ar-eg'), /Egyptian Arabic has no CPU-viable local model/);
});

await test('the dialects that ARE supported route to a real engine and voice', () => {
  for (const [tag, voice] of [
    ['ar', 'ar_JO-kareem-medium'],
    ['ar-jo', 'ar_JO-kareem-medium'],
    ['ar-gulf', 'ar-AE-emirati-female'],
  ]) {
    const route = voiceRouter.resolveRoute(tag);
    assert.strictEqual(route.engine, 'piper', `${tag} routes to a non-piper engine`);
    assert.strictEqual(route.voice, voice, `${tag} routes to the wrong voice`);
  }
});

await test('an unknown dialect is refused rather than defaulted to a nearby one', () => {
  assert.throws(() => voiceRouter.resolveRoute('ar-maghrebi'), /No route for/);
});

await test('every Arabic route lands on piper, the only engine behind the router', () => {
  // The private table this file used to carry asserted `engine: 'coqui'` for
  // Egyptian and `engine: 'tortoise'` for Gulf and Levantine. Neither engine
  // ever existed behind the router: they were names in a manifest with no
  // implementation, which is why that whole stack was deleted on 2026-09-25
  // (Ahmed's call — see PLAN_5). What is left is one engine set, pinned here
  // so a new one has to be added deliberately.
  for (const tag of ['ar', 'ar-jo', 'ar-gulf', 'ar-ae']) {
    assert.strictEqual(voiceRouter.resolveRoute(tag).engine, 'piper',
      `${tag} no longer routes to piper — the engine set changed`);
  }
});

finish();
})();
