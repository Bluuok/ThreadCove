import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@threadcove/core/types';
import type { AgentBackend, BackendConfig, ChatOptions } from '@threadcove/shared/agent';
import { createSession, loadSession, mutateSession } from '@threadcove/shared/sessions';
import { SessionManager } from '../src/server/session-manager.ts';

type Deferred = { promise: Promise<void>; resolve: () => void };
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

interface MockControls {
  release: Deferred;
  chatStarted: Deferred;
  chatCalls: string[];
  abortCalls: string[];
  eventsBeforeWait: AgentEvent[];
  eventsAfterWait: AgentEvent[];
}

function createControls(overrides: Partial<Pick<MockControls, 'eventsBeforeWait' | 'eventsAfterWait'>> = {}): MockControls {
  return {
    release: deferred(),
    chatStarted: deferred(),
    chatCalls: [],
    abortCalls: [],
    eventsBeforeWait: overrides.eventsBeforeWait ?? [],
    eventsAfterWait: overrides.eventsAfterWait ?? [{ type: 'complete' }],
  };
}

function mockBackend(config: BackendConfig, controls: MockControls): AgentBackend {
  let model = config.model ?? 'mock-model';
  return {
    async *chat(message: string, _options?: ChatOptions) {
      controls.chatCalls.push(message);
      controls.chatStarted.resolve();
      for (const event of controls.eventsBeforeWait) yield event;
      await controls.release.promise;
      for (const event of controls.eventsAfterWait) yield event;
    },
    abort: async reason => { controls.abortCalls.push(reason ?? 'user_stop'); controls.release.resolve(); },
    forceAbort: () => controls.release.resolve(),
    interruptForHandoff: () => controls.release.resolve(),
    redirect: () => false,
    runMiniCompletion: async () => 'mock title',
    postInit: async () => ({ authInjected: true }),
    destroy: () => controls.release.resolve(),
    dispose: () => controls.release.resolve(),
    isProcessing: () => controls.chatCalls.length > 0,
    getModel: () => model,
    setModel: next => { model = next; },
    getThinkingLevel: () => 'medium',
    setThinkingLevel: () => {},
    getPermissionMode: () => 'ask',
    setPermissionMode: () => {},
    cyclePermissionMode: () => 'ask',
    getSessionId: () => config.sessionId,
    setSessionId: () => {},
    supportsBranching: false,
    updateWorkingDirectory: () => {},
    respondToPermission: () => {},
    onBackendAuthRequired: null,
    onDebug: null,
  };
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function setup(controls: MockControls, id = 'lifecycle-session') {
  const root = mkdtempSync(join(tmpdir(), 'tc-lifecycle-'));
  roots.push(root);
  const stored = await createSession(root, { id });
  const workspaceId = 'workspace-test';
  const manager = new SessionManager(
    null,
    candidate => candidate === workspaceId ? root : null,
    null,
    config => mockBackend(config, controls),
  );
  manager.registerWorkspace(workspaceId, root);
  manager.createSession({
    workspaceId,
    sessionId: stored.id,
    provider: 'deepseek',
    workingDirectory: stored.workingDirectory!,
  });
  return { root, workspaceId, sessionId: stored.id, manager };
}

describe('SessionManager submitted-run lifecycle', () => {
  test('reserves synchronously so a busy rejection cannot persist a ghost user message', async () => {
    const controls = createControls();
    const { root, workspaceId, sessionId, manager } = await setup(controls);
    const broadcast = () => {};

    const first = manager.submitMessage({ workspaceId, sessionId, message: 'accepted', requestId: 'request-1', broadcast });
    const rejected = manager.submitMessage({ workspaceId, sessionId, message: 'must not persist', requestId: 'request-2', broadcast });
    await expect(rejected).rejects.toThrow('Session is busy');
    await expect(first).resolves.toMatchObject({ accepted: true });
    controls.release.resolve();
    await manager.waitForIdle(workspaceId, sessionId);

    expect(loadSession(root, sessionId)?.messages.filter(message => message.type === 'user').map(message => message.content)).toEqual(['accepted']);
    await manager.shutdown();
  });

  test('deduplicates the same requestId and runs the backend once', async () => {
    const controls = createControls();
    const { root, workspaceId, sessionId, manager } = await setup(controls);
    const opts = { workspaceId, sessionId, message: 'only once', requestId: 'stable-request', broadcast: () => {} };

    const first = manager.submitMessage(opts);
    const duplicate = manager.submitMessage(opts);
    expect(duplicate).toBe(first);
    const [accepted, duplicated] = await Promise.all([first, duplicate]);
    expect(duplicated).toEqual(accepted);
    controls.release.resolve();
    await manager.waitForIdle(workspaceId, sessionId);

    expect(controls.chatCalls).toEqual(['only once']);
    expect(loadSession(root, sessionId)?.messages.filter(message => message.requestId === 'stable-request')).toHaveLength(1);
    await manager.shutdown();
  });

  test('returns acceptance before the backend turn completes', async () => {
    const controls = createControls();
    const { workspaceId, sessionId, manager } = await setup(controls);

    const accepted = await Promise.race([
      manager.submitMessage({ workspaceId, sessionId, message: 'long run', requestId: 'fast-ack', broadcast: () => {} }),
      Bun.sleep(500).then(() => { throw new Error('submitMessage waited for backend completion'); }),
    ]);
    expect(accepted.accepted).toBe(true);
    await controls.chatStarted.promise;
    expect(manager.isProcessing(workspaceId, sessionId)).toBe(true);

    controls.release.resolve();
    await manager.waitForIdle(workspaceId, sessionId);
    await manager.shutdown();
  });

  test('cancellation persists partial assistant text and a cancelled terminal status', async () => {
    const controls = createControls({
      eventsBeforeWait: [{ type: 'text_delta', text: 'durable partial', turnId: 'turn-partial' }],
      eventsAfterWait: [{ type: 'complete' }],
    });
    const { root, workspaceId, sessionId, manager } = await setup(controls);
    const deltaPersisted = deferred();

    await manager.submitMessage({
      workspaceId,
      sessionId,
      message: 'cancel me',
      requestId: 'cancel-request',
      broadcast: event => { if (event.type === 'text_delta') deltaPersisted.resolve(); },
    });
    await deltaPersisted.promise;
    await manager.cancel(workspaceId, sessionId);
    await manager.waitForIdle(workspaceId, sessionId);

    const stored = loadSession(root, sessionId);
    expect(stored?.messages.some(message => message.type === 'assistant' && message.content === 'durable partial')).toBe(true);
    expect(stored?.lastRun).toMatchObject({ requestId: 'cancel-request', status: 'cancelled' });
    expect(controls.abortCalls).toEqual(['user_stop']);
    await manager.shutdown();
  });

  test('workspace recovery converts an orphaned running run to interrupted', async () => {
    const controls = createControls();
    const { root, sessionId, manager } = await setup(controls);
    await mutateSession(root, sessionId, stored => {
      stored.lastRun = { id: 'orphan-run', requestId: 'orphan-request', status: 'running' };
    });

    await manager.recoverWorkspace(root);

    expect(loadSession(root, sessionId)?.lastRun).toEqual({
      id: 'orphan-run',
      requestId: 'orphan-request',
      status: 'interrupted',
    });
    await manager.shutdown();
  });
});
