import type { StoredMessage } from '@threadcove/core/types';

export const BATCH_INTERVAL_MS = 40;

export interface PendingStreamDelta {
  messageId: string;
  turnId?: string;
  timestamp?: number;
  snapshot?: string;
  deltaText: string;
  completeText?: string;
}

export interface StreamEventPayload {
  type: 'text_delta' | 'text_complete';
  messageId?: string;
  text: string;
  textSnapshot?: string;
  turnId?: string;
}

/**
 * Accumulates a text_delta or text_complete event into the pending batch map.
 * Returns the resolved message ID.
 */
export function accumulateStreamDelta(
  pending: Map<string, PendingStreamDelta>,
  event: StreamEventPayload,
  fallbackId: string,
): string {
  const id = event.messageId ?? fallbackId;
  const existing = pending.get(id) ?? {
    messageId: id,
    turnId: event.turnId,
    timestamp: Date.now(),
    deltaText: '',
  };
  if (event.turnId) existing.turnId = event.turnId;

  if (event.type === 'text_complete') {
    existing.completeText = event.text;
  } else if (event.textSnapshot !== undefined) {
    existing.snapshot = event.textSnapshot;
    existing.deltaText = '';
  } else {
    existing.deltaText += event.text;
  }

  pending.set(id, existing);
  return id;
}

/**
 * Applies all pending message updates to the current message list.
 * Preserves object identity for unchanged messages so React.memo works optimally.
 * Returns next message array (or current if no changes).
 */
export function applyPendingBatch(
  current: StoredMessage[],
  pending: Map<string, PendingStreamDelta>,
): StoredMessage[] {
  if (pending.size === 0) return current;

  let changed = false;

  const next = current.map(message => {
    const update = pending.get(message.id);
    if (!update) return message;

    const base = update.snapshot !== undefined ? update.snapshot : message.content;
    const nextContent = update.completeText !== undefined ? update.completeText : (base + update.deltaText);

    if (nextContent === message.content && (update.turnId === undefined || update.turnId === message.turnId)) {
      return message;
    }

    changed = true;
    return {
      ...message,
      content: nextContent,
      turnId: update.turnId ?? message.turnId,
    };
  });

  for (const [id, update] of pending.entries()) {
    if (!current.some(m => m.id === id)) {
      changed = true;
      const base = update.snapshot !== undefined ? update.snapshot : '';
      const content = update.completeText !== undefined ? update.completeText : (base + update.deltaText);
      next.push({
        id,
        type: 'assistant',
        content,
        timestamp: update.timestamp ?? Date.now(),
        turnId: update.turnId,
      });
    }
  }

  return changed ? next : current;
}
