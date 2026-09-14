import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoredSession } from '@threadcove/core/types';
import { DeepSeekAgent } from '../src/agent/deepseek-agent.ts';
import type { BackendConfig } from '../src/agent/backend/types.ts';
import { resolveSessionFilePath } from '../src/sessions/file-path.ts';
import { SessionPersistenceQueue } from '../src/sessions/persistence-queue.ts';

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function session(root: string, id = 'same-session', content = 'new content'): StoredSession {
  const now = Date.now();
  return {
    id,
    workspaceRootPath: root,
    createdAt: now,
    lastUsedAt: now,
    workingDirectory: join(root, 'sessions', id),
    messageCount: 1,
    messages: [{ id: randomUUID(), type: 'user', content, timestamp: now }],
  };
}

function targetFile(root: string, id = 'same-session'): string {
  return join(root, 'sessions', id, 'session.jsonl');
}

describe('SessionPersistenceQueue atomic failure handling', () => {
  test('an injected temporary-file write failure preserves old content and remains observable', async () => {
    const root = tempRoot('tc-write-failure-');
    const target = targetFile(root);
    mkdirSync(join(root, 'sessions', 'same-session'), { recursive: true });
    writeFileSync(target, 'old stable content\n');
    const injected = new Error('injected write failure');
    const queue = new SessionPersistenceQueue(60_000, {
      mkdir,
      rename,
      unlink,
      writeFile: async () => { throw injected; },
    });

    queue.enqueue(session(root));
    await expect(queue.flush('same-session', root)).rejects.toBe(injected);
    expect(readFileSync(target, 'utf8')).toBe('old stable content\n');
    await expect(queue.flushAll()).rejects.toBe(injected);
  });

  test('an injected rename failure preserves old content, removes the temp file, and is observable', async () => {
    const root = tempRoot('tc-rename-failure-');
    const dir = join(root, 'sessions', 'same-session');
    const target = targetFile(root);
    mkdirSync(dir, { recursive: true });
    writeFileSync(target, 'old stable content\n');
    const injected = new Error('injected rename failure');
    const queue = new SessionPersistenceQueue(60_000, {
      mkdir,
      writeFile,
      unlink,
      rename: async () => { throw injected; },
    });

    queue.enqueue(session(root));
    await expect(queue.flush('same-session', root)).rejects.toBe(injected);
    expect(readFileSync(target, 'utf8')).toBe('old stable content\n');
    expect(lstatSync(dir).isDirectory()).toBe(true);
    expect(Bun.file(target).size).toBe('old stable content\n'.length);
    expect(readdirSync(dir).filter(name => name.endsWith('.tmp'))).toEqual([]);
    await expect(queue.flushAll()).rejects.toBe(injected);
  });

  test('same session id in different workspaces is queued and written independently', async () => {
    const rootA = tempRoot('tc-workspace-a-');
    const rootB = tempRoot('tc-workspace-b-');
    const queue = new SessionPersistenceQueue(60_000);

    queue.enqueue(session(rootA, 'same-session', 'from workspace A'));
    queue.enqueue(session(rootB, 'same-session', 'from workspace B'));
    expect(queue.pendingCount).toBe(2);
    await queue.flush('same-session');

    expect(readFileSync(targetFile(rootA), 'utf8')).toContain('from workspace A');
    expect(readFileSync(targetFile(rootB), 'utf8')).toContain('from workspace B');
  });
});

describe('resolveSessionFilePath containment', () => {
  function artifactRoot(): { root: string; data: string } {
    const root = tempRoot('tc-artifacts-');
    const data = join(root, 'sessions', 'safe-session', 'data');
    mkdirSync(data, { recursive: true });
    return { root, data };
  }

  test('rejects traversal through either separator, drive paths, and UNC paths', () => {
    const { root, data } = artifactRoot();
    mkdirSync(join(data, 'nested'));
    for (const unsafe of ['../secret.txt', '..\\secret.txt', 'nested\\..\\..\\secret.txt', 'C:\\secret.txt', '\\\\server\\share\\secret.txt']) {
      expect(() => resolveSessionFilePath(root, 'safe-session', unsafe)).toThrow();
    }
  });

  test('rejects symlink or junction traversal', () => {
    const { root, data } = artifactRoot();
    const outside = tempRoot('tc-artifacts-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'outside');
    symlinkSync(outside, join(data, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => resolveSessionFilePath(root, 'safe-session', 'linked/secret.txt')).toThrow(/link/i);
  });

  test('allows normal reads and writes inside data', () => {
    const { root, data } = artifactRoot();
    mkdirSync(join(data, 'reports'));
    const path = resolveSessionFilePath(root, 'safe-session', 'reports/result.txt');
    writeFileSync(path, 'contained artifact');
    expect(readFileSync(resolveSessionFilePath(root, 'safe-session', 'reports/result.txt'), 'utf8')).toBe('contained artifact');
    expect(readFileSync(resolveSessionFilePath(root, 'safe-session', 'reports\\result.txt'), 'utf8')).toBe('contained artifact');
  });
});

type Deferred = { promise: Promise<void>; resolve: () => void };
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

function deepSeekConfig(model = 'model-before'): BackendConfig {
  return {
    provider: 'deepseek',
    workspaceRootPath: tempRoot('tc-deepseek-workspace-'),
    workspaceId: 'workspace-test',
    sessionId: 'session-test',
    workingDirectory: tempRoot('tc-deepseek-cwd-'),
    model,
    apiKey: 'local-fake-key',
  };
}

function sseChunk(content: string, finishReason: string | null = null): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finishReason }] })}\n\n`);
}

describe('DeepSeekAgent local streaming contract', () => {
  test('delivers the first delta before the service finishes', async () => {
    const finish = deferred();
    let serviceFinished = false;
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(sseChunk('first'));
          void finish.promise.then(() => {
            serviceFinished = true;
            controller.enqueue(sseChunk(' tail', 'stop'));
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          });
        },
      }), { headers: { 'content-type': 'text/event-stream' } }),
    });
    const agent = new DeepSeekAgent(deepSeekConfig(), `http://127.0.0.1:${server.port}/v1`);
    const stream = agent.chat('stream now');
    try {
      await expect(stream.next()).resolves.toMatchObject({ value: { type: 'text_delta', text: 'first' } });
      expect(serviceFinished).toBe(false);
      finish.resolve();
      const rest = [];
      for await (const event of stream) rest.push(event);
      expect(rest.some(event => event.type === 'complete')).toBe(true);
    } finally {
      finish.resolve();
      agent.destroy();
      server.stop(true);
    }
  });

  test('abort closes the actual request and never emits complete', async () => {
    const requestAborted = deferred();
    const server = Bun.serve({
      port: 0,
      fetch: request => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(sseChunk('partial'));
          request.signal.addEventListener('abort', () => requestAborted.resolve(), { once: true });
        },
      }), { headers: { 'content-type': 'text/event-stream' } }),
    });
    const agent = new DeepSeekAgent(deepSeekConfig(), `http://127.0.0.1:${server.port}/v1`);
    const events: Array<{ type: string }> = [];
    const consuming = (async () => { for await (const event of agent.chat('keep streaming')) events.push(event); })();
    try {
      while (!events.some(event => event.type === 'text_delta')) await Bun.sleep(1);
      await agent.abort('user_stop');
      await consuming;
      await Promise.race([requestAborted.promise, Bun.sleep(1_000).then(() => { throw new Error('request was not aborted'); })]);
      expect(events.some(event => event.type === 'complete')).toBe(false);
    } finally {
      agent.destroy();
      server.stop(true);
    }
  });

  test('setModel changes the outbound body and restored history is sent verbatim', async () => {
    const bodies: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        bodies.push(await request.json() as typeof bodies[number]);
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });
    const agent = new DeepSeekAgent(deepSeekConfig('model-before'), `http://127.0.0.1:${server.port}/v1`);
    const token = `history-${randomUUID()}`;
    agent.restoreHistory([
      { id: 'history-user', type: 'user', content: token, timestamp: Date.now() },
      { id: 'history-assistant', type: 'assistant', content: 'remembered answer', timestamp: Date.now() },
    ]);
    try {
      for await (const _event of agent.chat('first outbound')) { /* drain */ }
      agent.setModel('model-after');
      for await (const _event of agent.chat('second outbound')) { /* drain */ }

      expect(bodies.map(body => body.model)).toEqual(['model-before', 'model-after']);
      expect(bodies[0]?.messages).toContainEqual({ role: 'user', content: token });
    } finally {
      agent.destroy();
      server.stop(true);
    }
  });
});
