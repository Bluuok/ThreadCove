/**
 * Envelope codec roundtrip tests (R12).
 * Binary values (Uint8Array) must survive base64 annotation encoding;
 * malformed envelopes must be rejected.
 */
import { describe, test, expect } from 'bun:test';
import {
  serializeEnvelope,
  deserializeEnvelope,
  validateEnvelopeShape,
} from '../src/protocol/codec.ts';

describe('envelope codec', () => {
  test('plain envelope roundtrip', () => {
    const envelope = {
      id: 'req-1',
      type: 'request' as const,
      channel: 'sessions:get',
      args: ['ws-1', false],
    };
    const raw = serializeEnvelope(envelope);
    const parsed = deserializeEnvelope(raw);
    expect(parsed.id).toBe('req-1');
    expect(parsed.type).toBe('request');
    expect(parsed.channel).toBe('sessions:get');
    expect(parsed.args).toEqual(['ws-1', false]);
  });

  test('Uint8Array roundtrips through base64 annotation', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
    const envelope = {
      id: 'req-2',
      type: 'request' as const,
      channel: 'files:write',
      args: ['ws', 'session', 'file.bin', bytes],
    };
    const raw = serializeEnvelope(envelope);
    // Serialized JSON must not contain raw binary.
    expect(raw).toContain('__tcRpcType');
    const parsed = deserializeEnvelope(raw);
    const arg = parsed.args?.[3];
    expect(arg).toBeInstanceOf(Uint8Array);
    expect(Array.from(arg as Uint8Array)).toEqual([0, 1, 2, 250, 251, 255]);
  });

  test('nested Uint8Array inside objects roundtrips', () => {
    const envelope = {
      id: 'req-3',
      type: 'response' as const,
      channel: 'files:read',
      result: { content: new Uint8Array([9, 8, 7]), nested: { data: new Uint8Array([1]) } },
    };
    const parsed = deserializeEnvelope(serializeEnvelope(envelope));
    const result = parsed.result as { content: Uint8Array; nested: { data: Uint8Array } };
    expect(Array.from(result.content)).toEqual([9, 8, 7]);
    expect(Array.from(result.nested.data)).toEqual([1]);
  });

  test('malformed envelope shape is rejected', () => {
    expect(validateEnvelopeShape(null)).toBe(false);
    expect(validateEnvelopeShape({ id: 'x' })).toBe(false);
    expect(validateEnvelopeShape({ id: 'x', type: 'bogus' })).toBe(false);
    expect(validateEnvelopeShape({ id: '', type: 'request', channel: 'c' })).toBe(false);
    expect(validateEnvelopeShape({ id: 'x', type: 'request', channel: 'sessions:get' })).toBe(true);
    expect(validateEnvelopeShape({ id: 'x', type: 'handshake_ack' })).toBe(false); // missing clientId
    expect(validateEnvelopeShape({ id: 'x', type: 'handshake_ack', clientId: 'c1' })).toBe(true);
  });

  test('deserializeEnvelope throws on invalid shape', () => {
    expect(() => deserializeEnvelope(JSON.stringify({ type: 'nope' }))).toThrow();
  });

  test('wire error survives response envelope', () => {
    const envelope = {
      id: 'req-4',
      type: 'response' as const,
      channel: 'sessions:get',
      error: { code: 'CHANNEL_NOT_FOUND' as const, message: 'nope' },
    };
    const parsed = deserializeEnvelope(serializeEnvelope(envelope));
    expect(parsed.error?.code).toBe('CHANNEL_NOT_FOUND');
    expect(parsed.error?.message).toBe('nope');
  });
});
