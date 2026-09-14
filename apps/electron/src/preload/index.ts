import { contextBridge, ipcRenderer } from 'electron';
import { bootstrapClientApi } from './bootstrap.ts';
import type { BootstrapOptions } from './bootstrap.ts';

const options = ipcRenderer.sendSync('threadcove:bootstrap') as BootstrapOptions;
const api = bootstrapClientApi(options);
contextBridge.exposeInMainWorld('threadcove', api);
window.addEventListener('unload', () => api.dispose());
