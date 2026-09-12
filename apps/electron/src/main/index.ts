import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { startRuntime } from '../server/runtime.ts';
let runtime: Awaited<ReturnType<typeof startRuntime>>;
let closing = false;
function createWindow() {
  const win = new BrowserWindow({ width: 1380, height: 900, minWidth: 760, minHeight: 600, backgroundColor: '#f6f5ef',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  if (process.env['THREADCOVE_DEV_URL']) void win.loadURL(process.env['THREADCOVE_DEV_URL']);
  else void win.loadFile(join(__dirname, 'renderer', 'index.html'));
}
app.whenReady().then(async () => {
  runtime = await startRuntime({ root: process.env['THREADCOVE_WORKSPACE'] ?? join(app.getPath('userData'), 'workspace'), origins: ['file://', ...(process.env['THREADCOVE_DEV_URL'] ? [new URL(process.env['THREADCOVE_DEV_URL']).origin] : [])] });
  ipcMain.on('threadcove:bootstrap', event => {
    if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) return;
    event.returnValue = { localUrl: runtime.url, token: runtime.token, workspaceId: runtime.workspaceId };
  });
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  if (closing || !runtime) return;
  event.preventDefault(); closing = true;
  void runtime.close().then(() => app.quit(), error => { console.error(error); app.exit(1); });
});
