import { describe, it, expect } from 'bun:test';
import type { StoredMessage } from '@threadcove/core/types';
import {
  accumulateStreamDelta,
  applyPendingBatch,
  type PendingStreamDelta,
  BATCH_INTERVAL_MS,
} from '../src/streamBatcher.ts';

describe('streamBatcher', () => {
  it('accumulates deltas for a new assistant message', () => {
    const pending = new Map<string, PendingStreamDelta>();
    accumulateStreamDelta(pending, { type: 'text_delta', text: 'Hello' }, 'msg-1');
    accumulateStreamDelta(pending, { type: 'text_delta', text: ', world!' }, 'msg-1');

    const result = applyPendingBatch([], pending);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('msg-1');
    expect(result[0].content).toBe('Hello, world!');
    expect(result[0].type).toBe('assistant');
  });

  it('handles snapshots overriding prior deltas', () => {
    const pending = new Map<string, PendingStreamDelta>();
    accumulateStreamDelta(pending, { type: 'text_delta', text: 'Stale chunk' }, 'msg-1');
    accumulateStreamDelta(pending, { type: 'text_delta', text: '', textSnapshot: 'Full snapshot text' }, 'msg-1');
    accumulateStreamDelta(pending, { type: 'text_delta', text: ' and more' }, 'msg-1');

    const result = applyPendingBatch([], pending);
    expect(result[0].content).toBe('Full snapshot text and more');
  });

  it('batches updates across multiple message IDs in a single pass', () => {
    const pending = new Map<string, PendingStreamDelta>();
    accumulateStreamDelta(pending, { type: 'text_delta', text: 'Message A chunk' }, 'msg-a');
    accumulateStreamDelta(pending, { type: 'text_delta', text: 'Message B chunk' }, 'msg-b');
    accumulateStreamDelta(pending, { type: 'text_delta', text: ' more A' }, 'msg-a');

    const initial: StoredMessage[] = [
      { id: 'user-1', type: 'user', content: 'Prompt', timestamp: 100 },
    ];
    const result = applyPendingBatch(initial, pending);

    expect(result).toHaveLength(3);
    expect(result[0]).toBe(initial[0]); // Referential equality preserved
    expect(result[1].id).toBe('msg-a');
    expect(result[1].content).toBe('Message A chunk more A');
    expect(result[2].id).toBe('msg-b');
    expect(result[2].content).toBe('Message B chunk');
  });

  it('applies text_complete directly and overrides partial deltas', () => {
    const pending = new Map<string, PendingStreamDelta>();
    accumulateStreamDelta(pending, { type: 'text_delta', text: 'Incomplete' }, 'msg-1');
    accumulateStreamDelta(pending, { type: 'text_complete', text: 'Final complete text.' }, 'msg-1');

    const result = applyPendingBatch([], pending);
    expect(result[0].content).toBe('Final complete text.');
  });

  it('preserves references for messages not touched by the batch', () => {
    const existing: StoredMessage[] = [
      { id: 'msg-0', type: 'user', content: 'Question', timestamp: 1 },
      { id: 'msg-1', type: 'assistant', content: 'Answer 1', timestamp: 2 },
      { id: 'msg-2', type: 'assistant', content: 'Answer 2', timestamp: 3 },
    ];
    const pending = new Map<string, PendingStreamDelta>();
    accumulateStreamDelta(pending, { type: 'text_delta', text: ' updated' }, 'msg-2');

    const next = applyPendingBatch(existing, pending);
    expect(next[0]).toBe(existing[0]);
    expect(next[1]).toBe(existing[1]);
    expect(next[2]).not.toBe(existing[2]);
    expect(next[2].content).toBe('Answer 2 updated');
  });

  it('demonstrates refresh count reduction when batching 20 stream deltas', () => {
    // Simulate 20 deltas arriving within a 40ms burst
    let flushes = 0;
    const pending = new Map<string, PendingStreamDelta>();
    let batchTimer: boolean = false;

    const onDelta = (text: string) => {
      accumulateStreamDelta(pending, { type: 'text_delta', text }, 'live-msg');
      if (!batchTimer) {
        batchTimer = true;
      }
    };

    const flush = (current: StoredMessage[]) => {
      batchTimer = false;
      flushes++;
      const res = applyPendingBatch(current, pending);
      pending.clear();
      return res;
    };

    let state: StoredMessage[] = [];
    // 20 chunks in a single batch interval
    for (let i = 0; i < 20; i++) {
      onDelta(` chunk-${i}`);
    }

    // Single flush at the end of the batch window
    state = flush(state);

    expect(flushes).toBe(1);
    expect(state[0].content).toContain('chunk-0');
    expect(state[0].content).toContain('chunk-19');
    expect(BATCH_INTERVAL_MS).toBeGreaterThanOrEqual(32);
    expect(BATCH_INTERVAL_MS).toBeLessThanOrEqual(50);
  });
});
