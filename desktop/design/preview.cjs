// Local design preview, not an application entry or production build input.
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !['file:', 'data:', 'devtools:'].includes(new URL(details.url).protocol) });
  });
  const window = new BrowserWindow({ width: 1440, height: 940, title: 'docu.md · 界面设计 R0.1',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  await window.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
