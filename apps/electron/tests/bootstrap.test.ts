/**
 * Bootstrap tests — plaintext ws:// rejection and API generation.
 */
import { describe, test, expect } from 'bun:test';
import { assertSecureWsUrl, bootstrapClientApi, bootstrapThinClientApi } from '../src/preload/bootstrap.ts';
import type { ElectronAPI } from '../src/shared/types.ts';

describe('plaintext ws:// guard (MUST)', () => {
  test('ws:// to localhost is allowed', () => {
    expect(() => assertSecureWsUrl('ws://localhost:3000')).not.toThrow();
    expect(() => assertSecureWsUrl('ws://127.0.0.1:3000')).not.toThrow();
    expect(() => assertSecureWsUrl('ws://[::1]:3000')).not.toThrow();
  });

  test('ws:// to a remote host is refused', () => {
    expect(() => assertSecureWsUrl('ws://example.com:3000')).toThrow(/unencrypted/);
    expect(() => assertSecureWsUrl('ws://192.168.1.10:3000')).toThrow(/Refusing/);
  });

  test('wss:// to any host is allowed', () => {
    expect(() => assertSecureWsUrl('wss://example.com:443')).not.toThrow();
  });
});

describe('bootstrapClientApi', () => {
  test('returns an ElectronAPI-shaped proxy with channel availability', () => {
    const api = bootstrapClientApi({
      localUrl: 'ws://127.0.0.1:59999',
      token: '',
      workspaceId: 'ws-1',
    }) as ElectronAPI & { isChannelAvailable: (channel?: string) => boolean };
    expect(typeof api.getStatus).toBe('function');
    expect(typeof api.sendMessage).toBe('function');
    expect(typeof api.onSessionEvent).toBe('function');
    expect(typeof api.isChannelAvailable).toBe('function');
    expect(api.isChannelAvailable('getStatus')).toBe(true);
    expect(typeof api.getSessionMessages).toBe('function'); // exists but no client connected — no call made
  });

  test('thin-client mode with plaintext remote ws:// is refused', () => {
    expect(() => bootstrapThinClientApi('ws://remote.example.com:3000', 'tok')).toThrow(/unencrypted/);
  });

  test('thin-client mode localhost works', () => {
    const api = bootstrapThinClientApi('ws://127.0.0.1:59999', 'tok', 'ws-1');
    expect(typeof api.getStatus).toBe('function');
  });
});
