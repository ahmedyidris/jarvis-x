// CONTENT PHASE 1's DRAFTING STEPS — research → outline → script.
//
// Two rules carry this suite, and both are about a draft that LOOKS fine.
//
// 1. IT REFUSES WITHOUT A VOICE PROFILE. §6.2 rules "Your words, Jarvis
//    assists". A draft in a voice Jarvis invented would invert that ruling
//    while appearing to satisfy it — generic LLM prose reads as competent, so
//    the gate downstream would be reviewing "is this passable" instead of "is
//    this mine". There is no fallback register and no default profile.
//
// 2. FIDELITY IS CHECKED AGAINST THE SOURCES, NEVER THE OUTLINE. Checking the
//    script against the outline would let an invented number LAUNDER: outline
//    fabricates 40%, script faithfully restates the outline, check passes. A
//    test below drives exactly that path, because it is the one an otherwise
//    correct implementation gets wrong.
//
// Offline: `ask` and `research` are injected with no defaults, so nothing here
// opens a socket or calls a model. Every `ask` below is a lookup table.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const D = require('./content-draft.js');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-draft-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

let seq = 0;
/** A voice profile file with real content — i.e. one Ahmed has written. */
function filledVoice(text = 'Short sentences. No hooks. I never open with a question.') {
  const p = path.join(TMP, `voice-${seq++}.md`);
  fs.writeFileSync(p, `# voice\n\n${text}\n`);
  return p;
}
/** One still carrying the marker. */
function unfilledVoice() {
  const p = path.join(TMP, `voice-${seq++}.md`);
  fs.writeFileSync(p, `${D.UNFILLED}\n\n# voice\n\n<!-- paste here -->\n`);
  return p;
}

const SOURCE = 'CPI rose 2.4% in August, the slowest since 2021.';
const researchOK = async () => [SOURCE];

/** An `ask` that returns queued answers in order and records the prompts. */
function scriptedAsk(...answers) {
  const prompts = [];
  const fn = async (p) => { prompts.push(p); return answers[prompts.length - 1] ?? answers[answers.length - 1]; };
  fn.prompts = prompts;
  return fn;
}

(async () => {

// --- RULE 1: no voice profile, no draft ----------------------------------

await test('an UNFILLED profile refuses, naming the marker and whose job it is', async () => {
  const r = await D.draft({ brief: 'explain the CPI print', ask: scriptedAsk('x'), research: researchOK,
    voiceFile: unfilledVoice() });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, 'voice');
  assert.strictEqual(r.reason, 'unfilled');
  assert.match(r.why, /UNFILLED/);
  assert.match(r.why, /his/, 'the refusal no longer says whose job the profile is');
});

await test('a MISSING profile refuses differently — the two send you elsewhere', async () => {
  const r = await D.draft({ brief: 'b', ask: scriptedAsk('x'), research: researchOK,
    voiceFile: path.join(TMP, 'does-not-exist.md') });
  assert.strictEqual(r.reason, 'missing');
  assert.notStrictEqual(r.reason, 'unfilled');
});

await test('an EMPTY profile refuses too — whitespace is not a voice', async () => {
  const p = path.join(TMP, `blank-${seq++}.md`);
  fs.writeFileSync(p, '   \n\n  \n');
  assert.strictEqual((await D.draft({ brief: 'b', ask: scriptedAsk('x'), research: researchOK, voiceFile: p })).reason, 'empty');
});

await test('refusing happens BEFORE any work is done — no model call, no research', async () => {
  // Refusing after generating would mean the invented-voice draft exists, and
  // something downstream would eventually be tempted to use it.
  //
  // The research half matters too and was missed at first: a mutation moving
  // the voice check AFTER research escaped, because this only asserted that
  // `ask` was untouched. `research` is the step that reaches the network and
  // may cost money, so doing it for a draft that cannot happen is waste the
  // check exists to avoid.
  const ask = scriptedAsk('draft');
  let researched = 0;
  const research = async () => { researched++; return [SOURCE]; };
  await D.draft({ brief: 'b', ask, research, voiceFile: unfilledVoice() });
  assert.strictEqual(ask.prompts.length, 0, 'the model was asked to draft before the voice check');
  assert.strictEqual(researched, 0, 'research ran for a draft that was going to be refused');
});

await test('the real config/writing-voice.md is still unfilled, and the module says so', () => {
  // If this ever fails, Ahmed has written it — delete this test rather than
  // "fixing" it, and do NOT let anything auto-populate that file.
  const live = D.loadVoiceProfile();
  assert.strictEqual(live.ok, false);
  assert.strictEqual(live.reason, 'unfilled');
});

await test('a filled profile is actually injected into both prompts', async () => {
  // The profile has to reach the model, not merely be checked for existence —
  // a check that gates on a file nobody reads is theatre.
  const voice = 'I never open with a rhetorical question.';
  const ask = scriptedAsk('outline with 2.4%', 'script with 2.4%');
  await D.draft({ brief: 'explain it', ask, research: researchOK, voiceFile: filledVoice(voice) });
  assert.strictEqual(ask.prompts.length, 2);
  assert.ok(ask.prompts[0].includes(voice), 'the outline prompt does not carry the voice');
  assert.ok(ask.prompts[1].includes(voice), 'the script prompt does not carry the voice');
});

// --- RULE 2: fidelity against the SOURCES, never the outline --------------

await test('THE LAUNDERING PATH: an outline invents, the script restates it faithfully', async () => {
  // The headline test. If the script were checked against the OUTLINE, this
  // ships a number that appears in no source with a clean bill of health.
  const ask = scriptedAsk(
    'Outline: CPI 2.4%, lowest in 40 months',   // 40 is invented
    'Outline: CPI 2.4%, lowest in 40 months',   // retry: invents it again
  );
  const r = await D.draft({ brief: 'explain the CPI print', ask, research: researchOK,
    voiceFile: filledVoice() });
  assert.strictEqual(r.ok, false, 'an invented number laundered through the outline');
  assert.strictEqual(r.stage, 'outline');
  assert.deepStrictEqual(r.suspects, ['40']);
});

await test('a script inventing a number the outline never had is caught', async () => {
  const ask = scriptedAsk(
    'Outline: CPI 2.4%',
    'Script: CPI rose 2.4%, down from 9.1%',    // 9.1 invented at the script step
    'Script: CPI rose 2.4%, down from 9.1%',    // retry repeats it
  );
  const r = await D.draft({ brief: 'b', ask, research: researchOK, voiceFile: filledVoice() });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, 'script');
  // '9.1%', not '9.1': the percent sign is significant, so the token keeps it.
  assert.deepStrictEqual(r.suspects, ['9.1%']);
});

await test('numbers from the BRIEF count as sourced, not invented', async () => {
  // The brief is Ahmed's and is part of the source material. A figure he put
  // in it must not be reported as an invention.
  const ask = scriptedAsk('Outline: 3 points on CPI 2.4%', 'Script: 3 points, CPI 2.4%');
  const r = await D.draft({ brief: 'make 3 points about the CPI print', ask,
    research: researchOK, voiceFile: filledVoice() });
  assert.strictEqual(r.ok, true, r.why);
});

// --- enforcement: retry once, then refuse ---------------------------------

await test('one corrective retry that succeeds is allowed to ship', async () => {
  const ask = scriptedAsk(
    'Outline: CPI 2.4% lowest in 40 months',    // bad
    'Outline: CPI 2.4%',                        // corrected
    'Script: CPI rose 2.4%',                    // clean first time
  );
  const r = await D.draft({ brief: 'b', ask, research: researchOK, voiceFile: filledVoice() });
  assert.strictEqual(r.ok, true, r.why);
  assert.strictEqual(r.attempts.outline, 2);
  assert.strictEqual(r.attempts.script, 1);
});

await test('the retry prompt NAMES the offending numbers in its instructions', () => {
  // A vague "check your facts" produces a differently-wrong draft about as
  // often as a right one.
  //
  // THE ASSERTION HAS TO LOOK AT THE HEADER, not the whole prompt. The prompt
  // also echoes the previous draft, which by definition contains the invented
  // numbers — so a plain `includes('40')` is satisfied by the echo even when
  // the suspect list has been replaced by "(see the research)". A mutation
  // doing exactly that escaped the first version of this test. Same shape as
  // the hash-via-footer miss in test-content-cli.js.
  const previous = 'draft says 40 months and 9.1%';
  const p = D.fidelityRetryPrompt(previous, ['40', '9.1%'], ['source has 2.4%']);
  const header = p.slice(0, p.indexOf('YOUR PREVIOUS DRAFT'));
  assert.ok(header.includes('40'), 'the instructions do not name the invented number');
  assert.ok(header.includes('9.1%'), 'the instructions name only some of them');
  assert.ok(/appear NOWHERE|nowhere/i.test(header));
  assert.ok(p.includes(previous), 'the prompt no longer shows the model what it wrote');
});

await test('it refuses after the SECOND failure rather than retrying forever', async () => {
  const ask = scriptedAsk('bad 40', 'bad 40', 'bad 40', 'bad 40');
  const r = await D.draft({ brief: 'b', ask, research: researchOK, voiceFile: filledVoice() });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(ask.prompts.length, 2, `asked ${ask.prompts.length} times, expected exactly 2`);
});

await test('a refusal returns no text — there is nothing to accidentally use', async () => {
  const ask = scriptedAsk('bad 40', 'bad 40');
  const r = await D.draft({ brief: 'b', ask, research: researchOK, voiceFile: filledVoice() });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.script, undefined);
  assert.strictEqual(r.outline, undefined);
});

await test('generateFaithful itself withholds the failed text', async () => {
  // draft() never surfaces it either way, so asserting only there let a
  // mutation returning the bad text escape. The rule belongs where the
  // decision is made: a caller holding a refusal must not be able to reach
  // past it to the invention.
  const out = await D.generateFaithful(
    scriptedAsk('has 40', 'still has 40'), 'prompt', 'source with 2.4%', { label: 'the script' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.text, null, 'the refused draft came back anyway');
  assert.deepStrictEqual(out.suspects, ['40']);
});

await test('generateFaithful returns the text when it is clean', () => {
  // The other half, so "always return null" cannot pass the test above.
  return D.generateFaithful(scriptedAsk('says 2.4%'), 'p', 'source with 2.4%', { label: 'x' })
    .then((out) => {
      assert.strictEqual(out.ok, true);
      assert.strictEqual(out.text, 'says 2.4%');
      assert.strictEqual(out.attempts, 1);
    });
});

// --- inputs ---------------------------------------------------------------

await test('a brief is required — Jarvis never invents the idea', async () => {
  for (const bad of ['', '   ', null, undefined, 7]) {
    await assert.rejects(() => D.draft({ brief: bad, ask: scriptedAsk('x'), research: researchOK }),
      /needs a brief/);
  }
});

await test('ask and research have no defaults', async () => {
  await assert.rejects(() => D.draft({ brief: 'b', research: researchOK }), /needs an `ask`/);
  await assert.rejects(() => D.draft({ brief: 'b', ask: scriptedAsk('x') }), /needs a `research`/);
});

await test('empty research refuses rather than drafting from nothing', async () => {
  // Every number would be unsourced by definition; saying so beats a fidelity
  // refusal that reads like the model's fault.
  for (const nothing of [[], null, undefined]) {
    const r = await D.draft({ brief: 'b', ask: scriptedAsk('x'), research: async () => nothing,
      voiceFile: filledVoice() });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no-sources');
  }
});

await test('the happy path returns the sources it actually used', async () => {
  // The gate downstream shows Ahmed the script; being able to show what it was
  // drafted FROM is what makes "is this true" answerable at all.
  const ask = scriptedAsk('Outline: 2.4%', 'Script: 2.4%');
  const r = await D.draft({ brief: 'explain it', ask, research: researchOK, voiceFile: filledVoice() });
  assert.strictEqual(r.ok, true, r.why);
  assert.deepStrictEqual(r.sources, [SOURCE]);
  assert.strictEqual(r.script, 'Script: 2.4%');
});

await test('both fidelity checks receive the SAME sourceText', () => {
  // The laundering rule, pinned structurally because it cannot be pinned
  // behaviourally: the outline check guarantees every outline number is
  // sourced, so by the time the script runs, "checked against the outline" and
  // "checked against the sources" agree — the mutation is invisible through
  // draft(). Kept as defence in depth (a future caller could supply its own
  // outline, or the outline check could be weakened), and asserted on the
  // source so the invariant is not silently reversible.
  const src = fs.readFileSync(path.join(__dirname, 'content-draft.js'), 'utf8');
  // `await` excludes the function's own definition, which otherwise matches.
  const calls = [...src.matchAll(/await generateFaithful\(\s*\n?\s*ask,[^;]*?,\s*(\w+),\s*\{ label/g)]
    .map((m) => m[1]);
  assert.strictEqual(calls.length, 2, `expected 2 generateFaithful calls, found ${calls.length}`);
  assert.deepStrictEqual(calls, ['sourceText', 'sourceText'],
    `a fidelity check reads ${calls.join(' and ')} — both must read the original sources, ` +
    'or an invented number can launder through the step before it');
});

// --- layering -------------------------------------------------------------

await test('it opens no socket and calls no model of its own', () => {
  const src = fs.readFileSync(path.join(__dirname, 'content-draft.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['http', 'https', 'net', 'child_process']) {
    assert.ok(!new RegExp(`require\\(['"]${banned}['"]\\)`).test(src), `requires ${banned}`);
  }
  assert.ok(!/\bfetch\s*\(/.test(src), 'calls fetch');
});

await test('it does not advance the pipeline — drafting and gating stay separate', () => {
  // "Jarvis wrote something" and "the something may move" must never be one
  // act. The caller attaches and submits; this module only produces.
  const src = fs.readFileSync(path.join(__dirname, 'content-draft.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/require\(['"]\.\/content-pipeline/.test(src),
    'content-draft.js imports the pipeline — it could then advance its own work');
});

finish();
})();
