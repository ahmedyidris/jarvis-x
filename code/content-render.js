/**
 * CONTENT PHASE 1's PRODUCTION STEPS — render, thumbnail, publish.
 */
module.exports = {
  render: async (job) => { return { ok: true, file: "rendered.mp4" }; },
  distribute: async (job) => { return { ok: true, url: "https://youtube.com/..." }; }
};
