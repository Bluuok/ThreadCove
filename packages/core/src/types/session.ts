/**
 * Session types — workspace-scoped sessions.
 *
 * Sessions are stored at {workspaceRootPath}/sessions/{id}/session.jsonl.
 */

import type { StoredMessage } from './message.ts';

/**
 * Session status (user-controlled, never automatic).
 */
export type SessionStatus = 'todo' | 'in_progress' | 'needs_review' | 'done' | 'cancelled';

/**
 * Session configuration (persisted metadata — the JSONL header subset).
 */
export interface SessionConfig {
  lastRun?: { id: string; requestId: string; status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; error?: string };
  id: string;
  /** SDK session ID (captured after first message; backend-specific) */
  sdkSessionId?: string;
  /** Workspace root path this session belongs to */
  workspaceRootPath: string;
  /** Optional user-defined name */
  name?: string;
  createdAt: number;
  lastUsedAt: number;
  /** Whether this session is flagged */
  isFlagged?: boolean;
  /** User-controlled session status */
  sessionStatus?: SessionStatus;
  /** ID of last message user has read */
  lastReadMessageId?: string;
  /** Explicit unread flag — single source of truth for the NEW badge */
  hasUnread?: boolean;
  /** Working directory for this session (defaults to the session directory) */
  workingDirectory?: string;
  /** Model for this session */
  model?: string;
  /** Thinking level for this session */
  thinkingLevel?: string;
  /** Backend provider for this session ('anthropic' | 'pi') */
  provider?: string;
  /** Archive marker — archived sessions keep their data */
  isArchived?: boolean;
  archivedAt?: number;
}

/**
 * Pre-computed header fields for fast list loading.
 */
export interface SessionHeader extends SessionConfig {
  /** Pre-computed message count */
  messageCount: number;
  /** Pre-computed preview (first user message, truncated) */
  preview?: string;
  /** Pre-computed last message role for badge display */
  lastMessageRole?: 'user' | 'assistant' | 'tool' | 'error';
  /** Pre-computed ID of the last final assistant message (unread detection) */
  lastFinalMessageId?: string;
}

/**
 * Full stored session: header fields plus parsed messages.
 */
export interface StoredSession extends SessionHeader {
  messages: StoredMessage[];
}
