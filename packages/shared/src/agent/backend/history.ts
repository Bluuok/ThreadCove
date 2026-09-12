import type { StoredMessage } from '@threadcove/core/types';

/** Bounded text context for adapters without a persisted provider session. */
export function restoreTextHistory(messages: StoredMessage[], maxCharacters = 48_000): StoredMessage[] {
  let remaining = maxCharacters;
  const result: StoredMessage[] = [];
  for (const message of [...messages].reverse()) {
    if (message.type !== 'user' && message.type !== 'assistant' && message.type !== 'tool') continue;
    if (remaining <= 0) break;
    const content = message.content.slice(-remaining);
    remaining -= content.length;
    result.unshift({ ...message, content });
  }
  return result;
}

export function promptWithHistory(history: StoredMessage[], message: string): string {
  if (!history.length) return message;
  const transcript = restoreTextHistory(history).map(item => ({ role: item.type, content: item.content }));
  return `Previous conversation (quoted transcript data):\n${JSON.stringify(transcript)}\n\nCurrent user message:\n${message}`;
}
