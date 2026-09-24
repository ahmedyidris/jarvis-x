/**
 * CONTENT PHASE 1's RENDER STEP — not built, and saying so.
 *
 * This file used to return `{ ok: true, file: "rendered.mp4" }` for any job,
 * having rendered nothing. That is worse than an empty file: process-content.js
 * would have attached the fake result as the job's `cut` and submitted it to
 * the cut gate, putting a video that does not exist in front of Ahmed for
 * approval — and an approval he gives to a hash of the string "rendered.mp4"
 * is a real approval, recorded in an append-only log, binding.
 *
 * So it refuses. `{ ok: false }` leaves the job in `producing` where it
 * belongs — Jarvis's side of the line, waiting on work Jarvis has not done —
 * instead of moving it to Ahmed's desk. Same rule as content-draft.js
 * refusing without a voice profile, and the same reason: an unknown must have
 * its own value and must never default to the reassuring one.
 *
 * WHAT WIRING IT ACTUALLY TAKES, so the next person does not assume it is a
 * few lines. `automation/phase-b/video_renderer.py` renders vertical shorts
 * already, but it is not this function: it takes a LETTER and looks up
 * content_generator.py's JSON for it, not a script produced by
 * content-draft.js. It also needs MoviePy, the local TTS engine, and
 * HiggsfieldRenderer's credentials, none of which exist on a CI runner. A
 * render step for this pipeline is a real build, not an import.
 */
module.exports = {
  render: async (job) => ({
    ok: false,
    why: 'no renderer is wired to the JS content pipeline yet — '
      + 'automation/phase-b/video_renderer.py renders letters, not scripts, '
      + `so job ${job && job.id} stays in producing rather than reaching the cut gate`,
  }),
};
