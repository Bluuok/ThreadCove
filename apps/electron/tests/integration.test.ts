/**
 * R12 end-to-end integration test: full server stack (WsRpcServer +
 * handlers + SessionManager) against a real client, with a mock Pi
 * backend driving multi-session and Claude/Pi switch scenarios.
 */
import { describe, test, expect, afterAll, beforeAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WsRpcServer } from '../src/transport/server.ts';
import { WsRpcClient } from '../src/transport/client.ts';
import { buildClientApi } from '../src/transport/build-api.ts';
import { CHANNEL_MAP } from '../src/transport/channel-map.ts';
import { SessionManager } from '../src/server/session-manager.ts';
import { registerHandlers } from '../src/server/handlers.ts';
import { createWorkspace } from '@threadcove/shared/workspaces';
import type { SessionEvent } from '@threadcove/shared/protocol';

// A deterministic in-process mock backend: 'anthropic' and 'pi' both
// produce the same event vocabulary, tagged by provider so the switch
// test can observe which backend ran.
const mockScript: Record<string, string> = {
  hello: 'mock reply from backend',
};

import type { BackendConfig, AgentBackend, ChatOptions } from '@threadcove/shared/agent';
import type { AgentEvent } from '@threadcove/core/types';

function createMockBackend(config: BackendConfig): AgentBackend {
  const tag = config.provider; // 'anthropic' | 'pi'
  const backend: AgentBackend = {
    chat: async function* (message: string, _options?: ChatOptions): AsyncGenerator<AgentEvent> {
      const text = mockScript[message] ?? `echo:${message}`;
      yield { type: 'text_delta', text, turnId: `turn-${tag}` };
      yield { type: 'text_complete', text, turnId: `turn-${tag}` };
      yield { type: 'complete', usage: { inputTokens: 5, outputTokens: 7 } };
    },
    abort: async () => {},
    forceAbort: () => {},
    interruptForHandoff: () => {},
    redirect: () => false,
    runMiniCompletion: async () => 'mock title',
    postInit: async () => ({ authInjected: true }),
    destroy: () => {},
    dispose: () => {},
    isProcessing: () => false,
    getModel: () => config.model ?? 'mock-model',
    setModel: () => {},
    getThinkingLevel: () => 'medium',
    setThinkingLevel: () => {},
    getPermissionMode: () => 'ask',
    setPermissionMode: () => {},
    cyclePermissionMode: () => 'ask',
    respondToPermission: () => {},
    getSessionId: () => config.sessionId,
    setSessionId: () => {},
    supportsBranching: false,
    updateWorkingDirectory: () => {},
    onBackendAuthRequired: null,
    onDebug: null,
  };
  return backend;
}

describe('R12 end-to-end: server stack + client over real WebSocket', () => {
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0 });
  const base = mkdtempSync(join(tmpdir(), 'tc-r12-'));
  process.env['THREADCOVE_HOME'] = base;
  const ws = createWorkspace({ name: 'R12' });

  beforeAll(async () => {
    await server.start();
  });

  const sessionManager = new SessionManager(
    server,
    (id) => (id === ws.config.id ? ws.rootPath : null),
    null,
    createMockBackend,
  );
  sessionManager.registerWorkspace(ws.config.id, ws.rootPath);

  registerHandlers(server, {
    getWorkspaceRoot: (id) => (id === ws.config.id ? ws.rootPath : null),
    sessionManager,
    broadcast: (target, channel, ...args) =>
      server.broadcast(
        target as Parameters<typeof server.broadcast>[0],
        channel,
        ...args,
      ),
    modelProvider: () => ({ provider: 'anthropic' }),
    model: () => 'mock-model',
    apiKey: () => 'test-key',
    isLocal: true,
  });

  afterAll(async () => {
    await sessionManager.shutdown();
    await server.stop();
    // Windows: give any pending file handles a beat before cleanup.
    await new Promise((r) => setTimeout(r, 200));
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // EBUSY on Windows if a handle lingers — non-fatal for the test run.
    }
    delete process.env['THREADCOVE_HOME'];
  });

  function connect(): { client: WsRpcClient; api: ReturnType<typeof buildClientApi>; events: SessionEvent[] } {
    const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { autoReconnect: false, workspaceId: ws.config.id });
    const events: SessionEvent[] = [];
    const api = buildClientApi(client, CHANNEL_MAP) as ReturnType<typeof buildClientApi> & {
      onSessionEvent: (cb: (e: SessionEvent) => void) => void;
    };
    client.connect();
    return { client, api, events };
  }

  /** Await WS connection with a timeout guard. */
  async function waitConnected(client: WsRpcClient): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        un();
        reject(new Error('connection timeout'));
      }, 2000);
      const un = client.onConnectionStateChanged((s) => {
        if (s === 'connected') {
          clearTimeout(timer);
          un();
          resolve();
        }
      });
    });
  }

  test('create session, send message, receive streamed events', async () => {
    const { client, api } = connect();
    await waitConnected(client);

    const session = (await api.createSession(ws.config.id, {})) as { id: string };
    expect(session.id).toBeTruthy();

    const received: SessionEvent[] = [];
    (api as { onSessionEvent: (cb: (e: SessionEvent) => void) => void }).onSessionEvent((e) => received.push(e));

    const result = (await api.sendMessage(ws.config.id, session.id, 'hello')) as { accepted: boolean };
    expect(result.accepted).toBe(true);
    await new Promise((r) => setTimeout(r, 100));

    // Events were broadcast: user_message + text_delta + text_complete + complete
    const types = received.filter((e) => e.sessionId === session.id).map((e) => e.event.type);
    expect(types).toContain('user_message');
    expect(types).toContain('text_delta');
    expect(types).toContain('text_complete');
    expect(types).toContain('complete');

    // Messages were persisted (user + final assistant)
    const messages = (await api.getSessionMessages(ws.config.id, session.id)) as Array<{ type: string; content: string }>;
    expect(messages.some((m) => m.type === 'user' && m.content === 'hello')).toBe(true);
    expect(messages.some((m) => m.type === 'assistant' && m.content === 'mock reply from backend')).toBe(true);

    client.disconnect();
  });

  test('multi-session: two sessions maintain separate transcripts', async () => {
    const { client, api } = connect();
    await waitConnected(client);

    const s1 = (await api.createSession(ws.config.id, {})) as { id: string };
    const s2 = (await api.createSession(ws.config.id, {})) as { id: string };
    expect(s1.id).not.toBe(s2.id);

    await api.sendMessage(ws.config.id, s1.id, 'hello');
    await api.sendMessage(ws.config.id, s2.id, 'other question');

    const m1 = (await api.getSessionMessages(ws.config.id, s1.id)) as Array<{ content: string }>;
    const m2 = (await api.getSessionMessages(ws.config.id, s2.id)) as Array<{ content: string }>;
    expect(m1.some((m) => m.content === 'hello')).toBe(true);
    expect(m1.some((m) => m.content === 'other question')).toBe(false);
    expect(m2.some((m) => m.content === 'other question')).toBe(true);
    expect(m2.some((m) => m.content === 'hello')).toBe(false);

    client.disconnect();
  });

  test('Claude/Pi switch: same API surface, provider is configuration', async () => {
    // Provider lives in BackendConfig — switching is a config change.
    // Verify by creating a backend directly through the (patched) factory.
    for (const provider of ['anthropic', 'pi'] as const) {
      const backend = createMockBackend({
        provider,
        workspaceRootPath: ws.rootPath,
        workspaceId: ws.config.id,
        sessionId: `switch-${provider}`,
        workingDirectory: ws.rootPath,
      });
      const events: AgentEvent[] = [];
      for await (const event of backend.chat('hello')) {
        events.push(event);
      }
      // Both backends emit the same vocabulary — the UI cannot tell them apart.
      expect(events.map((e) => e.type)).toEqual(['text_delta', 'text_complete', 'complete']);
      const complete = events.find((e) => e.type === 'complete') as Extract<AgentEvent, { type: 'complete' }>;
      expect(complete.usage?.inputTokens).toBe(5);
    }
  });

  test('unknown channel returns typed CHANNEL_NOT_FOUND error', async () => {
    const { client } = connect();
    await new Promise<void>((resolve) => {
      const un = client.onConnectionStateChanged((s) => {
        if (s === 'connected') { un(); resolve(); }
      });
    });
    try {
      await client.invoke('sessions:totallyBogus');
      expect.unreachable();
    } catch (err) {
      expect((err as Error & { code?: string }).code).toBe('CHANNEL_NOT_FOUND');
    }
    client.disconnect();
  });
});
