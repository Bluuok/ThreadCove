/**
 * Session ID Validation (R08 security).
 *
 * Session IDs become folder names under {workspace}/sessions/. Path
 * traversal would escape the workspace — validate, then sanitize as
 * defense-in-depth.
 */

import { basename } from 'path';

/**
 * Valid session ID pattern.
 * Matches: alphanumeric, hyphens, underscores
 * Examples: "260830-swift-river", "my_session_1", "abc123"
 */
const SESSION_ID_PATTERN = /^[\w-]+$/;

/**
 * Validate that a session ID is safe for use in file paths.
 * Throws a SecurityError if the session ID contains path traversal characters.
 */
export function validateSessionId(sessionId: string): void {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Security Error: Session ID is required');
  }

  // basename() strips directory components, so if it differs, there was traversal
  const sanitized = basename(sessionId);
  if (sanitized !== sessionId) {
    throw new Error('Security Error: Invalid session ID - path traversal detected');
  }

  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('Security Error: Invalid session ID format');
  }
}

/**
 * Sanitize a session ID by stripping any path components.
 * Defense-in-depth: callers should validate first; this is the second gate.
 */
export function sanitizeSessionId(sessionId: string): string {
  if (!sessionId || typeof sessionId !== 'string') {
    return '';
  }
  return basename(sessionId);
}

/** Non-throwing validity check. */
export function isValidSessionId(sessionId: string): boolean {
  try {
    validateSessionId(sessionId);
    return true;
  } catch {
    return false;
  }
}
