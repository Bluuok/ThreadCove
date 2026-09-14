import { describe, expect, test } from 'bun:test';
import WebSocket from 'ws';
import { RPC_CHANNELS, assertSecureWsUrl } from '@threadcove/shared/protocol';
import { withLifecycle } from '@threadcove/shared/client';
import { buildClientApi } from '../src/transport/build-api.ts';
import { CHANNEL_MAP } from '../src/transport/channel-map.ts';
import { WsRpcClient } from '../src/transport/client.ts';
import { WsRpcServer } from '../src/transport/server.ts';

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out');
    await Bun.sleep(5);
  }
}

function openWithOrigin(url: string, origin: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Origin: origin } });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function expectOriginRejected(url: string, origin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Origin: origin } });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('origin rejection timed out'));
    }, 1_000);
    socket.once('open', () => {
      clearTimeout(timer);
      socket.terminate();
      reject(new Error('disallowed origin connected'));
    });
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      response.resume();
      resolve();
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('WebSocket endpoint security', () => {
  test('rejects plaintext remote paths and localhost-lookalike subdomains', () => {
    for (const url of [
      'ws://example.test/private/socket',
      'ws://localhost.example.test/socket',
      'ws://example.localhost/socket',
    ]) {
      expect(() => assertSecureWsUrl(url)).toThrow(/unencrypted/i);
    }
  });

  test('allows loopback IPv6 and secure remote paths', () => {
    expect(() => assertSecureWsUrl('ws://[::1]:4312/socket')).not.toThrow();
    expect(() => assertSecureWsUrl('wss://example.test/private/socket')).not.toThrow();
  });

  test('rejects non-WebSocket protocols', () => {
    for (const url of ['http://localhost:4312/socket', 'https://example.test/socket', 'ftp://localhost/socket']) {
      expect(() => assertSecureWsUrl(url)).toThrow(/invalid WebSocket URL/i);
    }
  });

  test('server accepts only origins on its allowlist', async () => {
    const allowedOrigin = 'https://desktop.threadcove.test';
    const server = new WsRpcServer({ host: '127.0.0.1', port: 0, allowedOrigins: [allowedOrigin] });
    await server.start();
    const url = `ws://127.0.0.1:${server.port}`;
    let allowed: WebSocket | undefined;
    try {
      allowed = await openWithOrigin(url, allowedOrigin);
      expect(allowed.readyState).toBe(WebSocket.OPEN);
      await expectOriginRejected(url, 'https://attacker.example');
    } finally {
      allowed?.terminate();
      await server.stop();
    }
  });
});

describe('WebSocket authentication and workspace isolation', () => {
  test('bad handshake token is fatal even with autoReconnect enabled', async () => {
    let validationCalls = 0;
    const server = new WsRpcServer({
      host: '127.0.0.1',
      port: 0,
      requireAuth: true,
      validateToken: token => { validationCalls++; return token === 'valid-local-token'; },
    });
    await server.start();
    const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, {
      token: 'invalid-local-token',
      autoReconnect: true,
    });
    try {
      client.connect();
      const ready = client.ready();
      await expect(ready).rejects.toMatchObject({ code: 'AUTH_FAILED' });
      await Bun.sleep(1_100);
      expect(client.connectionState).toBe('failed');
      expect(validationCalls).toBe(1);
      expect(server.clientCount).toBe(0);
    } finally {
      client.disconnect();
      await server.stop();
    }
  });

  test('workspace requests cannot cross scopes and directed broadcasts stay isolated', async () => {
    const server = new WsRpcServer({ host: '127.0.0.1', port: 0 });
    server.handle(RPC_CHANNELS.sessions.GET, workspaceId => [{ id: 'visible', workspaceId }]);
    await server.start();
    const url = `ws://127.0.0.1:${server.port}`;
    const clientA = new WsRpcClient(url, { workspaceId: 'workspace-a', autoReconnect: false });
    const clientB = new WsRpcClient(url, { workspaceId: 'workspace-b', autoReconnect: false });
    const eventsA: unknown[] = [];
    const eventsB: unknown[] = [];
    clientA.on(RPC_CHANNELS.session.EVENT, event => eventsA.push(event));
    clientB.on(RPC_CHANNELS.session.EVENT, event => eventsB.push(event));
    try {
      clientA.connect();
      clientB.connect();
      await Promise.all([clientA.ready(), clientB.ready()]);
      expect(server.clientCount).toBe(2);

      await expect(clientA.invoke(RPC_CHANNELS.sessions.GET, 'workspace-b')).rejects.toMatchObject({ code: 'AUTH_FAILED' });
      await expect(clientA.invoke(RPC_CHANNELS.sessions.GET, 'workspace-a')).resolves.toEqual([
        { id: 'visible', workspaceId: 'workspace-a' },
      ]);

      server.broadcast(
        { to: 'workspace', workspaceId: 'workspace-a' },
        RPC_CHANNELS.session.EVENT,
        { workspaceId: 'workspace-a', marker: 'only-a' },
      );
      await waitFor(() => eventsA.length === 1);
      await Bun.sleep(30);
      expect(eventsA).toEqual([{ workspaceId: 'workspace-a', marker: 'only-a' }]);
      expect(eventsB).toEqual([]);
    } finally {
      clientA.disconnect();
      clientB.disconnect();
      await server.stop();
    }
  });
});

describe('client ready/dispose lifecycle', () => {
  test('ready resolves after handshake and dispose makes later ready calls reject', async () => {
    const server = new WsRpcServer({ host: '127.0.0.1', port: 0 });
    server.handle(RPC_CHANNELS.server.GET_STATUS, () => ({ version: 'test', workspaceCount: 1 }));
    await server.start();
    const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { autoReconnect: false });
    const api = withLifecycle(buildClientApi(client, CHANNEL_MAP), [client]);
    try {
      client.connect();
      await expect(api.ready()).resolves.toBeUndefined();
      expect(api.getConnectionState()).toBe('connected');
      await expect(api.getStatus()).resolves.toEqual({ version: 'test', workspaceCount: 1 });

      api.dispose();
      expect(api.getConnectionState()).toBe('disconnected');
      await expect(api.ready()).rejects.toThrow(/connection failed/i);
      await waitFor(() => server.clientCount === 0);
    } finally {
      api.dispose();
      await server.stop();
    }
  });
});
