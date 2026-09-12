/**
 * Session Storage (R08).
 *
 * Workspace-scoped session CRUD. Each session is one directory:
 *   {workspaceRootPath}/sessions/{id}/
 *     ├── session.jsonl        (line 1 = header, lines 2+ = messages)
 *     ├── attachments/
 *     ├── data/
 *     ├── long_responses/
 *     └── downloads/
 *
 * Isolation semantics: a session's workingDirectory defaults to its own
 * directory, so tool-execution cwd is injected per session — two parallel
 * research tasks write search results/downloads/intermediate artifacts to
 * physically separate places. This is the technical substance of "not
 * just opening another window".
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'fs';
import { join, basename } from 'path';
import type {
  StoredSession,
  SessionHeader,
  StoredMessage,
  SessionConfig,
  SessionStatus,
} from '@threadcove/core/types';
import { generateUniqueSessionId } from './slug-generator.ts';
import { toPortablePath, expandPath } from '@threadcove/core/utils';
import { validateSessionId, sanitizeSessionId } from './validation.ts';
import { readSessionHeader, readSessionJsonl } from './jsonl.ts';
import { sessionPersistenceQueue } from './persistence-queue.ts';

// ============================================================
// Directory utilities
// ============================================================

/** Path to a session's directory (defense-in-depth: sanitizes the ID). */
export function getSessionPath(workspaceRootPath: string, sessionId: string): string {
  // Defense-in-depth: strip any path components from sessionId.
  // Callers should still validateSessionId before calling this function.
  const safeSessionId = sanitizeSessionId(sessionId);
  return join(getWorkspaceSessionsPath(workspaceRootPath), safeSessionId);
}

export function getWorkspaceSessionsPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'sessions');
}

export function getSessionFilePath(workspaceRootPath: string, sessionId: string): string {
  validateSessionId(sessionId);
  return join(getSessionPath(workspaceRootPath, sessionId), 'session.jsonl');
}

/** Create the session directory with all standard subdirectories. */
export function ensureSessionDir(workspaceRootPath: string, sessionId: string): string {
  const sessionDir = getSessionPath(workspaceRootPath, sessionId);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  for (const sub of ['plans', 'attachments', 'data', 'long_responses', 'downloads']) {
    const dir = join(sessionDir, sub);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  return sessionDir;
}

export function getSessionAttachmentsPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'attachments');
}

export function getSessionPlansPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'plans');
}

export function getSessionDataPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'data');
}

export function getSessionDownloadsPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'downloads');
}

// ============================================================
// CRUD
// ============================================================

/** List all session IDs in a workspace. */
export function listSessionIds(workspaceRootPath: string): string[] {
  const sessionsDir = getWorkspaceSessionsPath(workspaceRootPath);
  if (!existsSync(sessionsDir)) return [];
  return readdirSync(sessionsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/**
 * Create a session with a unique human-readable ID and its directory tree.
 * workingDirectory defaults to the session directory — the isolation anchor.
 */
export async function createSession(
  workspaceRootPath: string,
  options?: { id?: string; name?: string; model?: string; thinkingLevel?: string; provider?: string },
): Promise<StoredSession> {
  const existing = listSessionIds(workspaceRootPath);
  const id = options?.id ?? generateUniqueSessionId(existing);
  validateSessionId(id);

  const sessionDir = ensureSessionDir(workspaceRootPath, id);
  const now = Date.now();

  const session: StoredSession = {
    id,
    workspaceRootPath,
    name: options?.name,
    createdAt: now,
    lastUsedAt: now,
    model: options?.model,
    thinkingLevel: options?.thinkingLevel,
    provider: options?.provider,
    workingDirectory: sessionDir,
    isFlagged: false,
    isArchived: false,
    sessionStatus: 'todo',
    messageCount: 0,
    messages: [],
  };

  // Write the header immediately — subsequent operations (append, update)
  // read from disk, so the session must exist on disk when create returns.
  await persistSessionNow(session);
  return session;
}

/** Load a full session (header + messages). */
export function loadSession(workspaceRootPath: string, sessionId: string): StoredSession | null {
  const sessionFile = getSessionFilePath(workspaceRootPath, sessionId);
  if (!existsSync(sessionFile)) return null;
  return readSessionJsonl(sessionFile);
}

/** Load just the header (cheap list view). */
export function loadSessionHeader(workspaceRootPath: string, sessionId: string): SessionHeader | null {
  const sessionFile = getSessionFilePath(workspaceRootPath, sessionId);
  if (!existsSync(sessionFile)) return null;
  return readSessionHeader(sessionFile);
}

/** List session headers for a workspace (fast list). */
export function listSessionHeaders(workspaceRootPath: string, includeArchived = false): SessionHeader[] {
  const headers: SessionHeader[] = [];
  for (const id of listSessionIds(workspaceRootPath)) {
    const header = loadSessionHeader(workspaceRootPath, id);
    if (!header) continue;
    if (!includeArchived && header.isArchived) continue;
    headers.push(header);
  }
  return headers.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
}

/** Persist a session through the queue (serialized, atomic, portable). */
export function persistSession(session: StoredSession): void {
  sessionPersistenceQueue.enqueue(session);
}

/** Persist immediately and wait (used for tests and shutdown). */
export async function persistSessionNow(session: StoredSession): Promise<void> {
  sessionPersistenceQueue.enqueue(session);
  await sessionPersistenceQueue.flush(session.id, session.workspaceRootPath);
}

const mutations = new Map<string, Promise<unknown>>();
const deleting = new Set<string>();
/** Serialize read-modify-write too, otherwise concurrent appends lose messages. */
export async function mutateSession(root: string, id: string, mutate: (session: StoredSession) => void): Promise<StoredSession | null> {
  const key = getSessionFilePath(root, id);
  if (deleting.has(key)) throw new Error('Session is being deleted');
  const previous = mutations.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(async () => {
    const session = loadSession(root, id);
    if (!session) return null;
    mutate(session);
    await persistSessionNow(session);
    return session;
  });
  mutations.set(key, run);
  try { return await run; }
  finally { if (mutations.get(key) === run) mutations.delete(key); }
}

/** Append messages and persist. */
export async function appendMessages(
  workspaceRootPath: string,
  sessionId: string,
  messages: StoredMessage[],
): Promise<StoredSession | null> {
  return mutateSession(workspaceRootPath, sessionId, session => {
    session.messages.push(...messages);
    session.lastUsedAt = Date.now();
  });
}

/**
 * Update session config fields (header metadata). External metadata edits
 * are protected by the persistence queue's signature comparison.
 */
export async function updateSessionConfig(
  workspaceRootPath: string,
  sessionId: string,
  updates: Partial<SessionConfig>,
): Promise<StoredSession | null> {
  return mutateSession(workspaceRootPath, sessionId, session => { Object.assign(session, updates); });
}

/** Archive a session — data retained, only the flag flips. */
export async function archiveSession(
  workspaceRootPath: string,
  sessionId: string,
  archived: boolean,
): Promise<boolean> {
  const session = await updateSessionConfig(workspaceRootPath, sessionId, {
    isArchived: archived,
    archivedAt: archived ? Date.now() : undefined,
  });
  return session !== null;
}

/** Flag a session. */
export async function flagSession(
  workspaceRootPath: string,
  sessionId: string,
  flagged: boolean,
): Promise<boolean> {
  const session = await updateSessionConfig(workspaceRootPath, sessionId, {
    isFlagged: flagged,
  });
  return session !== null;
}

/** Mark read tracking state. */
export async function markSessionRead(
  workspaceRootPath: string,
  sessionId: string,
  lastReadMessageId: string | undefined,
  hasUnread: boolean,
): Promise<boolean> {
  const session = await updateSessionConfig(workspaceRootPath, sessionId, {
    lastReadMessageId,
    hasUnread,
  });
  return session !== null;
}

/** Delete a session — removes the whole directory. Workspace data untouched. */
export function deleteSession(workspaceRootPath: string, sessionId: string): boolean {
  validateSessionId(sessionId);
  sessionPersistenceQueue.cancel(sessionId, workspaceRootPath);
  const sessionDir = getSessionPath(workspaceRootPath, sessionId);
  if (!existsSync(sessionDir)) return false;
  rmSync(sessionDir, { recursive: true, force: true });
  return true;
}

/** RPC deletion drains mutations and writes before removing the directory. */
export async function deleteSessionSafely(root: string, id: string): Promise<boolean> {
  const key = getSessionFilePath(root, id);
  if (deleting.has(key)) throw new Error('Session is being deleted');
  deleting.add(key);
  try {
    await mutations.get(key)?.catch(() => {});
    sessionPersistenceQueue.cancel(id, root);
    await sessionPersistenceQueue.waitForWrites(id, root).catch(() => {});
    return deleteSession(root, id);
  } finally { deleting.delete(key); }
}

/** Update the effective working directory (session config, not the folder). */
export async function setWorkingDirectory(
  workspaceRootPath: string,
  sessionId: string,
  workingDirectory: string,
): Promise<StoredSession | null> {
  return updateSessionConfig(workspaceRootPath, sessionId, {
    workingDirectory: toPortablePath(workingDirectory),
  });
}

/** Resolve the session's effective working directory (expand portable forms). */
export function resolveWorkingDirectory(session: StoredSession): string {
  if (!session.workingDirectory) return join(session.workspaceRootPath, 'sessions', session.id);
  return expandPath(session.workingDirectory);
}

/** Session status validation. */
export function validateSessionStatus(status: string): boolean {
  const valid: SessionStatus[] = ['todo', 'in_progress', 'needs_review', 'done', 'cancelled'];
  return valid.includes(status as SessionStatus);
}

// ============================================================
// Slug generator (re-exported for API convenience)
// ============================================================

export { generateUniqueSessionId } from './slug-generator.ts';
export { validateSessionId, sanitizeSessionId, isValidSessionId } from './validation.ts';

/** Stat helper for tests. */
export function sessionDirExists(workspaceRootPath: string, sessionId: string): boolean {
  return existsSync(getSessionPath(workspaceRootPath, sessionId));
}

/** Read raw JSONL file content (tests/diagnostics). */
export function readSessionFileRaw(workspaceRootPath: string, sessionId: string): string | null {
  const file = getSessionFilePath(workspaceRootPath, sessionId);
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf-8');
}

/** File mtime helper for tests. */
export function sessionFileMtime(workspaceRootPath: string, sessionId: string): number | null {
  const file = getSessionFilePath(workspaceRootPath, sessionId);
  if (!existsSync(file)) return null;
  return statSync(file).mtimeMs;
}

export { basename };
