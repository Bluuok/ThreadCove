import { writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SessionHeader, StoredSession } from '@threadcove/core/types';
import { createSessionHeader, makeSessionPathPortable, readSessionHeader } from './jsonl.ts';
import { validateSessionId } from './validation.ts';

const METADATA_FIELDS = ['name', 'isFlagged', 'sessionStatus', 'isArchived', 'lastReadMessageId', 'hasUnread'] as const;
function signature(header: SessionHeader): string {
  return JSON.stringify(Object.fromEntries(METADATA_FIELDS.map(field => [field, header[field]])));
}
type FileOps = { writeFile: typeof writeFile; rename: typeof rename; unlink: typeof unlink; mkdir: typeof mkdir };
interface PendingWrite { data: StoredSession; timer: ReturnType<typeof setTimeout> }

/** Snapshot writes are serialized by absolute workspace + session, with observable failures. */
export class SessionPersistenceQueue {
  private pending = new Map<string, PendingWrite>();
  private inFlight = new Map<string, Promise<void>>();
  private errors = new Map<string, unknown>();
  private signatures = new Map<string, string>();
  constructor(private readonly debounceMs = 500, private readonly fs: FileOps = { writeFile, rename, unlink, mkdir }) {}
  private key(root: string, id: string): string {
    validateSessionId(id);
    const path = resolve(root, 'sessions', id);
    return process.platform === 'win32' ? path.toLowerCase() : path;
  }
  private keys(id: string, root?: string): string[] {
    if (root) return [this.key(root, id)];
    return [...new Set([...this.pending.keys(), ...this.inFlight.keys(), ...this.errors.keys(), ...this.signatures.keys()])]
      .filter(key => key.endsWith(join('sessions', id)));
  }
  enqueue(session: StoredSession): void {
    const key = this.key(session.workspaceRootPath, session.id);
    const previous = this.pending.get(key);
    if (previous) clearTimeout(previous.timer);
    const data = structuredClone(session);
    const timer = setTimeout(() => {
      // Timer failures stay recorded; flush/flushAll will report them.
      void this.write(key).catch(() => {});
    }, this.debounceMs);
    this.pending.set(key, { data, timer });
  }
  private write(key: string): Promise<void> {
    const pending = this.pending.get(key);
    if (!pending) return this.inFlight.get(key) ?? (this.errors.has(key) ? Promise.reject(this.errors.get(key)) : Promise.resolve());
    clearTimeout(pending.timer);
    this.pending.delete(key);
    const previous = this.inFlight.get(key) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(() => this.writeSnapshot(key, pending.data));
    this.inFlight.set(key, run);
    void run.then(() => {
      this.errors.delete(key);
      if (this.inFlight.get(key) === run) this.inFlight.delete(key);
    }, error => {
      this.errors.set(key, error);
      if (this.inFlight.get(key) === run) this.inFlight.delete(key);
    });
    return run;
  }
  private async writeSnapshot(key: string, data: StoredSession): Promise<void> {
    const dir = join(data.workspaceRootPath, 'sessions', data.id);
    await this.fs.mkdir(dir, { recursive: true });
    const target = join(dir, 'session.jsonl');
    const header = createSessionHeader(data);
    const disk = readSessionHeader(target);
    const previous = this.signatures.get(key);
    if (disk && previous && signature(disk) !== previous) {
      for (const field of METADATA_FIELDS) Object.assign(header, { [field]: disk[field] });
    }
    const lines = [header, ...data.messages].map(value => makeSessionPathPortable(JSON.stringify(value), dir));
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await this.fs.writeFile(temp, lines.join('\n') + '\n', { encoding: 'utf-8', flag: 'wx', flush: true });
      // Same-directory rename replaces the destination. Never delete the old file first.
      await this.fs.rename(temp, target);
      this.signatures.set(key, signature(header));
    } finally {
      await this.fs.unlink(temp).catch(() => {});
    }
  }
  async flush(id: string, root?: string): Promise<void> {
    await Promise.all(this.keys(id, root).map(key => this.write(key)));
  }
  cancel(id: string, root?: string): void {
    for (const key of this.keys(id, root)) {
      const entry = this.pending.get(key);
      if (entry) clearTimeout(entry.timer);
      this.pending.delete(key);
      this.signatures.delete(key);
      this.errors.delete(key);
    }
  }
  async flushAll(): Promise<void> {
    await Promise.all([...new Set([...this.pending.keys(), ...this.inFlight.keys(), ...this.errors.keys()])].map(key => this.write(key)));
  }
  hasPending(id: string, root?: string): boolean { return this.keys(id, root).some(key => this.pending.has(key)); }
  async waitForWrites(id: string, root: string): Promise<void> {
    await this.inFlight.get(this.key(root, id));
  }
  get pendingCount(): number { return this.pending.size; }
  getLastWrittenSignature(id: string, root?: string): string | undefined {
    const key = this.keys(id, root)[0];
    return key ? this.signatures.get(key) : undefined;
  }
}
export const sessionPersistenceQueue = new SessionPersistenceQueue();
