/**
 * JSONL Session Storage (R08).
 *
 * Format: Line 1 = SessionHeader, Lines 2+ = StoredMessage (one per line).
 *
 * Portability: absolute session directory paths are replaced with the
 * {{SESSION_PATH}} token after JSON.stringify (including the Windows
 * JSON-escaped double-backslash form) and expanded before parse — session
 * folders survive moves between machines/directories.
 */

import { openSync, readSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import type { SessionHeader, StoredSession, StoredMessage } from '@threadcove/core/types';
import { normalizePath } from '@threadcove/core/utils';

const SESSION_PATH_TOKEN = '{{SESSION_PATH}}';

// ============================================================
// Session path portability
// ============================================================

/**
 * Replace absolute session directory paths with a portable token.
 * Applied after JSON.stringify so paths embedded anywhere in message
 * content are made portable.
 *
 * On Windows a JSON-serialized line contains backslash paths in their
 * JSON-escaped form (C:\foo → C:\\foo inside the string), so the escaped
 * variant is replaced alongside the normalized forward-slash form.
 */
export function makeSessionPathPortable(jsonLine: string, sessionDir: string): string {
  if (!sessionDir) return jsonLine;
  const normalized = normalizePath(sessionDir);
  if (sessionDir === normalized) {
    // Unix-style or already-normalized path: single replacement form.
    return jsonLine.replaceAll(normalized, SESSION_PATH_TOKEN);
  }
  // Windows path: replace the raw form and the JSON-escaped form
  // (JSON.stringify doubles backslashes inside string values).
  const jsonEscaped = sessionDir.replaceAll('\\', '\\\\');
  return jsonLine
    .replaceAll(jsonEscaped, SESSION_PATH_TOKEN)
    .replaceAll(normalized, SESSION_PATH_TOKEN);
}

/**
 * Expand the portable session path token back to an absolute path.
 * Applied before JSON.parse so path references resolve at runtime.
 *
 * The token expands to the JSON-escaped native form: the surrounding line
 * is still JSON text, so backslashes in Windows paths must be doubled
 * exactly as JSON.stringify would escape them. After JSON.parse the value
 * contains the real single-backslash path.
 */
export function expandSessionPath(jsonLine: string, sessionDir: string): string {
  if (!jsonLine.includes(SESSION_PATH_TOKEN)) return jsonLine;
  const escaped = sessionDir.replaceAll('\\', '\\\\');
  return jsonLine.replaceAll(SESSION_PATH_TOKEN, escaped);
}

// ============================================================
// Read
// ============================================================

/** Read only the header (first line) — cheap list loading. */
export function readSessionHeader(sessionFile: string): SessionHeader | null {
  try {
    const fd = openSync(sessionFile, 'r');
    const buffer = Buffer.alloc(8192);
    const bytesRead = readSync(fd, buffer, 0, 8192, 0);
    closeSync(fd);

    const content = buffer.toString('utf-8', 0, bytesRead);
    const firstNewline = content.indexOf('\n');
    const firstLine = firstNewline > 0 ? content.slice(0, firstNewline) : content;

    return JSON.parse(expandSessionPath(firstLine, dirname(sessionFile))) as SessionHeader;
  } catch {
    return null;
  }
}

/** Read the full session (header + all message lines). */
export function readSessionJsonl(sessionFile: string): StoredSession | null {
  try {
    const content = readFileSync(sessionFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    const firstLine = lines[0];
    if (!firstLine) return null;

    const sessionDir = dirname(sessionFile);
    const header = JSON.parse(expandSessionPath(firstLine, sessionDir)) as SessionHeader;
    const messageLines = lines.slice(1).map((line) => expandSessionPath(line, sessionDir));
    const messages = parseMessagesResilient(messageLines);

    return { ...header, messages };
  } catch {
    return null;
  }
}

/** Read only messages (skips header). */
export function readSessionMessages(sessionFile: string): StoredMessage[] {
  try {
    const content = readFileSync(sessionFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const sessionDir = dirname(sessionFile);
    const expanded = lines.slice(1).map((line) => expandSessionPath(line, sessionDir));
    return parseMessagesResilient(expanded);
  } catch {
    return [];
  }
}

/**
 * Parse message lines resiliently: skip lines that fail JSON.parse
 * (e.g., truncated by a crash) rather than losing the whole session.
 */
function parseMessagesResilient(lines: string[]): StoredMessage[] {
  const messages: StoredMessage[] = [];
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line) as StoredMessage);
    } catch {
      // Corrupted/truncated line — skip and continue.
    }
  }
  return messages;
}

// ============================================================
// Write
// ============================================================

/**
 * Write session to JSONL using atomic write (write-to-temp-then-rename).
 * Either the old file remains intact or the new file is fully written.
 */
export function writeSessionJsonl(sessionFile: string, session: StoredSession): void {
  const header = createSessionHeader(session);
  const sessionDir = dirname(sessionFile);

  const lines = [
    makeSessionPathPortable(JSON.stringify(header), sessionDir),
    ...session.messages.map((m) => makeSessionPathPortable(JSON.stringify(m), sessionDir)),
  ];

  const tmpFile = sessionFile + '.tmp';
  writeFileSync(tmpFile, lines.join('\n') + '\n');
  try {
    renameSync(tmpFile, sessionFile);
  } finally {
    try { unlinkSync(tmpFile); } catch { /* renamed or absent */ }
  }
}

/**
 * Create a SessionHeader from a StoredSession.
 * Pre-computes messageCount/preview/lastMessageRole for fast list loading.
 */
export function createSessionHeader(session: StoredSession): SessionHeader {
  const { messages: _m, ...headerFields } = session;
  return {
    ...headerFields,
    lastUsedAt: Date.now(),
    messageCount: session.messages.length,
    lastMessageRole: extractLastMessageRole(session.messages),
    preview: extractPreview(session.messages),
    lastFinalMessageId: extractLastFinalMessageId(session.messages),
  } as SessionHeader;
}

function extractLastMessageRole(messages: StoredMessage[]): SessionHeader['lastMessageRole'] {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return undefined;
  const role = lastMessage.type;
  if (role === 'user' || role === 'assistant' || role === 'tool' || role === 'error') {
    return role;
  }
  return undefined;
}

function extractLastFinalMessageId(messages: StoredMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.type === 'assistant' && !msg.isIntermediate) {
      return msg.id;
    }
  }
  return undefined;
}

function extractPreview(messages: StoredMessage[]): string | undefined {
  const firstUserMessage = messages.find((m) => m.type === 'user');
  if (!firstUserMessage?.content) return undefined;
  const sanitized = firstUserMessage.content.replace(/\s+/g, ' ').trim();
  return sanitized.substring(0, 150) || undefined;
}
