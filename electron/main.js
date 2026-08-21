const { app, BrowserWindow } = require('electron');
let win;
app.on('ready', () => {
  win = new BrowserWindow({ width: 1200, height: 800, webPreferences: { nodeIntegration: false } });
  win.loadURL('http://localhost:8001');
  win.webContents.openDevTools();
});
