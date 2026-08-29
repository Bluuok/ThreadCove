/**
 * WebUI adapter (R12) — the physical evidence of "multi-client reuse".
 *
 * Reuses the SAME WsRpcClient + buildClientApi + CHANNEL_MAP + ElectronAPI
 * types as the Electron app. Only LOCAL_ONLY methods are overridden with
 * web equivalents (file dialog → input[type=file], shell.openExternal →
 * window.open). The thickness of this file IS the point: everything else
 * is shared, not duplicated.
 */

import { WsRpcClient } from '../../../electron/src/transport/client.ts';
import { buildClientApi } from '../../../electron/src/transport/build-api.ts';
import { CHANNEL_MAP } from '../../../electron/src/transport/channel-map.ts';
import type { ElectronAPI } from '../../../electron/src/shared/types.ts';

export interface WebApiOptions {
  /** WebSocket server URL (ws:// for localhost; wss:// for remote). */
  serverUrl: string;
  /** Handshake token (empty for cookie-authenticated local servers). */
  token?: string;
  /** Workspace advertised on handshake. */
  workspaceId?: string;
}

/** Web file picker replaces the native Electron dialog. */
function webFilePicker(): Promise<{ paths: string[] }> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = () => {
      const files = input.files;
      if (!files || files.length === 0) {
        resolve({ paths: [] });
        return;
      }
      resolve({ paths: Array.from(files).map((f) => f.name) });
    };
    input.oncancel = () => resolve({ paths: [] });
    input.click();
  });
}

/**
 * Build the web API. LOCAL_ONLY overrides are applied on top of the
 * generated proxy; everything else routes to the server untouched.
 */
export function createWebApi(options: WebApiOptions): ElectronAPI {
  const isLocalhost =
    options.serverUrl.includes('localhost') || options.serverUrl.includes('127.0.0.1');
  if (options.serverUrl.startsWith('ws:') && !isLocalhost) {
    throw new Error(
      'Refusing to connect to a remote server over unencrypted ws://. Use wss://.',
    );
  }

  const client = new WsRpcClient(options.serverUrl, {
    token: options.token ?? '',
    workspaceId: options.workspaceId,
    autoReconnect: true,
  });
  client.connect();

  const base = buildClientApi(client, CHANNEL_MAP) as ElectronAPI;

  return {
    ...base,
    // LOCAL_ONLY override: native file dialog → web file input.
    openFileDialog: () => webFilePicker(),
    // LOCAL_ONLY override: shell.openExternal → window.open.
    openExternal: (url: string) => {
      window.open(url, '_blank', 'noopener');
      return Promise.resolve({ opened: true });
    },
  } as ElectronAPI;
}
