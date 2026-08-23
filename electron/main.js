const { app, BrowserWindow, shell } = require('electron');
const { execFile } = require('child_process');
const http = require('http');
const path = require('path');

// Crostini has no DRM render node, so Chromium's GPU process fails to launch
// and floods stderr before falling back to software rendering anyway. Ask for
// the fallback directly: quieter logs and a faster cold start.
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

const BACKEND = 'http://127.0.0.1:8000';
const REPO = path.resolve(__dirname, '..');
const SUPERVISOR_CONF = path.join(REPO, 'config', 'supervisord.conf');

let win;

function ping() {
  return new Promise(resolve => {
    const req = http.get(`${BACKEND}/api/status`, res => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

// supervisord owns hermes-api's lifecycle; we only nudge it awake. Deliberately
// NOT stopped on window close -- the scheduler and API are used outside this
// window, and killing them here would fight the existing supervisor setup.
function startBackend() {
  return new Promise(resolve => {
    execFile('supervisorctl', ['-c', SUPERVISOR_CONF, 'start', 'hermes-api'],
      { timeout: 15000 }, () => resolve());
  });
}

async function waitForBackend(attempts = 20) {
  if (await ping()) return true;
  await startBackend();
  for (let i = 0; i < attempts; i++) {
    await new Promise(r => setTimeout(r, Math.min(500 * (i + 1), 2000)));
    if (await ping()) return true;
  }
  return false;
}

function createWindow(backendUp) {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Jarvis X',
    icon: path.join(REPO, 'web', 'public', 'icon-512.png'),
    backgroundColor: '#0a0a0a',
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });

  win.once('ready-to-show', () => win.show());

  // Anything not our own origin opens in the real browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!backendUp) {
    win.loadURL('data:text/html,' + encodeURIComponent(
      `<body style="background:#0a0a0a;color:#e5e5e5;font:14px monospace;padding:3rem">
       <h2>Backend unreachable</h2>
       <p>hermes-api did not come up on 127.0.0.1:8000.</p>
       <pre>supervisorctl -c config/supervisord.conf status hermes-api</pre></body>`));
    return;
  }

  win.loadURL(BACKEND);
  win.webContents.on('did-finish-load', () => console.log('JARVIS_ELECTRON_LOADED'));

  // Was process.exit(1) on any failed load -- a transient blip during startup
  // killed the whole app instead of retrying. Reload with backoff instead.
  let retries = 0;
  win.webContents.on('did-fail-load', (_e, code, description) => {
    console.error('JARVIS_ELECTRON_LOAD_FAILED', code, description);
    if (retries++ < 5 && !win.isDestroyed()) {
      setTimeout(() => win.loadURL(BACKEND), 1000 * retries);
    }
  });
}

app.whenReady().then(async () => {
  const up = await waitForBackend();
  createWindow(up);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(up);
  });
});

app.on('window-all-closed', () => app.quit());
