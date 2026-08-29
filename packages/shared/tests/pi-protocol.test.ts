/**
 * Pi JSONL protocol integration tests (R03) — mock subprocess.
 *
 * Uses a scripted mock child process to exercise the full protocol:
 * init→ready handshake, prompt→event sequence through the EventQueue,
 * tool_execute_request→host execution→response roundtrip, abort, and
 * bad-JSONL tolerance.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { PiAgent } from '../src/agent/pi-agent.ts';
import type { AgentEvent } from '@threadcove/core/types';

const MOCK_SERVER = join(import.meta.dir, 'fixtures', 'mock-pi-server.ts');

describe('PiAgent JSONL protocol (mock subprocess)', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tc-pi-'));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeAgent(): PiAgent {
    return new PiAgent(
      {
        provider: 'pi',
        workspaceRootPath: tempDir,
        workspaceId: 'ws-test',
        sessionId: 'session-test',
        workingDirectory: tempDir,
        apiKey: 'test-key',
      },
      MOCK_SERVER,
    );
  }

  test('init→ready handshake and prompt event sequence flows through the queue', async () => {
    const agent = makeAgent();
    await agent.postInit();

    const events: AgentEvent[] = [];
    for await (const event of agent.chat('hello')) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain('text_delta');
    expect(types).toContain('text_complete');
    expect(types).toContain('complete');

    const delta = events.find((e) => e.type === 'text_delta') as Extract<AgentEvent, { type: 'text_delta' }>;
    expect(delta.text).toBe('mock response');

    agent.destroy();
  }, 20_000);

  test('tool_execute_request roundtrips to the host executor', async () => {
    const agent = makeAgent();
    const executed: Array<{ tool: string; args: Record<string, unknown> }> = [];
    agent.setToolExecutor(async (toolName, args) => {
      executed.push({ tool: toolName, args });
      return { content: 'host executed', isError: false };
    });
    await agent.postInit();

    const events: AgentEvent[] = [];
    for await (const event of agent.chat('use the tool')) {
      events.push(event);
    }

    expect(executed).toHaveLength(1);
    expect(executed[0]?.tool).toBe('mcp__test__search');
    expect(executed[0]?.args).toEqual({ query: 'test' });

    const result = events.find((e) => e.type === 'tool_result') as Extract<AgentEvent, { type: 'tool_result' }>;
    expect(result.result).toBe('host executed');

    agent.destroy();
  }, 20_000);

  test('tool executor failure returns isError result to the child', async () => {
    const agent = makeAgent();
    agent.setToolExecutor(async () => {
      throw new Error('source unreachable');
    });
    await agent.postInit();

    const events: AgentEvent[] = [];
    for await (const event of agent.chat('fail the tool')) {
      events.push(event);
    }

    const result = events.find((e) => e.type === 'tool_result') as Extract<AgentEvent, { type: 'tool_result' }>;
    expect(result.isError).toBe(true);
    expect(result.result).toContain('source unreachable');

    agent.destroy();
  }, 20_000);

  test('redirect while streaming returns true (native steering)', async () => {
    const agent = makeAgent();
    await agent.postInit();

    const consumed = (async () => {
      const events: AgentEvent[] = [];
      for await (const event of agent.chat('long stream')) {
        events.push(event);
      }
      return events;
    })();

    // While the stream is in flight, redirect should steer, not abort.
    await new Promise((r) => setTimeout(r, 100));
    expect(agent.isProcessing()).toBe(true);
    expect(agent.redirect('change direction')).toBe(true);

    const events = await consumed;
    expect(events.length).toBeGreaterThan(0);
    agent.destroy();
  }, 20_000);

  test('redirect while idle returns false and does not throw', async () => {
    const agent = makeAgent();
    await agent.postInit();
    expect(agent.redirect('nobody home')).toBe(false);
    agent.destroy();
  }, 20_000);

  test('bad JSONL lines from the child do not break the stream', async () => {
    const agent = makeAgent();
    await agent.postInit();

    const events: AgentEvent[] = [];
    for await (const event of agent.chat('trigger bad lines')) {
      events.push(event);
    }

    // The mock emits garbage lines between valid events; the stream survives.
    expect(types(events)).toContain('text_complete');
    expect(types(events)).toContain('complete');
    agent.destroy();
  }, 20_000);

  test('abort stops the stream early', async () => {
    const agent = makeAgent();
    await agent.postInit();

    const events: AgentEvent[] = [];
    const consumed = (async () => {
      for await (const event of agent.chat('long stream')) {
        events.push(event);
      }
    })();

    await new Promise((r) => setTimeout(r, 100));
    await agent.abort('user_stop');
    await consumed;

    // Abort closes the queue: some deltas arrived, the stream terminated
    // cleanly, and the mock's later chunks never showed up.
    expect(types(events)).toContain('text_delta');
    expect(events.filter((e) => e.type === 'text_delta').length).toBeLessThan(3);
    agent.destroy();
  }, 20_000);
});

function types(events: AgentEvent[]): string[] {
  return events.map((e) => e.type);
}
