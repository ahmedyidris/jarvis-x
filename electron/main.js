const { app, BrowserWindow } = require('electron');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { nodeIntegration: false },
  });
  win.loadURL('http://localhost:8000');
  win.webContents.on('did-finish-load', () => {
    console.log('JARVIS_ELECTRON_LOADED');
  });
  win.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('JARVIS_ELECTRON_LOAD_FAILED', code, description);
    process.exit(1);
  });
}

app.on('ready', createWindow);
app.on('window-all-closed', () => app.quit());
