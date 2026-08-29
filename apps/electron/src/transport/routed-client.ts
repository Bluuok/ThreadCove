/**
 * RoutedClient — dual-client routing (R12).
 *
 * LOCAL_ONLY channels always go to the local client. Everything else goes
 * to the workspace client (which may itself be the local server or a
 * remote one). This is the fork point where "desktop local direct connect"
 * and "web proxied through the server" converge into one API surface.
 */

import type { ListenerFn, RpcClient } from '@threadcove/shared/protocol';
import { LOCAL_ONLY_CHANNELS, REMOTE_ELIGIBLE_CHANNELS } from '@threadcove/shared/protocol';
import type { WsRpcClient } from './client.ts';

export class RoutedClient implements RpcClient {
  constructor(
    private readonly localClient: WsRpcClient,
    private workspaceClient: WsRpcClient,
  ) {}

  /** Swap the workspace client (e.g., after switching to a remote workspace). */
  setWorkspaceClient(client: WsRpcClient): void {
    this.workspaceClient = client;
  }

  /** Which client a channel routes to — exposed for tests and debugging. */
  routeFor(channel: string): 'local' | 'workspace' {
    if (LOCAL_ONLY_CHANNELS.has(channel)) return 'local';
    if (REMOTE_ELIGIBLE_CHANNELS.has(channel)) return 'workspace';
    // Unclassified channels must never ship (routing exhaustiveness test
    // guards the table); at runtime, default to workspace.
    return 'workspace';
  }

  async invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
    const target = this.routeFor(channel) === 'local' ? this.localClient : this.workspaceClient;
    return target.invoke<T>(channel, ...args);
  }

  on(channel: string, listener: ListenerFn): () => void {
    const target = this.routeFor(channel) === 'local' ? this.localClient : this.workspaceClient;
    return target.on(channel, listener);
  }
}
