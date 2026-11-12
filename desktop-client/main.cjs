"use strict";
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

let mainWindow;
const configPath = () => path.join(app.getPath('userData'), 'server.json');
function parseServer(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid server address');
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw)) throw new Error('Enter http:// or https://');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid server address'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Unsupported server address');
  if (url.search || url.hash) throw new Error('Please enter the server base URL without query or fragment');
  // Use only one origin; the app never follows navigation to arbitrary websites.
  return url.origin;
}
function savedServer() {
  try { return parseServer(JSON.parse(readFileSync(configPath(), 'utf8')).server); }
  catch { return ''; }
}
function startupPage() { return path.join(__dirname, 'setup.html'); }
function permitted(target, server) {
  try {
    const candidate = new URL(target);
    return candidate.origin === server && ['http:', 'https:'].includes(candidate.protocol);
  } catch { return false; }
}
function createWindow() {
  const server = savedServer();
  mainWindow = new BrowserWindow({
    title: 'TMP Camera Surveillance', width: 1440, height: 900, minWidth: 900, minHeight: 620,
    backgroundColor: '#0b1421', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'), partition: 'persist:tmp-camera-desktop' }
  });
  const contents = mainWindow.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    // The setup page is loaded from file://, with no untrusted navigation permitted.
    if (!permitted(url, savedServer())) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!permitted(url, savedServer())) event.preventDefault();
  });
  contents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'fullscreen');
  });
  contents.session.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
  if (server) contents.loadURL(server).catch(() => showSetup());
  else showSetup();
}
function showSetup() { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile(startupPage()); }
app.whenReady().then(() => {
  ipcMain.handle('server:read', () => savedServer());
  ipcMain.handle('server:save', async (_event, candidate) => {
    const origin = parseServer(candidate);
    // Only HTTPS is recommended outside a trusted local network. No TLS bypass.
    writeFileSync(configPath(), JSON.stringify({ server: origin }, null, 2), { mode: 0o600 });
    try { await mainWindow.loadURL(origin); } catch (error) { showSetup(); throw error; }
    return origin;
  });
  ipcMain.handle('server:reset', async () => {
    writeFileSync(configPath(), '{}', { mode: 0o600 });
    showSetup();
    return true;
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'TMP Camera', submenu: [
    { label: 'Server wechseln', accelerator: 'CmdOrCtrl+Shift+S', click: () => showSetup() },
    { role: 'reload', label: 'Ansicht neu laden' },
    { role: 'quit', label: 'Beenden' }
  ] }]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
