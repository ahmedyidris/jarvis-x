// scripts/starnet.sh runs StarNet itself on the Chromebook, wired to the
// Jarvis gateway. The assertions that matter most pin what was found by
// actually installing and running StarNet on Debian (2026-09-26):
//
//   * process matching must be anchored -- an unanchored `pgrep -f` matched
//     the terminal that ran `stop`, and `stop` killed it;
//   * a stale workspace lock is removed only when its PID is provably gone;
//   * pruning touches only onnxruntime's GPU/Mac/Windows binaries;
//   * StarNet never receives the provider keys (its Groq path is Bug A);
//   * the launcher and the gateway agree on the port.
//
// OFFLINE. Every run points STARNET_DIR, HOME and the workspace root at a temp
// dir; no command here installs, clones, starts a server or opens a socket.
// `start` is exercised only on its refusal path (nothing installed).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, finish, assert } = require('./test-helper.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'starnet.sh');
const SRC = fs.readFileSync(SCRIPT, 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-starnet-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } });

function run(args, env = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: TMP, STARNET_DIR: path.join(TMP, 'none'), STARNET_WORKSPACES: path.join(TMP, 'ws'), ...env },
    timeout: 20000,
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// Code outside comments, so a pin cannot be satisfied by the explanation of it.
const CODE = SRC.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

process.exitCode = 1;

(async () => {

await test('the script parses', () => {
  const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});

await test('help lists every command and exits 0; an unknown command exits 2', () => {
  const h = run(['help']);
  assert.strictEqual(h.code, 0);
  for (const c of ['install', 'start', 'stop', 'status', 'logs', 'doctor', 'clear-lock', 'prune']) {
    assert.ok(new RegExp(`starnet\\.sh ${c}\\b`).test(h.out), `help does not list ${c}`);
  }
  assert.strictEqual(run(['frobnicate']).code, 2);
});

await test('start refuses cleanly when StarNet is not installed, and starts nothing', () => {
  const r = run(['start'], { JX_STARNET_LOGS: path.join(TMP, 'logs') });
  assert.strictEqual(r.code, 1);
  assert.ok(/not installed at .*run: scripts\/starnet\.sh install/.test(r.out), r.out);
  assert.ok(!fs.existsSync(path.join(TMP, 'logs', 'gateway.log')), 'the gateway was started before the refusal');
});

// --- the stale-lock rule ---------------------------------------------------

function lockWith(content) {
  const ws = path.join(TMP, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  const f = path.join(ws, '.starnet-workspace-owner.json');
  fs.writeFileSync(f, content);
  return f;
}
function deadPid() {
  const child = spawnSync('bash', ['-c', 'echo $$']);
  return Number(String(child.stdout).trim());
}

await test('clear-lock removes a lock whose PID is gone', () => {
  const pid = deadPid();
  const f = lockWith(JSON.stringify({ pid }));
  const r = run(['clear-lock']);
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(!fs.existsSync(f), 'stale lock left behind');
  assert.ok(r.out.includes(`pid ${pid} is gone`));
});

await test('clear-lock KEEPS a lock whose PID is alive', () => {
  const f = lockWith(JSON.stringify({ pid: process.pid }));
  const r = run(['clear-lock']);
  assert.strictEqual(r.code, 0);
  assert.ok(fs.existsSync(f), 'removed the lock of a running StarNet');
  fs.rmSync(f);
});

await test('clear-lock KEEPS a lock it cannot read, rather than guessing', () => {
  for (const bad of ['not json', JSON.stringify({ pid: 'abc' }), JSON.stringify({})]) {
    const f = lockWith(bad);
    run(['clear-lock']);
    assert.ok(fs.existsSync(f), `removed an unreadable lock: ${bad}`);
    fs.rmSync(f);
  }
  assert.ok(/no legacy workspace lock/.test(run(['clear-lock']).out));
});

await test('the liveness check is ps -p, not kill -0 (which fails on other users\' live processes)', () => {
  assert.ok(/ps -p "\$pid"/.test(CODE));
  assert.ok(!/kill -0/.test(CODE));
});

// --- pruning ----------------------------------------------------------------

await test('prune removes only onnxruntime GPU/Mac/Windows binaries', () => {
  const dir = path.join(TMP, 'sn');
  const bin = path.join(dir, 'node_modules', 'kokoro-js', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3');
  const files = {
    cuda: path.join(bin, 'linux', 'x64', 'libonnxruntime_providers_cuda.so'),
    trt: path.join(bin, 'linux', 'x64', 'libonnxruntime_providers_tensorrt.so'),
    core: path.join(bin, 'linux', 'x64', 'libonnxruntime.so.1'),
    mac: path.join(bin, 'darwin', 'arm64', 'x.node'),
    win: path.join(bin, 'win32', 'x64', 'y.dll'),
    other: path.join(dir, 'node_modules', 'somelib', 'darwin', 'keep.js'),
    otherCuda: path.join(dir, 'node_modules', 'somelib', 'libonnxruntime_providers_cuda.so'),
  };
  for (const f of Object.values(files)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); }
  const r = run(['prune'], { STARNET_DIR: dir });
  assert.strictEqual(r.code, 0, r.out);
  for (const k of ['cuda', 'trt', 'mac', 'win']) assert.ok(!fs.existsSync(files[k]), `${k} survived`);
  assert.ok(fs.existsSync(files.core), 'deleted the CPU runtime StarNet needs');
  assert.ok(fs.existsSync(files.other), 'deleted a darwin/ dir outside onnxruntime-node/bin');
  assert.ok(fs.existsSync(files.otherCuda), 'deleted a file outside onnxruntime-node/bin');
});

await test('prune on a missing node_modules is a no-op, not an error', () => {
  assert.strictEqual(run(['prune'], { STARNET_DIR: path.join(TMP, 'empty') }).code, 0);
});

// --- pins on what the install and start must do ------------------------------

await test('install skips the CUDA download and dev packages', () => {
  assert.ok(/ONNXRUNTIME_NODE_INSTALL=skip npm ci --omit=dev/.test(CODE));
});

await test('a fresh clone is shallow and leaves out website/ docs/ output/ qa/', () => {
  assert.ok(/git clone --depth 1 --filter=blob:none --no-checkout/.test(CODE));
  for (const d of ['website', 'docs', 'output', 'qa']) assert.ok(CODE.includes(`'!/${d}/'`), `${d}/ not excluded`);
});

await test('an existing StarNet checkout is never reset, cleaned or switched', () => {
  assert.ok(!/reset --hard|git clean|git -C "\$STARNET_DIR" (checkout|switch) \S/.test(CODE));
  assert.ok(/using the existing StarNet/.test(CODE));
});

await test('StarNet gets no provider keys unless asked (its own Groq path is Bug A)', () => {
  for (const k of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY']) assert.ok(CODE.includes(`-u ${k}`), `${k} reaches StarNet`);
  assert.ok(/--direct-keys/.test(CODE));
});

await test('StarNet is pointed at the gateway on the SAME port the gateway defaults to', () => {
  const { DEFAULT_PORT } = require('./openai-gateway.js');
  const m = /GATEWAY_PORT="\$\{JX_GATEWAY_PORT:-(\d+)\}"/.exec(CODE);
  assert.ok(m, 'no default gateway port');
  assert.strictEqual(Number(m[1]), DEFAULT_PORT);
  assert.ok(/CUSTOM_OPENAI_BASE_URL="http:\/\/127\.0\.0\.1:\$GATEWAY_PORT\/v1"/.test(CODE));
});

await test('REGRESSION: process matching is anchored and per-user', () => {
  const lines = CODE.split('\n').filter((l) => /pgrep/.test(l));
  assert.strictEqual(lines.length, 2);
  for (const l of lines) {
    assert.ok(/pgrep -u "\$\(id -u\)" -f '\^node [^']+\$'/.test(l), `unanchored: ${l}`);
  }
  assert.ok(!/pkill/.test(CODE), 'pkill -f has the same self-match problem');
});

await test('REGRESSION: stop does not kill a shell that merely mentions StarNet', () => {
  // A decoy whose command line contains the string, as the terminal did.
  const { spawn } = require('child_process');
  const decoy = spawn('bash', ['-c', 'sleep 5 # node sidecar/index.js'], { stdio: 'ignore' });
  const r = run(['stop']);
  let alive = true;
  try { process.kill(decoy.pid, 0); } catch { alive = false; }
  decoy.kill();
  assert.ok(alive, 'stop killed an unrelated process');
  assert.ok(/StarNet was not running/.test(r.out), r.out);
});

await test('the launcher never sets StarNet approval mode, and tells Ahmed to keep ASK FOR APPROVAL', () => {
  // It may only ADVISE: no roster write, no approval field, no env switch.
  assert.ok(!/approvalMode|\/api\/roster|FULL_POWER|APPROVAL=/.test(CODE));
  assert.ok(/choose ASK FOR APPROVAL \(not FULL POWER\)/.test(CODE), 'the start message lost the no-YOLO advice');
});

finish();
})();
