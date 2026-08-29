/**
 * R03 factory tests — provider routing and unknown-provider error.
 */
import { describe, test, expect } from 'bun:test';
import { createBackend, DRIVER_REGISTRY, getProviderDriver } from '../src/agent/backend/factory.ts';
import { ClaudeAgent } from '../src/agent/claude-agent.ts';
import { PiAgent } from '../src/agent/pi-agent.ts';
import type { BackendConfig } from '../src/agent/backend/types.ts';

function makeConfig(provider: BackendConfig['provider']): BackendConfig {
  return {
    provider,
    workspaceRootPath: '/tmp/ws',
    workspaceId: 'ws-1',
    sessionId: 'session-1',
    workingDirectory: '/tmp/ws/session-1',
  };
}

describe('backend factory', () => {
  test('anthropic provider → ClaudeAgent', () => {
    const backend = createBackend(makeConfig('anthropic'));
    expect(backend).toBeInstanceOf(ClaudeAgent);
    expect(backend.getModel()).toBe('claude-sonnet-4-6');
  });

  test('pi provider → PiAgent', () => {
    const backend = createBackend(makeConfig('pi'));
    expect(backend).toBeInstanceOf(PiAgent);
  });

  test('unknown provider throws', () => {
    expect(() => createBackend({ ...makeConfig('anthropic'), provider: 'unknown' as never })).toThrow(
      /Unknown provider/,
    );
  });

  test('driver registry routes both providers', () => {
    expect(DRIVER_REGISTRY['anthropic'].provider).toBe('anthropic');
    expect(DRIVER_REGISTRY['pi'].provider).toBe('pi');
    expect(getProviderDriver('pi').buildRuntime(makeConfig('pi'))['transport']).toBe('jsonl-stdio');
  });

  test('backends expose the unified lifecycle surface', () => {
    const claude = createBackend(makeConfig('anthropic'));
    expect(claude.supportsBranching).toBe(false);
    expect(claude.isProcessing()).toBe(false);
    expect(claude.getPermissionMode()).toBe('ask');
    expect(claude.cyclePermissionMode()).toBe('allow-all');

    claude.setModel('claude-opus-4-8');
    expect(claude.getModel()).toBe('claude-opus-4-8');
    claude.destroy();
  });
});
