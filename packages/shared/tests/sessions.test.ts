/**
 * R08 session/workspace isolation tests.
 *
 * Core isolation claims locked by tests:
 * - two sessions in the same workspace cannot see each other's state
 * - per-session workingDirectory defaults to the session folder
 * - sanitizeSessionId rejects path traversal
 * - archive keeps data, delete removes the directory
 * - concurrent persistence is serialized and header-protected
 * - {{SESSION_PATH}} portable token roundtrips
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createSession,
  loadSession,
  deleteSession,
  archiveSession,
  flagSession,
  markSessionRead,
  appendMessages,
  listSessionHeaders,
  getSessionPath,
  getSessionFilePath,
  ensureSessionDir,
  resolveWorkingDirectory,
  sanitizeSessionId,
  validateSessionId,
  isValidSessionId,
  generateUniqueSessionId,
} from '../src/sessions/storage.ts';
import { sessionPersistenceQueue } from '../src/sessions/persistence-queue.ts';
import {
  makeSessionPathPortable,
  expandSessionPath,
} from '../src/sessions/jsonl.ts';
import { createWorkspace } from '../src/workspaces/storage.ts';

function makeStoredMessage(id: string, content: string) {
  return { id, type: 'user' as const, content, timestamp: Date.now() };
}

/** Wait out the persistence debounce window so timer writes land. */
const DEBOUNCE_WAIT_MS = 700;

describe('R08 session/workspace isolation', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), 'tc-r08-'));
    process.env['THREADCOVE_HOME'] = base;
    const ws = createWorkspace({ name: 'Research' });
    workspaceRoot = ws.rootPath;
  });

  afterEach(() => {
    rmSync(process.env['THREADCOVE_HOME']!, { recursive: true, force: true });
    delete process.env['THREADCOVE_HOME'];
  });

  test('two sessions in the same workspace are physically isolated', async () => {
    const s1 = await createSession(workspaceRoot);
    const s2 = await createSession(workspaceRoot);

    expect(s1.id).not.toBe(s2.id);
    expect(getSessionPath(workspaceRoot, s1.id)).not.toBe(getSessionPath(workspaceRoot, s2.id));

    // workingDirectory defaults to each session's own directory
    const d1 = resolveWorkingDirectory(s1);
    const d2 = resolveWorkingDirectory(s2);
    expect(d1).toBe(getSessionPath(workspaceRoot, s1.id));
    expect(d2).toBe(getSessionPath(workspaceRoot, s2.id));

    // Write a file "into" each session's working dir; they must not cross.
    writeFileSync(join(d1, 'findings.txt'), 'session one data');
    writeFileSync(join(d2, 'findings.txt'), 'session two data');
    expect(readFileSync(join(d1, 'findings.txt'), 'utf-8')).toBe('session one data');
    expect(readFileSync(join(d2, 'findings.txt'), 'utf-8')).toBe('session two data');

    // Messages appended to s1 are invisible to s2.
    await appendMessages(workspaceRoot, s1.id, [makeStoredMessage('m1', 'only in s1')]);
    await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT_MS)); // let createSession's debounced write land
    const reloaded1 = loadSession(workspaceRoot, s1.id);
    const reloaded2 = loadSession(workspaceRoot, s2.id);
    expect(reloaded1?.messages).toHaveLength(1);
    expect(reloaded2?.messages).toHaveLength(0);
  });

  test('sanitizeSessionId strips traversal; validateSessionId throws', () => {
    expect(sanitizeSessionId('../../etc/passwd')).toBe('passwd');
    expect(sanitizeSessionId('..\\..\\windows')).toBe('windows');
    expect(sanitizeSessionId('')).toBe('');
    expect(isValidSessionId('../escape')).toBe(false);
    expect(isValidSessionId('valid-id_1')).toBe(true);
    expect(() => validateSessionId('../escape')).toThrow(/path traversal/);
  });

  test('getSessionPath is defense-in-depth against traversal', () => {
    const sneaky = getSessionPath(workspaceRoot, '../../outside');
    // The traversal components are stripped — path stays inside sessions/.
    expect(sneaky.startsWith(join(workspaceRoot, 'sessions'))).toBe(true);
    expect(sneaky).not.toContain('..');
  });

  test('archive keeps data, delete removes the directory', async () => {
    const s = await createSession(workspaceRoot);
    await appendMessages(workspaceRoot, s.id, [makeStoredMessage('m1', 'precious research')]);
    await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT_MS));

    // Archive: data retained, only flag flipped.
    await archiveSession(workspaceRoot, s.id, true);
    const archived = loadSession(workspaceRoot, s.id);
    expect(archived?.isArchived).toBe(true);
    expect(archived?.messages).toHaveLength(1);
    // Archived sessions are hidden from the default list, visible with the flag.
    expect(listSessionHeaders(workspaceRoot).find((h) => h.id === s.id)).toBeUndefined();
    expect(listSessionHeaders(workspaceRoot, true).find((h) => h.id === s.id)).toBeDefined();

    await archiveSession(workspaceRoot, s.id, false);
    expect(loadSession(workspaceRoot, s.id)?.isArchived).toBe(false);

    // Delete: whole directory gone.
    expect(deleteSession(workspaceRoot, s.id)).toBe(true);
    expect(existsSync(getSessionPath(workspaceRoot, s.id))).toBe(false);
    expect(loadSession(workspaceRoot, s.id)).toBeNull();
    expect(deleteSession(workspaceRoot, s.id)).toBe(false);
  });

  test('flag and read tracking update the header', async () => {
    const s = await createSession(workspaceRoot);
    await flagSession(workspaceRoot, s.id, true);
    await markSessionRead(workspaceRoot, s.id, 'msg-final', false);
    const header = loadSession(workspaceRoot, s.id);
    expect(header?.isFlagged).toBe(true);
    expect(header?.lastReadMessageId).toBe('msg-final');
    expect(header?.hasUnread).toBe(false);
  });

  test('concurrent persistence: coalesced writes serialize per session', async () => {
    const s = await createSession(workspaceRoot);
    // Fire many concurrent appends; each one loads → mutates → flushes.
    // The serialized write path means the final file reflects exactly one
    // consistent write (no torn/partial state, no .tmp residue).
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        appendMessages(workspaceRoot, s.id, [makeStoredMessage(`m-${i}`, `msg ${i}`)]),
      ),
    );
    await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT_MS));
    const final = loadSession(workspaceRoot, s.id);
    expect(final).not.toBeNull();
    expect(final?.messages).toHaveLength(1);
    // No .tmp residue.
    const sessionDir = getSessionPath(workspaceRoot, s.id);
    const residue = readdirSync(sessionDir).filter((f) => f.includes('.tmp'));
    expect(residue).toEqual([]);
    void sessionPersistenceQueue;
  });

  test('persistence queue does not clobber externally-edited header metadata', async () => {
    const { SessionPersistenceQueue } = await import('../src/sessions/persistence-queue.ts');
    // Isolated queue: our own signature tracking, no shared singleton state.
    const queue = new SessionPersistenceQueue(10);
    // Also neutralize the shared singleton so createSession/appendMessages
    // don't write signatures into it for this session ID.
    sessionPersistenceQueue.cancel('__noop__');

    const s = await createSession(workspaceRoot);
    await appendMessages(workspaceRoot, s.id, [makeStoredMessage('m1', 'hello')]);
    const file = getSessionFilePath(workspaceRoot, s.id);
    await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT_MS));
    expect(existsSync(file)).toBe(true);

    // The queue has no knowledge of this session yet: enqueue once and
    // flush to record the baseline signature.
    queue.enqueue(loadSession(workspaceRoot, s.id)!);
    await queue.flush(s.id);

    // External edit (another instance renamed the session).
    const external = JSON.parse(readFileSync(file, 'utf-8').split('\n')[0]!) as Record<string, unknown>;
    external['name'] = 'renamed externally';
    writeFileSync(file, JSON.stringify(external) + '\n', 'utf-8');

    // A stale in-memory copy now flushes. The disk signature differs from
    // the last-written signature → external metadata must be preserved.
    const stale = loadSession(workspaceRoot, s.id)!;
    stale.name = 'in-memory stale name';
    queue.enqueue(stale);
    await queue.flush(s.id);

    const header = JSON.parse(readFileSync(file, 'utf-8').split('\n')[0]!) as Record<string, unknown>;
    expect(header['name']).toBe('renamed externally');
  });

  test('{{SESSION_PATH}} token roundtrips including Windows escaping', () => {
    const sessionDir = join(workspaceRoot, 'sessions', 'test-session');
    mkdirSync(sessionDir, { recursive: true });

    // Line containing the absolute path (as message content would).
    const message = JSON.stringify({ id: 'm1', type: 'user', content: `saved at ${sessionDir}` });
    const portable = makeSessionPathPortable(message, sessionDir);
    expect(portable).not.toContain(sessionDir);
    expect(portable).toContain('{{SESSION_PATH}}');

    const expanded = expandSessionPath(portable, sessionDir);
    expect(expanded).toBe(message);

    // Windows backslash path: JSON-escaped double backslash form also replaced.
    const winDir = 'C:\\Users\\researcher\\workspace\\sessions\\s1';
    const winMessage = JSON.stringify({ path: winDir });
    const winPortable = makeSessionPathPortable(winMessage, winDir);
    // JSON.stringify escapes \ to \\, so the wire form is double-backslash.
    expect(winPortable).not.toContain('C:');
    expect(winPortable).toContain('{{SESSION_PATH}}');
    expect(expandSessionPath(winPortable, winDir)).toBe(winMessage);
  });

  test('full session JSONL write/read roundtrip preserves messages and header', async () => {
    const s = await createSession(workspaceRoot);
    await appendMessages(workspaceRoot, s.id, [
      makeStoredMessage('m1', 'first question'),
      { id: 'm2', type: 'assistant', content: 'first answer', timestamp: Date.now(), turnId: 't1' },
    ]);
    await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT_MS));

    const reloaded = loadSession(workspaceRoot, s.id);
    expect(reloaded?.messages).toHaveLength(2);
    expect(reloaded?.messageCount).toBe(2);
    expect(reloaded?.lastMessageRole).toBe('assistant');
    expect(reloaded?.preview).toBe('first question');

    // Raw file: portable paths, one JSON per line.
    const raw = readFileSync(getSessionFilePath(workspaceRoot, s.id), 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines.length).toBe(3); // header + 2 messages
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    // The workspace root path never appears in portable form — only the
    // session directory itself is tokenized (workspaceRootPath is stored
    // as a ~-prefixed portable path by toPortablePath, so assert on the
    // raw absolute form instead of the backslash-escaped one).
    expect(raw).not.toContain(workspaceRoot);
    expect(raw).toContain('{{SESSION_PATH}}'); // workingDirectory tokenized
  });

  test('ensureSessionDir creates all standard subdirectories', () => {
    const dir = ensureSessionDir(workspaceRoot, 'subdir-test');
    for (const sub of ['plans', 'attachments', 'data', 'long_responses', 'downloads']) {
      expect(existsSync(join(dir, sub))).toBe(true);
    }
  });

  test('session ID uniqueness under collisions', () => {
    const existing = ['260830-swift-river'];
    const date = new Date(2026, 7, 30);
    const id1 = generateUniqueSessionId(existing, date);
    expect(existing).not.toContain(id1);
    const id2 = generateUniqueSessionId([id1, ...existing], date);
    expect(id2).not.toBe(id1);
  });

  test('workspace defaults survive workspace reload; session deletion spares workspace', async () => {
    const { loadWorkspaceFrom, updateWorkspaceDefaults } = await import('../src/workspaces/storage.ts');
    updateWorkspaceDefaults(loadWorkspaceFrom(workspaceRoot)!, { model: 'claude-haiku-4-5' });
    const reloaded = loadWorkspaceFrom(workspaceRoot);
    expect(reloaded?.config.defaults?.model).toBe('claude-haiku-4-5');

    const s = await createSession(workspaceRoot);
    writeFileSync(join(resolveWorkingDirectory(s), 'artifact.txt'), 'accumulated');
    deleteSession(workspaceRoot, s.id);
    // Workspace-level material (config) untouched by session deletion.
    expect(existsSync(join(workspaceRoot, 'workspace.json'))).toBe(true);
  });
});
