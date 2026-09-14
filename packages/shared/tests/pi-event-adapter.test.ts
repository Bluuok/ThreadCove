/**
 * Pi event adapter snapshot tests (R10) — Pi fixture events → unified
 * AgentEvent shapes, plus unknown-event tolerance.
 */
import { describe, test, expect } from 'bun:test';
import { PiEventAdapter } from '../src/agent/backend/pi/event-adapter.ts';
import type { AgentEvent } from '@threadcove/core/types';

describe('PiEventAdapter', () => {
  test('message_update text delta → text_delta with sub-turn id', () => {
    const adapter = new PiEventAdapter();
    adapter.startTurn();
    const events = adapter.adaptEvent({
      type: 'message_update',
      delta: { type: 'text_delta', text: 'Pi says hi' },
    });
    expect(events).toHaveLength(1);
    const delta = events[0] as Extract<AgentEvent, { type: 'text_delta' }>;
    expect(delta.text).toBe('Pi says hi');
    expect(delta.turnId).toContain('sub1');
  });

  test('message_end preserves each assistant answer across tool rounds', () => {
    const adapter = new PiEventAdapter();
    adapter.startTurn();
    const events = adapter.adaptEvent({
      type: 'message_end',
      message: { content: [{ type: 'text', text: 'done text' }] },
    });
    const complete = events[0] as Extract<AgentEvent, { type: 'text_complete' }>;
    expect(complete.type).toBe('text_complete');
    expect(complete.text).toBe('done text');

    // Tool loops can finish several assistant messages in one turn.
    const again = adapter.adaptEvent({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'final answer' }] },
    });
    expect(again.find((e) => e.type === 'text_complete')).toMatchObject({ text: 'final answer' });
    expect(adapter.adaptEvent({ type: 'message_end', message: { role: 'user', content: 'do not echo' } })).toEqual([]);
    expect(adapter.adaptEvent({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'bad auth' } })).toContainEqual({ type: 'error', message: 'bad auth' });
  });

  test('tool_execution_start/end → tool_start/tool_result pair', () => {
    const adapter = new PiEventAdapter();
    adapter.startTurn();
    const startEvents = adapter.adaptEvent({
      type: 'tool_execution_start',
      toolCallId: 'tc1',
      toolName: 'read_file',
      args: { path: '/tmp/x' },
    });
    const start = startEvents[0] as Extract<AgentEvent, { type: 'tool_start' }>;
    expect(start.toolName).toBe('read_file');
    expect(start.toolUseId).toBe('tc1');
    expect(start.input).toEqual({ path: '/tmp/x' });

    const endEvents = adapter.adaptEvent({
      type: 'tool_execution_end',
      toolCallId: 'tc1',
      result: { content: 'file body' },
      isError: false,
    });
    const result = endEvents[0] as Extract<AgentEvent, { type: 'tool_result' }>;
    expect(result.toolName).toBe('read_file');
    expect(result.result).toBe('file body');
    expect(result.isError).toBe(false);
  });

  test('compaction events map to status/info', () => {
    const adapter = new PiEventAdapter();
    adapter.startTurn();
    expect(adapter.adaptEvent({ type: 'compaction_start' })[0]?.type).toBe('status');
    expect(adapter.adaptEvent({ type: 'compaction_end' })[0]?.type).toBe('info');
    const failed = adapter.adaptEvent({ type: 'compaction_end', errorMessage: 'boom' });
    expect(failed[0]?.type).toBe('error');
  });

  test('auto_retry events map to status', () => {
    const adapter = new PiEventAdapter();
    adapter.startTurn();
    expect(adapter.adaptEvent({ type: 'auto_retry_start', attempt: 2 })[0]?.type).toBe('status');
    expect(adapter.adaptEvent({ type: 'auto_retry_end' })[0]?.type).toBe('status');
  });

  test('queue_update is ignored', () => {
    const adapter = new PiEventAdapter();
    expect(adapter.adaptEvent({ type: 'queue_update' })).toEqual([]);
  });

  test('unknown event types are dropped (tolerance contract)', () => {
    const adapter = new PiEventAdapter();
    expect(adapter.adaptEvent({ type: 'future_pi_event', data: 42 })).toEqual([]);
  });
});
