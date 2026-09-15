/**
 * CONTENT PHASE 1's DRAFTING STEPS — research → outline → script.
 *
 * PLAN_5 §6.2, the left-to-right middle of the flow:
 *
 *   prompt/link -> [research -> outline -> script]  <- this file
 *              -> HIS EDIT                          <- code/content-pipeline.js gate 1
 *              -> render -> metadata
 *              -> HIS APPROVAL OF THE CUT           <- gate 2
 *              -> queue -> post
 *
 * It produces artifacts; it does not advance anything. The caller attaches the
 * script to a job and submits it to the gate. Drafting and the gated state
 * machine stay separate modules so that "Jarvis wrote something" and "the
 * something is allowed to move" can never be the same act.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IT REFUSES TO DRAFT WITHOUT A VOICE PROFILE, AND THAT IS THE POINT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * §6.2's ruling is "Your words, Jarvis assists." A draft in a voice Jarvis
 * invented would invert that ruling while appearing to satisfy it — and it
 * would do so invisibly, because generic LLM prose reads as competent. The
 * gate at the script would then be reviewing the wrong thing: not "is this
 * mine", but "is this passable".
 *
 * So `config/writing-voice.md` carries an `<!-- UNFILLED -->` marker on its
 * first line, and this module refuses while it is there. It does not fall back
 * to a neutral register, does not infer a voice from the brief, and does not
 * ship with a default profile. Same rule as `by` having no default in the
 * approval path: a convenience default is exactly how the thing a human was
 * supposed to supply gets supplied by a machine instead.
 *
 * The marker is the whole mechanism, deliberately. A heuristic for "does this
 * profile look filled in" is one more rule to be subtly wrong about, and being
 * wrong in the permissive direction here means drafting in an invented voice.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FIDELITY IS CHECKED AGAINST THE SOURCES, NEVER AGAINST THE OUTLINE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The subtle one, and the reason the checks are wired the way they are.
 *
 * Both the outline and the script are checked against brief + research — the
 * ORIGINAL material — never against the step before them. Checking the script
 * against the outline would let an invented number LAUNDER: the outline
 * fabricates "40%", the script faithfully restates the outline, the check
 * passes, and a number that was never in any source ships with a clean bill.
 *
 * `REMAINING_WORK.md` §P4 records four confirmed inventions in this repo's
 * other pipeline, two of them fabricated digits. Laundering through an
 * intermediate step is how that failure would survive a check that was
 * otherwise correct.
 *
 * BEING PRECISE ABOUT WHICH CHECK DOES THE WORK, because the paragraph above
 * overstates it on its own. What actually closes the laundering path is that
 * the OUTLINE is checked against the sources: by the time the script step
 * runs, every number in the outline is provably sourced, so "checked against
 * the outline" and "checked against the sources" would agree. Mutating the
 * script's check to read the outline is therefore invisible through `draft()`,
 * and a test claiming to catch it would be claiming too much.
 *
 * It is kept anyway as defence in depth — the outline check could be removed,
 * weakened, or bypassed by a future caller that supplies its own outline — and
 * the invariant that both checks receive the SAME sourceText is pinned
 * structurally by a test rather than behaviourally by a scenario that cannot
 * exist while both checks are intact.
 *
 * ENFORCEMENT, NOT JUST DETECTION. On suspects, it re-prompts ONCE with the
 * offending numbers named, then REFUSES rather than shipping a known
 * invention — the behaviour `content_generator.py`'s enforce_numeric_fidelity()
 * settled on, which re-prompts and then raises. A draft that is quietly wrong
 * is worse than no draft, because the gate downstream is a human reading for
 * voice, not auditing arithmetic against sources he may not have.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `ask` and `research` are injected with NO DEFAULTS, so this module opens no
 * socket and calls no model on its own — the whole suite runs without ollama
 * or a key, like every other module here.
 */
const fs = require('fs');
const path = require('path');
const { checkNumericFidelity } = require('./content-fidelity.js');

const REPO = path.join(__dirname, '..');
const VOICE_PROFILE = path.join(REPO, 'config', 'writing-voice.md');

/** The marker whose presence means "Ahmed has not written this yet". */
const UNFILLED = '<!-- UNFILLED -->';

/**
 * Reads the profile and says whether it is usable. Returns a REASON rather
 * than a boolean, because "no file" and "still the placeholder" send whoever
 * hits them to different actions.
 */
function loadVoiceProfile({ file = VOICE_PROFILE } = {}) {
  if (!fs.existsSync(file)) {
    return { ok: false, reason: 'missing', why: `${file} does not exist` };
  }
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes(UNFILLED)) {
    return {
      ok: false,
      reason: 'unfilled',
      why: `${file} still carries its ${UNFILLED} marker — Ahmed has not written it yet. `
         + 'Jarvis must not fill it in: §6.2 rules that the words are his.',
    };
  }
  if (!text.trim()) {
    return { ok: false, reason: 'empty', why: `${file} is empty` };
  }
  return { ok: true, text };
}

const SOURCE_TEXT = (brief, sources) => [brief, ...sources].join('\n\n');

function outlinePrompt(brief, sources, voice) {
  return [
    'Produce a shot-by-shot outline for a short video.',
    '',
    `THE BRIEF (Ahmed's, and the only source of the angle):\n${brief}`,
    '',
    `RESEARCH — the ONLY factual material you may use:\n${sources.join('\n\n')}`,
    '',
    'RULES:',
    '- Every number, date and named quantity must appear in the research above.',
    '  Do not compute, round, extrapolate or illustrate with one that does not.',
    '- If the research does not support a beat, drop the beat. Do not fill it in.',
    '- The angle is the brief\'s. Do not substitute a more obvious one.',
    '',
    `AHMED'S VOICE, for tone only — the outline is structure, not prose:\n${voice}`,
  ].join('\n');
}

function scriptPrompt(brief, sources, outline, voice) {
  return [
    "Write the narration script from this outline, in Ahmed's voice.",
    '',
    `THE BRIEF:\n${brief}`,
    '',
    `RESEARCH — the ONLY factual material you may use:\n${sources.join('\n\n')}`,
    '',
    `OUTLINE:\n${outline}`,
    '',
    "AHMED'S VOICE — match this. It is the point of the exercise, not a garnish:",
    voice,
    '',
    'RULES:',
    '- Every number and date must appear in the RESEARCH, not merely in the outline.',
    '- Write prose he would actually say aloud. If the voice profile and a',
    '  smoother phrasing disagree, the voice profile wins.',
  ].join('\n');
}

/**
 * The corrective re-prompt. Names the offending numbers explicitly rather than
 * saying "check your facts": the Python's version does the same, because a
 * vague retry produces a differently-wrong draft about as often as a right one.
 */
function fidelityRetryPrompt(previous, suspects, sources) {
  return [
    'That draft contains numbers that appear NOWHERE in the source material:',
    suspects.map((s) => `  - ${s}`).join('\n'),
    '',
    'Rewrite it using only figures present in the research below. Do not',
    'substitute different invented numbers, and do not paraphrase a number into',
    'words to get around this. If a claim needs a figure the research does not',
    'have, cut the claim.',
    '',
    `RESEARCH:\n${sources.join('\n\n')}`,
    '',
    `YOUR PREVIOUS DRAFT:\n${previous}`,
  ].join('\n');
}

/**
 * One generate-check-retry cycle against the original sources.
 *
 * Returns `{ ok, text, suspects, attempts }`. On a second failure it returns
 * ok:false rather than the text — refusing beats shipping a known invention.
 */
async function generateFaithful(ask, prompt, sourceText, { label }) {
  let text = await ask(prompt);
  let suspects = checkNumericFidelity(sourceText, text);
  if (!suspects.length) return { ok: true, text, suspects: [], attempts: 1 };

  const retry = fidelityRetryPrompt(text, suspects, [sourceText]);
  text = await ask(retry);
  suspects = checkNumericFidelity(sourceText, text);
  if (!suspects.length) return { ok: true, text, suspects: [], attempts: 2 };

  return {
    ok: false, text: null, suspects, attempts: 2,
    why: `${label} still invents ${suspects.join(', ')} after one correction — refusing to ship it`,
  };
}

/**
 * Draft a script for a brief.
 *
 * `research` takes the brief and returns an array of source strings. It is
 * injected with no default: a drafter that could reach the web on its own
 * would make this module untestable offline and would decide for itself what
 * counts as a source.
 */
async function draft({ brief, ask, research, voiceFile = VOICE_PROFILE } = {}) {
  if (typeof brief !== 'string' || !brief.trim()) {
    throw new Error("a draft needs a brief — the idea is Ahmed's, not Jarvis's");
  }
  if (typeof ask !== 'function') throw new Error('draft() needs an `ask` function');
  if (typeof research !== 'function') throw new Error('draft() needs a `research` function');

  const voice = loadVoiceProfile({ file: voiceFile });
  if (!voice.ok) {
    return { ok: false, stage: 'voice', reason: voice.reason, why: voice.why };
  }

  const sources = await research(brief);
  if (!Array.isArray(sources) || !sources.length) {
    // No sources means every number in the draft would be unsourced by
    // definition. Better to say so than to draft something the fidelity check
    // will then reject for reasons that look like the model's fault.
    return { ok: false, stage: 'research', reason: 'no-sources',
             why: 'research returned nothing — there is no material to draft from' };
  }

  // THE SOURCE OF TRUTH FOR BOTH CHECKS. Note it is built once, from the
  // brief and the research, and never updated with the outline. That is what
  // stops an invented number laundering through an intermediate step.
  const sourceText = SOURCE_TEXT(brief, sources);

  const outline = await generateFaithful(
    ask, outlinePrompt(brief, sources, voice.text), sourceText, { label: 'the outline' });
  if (!outline.ok) {
    return { ok: false, stage: 'outline', reason: 'fidelity', why: outline.why, suspects: outline.suspects };
  }

  const script = await generateFaithful(
    ask, scriptPrompt(brief, sources, outline.text, voice.text), sourceText, { label: 'the script' });
  if (!script.ok) {
    return { ok: false, stage: 'script', reason: 'fidelity', why: script.why, suspects: script.suspects };
  }

  return {
    ok: true, brief, sources,
    outline: outline.text, script: script.text,
    attempts: { outline: outline.attempts, script: script.attempts },
  };
}

module.exports = {
  draft, loadVoiceProfile, generateFaithful,
  outlinePrompt, scriptPrompt, fidelityRetryPrompt,
  VOICE_PROFILE, UNFILLED,
};
