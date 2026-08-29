/**
 * Debounced Session Persistence Queue (R08).
 *
 * Serializes writes per session (rapid successive flushes must not race on
 * the shared .tmp file), coalesces rapid persist calls into one write, and
 * protects header metadata changed externally (name/flag/status edits made
 * outside this process are not clobbered by stale in-memory values).
 */

import { writeFile, rename, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import type { SessionHeader, StoredSession } from '@threadcove/core/types';
import { createSessionHeader, makeSessionPathPortable, readSessionHeader } from './jsonl.ts';
import { sanitizeSessionId } from './validation.ts';

interface PendingWrite {
  data: StoredSession;
  timer: ReturnType<typeof setTimeout>;
}

/** Metadata fields whose external edits are protected. */
const METADATA_FIELDS = [
  'name',
  'isFlagged',
  'sessionStatus',
  'isArchived',
  'lastReadMessageId',
  'hasUnread',
] as const;

function getHeaderMetadataSignature(header: SessionHeader): string {
  const signature: Record<string, unknown> = {};
  for (const field of METADATA_FIELDS) {
    signature[field] = header[field];
  }
  return JSON.stringify(signature);
}

function mergeHeaderWithExternalMetadata(localHeader: SessionHeader, diskHeader: SessionHeader): SessionHeader {
  const merged: Record<string, unknown> = { ...localHeader };
  for (const field of METADATA_FIELDS) {
    merged[field] = diskHeader[field];
  }
  return merged as unknown as SessionHeader;
}

export class SessionPersistenceQueue {
  private pending = new Map<string, PendingWrite>();
  private writeInProgress = new Map<string, Promise<void>>();
  private lastWrittenHeaderSignature = new Map<string, string>();

  constructor(private readonly debounceMs: number = 500) {}

  /**
   * Queue a session for persistence. A pending write for the same session
   * is replaced with the new data and the timer resets (coalescing).
   */
  enqueue(session: StoredSession): void {
    const existing = this.pending.get(session.id);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => {
      void this.write(session.id);
    }, this.debounceMs);

    this.pending.set(session.id, { data: session, timer });
  }

  /** Immediate write path — serialized per session via a promise chain. */
  private async write(sessionId: string): Promise<void> {
    // Serialize writes per session: concurrent flush/timer writes for the
    // same ID must not interleave unlink/rename on the shared target file
    // (Windows EPERM) or race the .tmp→target rename pair.
    const previous = this.writeInProgress.get(sessionId);
    const run = previous
      ? previous.then(() => this.writeInner(sessionId))
      : this.writeInner(sessionId);
    const promise = run.catch(() => {
      // Swallow: write errors are logged inside writeInner.
    });
    this.writeInProgress.set(sessionId, promise);
    try {
      await promise;
    } finally {
      if (this.writeInProgress.get(sessionId) === promise) {
        this.writeInProgress.delete(sessionId);
      }
    }
  }

  private async writeInner(sessionId: string): Promise<void> {
    const entry = this.pending.get(sessionId);
    if (!entry) return;
    this.pending.delete(sessionId);

    const { data } = entry;
    const safeId = sanitizeSessionId(sessionId);
    const sessionDir = join(data.workspaceRootPath, 'sessions', safeId);
    await mkdir(sessionDir, { recursive: true });
    const filePath = join(sessionDir, 'session.jsonl');

    const localHeader = createSessionHeader(data);
    const diskHeader = readSessionHeader(filePath);
    const previousSig = this.lastWrittenHeaderSignature.get(sessionId);
    const diskSig = diskHeader ? getHeaderMetadataSignature(diskHeader) : undefined;

    // Preserve disk metadata only when it diverged from our last written
    // signature — that indicates an external mutation.
    const hasExternalMetadataChange =
      !!diskHeader && !!diskSig && !!previousSig && diskSig !== previousSig;
    const header =
      hasExternalMetadataChange && diskHeader
        ? mergeHeaderWithExternalMetadata(localHeader, diskHeader)
        : localHeader;

    const lines = [
      makeSessionPathPortable(JSON.stringify(header), sessionDir),
      ...data.messages.map((m) => makeSessionPathPortable(JSON.stringify(m), sessionDir)),
    ];

    // Update signature before write so fs.watch self-writes are recognized.
    this.lastWrittenHeaderSignature.set(sessionId, getHeaderMetadataSignature(header));

    // Atomic write: .tmp then rename. The tmp filename is per-write unique
    // but write() serializes per session, so the rename pair is safe.
    const tmpFile = `${filePath}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`;
    await writeFile(tmpFile, lines.join('\n') + '\n', 'utf-8');
    try {
      await unlink(filePath);
    } catch {
      /* ignore if doesn't exist */
    }
    await rename(tmpFile, filePath);
  }

  /**
   * Immediately flush a pending session. The write path is serialized
   * inside write() itself, so callers can await this directly.
   */
  async flush(sessionId: string): Promise<void> {
    const entry = this.pending.get(sessionId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(sessionId);

    // Stage the data back and run a serialized write.
    await this.writeNow(sessionId, entry.data);
  }

  private async writeNow(sessionId: string, data: StoredSession): Promise<void> {
    this.pending.set(sessionId, {
      data,
      timer: setTimeout(() => this.pending.delete(sessionId), this.debounceMs),
    });
    await this.write(sessionId);
  }

  /** Cancel a pending write (e.g., session deleted). */
  cancel(sessionId: string): void {
    const entry = this.pending.get(sessionId);
    if (entry) {
      clearTimeout(entry.timer);
      this.pending.delete(sessionId);
    }
    this.lastWrittenHeaderSignature.delete(sessionId);
  }

  /** Flush all pending sessions (call on app quit). */
  async flushAll(): Promise<void> {
    const ids = [...this.pending.keys()];
    await Promise.all(ids.map((id) => this.flush(id)));
  }

  hasPending(sessionId: string): boolean {
    return this.pending.has(sessionId);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  getLastWrittenSignature(sessionId: string): string | undefined {
    return this.lastWrittenHeaderSignature.get(sessionId);
  }
}

/** Singleton instance used by the session layer. */
export const sessionPersistenceQueue = new SessionPersistenceQueue();
