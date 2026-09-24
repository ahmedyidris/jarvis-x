// THE VOICE STACK NOTHING USES, and the suite that could not say so.
//
// WHAT WAS WRONG WITH THIS FILE, before anything it asserts. It ended in
// `testFullVoiceSystem().catch(console.error)`, so a rejected promise printed
// a message and the process exited 0. Demonstrated rather than assumed: with
// one assertion changed to something false, the old file still exited 0 while
// printing "=== ALL VOICE SYSTEM TESTS PASSED ===".
//
// That is the third occurrence of this exact defect in this repo.
// test-data-layer.js had it (recorded in .github/workflows/test.yml), then
// test-accessibility.js and test-full-accessibility.js had it and were fixed
// in the same pass that wrote the comment describing the fix — a comment
// sitting two lines above `test-voice-full-system` in the excluded list.
//
// AND THE STATED REASON FOR EXCLUDING IT WAS FALSE. test.yml grouped it with
// the suites that "need local Piper/Kokoro/Ollama and real audio". It needs
// none of them: it never calls fetch() on a provider, only listVoices() on
// hardcoded arrays and a JSON manifest. It runs offline, which is why it is
// in CI now.
//
// WHAT THE SUITE FOUND ONCE IT COULD FAIL. code/voice-layer-manager.js, the
// three providers under code/providers/ and this file form a SECOND voice
// stack that no product code imports — the real synthesis path is
// code/voice-router.js -> code/voice.js / code/kokoro.js, and app.py ->
// code/tts_worker.py. The two stacks disagree, and they disagree about the
// one voice Ahmed is actually waiting on. That disagreement is pinned below
// rather than quietly corrected, because which stack survives is his call,
// not this suite's.
const fs = require('fs');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const VoiceLayerManager = require('./voice-layer-manager');
const PiperProvider = require('./providers/piper-provider');
const CoquiProvider = require('./providers/coqui-provider');
const TortoiseProvider = require('./providers/tortoise-provider');
const voiceRouter = require('./voice-router.js');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

(async () => {

// ─── the manifest and the manager, which are real and offline ──────────────

await test('the manifest lists English accents', () => {
  const m = new VoiceLayerManager();
  const en = m.listAccents('en');
  for (const a of ['us', 'uk', 'au']) assert.ok(en.includes(a), `missing ${a}`);
});

await test('the manifest lists Arabic accents', () => {
  const m = new VoiceLayerManager();
  const ar = m.listAccents('ar');
  for (const a of ['fusha', 'egyptian', 'gulf', 'levantine']) {
    assert.ok(ar.includes(a), `missing ${a}`);
  }
});

await test('selectVoice returns an engine and gender for a known voice', () => {
  const m = new VoiceLayerManager();
  const v = m.selectVoice('en', 'us', 'male');
  assert.strictEqual(v.engine, 'piper');
  assert.strictEqual(v.gender, 'male');
});

await test('an unknown language reads as no accents, not as an empty success', () => {
  const m = new VoiceLayerManager();
  assert.deepStrictEqual(m.listAccents('fr'), []);
  assert.strictEqual(m.getVoicesByLanguage('fr'), null);
});

// ─── the vacuity trap this suite walked into ───────────────────────────────

await test('selectVoice MISSING returns a truthy object — so `assert(v)` proves nothing', () => {
  // The old Test 5 was `assert(clonedVoice)`, which passes for every input
  // this function can be given: the not-found path returns `{ error: ... }`,
  // an object, and every object is truthy. An assertion that cannot fail is
  // worse than no assertion, because it occupies the slot where a real one
  // would go.
  //
  // Pinned as the shape it actually has rather than changed, because
  // code/voice-layer-manager.js has no product caller (see the last test in
  // this file) and rewriting an unused API's contract is not this suite's
  // call. What the pin buys: a caller must check `.error`, and this test
  // fails the day the shape changes, so whoever changes it sees this note.
  const m = new VoiceLayerManager();
  const missing = m.selectVoice('ar', 'martian', 'male');
  assert.ok(missing, 'the trap itself: the miss is truthy');
  assert.ok(missing.error, 'a miss must be identifiable by .error');
  assert.strictEqual(missing.engine, undefined, 'a miss must not carry an engine');
});

await test('registerClonedVoice does NOT affect selectVoice, despite the comment saying it should', () => {
  // The old Test 5's comment read "// Should find cloned version". It does
  // not: registerClonedVoice() writes to this.clonedVoices, and selectVoice()
  // reads only the manifest — it never consults that Map. So registering
  // Ahmed's cloned voice changes nothing about what gets selected.
  //
  // Recorded rather than fixed, for the same reason as above: nothing in the
  // product calls either method. This is the finding, not the repair.
  const m = new VoiceLayerManager();
  const before = m.selectVoice('ar', 'egyptian', 'male');
  m.registerClonedVoice('my-voice-egyptian', {
    lang: 'ar', accent: 'egyptian', gender: 'male',
    modelPath: './voices/my-voice/model.pt',
  });
  const after = m.selectVoice('ar', 'egyptian', 'male');
  assert.deepStrictEqual(after, before, 'selectVoice now honours clones — update this test deliberately');
  assert.strictEqual(m.getStats().clonedVoices, 1, 'the Map did record it; only selection ignores it');
});

// ─── THE CONTRADICTION, pinned because resolving it is Ahmed's call ────────

await test('the manifest advertises Egyptian Arabic that voice-router.js refuses to route', () => {
  // code/voice-router.js is the real router, with its verification history in
  // commits bbf3b43 and 4161b5a. It lists `ar-eg` under UNSUPPORTED and
  // THROWS for it — "Egyptian Arabic has no CPU-viable local model yet",
  // Habibi-TTS and NAMAA both ruled out — and its own comment says the point
  // is that ar-eg must fail loudly rather than be "silently misrouted to a
  // different dialect".
  //
  // This manifest advertises ar-eg-male-coqui at quality "high", and
  // ar-eg-male-cloned at quality "ultimate" with `yourVoice: true`. Neither
  // exists. Ahmed's cloned Egyptian voice is a carried-over open item in
  // MASTER_PLAN_v5, waiting on a ~5GB checkpoint (code/tts_worker.py's
  // `voices/chatterbox-eg`) he has not sourced.
  //
  // This test FAILS when either side changes, which is the point: if Egyptian
  // support becomes real, the router stops throwing and this pin forces
  // somebody to reconcile the two stacks deliberately instead of leaving one
  // of them lying.
  let routerRefused = false;
  try { voiceRouter.resolveRoute('ar-eg'); } catch { routerRefused = true; }
  assert.ok(routerRefused, 'voice-router now routes ar-eg — reconcile the manifest and delete this pin');

  const m = new VoiceLayerManager();
  const advertised = m.selectVoice('ar', 'egyptian', 'male');
  assert.ok(!advertised.error, 'the manifest no longer advertises Egyptian — update this pin');
  assert.strictEqual(advertised.engine, 'coqui');
});

await test('no engine the manifest names is an engine voice-router can dispatch', () => {
  // The two stacks do not even share an engine vocabulary: the manifest's are
  // piper/coqui/tortoise, the router dispatches piper/kokoro. `coqui` and
  // `tortoise` have no implementation behind them anywhere in this repo.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'voice-manifest.json'), 'utf8'));
  const engines = Object.keys(manifest.engines);
  assert.ok(engines.includes('coqui') && engines.includes('tortoise'),
    'manifest engines changed — recheck this pin');
  for (const engine of ['coqui', 'tortoise']) {
    let routed = false;
    for (const tag of ['ar', 'ar-jo', 'ar-gulf', 'ar-ae', 'en', 'en-us', 'en-gb']) {
      try { if (voiceRouter.resolveRoute(tag).engine === engine) routed = true; } catch { /* unsupported */ }
    }
    assert.ok(!routed, `voice-router now dispatches ${engine} — the two stacks have converged, update this`);
  }
});

// ─── the providers: catalogues that no longer claim to have spoken ─────────

await test('Piper provider lists English voices', async () => {
  const voices = await new PiperProvider().listVoices();
  assert.ok(voices.length > 5, `only ${voices.length} voices`);
});

await test('Coqui provider lists Arabic voices', async () => {
  const voices = await new CoquiProvider().listVoices('ar');
  assert.ok(voices.length > 4, `only ${voices.length} voices`);
});

await test('a provider fetch is TAGGED as mock and carries no audio', async () => {
  // Every honest provider in code/providers/ tags a fabricated return with
  // `source: 'mock'` (news, crypto, energy, market-brief). The three voice
  // providers did not: they logged "[Piper] Speaking: en-us-amy" and returned
  // `{ status: 'ready' }` for a voice nothing had synthesized. A caller
  // reading `.status` had no way to tell that apart from real speech.
  for (const [name, p, voice] of [
    ['piper', new PiperProvider(), 'en-us-amy'],
    ['coqui', new CoquiProvider(), 'ar-fusha-male'],
  ]) {
    const r = await p.fetch(voice);
    assert.strictEqual(r.source, 'mock', `${name} does not tag its mock return`);
    assert.strictEqual(r.audio, null, `${name} claims to have produced audio`);
  }
});

await test('an unknown voice is refused rather than fabricated', async () => {
  await assert.rejects(() => new PiperProvider().fetch('en-us-nobody'), /Unknown Piper voice/);
  await assert.rejects(() => new CoquiProvider().fetch('ar-nobody'), /Unknown Coqui voice/);
});

await test('Tortoise registers a clone and reports whether its model actually exists', async () => {
  const t = new TortoiseProvider();
  const r = await t.registerClonedVoice('my-voice-eg', {
    lang: 'ar', accent: 'egyptian', gender: 'male',
    modelPath: './voices/my-voice/model.pt',   // does not exist on this machine
  });
  assert.strictEqual(r.modelPresent, false);
  assert.ok((await t.listClonedVoices()).includes('my-voice-eg'));
});

await test('Tortoise REFUSES to report speech from a clone whose model is missing', async () => {
  // The old suite registered exactly this voice, at exactly this nonexistent
  // path, and printed "✓ PASS" for it. fetch() then returned `cloned: true`
  // and logged "Speaking with cloned voice". Cloning Ahmed's own Egyptian
  // voice is the open item all of this is standing in for, so "registered"
  // reporting as "cloned and spoken" was the worst available answer.
  const t = new TortoiseProvider();
  await t.registerClonedVoice('ghost', {
    lang: 'ar', accent: 'egyptian', gender: 'male', modelPath: '/nonexistent/model.pt',
  });
  await assert.rejects(() => t.fetch('ghost'), /model is not at/);
});

await test('Tortoise serves a clone whose model file IS present', async () => {
  // The other half, so the refusal above is a real check rather than a
  // blanket refusal that would pass this suite either way.
  const t = new TortoiseProvider();
  const real = path.join(__dirname, 'voice-manifest.json');   // any file that exists
  await t.registerClonedVoice('present', {
    lang: 'ar', accent: 'egyptian', gender: 'male', modelPath: real,
  });
  const r = await t.fetch('present');
  assert.strictEqual(r.cloned, true);
  assert.strictEqual(r.source, 'mock', 'still a mock — presence of a file is not synthesis');
});

// ─── the fact that makes all of the above safe to leave as-is ──────────────

await test('nothing outside test files imports this voice stack', () => {
  // The reason the findings above are pinned rather than repaired. If this
  // ever fails, the stack has a real caller and its contradictions stop being
  // dormant — at which point they are bugs, not notes.
  const dir = __dirname;
  const importers = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js') || f.startsWith('test-')) continue;
    if (f === 'voice-layer-manager.js') continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/require\(['"]\.\/voice-layer-manager/.test(src)) importers.push(f);
  }
  assert.deepStrictEqual(importers, [],
    `voice-layer-manager now has product callers (${importers.join(', ')}) — `
    + 'the manifest/router contradiction pinned above is now live');
});

finish();
})();
