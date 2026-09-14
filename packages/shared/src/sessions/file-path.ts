import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { validateSessionId } from './validation.ts';

/** File RPC exposes only user artifacts under data/, never session.jsonl. */
export function resolveSessionFilePath(root: string, sessionId: string, subPath = ''): string {
  validateSessionId(sessionId);
  if (typeof subPath !== 'string' || [...subPath].some(char => char.charCodeAt(0) < 32 || char === ':') || isAbsolute(subPath) || win32.isAbsolute(subPath)) {
    throw new Error('Invalid session file path');
  }
  const parts = subPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.some(p => p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) {
    throw new Error('Session file path escapes the artifact directory');
  }
  const workspace = realpathSync(root);
  const base = join(workspace, 'sessions', sessionId, 'data');
  const target = resolve(base, ...parts);
  const rel = relative(base, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Session file path escapes the artifact directory');
  // Reject links at every boundary, including sessions/, the session and data/.
  // Parents must exist; WRITE never creates arbitrary directory trees.
  const segments = ['sessions', sessionId, 'data', ...parts];
  let cursor = workspace;
  for (let i = 0; i < segments.length; i++) {
    cursor = join(cursor, segments[i]!);
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error('Linked session file paths are not allowed');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || i < segments.length - 1) throw error;
    }
  }
  return target;
}
