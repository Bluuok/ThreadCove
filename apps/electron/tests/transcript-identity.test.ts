import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, loadSession } from '@threadcove/shared/sessions';
import { RunTranscript } from '../src/server/run-transcript.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('RunTranscript assistant identity', () => {
  test('returns one stable messageId for deltas and completion and persists the same id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-transcript-id-'));
    roots.push(root);
    const session = await createSession(root, { id: 'identity-session' });
    const transcript = new RunTranscript(root, session.id, 'run-identity');

    const first = await transcript.consume({ type: 'text_delta', text: 'stable ', turnId: 'turn-identity' });
    const second = await transcript.consume({ type: 'text_delta', text: 'message', turnId: 'turn-identity' });
    const complete = await transcript.consume({ type: 'text_complete', text: 'stable message', turnId: 'turn-identity' });
    await transcript.flush();

    expect(first.type).toBe('text_delta');
    expect(second.type).toBe('text_delta');
    expect(complete.type).toBe('text_complete');
    if (first.type !== 'text_delta' || second.type !== 'text_delta' || complete.type !== 'text_complete') {
      throw new Error('unexpected transcript event types');
    }
    expect(first.messageId).toBeString();
    expect(second.messageId).toBe(first.messageId);
    expect(first.textSnapshot).toBe('stable ');
    expect(second.textSnapshot).toBe('stable message');
    expect(complete.messageId).toBe(first.messageId);

    const assistants = loadSession(root, session.id)?.messages.filter(message => message.type === 'assistant') ?? [];
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({
      id: first.messageId,
      runId: 'run-identity',
      turnId: 'turn-identity',
      content: 'stable message',
    });
  });
});
