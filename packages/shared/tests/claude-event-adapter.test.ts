/**
 * Claude event adapter snapshot tests (R10) — SDK message fixtures →
 * unified AgentEvent shapes.
 */
import { describe, test, expect } from 'bun:test';
import { ClaudeEventAdapter } from '../src/agent/backend/claude/event-adapter.ts';
import type { AgentEvent } from '@threadcove/core/types';

describe('ClaudeEventAdapter', () => {
  test('stream_event text deltas → text_delta events', () => {
    const adapter = new ClaudeEventAdapter();
    const events = adapter.adapt({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
      parent_tool_use_id: null,
    } as never);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'text_delta', text: 'Hello ', turnId: undefined, parentToolUseId: undefined });
  });

  test('assistant message sets turnId from message.id and emits tool_start', () => {
    const adapter = new ClaudeEventAdapter();
    adapter.startTurn();
    const events = adapter.adapt({
      type: 'assistant',
      message: {
        id: 'msg_01ABC',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'WebSearch', input: { query: 'news' } }],
      },
      parent_tool_use_id: null,
    } as never);

    expect(events).toHaveLength(1);
    const start = events[0] as Extract<AgentEvent, { type: 'tool_start' }>;
    expect(start.type).toBe('tool_start');
    expect(start.toolName).toBe('WebSearch');
    expect(start.toolUseId).toBe('tu_1');
    expect(start.turnId).toBe('msg_01ABC');
  });

  test('tool result user message → tool_result with correlated name', () => {
    const adapter = new ClaudeEventAdapter();
    adapter.startTurn();
    adapter.adapt({
      type: 'assistant',
      message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'tu_9', name: 'Read', input: {} }] },
      parent_tool_use_id: null,
    } as never);

    const events = adapter.adapt({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu_9', content: 'file text' }] },
      parent_tool_use_id: null,
    } as never);

    const result = events[0] as Extract<AgentEvent, { type: 'tool_result' }>;
    expect(result.type).toBe('tool_result');
    expect(result.toolName).toBe('Read');
    expect(result.result).toBe('file text');
    expect(result.isError).toBe(false);
  });

  test('result success flushes text_complete then complete with usage', () => {
    const adapter = new ClaudeEventAdapter();
    adapter.startTurn();
    adapter.adapt({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'final answer' } },
      parent_tool_use_id: null,
    } as never);
    adapter.adapt({
      type: 'assistant',
      message: { id: 'msg_2', content: [] },
      parent_tool_use_id: null,
    } as never);

    const events = adapter.adapt({
      type: 'result',
      subtype: 'success',
      result: 'final answer',
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0 },
    } as never);

    expect(events.map((e) => e.type)).toEqual(['text_complete', 'complete']);
    const complete = events[1] as Extract<AgentEvent, { type: 'complete' }>;
    expect(complete.usage?.inputTokens).toBe(100);
    expect(complete.usage?.outputTokens).toBe(20);
  });

  test('tool_use flushes pending text as isIntermediate', () => {
    const adapter = new ClaudeEventAdapter();
    adapter.startTurn();
    adapter.adapt({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'let me look' } },
      parent_tool_use_id: null,
    } as never);
    adapter.adapt({
      type: 'assistant',
      message: {
        id: 'msg_3',
        content: [{ type: 'tool_use', id: 'tu_2', name: 'Bash', input: { command: 'ls' } }],
      },
      parent_tool_use_id: null,
    } as never);

    // tool_start flushed the pending text as intermediate
    // (verified via a later result that does not re-emit it as final).
    const events = adapter.adapt({
      type: 'result',
      subtype: 'success',
      usage: {},
    } as never);
    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeDefined();
    // No text_complete in the final flush — it went out as intermediate before tool_start.
    expect(events.find((e) => e.type === 'text_complete')).toBeUndefined();
  });

  test('unknown SDK message types are dropped without breaking the stream', () => {
    const adapter = new ClaudeEventAdapter();
    const events = adapter.adapt({ type: 'some_future_type' } as never);
    expect(events).toEqual([]);
  });

  test('nested tool carries parentToolUseId', () => {
    const adapter = new ClaudeEventAdapter();
    adapter.startTurn();
    const events = adapter.adapt({
      type: 'assistant',
      message: { id: 'msg_5', content: [{ type: 'tool_use', id: 'tu_child', name: 'Read', input: {} }] },
      parent_tool_use_id: 'tu_parent',
    } as never);
    const start = events[0] as Extract<AgentEvent, { type: 'tool_start' }>;
    expect(start.parentToolUseId).toBe('tu_parent');
  });
});
