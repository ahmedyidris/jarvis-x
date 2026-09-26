// THE RENDER STEP — the bridge from the JS pipeline to Week 1's MP4 composition.
//
// WHAT THIS SUITE IS GUARDING. Twice this session a module reported success
// for work it had not done: this very file returned
// `{ ok: true, file: "rendered.mp4" }` for any job, and content-distribute.js
// returned a youtube.com/watch?v=mock URL with no token set. The render step is
// the worst place for that failure, because process-content.js attaches its
// result as the job's CUT and submits it to the cut gate — so a fabricated
// success asks Ahmed for a real, recorded, binding approval of a video that
// does not exist.
//
// So most of what follows is one question asked many ways: can anything make
// render() say ok when there is no watchable file at the end of it.
//
// Offline by construction: `run` is injected in every test, so no process is
// spawned and neither moviepy nor ffmpeg is needed. The one thing this suite
// CANNOT prove is the happy path against a real encoder — this container has
// no moviepy, no ffmpeg and no PIL (bootstrap/requirements-venv-ai.txt puts
// them in venv-ai on the Chromebook). That gap is named here rather than
// papered over, and the refusal paths ARE verified against the real Python:
// `echo '{"script":"x","brief":"y","out":"/tmp/x.mp4"}' |
//  python3 automation/phase-b/script_renderer.py` returns a refusal naming
// moviepy on this machine, which is the correct answer here.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, finish, assert } = require('./test-helper.js');
const R = require('./content-render.js');

// See test-status.js: a truncating suite exits 0 and prints no tally.
process.exitCode = 1;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-render-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

const NOW = () => new Date('2026-09-25T12:00:00.000Z');
const JOB = { id: 'job-1', script: 'CPI came in at 2.4% in August.', brief: 'August CPI' };

/** A fake python that writes a real file and reports it, the way the real one does. */
function goodRun(bytes = 'MP4 BYTES') {
  return (request) => {
    fs.mkdirSync(path.dirname(request.out), { recursive: true });
    fs.writeFileSync(request.out, bytes);
    return { code: 0, bin: 'fake-python', stderr: '', stdout: JSON.stringify({ ok: true, file: request.out, bytes: bytes.length, durationSeconds: 31.4 }) };
  };
}
// A FRESH OUTPUT DIRECTORY PER CALL. The first version shared one, and the
// "reports a file that is not there" test then passed against a file an
// earlier test had written at the same path — the fixed clock makes the
// filename deterministic, so two tests collided. It failed loudly, which is
// the point of the suite having a fuse, but a shared scratch directory across
// tests asserting things about files on disk is the bug waiting to happen.
let call = 0;
const render = (job = JOB, opts = {}) =>
  R.render(job, { run: goodRun(), outDir: path.join(TMP, `cuts-${call++}`), now: NOW, ...opts });

(async () => {

// ─── the happy path, as far as it can be checked without an encoder ────────

await test('a successful render returns the file as `cut`, with its real size', async () => {
  const r = await render();
  assert.strictEqual(r.ok, true, r.why);
  assert.ok(r.cut.endsWith('.mp4'));
  assert.strictEqual(fs.readFileSync(r.cut, 'utf8'), 'MP4 BYTES');
  assert.strictEqual(r.bytes, 9, 'bytes is not the size on disk');
  assert.strictEqual(r.durationSeconds, 31.4);
});

await test('the job\'s script and brief are what get sent to the renderer', async () => {
  let seen = null;
  await render(JOB, { run: (req) => { seen = req; return goodRun()(req); } });
  assert.strictEqual(seen.script, JOB.script);
  assert.strictEqual(seen.brief, JOB.brief);
  assert.ok(seen.out.includes('job-1'));
});

await test('re-rendering does NOT overwrite the previous cut', async () => {
  // Rule 1 binds an approval to the artifact's bytes. Writing a new cut over
  // the path a human may already be looking at is exactly the approve-then-swap
  // the gate exists to catch, so the filename carries a timestamp.
  const shared = path.join(TMP, 'rerender');
  const a = await render(JOB, { outDir: shared, now: () => new Date('2026-09-25T12:00:00Z') });
  const b = await render(JOB, { outDir: shared, now: () => new Date('2026-09-25T13:00:00Z') });
  assert.notStrictEqual(a.cut, b.cut);
  assert.ok(fs.existsSync(a.cut), 'the first cut was overwritten');
});

await test('the file the renderer REPORTS is the cut, not the path we asked for', () => {
  // Found by mutation testing: swapping `parsed.file` for `request.out`
  // escaped, because every fixture made the two identical. They are not the
  // same claim — one is what was requested, the other is what exists.
  // script_renderer.py returns `str(Path(out))`, and video_renderer.py writes
  // to a temp sibling and os.replace()s it into position, so the path that
  // ends up holding bytes is the renderer's answer to give, not ours.
  const dir = path.join(TMP, 'reported');
  const elsewhere = path.join(dir, 'actually-here.mp4');
  return R.render(JOB, {
    outDir: dir, now: NOW,
    run: (req) => {
      fs.mkdirSync(path.dirname(req.out), { recursive: true });
      fs.writeFileSync(elsewhere, 'REAL BYTES');
      return { code: 0, bin: 'p', stderr: '', stdout: JSON.stringify({ ok: true, file: elsewhere }) };
    },
  }).then((r) => {
    assert.strictEqual(r.ok, true, r.why);
    assert.strictEqual(r.cut, elsewhere, 'the cut is the requested path rather than the written one');
    assert.strictEqual(r.bytes, 10);
  });
});

// ─── every way a fake success could get through ────────────────────────────

await test('a renderer reporting ok for a file that is NOT THERE is refused', async () => {
  const r = await render(JOB, {
    run: (req) => ({ code: 0, bin: 'p', stderr: '', stdout: JSON.stringify({ ok: true, file: req.out }) }),
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.why, /which is not there/);
});

await test('a renderer reporting ok for an EMPTY file is refused', async () => {
  const r = await render(JOB, {
    run: (req) => {
      fs.mkdirSync(path.dirname(req.out), { recursive: true });
      fs.writeFileSync(req.out, '');
      return { code: 0, bin: 'p', stderr: '', stdout: JSON.stringify({ ok: true, file: req.out }) };
    },
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.why, /which is empty/);
});

await test('a non-zero exit is refused even when stdout claims ok', async () => {
  const r = await render(JOB, {
    run: (req) => {
      fs.mkdirSync(path.dirname(req.out), { recursive: true });
      fs.writeFileSync(req.out, 'bytes');
      return { code: 1, bin: 'p', stderr: 'boom', stdout: JSON.stringify({ ok: false, why: 'render failed: boom' }) };
    },
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.why, /render failed: boom/);
});

await test('unparseable output is refused, with the exit code and last stderr line', async () => {
  const r = await render(JOB, {
    run: () => ({ code: 2, bin: 'p', stderr: 'Traceback...\nModuleNotFoundError: No module named \'moviepy\'', stdout: 'not json' }),
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.why, /no usable output \(exit 2\)/);
  assert.match(r.why, /moviepy/, 'the reason a human needs was dropped');
});

await test('empty output is refused rather than read as an empty success', async () => {
  const r = await render(JOB, { run: () => ({ code: 0, bin: 'p', stderr: '', stdout: '' }) });
  assert.strictEqual(r.ok, false);
  assert.match(r.why, /no usable output/);
});

await test('a refusal from the renderer keeps its own reason', async () => {
  const r = await render(JOB, {
    run: () => ({ code: 1, bin: 'p', stderr: '', stdout: JSON.stringify({ ok: false, why: 'a render needs a script — the job has none' }) }),
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.why, /needs a script/);
});

await test('a job with no id is refused before anything is spawned', async () => {
  let spawned = false;
  const r = await R.render({ script: 'x' }, { run: () => { spawned = true; return {}; }, now: NOW });
  assert.strictEqual(r.ok, false);
  assert.match(r.why, /needs a job with an id/);
  assert.strictEqual(spawned, false);
});

await test('only the LAST line of stdout is parsed, so a chatty encoder cannot break it', async () => {
  // moviepy and ffmpeg both write progress to stdout in some configurations.
  const r = await render(JOB, {
    run: (req) => {
      fs.mkdirSync(path.dirname(req.out), { recursive: true });
      fs.writeFileSync(req.out, 'bytes');
      return { code: 0, bin: 'p', stderr: '', stdout: `Building video\nchunk:  99%\n${JSON.stringify({ ok: true, file: req.out })}` };
    },
  });
  assert.strictEqual(r.ok, true, r.why);
});

await test('an unmeasurable duration is reported as null, never as a number', async () => {
  const r = await render(JOB, {
    run: (req) => {
      fs.mkdirSync(path.dirname(req.out), { recursive: true });
      fs.writeFileSync(req.out, 'bytes');
      return { code: 0, bin: 'p', stderr: '', stdout: JSON.stringify({ ok: true, file: req.out, durationSeconds: null }) };
    },
  });
  assert.strictEqual(r.ok, true, r.why);
  assert.strictEqual(r.durationSeconds, null, 'an unknown duration became a number');
});

// ─── which interpreter, the thing most likely to be wrong on a real box ────

await test('THE INSTALLER\'S OWN VENV PATH IS ONE OF THE CANDIDATES', () => {
  // THE BUG THIS TEST EXISTS FOR, and it shipped. The first version of
  // pythonPath() looked only in <repo>/venv-ai. bootstrap/install.sh step 4
  // creates it at $HOME/venv-ai — `python3 -m venv "$HOME/venv-ai"` — so on
  // Ahmed's machine the check would have missed, fallen back to a bare python3
  // with no moviepy, and produced the exact confusing failure the venv
  // preference exists to prevent.
  //
  // Read out of install.sh rather than written here, for the same reason
  // weekly-sweep's kill-switch detector reads guard.js's own export: a check
  // carrying its own copy of the value it checks is one move away from
  // confidently enforcing the wrong answer.
  const sh = fs.readFileSync(path.join(__dirname, '..', 'bootstrap', 'install.sh'), 'utf8');
  const m = /python3 -m venv "\$HOME\/([A-Za-z0-9._-]+)"/.exec(sh);
  assert.ok(m, 'install.sh no longer creates a $HOME venv — re-derive the candidates');
  const expected = path.join('/home/someone', m[1], 'bin', 'python3');
  assert.ok(R.venvCandidates('/repo', '/home/someone').includes(expected),
    `install.sh creates $HOME/${m[1]} but that is not among the candidates: `
    + R.venvCandidates('/repo', '/home/someone').join(', '));
});

await test('the HOME venv is preferred over a repo-local one', () => {
  // Ordering matters: a repo-local venv nothing creates must not shadow the
  // one the installer actually builds.
  const home = path.join(TMP, 'home');
  const root = path.join(TMP, 'repo');
  for (const base of [home, root]) {
    fs.mkdirSync(path.join(base, 'venv-ai', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(base, 'venv-ai', 'bin', 'python3'), '#!/bin/sh\n');
  }
  assert.strictEqual(R.pythonPath(root, home), path.join(home, 'venv-ai', 'bin', 'python3'));
});

await test('a repo-local venv is still found when there is no HOME one', () => {
  const home = path.join(TMP, 'empty-home');
  const root = path.join(TMP, 'repo2');
  fs.mkdirSync(path.join(root, 'venv-ai', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'venv-ai', 'bin', 'python3'), '#!/bin/sh\n');
  assert.strictEqual(R.pythonPath(root, home), path.join(root, 'venv-ai', 'bin', 'python3'));
});

await test('it falls back to python3 when there is no venv anywhere', () => {
  assert.strictEqual(R.pythonPath(path.join(TMP, 'no-such-root'), path.join(TMP, 'no-such-home')), 'python3');
});

await test('every result names the interpreter used, including the refusals', async () => {
  // So a wrong-interpreter failure is diagnosable from the refusal alone
  // rather than needing a second run to find out.
  const ok = await render();
  assert.strictEqual(ok.python, 'fake-python');
  const bad = await render(JOB, { run: () => ({ code: 1, bin: 'some-python', stderr: 'x', stdout: '' }) });
  assert.strictEqual(bad.python, 'some-python');
});

// ─── the python adapter exists and is what this points at ──────────────────

await test('the python adapter this bridges to is actually present', async () => {
  assert.ok(fs.existsSync(R.SCRIPT), `${R.SCRIPT} is missing — the bridge points at nothing`);
  const src = fs.readFileSync(R.SCRIPT, 'utf8');
  assert.match(src, /def render\(/, 'the adapter has no render()');
  assert.match(src, /video_renderer import render_video/,
    'the adapter no longer calls the existing renderer — if composition was reimplemented, say why');
});

await test('this module never reports a render without checking the filesystem', async () => {
  // Structural, because the fabricated-success bug it replaces was exactly a
  // return statement nobody had to justify.
  const src = fs.readFileSync(path.join(__dirname, 'content-render.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const okReturns = (src.match(/ok:\s*true/g) || []).length;
  assert.strictEqual(okReturns, 1, `${okReturns} ok:true returns — each one needs its own filesystem check`);
  assert.ok(src.includes('fs.statSync(parsed.file)'), 'the ok path no longer stats the file it reports');
});

finish();
})();
