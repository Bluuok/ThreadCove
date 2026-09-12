/**
 * Preload bootstrap (R12).
 *
 * Replaces a hand-written IPC preload bridge. Builds the renderer's
 * ElectronAPI at runtime from WsRpcClient + RoutedClient + CHANNEL_MAP.
 *
 * Normal mode:   RoutedClient — LOCAL_ONLY → local WS server,
 *                REMOTE_ELIGIBLE → workspace server (local in Gate 0).
 * Thin-client:   CRAFT_SERVER_URL set → single client, all channels remote.
 *
 * Security: refuses unencrypted ws:// to non-localhost servers — the
 * handshake token would cross the wire in cleartext.
 */

import { WsRpcClient } from './client.ts';
import { RoutedClient } from './routed-client.ts';
import { buildClientApi } from './build-api.ts';
import { CHANNEL_MAP } from './channel-map.ts';
import type { ElectronAPI } from './types.ts';

import { assertSecureWsUrl } from '@threadcove/shared/protocol';
export { assertSecureWsUrl };

export interface BootstrapOptions {
  /** Local server URL (e.g. ws://127.0.0.1:PORT). */
  localUrl: string;
  /** Handshake token for the local server. */
  token: string;
  /** Active workspace ID. */
  workspaceId: string;
  /** Optional remote workspace server URL (thin-client / remote workspace). */
  remoteUrl?: string;
  /** Token for the remote server. */
  remoteToken?: string;
}

export function bootstrapClientApi(options: BootstrapOptions): ElectronAPI {
  assertSecureWsUrl(options.localUrl);

  if (options.remoteUrl) assertSecureWsUrl(options.remoteUrl);
  const localClient = new WsRpcClient(options.localUrl, {
    token: options.token,
    workspaceId: options.workspaceId,
    autoReconnect: true,
  });
  localClient.connect();

  const mapCheck = (channel: string): boolean => channel in (CHANNEL_MAP as Record<string, unknown>);

  if (options.remoteUrl) {
    assertSecureWsUrl(options.remoteUrl);
    const remoteClient = new WsRpcClient(options.remoteUrl, {
      token: options.remoteToken ?? '',
      workspaceId: options.workspaceId,
      autoReconnect: true,
    });
    remoteClient.connect();
    const routed = new RoutedClient(localClient, remoteClient);
    return withLifecycle(buildClientApi(routed, CHANNEL_MAP, mapCheck), [localClient, remoteClient]);
  }

  return withLifecycle(buildClientApi(localClient, CHANNEL_MAP, mapCheck), [localClient]);
}

/**
 * Thin-client mode: a single WsRpcClient — every channel, LOCAL_ONLY
 * included, goes to the remote server. Used when CRAFT_SERVER_URL is set.
 */
export function bootstrapThinClientApi(serverUrl: string, token: string, workspaceId?: string): ElectronAPI {
  assertSecureWsUrl(serverUrl);
  const client = new WsRpcClient(serverUrl, {
    token,
    workspaceId,
    autoReconnect: true,
  });
  client.connect();
  return withLifecycle(buildClientApi(client, CHANNEL_MAP), [client]);
}

export function withLifecycle(api: ElectronAPI, clients: WsRpcClient[]): ElectronAPI {
  const state = () => clients.every(client => client.connectionState === 'connected') ? 'connected' as const : clients.find(client => client.connectionState !== 'connected')!.connectionState;
  return Object.assign(api, {
    ready: async () => { await Promise.all(clients.map(client => client.ready())); },
    getConnectionState: state,
    onConnectionStateChanged: (listener: (value: ReturnType<typeof state>) => void) => {
      const unsubscribe = clients.map(client => client.onConnectionStateChanged(() => listener(state())));
      return () => unsubscribe.forEach(fn => fn());
    },
    dispose: () => clients.forEach(client => client.disconnect()),
  });
}
