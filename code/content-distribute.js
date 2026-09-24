/**
 * CONTENT PHASE 1's DISTRIBUTION STEP — the poster handed to
 * content-pipeline.js's post().
 *
 * It is never called directly. `pipeline.post(jobId, poster)` is the only
 * route, because that is where rule 4's cut-gate re-check lives, and a caller
 * that reaches past it publishes with no gate in front of it. That is not a
 * hypothetical: the version of process-content.js this replaces called
 * `distributor.post(job)` directly. code/test-process-content.js fails if a
 * second caller appears.
 *
 * IT THROWS WHEN IT CANNOT POST, rather than returning a cheerful mock. The
 * previous version returned `{ ok: true, platform: 'youtube', url:
 * 'https://youtube.com/watch?v=mock' }` when YOUTUBE_OAUTH_TOKEN was unset —
 * a success shape, carrying a URL, for a video nobody uploaded. Downstream
 * that becomes a `posted` row in an append-only log with a fabricated link in
 * it, which is the one kind of wrong this pipeline cannot walk back: the log
 * is the record of what was published, and a false row in it is worse than no
 * row. Ahmed would have had to open the URL to find out.
 *
 * A throw is deliberate over `{ok:false}`. post() awaits the poster inside
 * guard(), so a throw is both audited and impossible to mistake for a post;
 * `{ok:false}` is one missed check away from being treated as one. post()
 * refuses an explicit `{ok:false}` too, as defence in depth, but a poster
 * should not need that backstop to be safe.
 */

/**
 * The real upload is not built. What exists here is the refusal and the
 * shape it will take: googleapis' youtube.videos.insert against an OAuth
 * token in ~/.jarvis-x/.env, which is Ahmed's to populate and Read-denied to
 * Claude Code by design — so this cannot be finished from a remote session
 * even in principle, and pretending otherwise is what produced the mock.
 */
module.exports = {
  post: async (job) => {
    if (!process.env.YOUTUBE_OAUTH_TOKEN) {
      throw new Error(
        'refusing to report a post that did not happen: YOUTUBE_OAUTH_TOKEN is '
        + 'not set, so nothing was uploaded. Set it in ~/.jarvis-x/.env. '
        + `Job ${job && job.id} stays queued.`);
    }
    throw new Error(
      'YOUTUBE_OAUTH_TOKEN is set but the upload call is not built yet — '
      + 'refusing to record a post rather than inventing a URL for it');
  },
};
