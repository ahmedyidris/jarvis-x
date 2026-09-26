/**
 * CONTENT PHASE 1's RENDER STEP — now wired, to the renderer that already
 * existed.
 *
 * WHAT THIS REPLACES. Until 2026-09-25 this file returned
 * `{ ok: true, file: "rendered.mp4" }` for any job, having rendered nothing;
 * then it returned a refusal, which was honest but produced no video. Both
 * versions shared a wrong assumption — that rendering had to be built. It did
 * not. `automation/phase-b/video_renderer.py`'s `render_video()` has produced
 * vertical MP4s since Week 1 (TTS narration, solid background, headline,
 * caption, atomic write, a real check on ffmpeg's return code), and its own
 * docstring says the composition is not letter-specific. What was missing was
 * an adapter and a way for Node to reach it.
 *
 * `automation/phase-b/script_renderer.py` is that adapter. This file is the
 * bridge to it: one JSON object in on stdin, one JSON object out on stdout.
 *
 * `run` IS INJECTED AND THE SUITE ALWAYS SUPPLIES IT, so the tests spawn no
 * process and need neither moviepy nor ffmpeg. The real spawn is supplied here
 * at the boundary rather than by a caller, because unlike a poster or a model
 * call there is no decision in it — which interpreter to use is a fact about
 * the machine, discoverable, and getting it wrong is the whole failure mode
 * (see below).
 *
 * IT REFUSES RATHER THAN REPORTING A RENDER IT DID NOT DO. A non-zero exit,
 * unparseable output, a missing `file`, or a file that is absent or empty on
 * disk all come back `{ ok: false }` with a reason. `code/process-content.js`
 * treats that as "stays in producing" and never attaches a cut, so nothing
 * reaches the cut gate that a human would then be asked to approve sight
 * unseen.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'automation', 'phase-b', 'script_renderer.py');

/**
 * WHICH PYTHON, and why this is the thing most likely to be wrong on a given
 * machine. `bootstrap/requirements-venv-ai.txt` pins moviepy 2.2.1 and
 * imageio-ffmpeg into `venv-ai`, not into the system interpreter — so a bare
 * `python3` on the same box will import video_renderer fine and then fail on
 * `from moviepy import ...`, which reads like a broken renderer rather than
 * the wrong interpreter. Preferring the venv when it exists makes the common
 * case right, and the result names the interpreter used so the uncommon case
 * is diagnosable from the refusal alone instead of needing a second run.
 *
 * I GOT THE VENV'S LOCATION WRONG WHEN I WROTE THIS, 2026-09-25, and it would
 * have failed on exactly the machine it was written for. The first version
 * looked only in `<repo>/venv-ai`. `bootstrap/install.sh` step 4 creates it at
 * `$HOME/venv-ai` — `python3 -m venv "$HOME/venv-ai"` — so on Ahmed's box the
 * check would have missed, fallen back to a bare `python3` with no moviepy,
 * and produced the precise confusing failure this function exists to prevent.
 *
 * Caught by reading install.sh rather than by any test, because every test
 * injects the spawn and the container has no venv at either path — a seam that
 * makes the suite offline also makes it blind to which path is real. So both
 * are checked, `$HOME` first because that is what the installer actually does,
 * and CANDIDATES is exported so a test can assert the installer's path is
 * among them rather than trusting this comment.
 */
function venvCandidates(root = ROOT, home = os.homedir()) {
  return [
    // What bootstrap/install.sh step 4 actually creates.
    path.join(home, 'venv-ai', 'bin', 'python3'),
    // A repo-local venv, which nothing creates today but is the arrangement a
    // reader would assume from the name. Checked second so it cannot shadow
    // the real one.
    path.join(root, 'venv-ai', 'bin', 'python3'),
  ];
}

function pythonPath(root = ROOT, home = os.homedir()) {
  for (const venv of venvCandidates(root, home)) {
    try { if (fs.statSync(venv).isFile()) return venv; } catch { /* keep looking */ }
  }
  return 'python3';
}

/** The real spawn. Returns { code, stdout, stderr } and never throws for a non-zero exit. */
function spawnPython(job, { root = ROOT, timeoutMs = 10 * 60_000 } = {}) {
  const bin = pythonPath(root);
  try {
    const stdout = execFileSync(bin, [SCRIPT], {
      input: JSON.stringify(job),
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr: '', bin };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : -1,
      stdout: e.stdout || '',
      stderr: e.stderr || e.message || '',
      bin,
    };
  }
}

/**
 * Render a content-pipeline job into an MP4.
 *
 * Returns `{ ok: true, cut, bytes, durationSeconds, python }` — `cut` is the
 * path, and it is what `process-content.js` attaches as the job's cut
 * artifact. On any failure, `{ ok: false, why }`.
 */
async function render(job, { run = spawnPython, root = ROOT, outDir = null, now = () => new Date() } = {}) {
  if (!job || !job.id) return { ok: false, why: 'render needs a job with an id' };

  const dir = outDir || path.join(root, 'logs', 'cuts');
  // A stamped filename rather than a bare job id: re-rendering after a script
  // change must not overwrite the cut a human may already be looking at, and
  // rule 1 binds an approval to the artifact's bytes — silently replacing them
  // under the same path is exactly the swap that rule exists to catch.
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const out = path.join(dir, `${job.id}-${stamp}.mp4`);

  const request = {
    script: job.script,
    brief: job.brief,
    headline: job.headline || null,
    out,
  };

  const res = run(request, { root });
  let parsed;
  try {
    parsed = JSON.parse(String(res.stdout).trim().split('\n').pop() || '');
  } catch {
    return {
      ok: false,
      python: res.bin,
      why: `the renderer produced no usable output (exit ${res.code})`
        + `${res.stderr ? `: ${String(res.stderr).trim().split('\n').pop()}` : ''}`,
    };
  }

  if (!parsed || parsed.ok !== true) {
    return { ok: false, python: res.bin, why: parsed && parsed.why ? parsed.why : `the renderer refused (exit ${res.code})` };
  }

  // TRUST THE FILESYSTEM OVER THE REPORT. script_renderer.py already checks
  // this on its side; doing it again here is not redundancy for its own sake.
  // The two checks answer different questions — "did the encoder produce a
  // file" and "can the process that will attach it as a cut actually see that
  // file" — and this session has twice found a module reporting success for
  // work that had not happened.
  let size = 0;
  try { size = fs.statSync(parsed.file).size; } catch {
    return { ok: false, python: res.bin, why: `the renderer reported ${parsed.file}, which is not there` };
  }
  if (!size) return { ok: false, python: res.bin, why: `the renderer reported ${parsed.file}, which is empty` };

  return {
    ok: true,
    cut: parsed.file,
    bytes: size,
    durationSeconds: parsed.durationSeconds ?? null,
    python: res.bin,
  };
}

module.exports = { render, pythonPath, venvCandidates, spawnPython, SCRIPT };
