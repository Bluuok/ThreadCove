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

import { WsRpcClient } from '../transport/client.ts';
import { RoutedClient } from '../transport/routed-client.ts';
import { buildClientApi } from '../transport/build-api.ts';
import { CHANNEL_MAP } from '../transport/channel-map.ts';
import type { ElectronAPI } from '../shared/types.ts';

/** Validate a WS URL for plaintext exposure. Throws on violation. */
export function assertSecureWsUrl(url: string): void {
  const parsed = new URL(url);
  let hostname = parsed.hostname;
  // Bracketed IPv6 literals come out of URL.hostname with brackets.
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (parsed.protocol === 'ws:' && !isLocalhost) {
    throw new Error(
      'Refusing to connect to a remote server over unencrypted ws://. ' +
        'Use wss:// (TLS) for non-localhost connections.',
    );
  }
}

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
    return buildClientApi(routed, CHANNEL_MAP, mapCheck);
  }

  return buildClientApi(localClient, CHANNEL_MAP, mapCheck);
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
  return buildClientApi(client, CHANNEL_MAP, (channel) => channel in (CHANNEL_MAP as Record<string, unknown>));
}
