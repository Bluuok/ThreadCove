/**
 * EventQueue behavior tests (R10) — the structural answer to "is this
 * just an async generator re-skinned": push→pull decoupling, completion
 * signal, and reset lifecycle.
 */
import { describe, test, expect } from 'bun:test';
import { EventQueue } from '../src/agent/backend/event-queue.ts';
import type { AgentEvent } from '@threadcove/core/types';

function textDelta(text: string): AgentEvent {
  return { type: 'text_delta', text };
}

async function collect(queue: EventQueue): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of queue.drain()) {
    events.push(event);
  }
  return events;
}

describe('EventQueue', () => {
  test('enqueue→drain preserves order', async () => {
    const queue = new EventQueue();
    queue.enqueue(textDelta('a'));
    queue.enqueue(textDelta('b'));
    queue.enqueue(textDelta('c'));
    queue.complete();

    const events = await collect(queue);
    expect(events.map((e) => (e as { text: string }).text)).toEqual(['a', 'b', 'c']);
  });

  test('drain waits when empty and wakes on enqueue', async () => {
    const queue = new EventQueue();
    const collected = collect(queue);

    // Producer arrives asynchronously after the consumer is waiting.
    await new Promise((r) => setTimeout(r, 20));
    queue.enqueue(textDelta('late'));
    queue.complete();

    const events = await collected;
    expect(events).toHaveLength(1);
    expect((events[0] as { text: string }).text).toBe('late');
  });

  test('complete() after drain starts ends the stream', async () => {
    const queue = new EventQueue();
    queue.enqueue(textDelta('x'));

    const collected = collect(queue);
    await new Promise((r) => setTimeout(r, 10));
    queue.complete();

    const events = await collected;
    expect(events).toHaveLength(1);
    expect(queue.isComplete).toBe(true);
  });

  test('complete() before drain still delivers buffered events', async () => {
    const queue = new EventQueue();
    queue.enqueue(textDelta('first'));
    queue.enqueue(textDelta('second'));
    queue.complete();

    const events = await collect(queue);
    expect(events).toHaveLength(2);
  });

  test('reset() re-arms the queue for a new turn', async () => {
    const queue = new EventQueue();
    queue.enqueue(textDelta('old'));
    queue.complete();
    await collect(queue);

    queue.reset();
    expect(queue.isComplete).toBe(false);
    expect(queue.hasPending).toBe(false);

    queue.enqueue(textDelta('new'));
    queue.complete();
    const events = await collect(queue);
    expect(events.map((e) => (e as { text: string }).text)).toEqual(['new']);
  });

  test('interleaved producers: enqueue during drain yields in order', async () => {
    const queue = new EventQueue();
    const collected = (async () => {
      const events: AgentEvent[] = [];
      for await (const event of queue.drain()) {
        events.push(event);
        // Producer emits the next event after each consumption.
        if (events.length < 3) {
          queue.enqueue(textDelta(`n${events.length}`));
        } else {
          queue.complete();
        }
      }
      return events;
    })();

    queue.enqueue(textDelta('n0'));
    const events = await collected;
    expect(events.map((e) => (e as { text: string }).text)).toEqual(['n0', 'n1', 'n2']);
  });
});
