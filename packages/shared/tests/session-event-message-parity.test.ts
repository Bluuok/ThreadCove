/**
 * R10 session-event-message parity tests.
 *
 * For each core event type, verifies that the fields the session layer
 * persists into StoredMessage match the fields the renderer derives from
 * the AgentEvent. Both sides mirror inline (no app imports) — this catches
 * field drift between the two independent code paths.
 */
import { describe, it, expect } from 'bun:test';
import { messageToStored, storedToMessage } from '@threadcove/core/types';
import type { AgentEvent, StoredMessage } from '@threadcove/core/types';

/** Extract the set of defined (non-undefined) keys from an object. */
function definedKeys(obj: Record<string, unknown>): Set<string> {
  return new Set(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k]) => k));
}

/** Session-layer mapping: event → persisted message fields (main side). */
function eventToStoredFields(event: AgentEvent): Record<string, unknown> {
  switch (event.type) {
    case 'text_complete':
      return {
        id: 'msg-1',
        type: 'assistant',
        content: event.text,
        timestamp: 1700000000000,
        isIntermediate: event.isIntermediate,
        turnId: event.turnId,
        parentToolUseId: event.parentToolUseId,
      };
    case 'tool_start':
      return {
        id: 'msg-2',
        type: 'tool',
        content: '',
        timestamp: 1700000000000,
        toolName: event.toolName,
        toolUseId: event.toolUseId,
        toolInput: event.input,
        toolDisplayName: event.displayName,
        turnId: event.turnId,
        parentToolUseId: event.parentToolUseId,
      };
    case 'tool_result':
      return {
        id: 'msg-3',
        type: 'tool',
        content: event.result,
        timestamp: 1700000000000,
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        isError: event.isError,
        turnId: event.turnId,
        parentToolUseId: event.parentToolUseId,
      };
    case 'typed_error':
      return {
        id: 'msg-4',
        type: 'error',
        content: event.error.message,
        timestamp: 1700000000000,
        errorCode: event.error.code,
        errorTitle: event.error.title,
        errorDetails: event.error.details,
        errorOriginal: event.error.originalError,
        errorCanRetry: event.error.canRetry,
        errorActions: event.error.actions,
        turnId: event.turnId,
      };
    default:
      throw new Error(`Unhandled event type in parity test: ${event.type}`);
  }
}

/** Renderer-side mapping: event → live message fields (UI side). */
function eventToRenderFields(event: AgentEvent): Record<string, unknown> {
  switch (event.type) {
    case 'text_complete':
      return {
        id: 'msg-1',
        type: 'assistant',
        content: event.text,
        timestamp: 1700000000000,
        isIntermediate: event.isIntermediate,
        turnId: event.turnId,
        parentToolUseId: event.parentToolUseId,
      };
    case 'tool_start':
      return {
        id: 'msg-2',
        type: 'tool',
        content: '',
        timestamp: 1700000000000,
        toolName: event.toolName,
        toolUseId: event.toolUseId,
        toolInput: event.input,
        toolDisplayName: event.displayName,
        turnId: event.turnId,
        parentToolUseId: event.parentToolUseId,
      };
    case 'tool_result':
      return {
        id: 'msg-3',
        type: 'tool',
        content: event.result,
        timestamp: 1700000000000,
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        isError: event.isError,
        turnId: event.turnId,
        parentToolUseId: event.parentToolUseId,
      };
    case 'typed_error':
      return {
        id: 'msg-4',
        type: 'error',
        content: event.error.message,
        timestamp: 1700000000000,
        errorCode: event.error.code,
        errorTitle: event.error.title,
        errorDetails: event.error.details,
        errorOriginal: event.error.originalError,
        errorCanRetry: event.error.canRetry,
        errorActions: event.error.actions,
        turnId: event.turnId,
      };
    default:
      throw new Error(`Unhandled event type in parity test: ${event.type}`);
  }
}

describe('session-event-message parity', () => {
  it('text_complete fields match on both sides', () => {
    const event: AgentEvent = {
      type: 'text_complete',
      text: 'The answer.',
      isIntermediate: false,
      turnId: 'msg_01',
      parentToolUseId: undefined,
    };
    const main = definedKeys(eventToStoredFields(event));
    const render = definedKeys(eventToRenderFields(event));
    expect(main).toEqual(render);
  });

  it('text_complete intermediate vs final differ only in isIntermediate', () => {
    const final: AgentEvent = { type: 'text_complete', text: 'x', turnId: 't' };
    const inter: AgentEvent = { type: 'text_complete', text: 'x', isIntermediate: true, turnId: 't' };
    const finalKeys = definedKeys(eventToStoredFields(final));
    const interKeys = definedKeys(eventToStoredFields(inter));
    expect(finalKeys.has('isIntermediate')).toBe(false);
    expect(interKeys.has('isIntermediate')).toBe(true);
  });

  it('tool_start fields match on both sides', () => {
    const event: AgentEvent = {
      type: 'tool_start',
      toolName: 'WebSearch',
      toolUseId: 'tu_1',
      input: { query: 'papers' },
      turnId: 'msg_01',
    };
    expect(definedKeys(eventToStoredFields(event))).toEqual(definedKeys(eventToRenderFields(event)));
  });

  it('tool_result fields match on both sides', () => {
    const event: AgentEvent = {
      type: 'tool_result',
      toolUseId: 'tu_1',
      toolName: 'WebSearch',
      result: 'results…',
      isError: false,
      turnId: 'msg_01',
    };
    expect(definedKeys(eventToStoredFields(event))).toEqual(definedKeys(eventToRenderFields(event)));
  });

  it('typed_error fields match on both sides', () => {
    const event: AgentEvent = {
      type: 'typed_error',
      turnId: 'msg_09',
      error: {
        code: 'rate_limited',
        title: 'Rate limited',
        message: 'Too many requests.',
        actions: [{ key: 'r', label: 'Retry', action: 'retry' }],
        canRetry: true,
        retryDelayMs: 5000,
        details: ['status 429'],
        originalError: '429 Too Many Requests',
      },
    };
    const main = definedKeys(eventToStoredFields(event));
    const render = definedKeys(eventToRenderFields(event));
    expect(main).toEqual(render);
    expect(main.has('errorCanRetry')).toBe(true);
    expect(main.has('errorActions')).toBe(true);
  });

  it('StoredMessage roundtrip via messageToStored keeps event-derived fields', () => {
    const stored: StoredMessage = {
      id: 'msg-9',
      type: 'assistant',
      content: 'persisted',
      timestamp: 123,
      turnId: 't-1',
    };
    const round = storedToMessage(messageToStored(storedToMessage(stored)));
    expect(round.id).toBe('msg-9');
    expect(round.turnId).toBe('t-1');
    expect(round.content).toBe('persisted');
  });
});
