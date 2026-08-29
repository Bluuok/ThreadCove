/**
 * ThreadCove — Electron main process entry.
 *
 * Gate 0 scope: create the BrowserWindow with the WS-mode preload and load
 * the renderer. The embedded WsRpcServer + session handlers boot here in
 * Gate 4 (R12 server-side integration) — the transport layer is already
 * implemented and tested standalone under src/transport/.
 */

import { app, BrowserWindow } from 'electron';
import { join } from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env['THREADCOVE_DEV_URL']) {
    void mainWindow.loadURL(process.env['THREADCOVE_DEV_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
