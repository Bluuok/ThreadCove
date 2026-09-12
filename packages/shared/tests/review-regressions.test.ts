import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoredMessage } from '@threadcove/core/types';
import { promptWithHistory, restoreTextHistory } from '../src/agent/backend/history.ts';
import {
  createSession,
  deleteSessionSafely,
  getSessionPath,
  loadSession,
  mutateSession,
} from '../src/sessions/storage.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('safe session deletion', () => {
  test('drains concurrent mutations, rejects new mutations during deletion, and never revives the directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-safe-delete-'));
    roots.push(root);
    const session = await createSession(root, { id: 'delete-race' });
    const sessionPath = getSessionPath(root, session.id);

    const startedMutations = Array.from({ length: 8 }, (_, index) =>
      mutateSession(root, session.id, stored => {
        stored.name = `rename-${index}`;
        stored.isFlagged = index % 2 === 0;
        stored.hasUnread = index % 3 === 0;
      }),
    );
    const deletion = deleteSessionSafely(root, session.id);

    await expect(mutateSession(root, session.id, stored => {
      stored.name = 'must-be-rejected';
    })).rejects.toThrow(/being deleted/i);
    await expect(Promise.all(startedMutations)).resolves.toHaveLength(8);
    await expect(deletion).resolves.toBe(true);

    await Bun.sleep(100);
    expect(existsSync(sessionPath)).toBe(false);
    expect(loadSession(root, session.id)).toBeNull();
  });
});

describe('bounded text history', () => {
  test('promptWithHistory preserves an opaque token and the original roles', () => {
    const token = `opaque-${randomUUID()}`;
    const history: StoredMessage[] = [
      { id: 'u1', type: 'user', content: `remember ${token}`, timestamp: 1 },
      { id: 'a1', type: 'assistant', content: 'assistant reply', timestamp: 2 },
      { id: 't1', type: 'tool', content: 'tool evidence', timestamp: 3 },
      { id: 'e1', type: 'error', content: 'excluded error', timestamp: 4 },
    ];

    const prompt = promptWithHistory(history, 'current question');
    const encodedTranscript = prompt
      .slice('Previous conversation (quoted transcript data):\n'.length)
      .split('\n\nCurrent user message:\n')[0]!;
    const transcript = JSON.parse(encodedTranscript) as Array<{ role: string; content: string }>;

    expect(transcript).toEqual([
      { role: 'user', content: `remember ${token}` },
      { role: 'assistant', content: 'assistant reply' },
      { role: 'tool', content: 'tool evidence' },
    ]);
    expect(prompt).toContain(token);
    expect(prompt).toEndWith('Current user message:\ncurrent question');
  });

  test('restoreTextHistory keeps newest role ordering within the exact character budget', () => {
    const history: StoredMessage[] = [
      { id: 'old-user', type: 'user', content: '1234567890', timestamp: 1 },
      { id: 'new-assistant', type: 'assistant', content: 'abcdefghij', timestamp: 2 },
      { id: 'new-tool', type: 'tool', content: 'WXYZ', timestamp: 3 },
      { id: 'ignored-error', type: 'error', content: 'not context', timestamp: 4 },
    ];

    const restored = restoreTextHistory(history, 12);

    expect(restored.map(message => ({ id: message.id, type: message.type, content: message.content }))).toEqual([
      { id: 'new-assistant', type: 'assistant', content: 'cdefghij' },
      { id: 'new-tool', type: 'tool', content: 'WXYZ' },
    ]);
    expect(restored.reduce((sum, message) => sum + message.content.length, 0)).toBe(12);
  });
});
