import { bootstrapThinClientApi } from '@threadcove/shared/client';
import type { ElectronAPI } from '@threadcove/shared/client';
export interface WebApiOptions { serverUrl: string; token?: string; workspaceId?: string }
export function createWebApi(options: WebApiOptions): ElectronAPI {
  const api = bootstrapThinClientApi(options.serverUrl, options.token ?? '', options.workspaceId);
  return Object.assign(api, {
    openFileDialog: async () => { throw new Error('Browser file imports are not implemented. Use the session artifact directory.'); },
    openExternal: async (url: string) => {
      if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error('Unsupported URL');
      return { opened: Boolean(window.open(url, '_blank', 'noopener,noreferrer')) };
    },
  });
}
