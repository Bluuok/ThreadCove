/**
 * R12 server/client integration tests — WsRpcServer + WsRpcClient over a
 * real localhost WebSocket, plus the plaintext ws:// guard.
 */
import { describe, test, expect, afterAll } from 'bun:test';
import { WsRpcServer } from '../src/transport/server.ts';
import { WsRpcClient } from '../src/transport/client.ts';
import { RoutedClient } from '../src/transport/routed-client.ts';
import { buildClientApi } from '../src/transport/build-api.ts';
import { RPC_CHANNELS } from '@threadcove/shared/protocol';
import type { ElectronAPI } from '../src/shared/types.ts';

describe('WsRpcServer / WsRpcClient', () => {
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: false });
  let serverUrl = '';

  afterAll(async () => {
    await server.stop();
  });

  test('server starts, registers handlers, dispatches requests', async () => {
    await server.start();
    serverUrl = `ws://127.0.0.1:${server.port}`;
    expect(server.port).toBeGreaterThan(0);

    server.handle(RPC_CHANNELS.sessions.GET, (...args: unknown[]) => {
      const workspaceId = args[0] as string;
      return [{ id: 's1', workspaceId }];
    });
    // Duplicate registration throws.
    expect(() => server.handle(RPC_CHANNELS.sessions.GET, () => null)).toThrow(/already registered/);

    const client = new WsRpcClient(serverUrl, { autoReconnect: false, workspaceId: 'ws-1' });
    client.connect();
    await new Promise<void>((resolve) => {
      const un = client.onConnectionStateChanged((s) => {
        if (s === 'connected') {
          un();
          resolve();
        }
      });
    });

    const sessions = await client.invoke(RPC_CHANNELS.sessions.GET, 'ws-1');
    expect(sessions).toEqual([{ id: 's1', workspaceId: 'ws-1' }]);

    // Unknown channel produces a typed error code.
    try {
      await client.invoke('sessions:bogus');
      expect.unreachable();
    } catch (err) {
      expect((err as Error & { code?: string }).code).toBe('CHANNEL_NOT_FOUND');
    }

    client.disconnect();
  });

  test('handshake token auth rejects bad tokens', async () => {
    const authServer = new WsRpcServer({
      host: '127.0.0.1',
      port: 0,
      requireAuth: true,
      validateToken: (t) => t === 'good-token',
    });
    await authServer.start();
    expect(authServer.port).toBeGreaterThan(0);

    const badClient = new WsRpcClient(`ws://127.0.0.1:${authServer.port}`, {
      token: 'bad',
      autoReconnect: false,
    });
    badClient.connect();
    await new Promise((r) => setTimeout(r, 200));
    expect(badClient.connectionState).not.toBe('connected');
    badClient.disconnect();

    const goodClient = new WsRpcClient(`ws://127.0.0.1:${authServer.port}`, {
      token: 'good-token',
      autoReconnect: false,
    });
    goodClient.connect();
    await new Promise<void>((resolve) => {
      const un = goodClient.onConnectionStateChanged((s) => {
        if (s === 'connected') {
          un();
          resolve();
        }
      });
    });
    expect(goodClient.connectionState).toBe('connected');
    goodClient.disconnect();

    await authServer.stop();
  });

  test('broadcast delivers typed events to subscribed clients', async () => {
    const pushServer = new WsRpcServer({ host: '127.0.0.1', port: 0 });
    await pushServer.start();

    const client = new WsRpcClient(`ws://127.0.0.1:${pushServer.port}`, { autoReconnect: false });
    const received: unknown[] = [];
    const un = client.on(RPC_CHANNELS.session.EVENT, (payload) => received.push(payload));
    client.connect();
    await new Promise<void>((resolve) => {
      const un2 = client.onConnectionStateChanged((s) => {
        if (s === 'connected') {
          un2();
          resolve();
        }
      });
    });

    // Let the subscription register before broadcasting.
    await new Promise((r) => setTimeout(r, 50));
    pushServer.broadcast(
      { to: 'all' },
      RPC_CHANNELS.session.EVENT,
      { sessionId: 's1', event: { type: 'text_delta', text: 'hello' } },
    );
    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(1);
    const payload = received[0] as { sessionId: string; event: { type: string; text: string } };
    expect(payload.sessionId).toBe('s1');
    expect(payload.event.type).toBe('text_delta');

    un();
    client.disconnect();
    await pushServer.stop();
  });
});

describe('RoutedClient', () => {
  test('LOCAL_ONLY routes to the local client, workspace content to the workspace client', () => {
    // Build two clients pointed at the same local server for routing checks.
    const localClient = new WsRpcClient('ws://127.0.0.1:1', { autoReconnect: false });
    const remoteClient = new WsRpcClient('ws://127.0.0.1:2', { autoReconnect: false });
    const routed = new RoutedClient(localClient, remoteClient);

    expect(routed.routeFor(RPC_CHANNELS.dialog.OPEN_FILE)).toBe('local');
    expect(routed.routeFor(RPC_CHANNELS.system.OPEN_EXTERNAL)).toBe('local');
    expect(routed.routeFor(RPC_CHANNELS.sessions.SEND_MESSAGE)).toBe('workspace');
    expect(routed.routeFor(RPC_CHANNELS.sources.LIST)).toBe('workspace');
  });
});

describe('buildClientApi', () => {
  test('generates a working ElectronAPI surface from CHANNEL_MAP', async () => {
    const { CHANNEL_MAP } = await import('../src/transport/channel-map.ts');
    const apiServer = new WsRpcServer({ host: '127.0.0.1', port: 0 });
    await apiServer.start();

    apiServer.handle(RPC_CHANNELS.server.GET_STATUS, () => ({ version: '0.1.0', workspaceCount: 2 }));

    const client = new WsRpcClient(`ws://127.0.0.1:${apiServer.port}`, { autoReconnect: false });
    client.connect();
    await new Promise<void>((resolve) => {
      const un = client.onConnectionStateChanged((s) => {
        if (s === 'connected') {
          un();
          resolve();
        }
      });
    });

    const api = buildClientApi(client, CHANNEL_MAP) as ElectronAPI & { isChannelAvailable: () => boolean };
    const status = await api.getStatus();
    expect(status).toEqual({ version: '0.1.0', workspaceCount: 2 });
    expect(api.isChannelAvailable()).toBe(true);

    client.disconnect();
    await apiServer.stop();
  });
});
