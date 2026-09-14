/**
 * Secure Storage Backend (R18).
 *
 * Stores credentials in an encrypted file at ~/.threadcove/credentials.enc
 * using AES-256-GCM authenticated encryption.
 *
 * Machine binding: the encryption key is derived with PBKDF2 from the OS
 * hardware identifier —
 * - macOS:  IOPlatformUUID
 * - Windows: MachineGuid (registry, set at OS install)
 * - Linux:  /var/lib/dbus/machine-id
 *
 * IMPORTANT (口径): the machine identifier is a KDF *input* combined with a
 * random per-file salt, not the key itself. Copying credentials.enc to
 * another machine fails because the KDF input differs, not because the UUID
 * "is" the key.
 *
 * File format:
 *   [Header - 64 bytes]
 *   ├── Magic: "TC01\0\0\0" (8 bytes)
 *   ├── Flags: uint32 LE (4 bytes)
 *   ├── Salt: 32 bytes (PBKDF2 salt)
 *   ├── Reserved: 20 bytes
 *   [Encrypted Payload]
 *   ├── IV: 12 bytes (random per write)
 *   ├── Auth Tag: 16 bytes (GCM)
 *   └── Ciphertext: variable (encrypted JSON)
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  pbkdf2Sync,
} from 'crypto';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { userInfo, homedir } from 'os';
import { join, dirname } from 'path';
// File format constants
const MAGIC_BYTES = Buffer.from('TC01\0\0\0\0');
const HEADER_SIZE = 64;
const SALT_SIZE = 32;
const IV_SIZE = 12;
const AUTH_TAG_SIZE = 16;
const KEY_SIZE = 32;

/** PBKDF2 iterations (balance security vs startup time). */
const PBKDF2_ITERATIONS = 100_000;

/** Read a stable machine identifier via injectable command runner.
 * The runner parameter makes this testable — tests inject a fake ID.
 */
export function getStableMachineId(run: (cmd: string) => string = (cmd) => String(execSync(cmd))): string {
  try {
    if (process.platform === 'darwin') {
      const output = run('ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID');
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    } else if (process.platform === 'win32') {
      const output = run('reg query HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid');
      const match = output.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
      if (match?.[1]) return match[1];
    } else {
      const machineIdPath = '/var/lib/dbus/machine-id';
      const altPath = '/etc/machine-id';
      if (existsSync(machineIdPath)) {
        return readFileSync(machineIdPath, 'utf-8').trim();
      } else if (existsSync(altPath)) {
        return readFileSync(altPath, 'utf-8').trim();
      }
    }
  } catch {
    // Fall through to fallback
  }
  return `${userInfo().username}:${homedir()}`;
}

/** Internal credential store structure. */
export interface CredentialStore {
  version: 1;
  credentials: Record<string, string>;
  metadata: {
    createdAt: number;
    updatedAt: number;
  };
}

export interface SecureStorageOptions {
  /** Override the storage file path (tests). */
  filePath?: string;
  /** Override the machine identifier source (tests simulate machine moves). */
  machineId?: () => string;
  /** Override PBKDF2 iterations (tests keep this small for speed). */
  iterations?: number;
}

export class SecureStorageBackend {
  readonly name = 'secure-storage';

  private readonly filePath: string;
  private readonly getMachineId: () => string;
  private readonly iterations: number;
  private cachedStore: CredentialStore | null = null;
  private encryptionKey: Buffer | null = null;
  private salt: Buffer | null = null;

  constructor(options?: SecureStorageOptions) {
    this.filePath = options?.filePath ?? join(homedir(), '.threadcove', 'credentials.enc');
    this.getMachineId = options?.machineId ?? (() => getStableMachineId());
    this.iterations = options?.iterations ?? PBKDF2_ITERATIONS;
  }

  // ============================================================
  // Key derivation
  // ============================================================

  /**
   * Derive the AES-256 key: PBKDF2-HMAC-SHA256 over (machineId) with the
   * file's random salt. The machine ID is an input to derivation, not the
   * key material itself.
   */
  private deriveKey(salt: Buffer): Buffer {
    const machineId = this.getMachineId();
    return pbkdf2Sync(machineId, salt, this.iterations, KEY_SIZE, 'sha256');
  }

  private ensureKey(): void {
    if (this.encryptionKey && this.salt) return;
    if (existsSync(this.filePath)) {
      // Load salt from the existing file header.
      const buf = readFileSync(this.filePath);
      this.salt = buf.subarray(12, 12 + SALT_SIZE);
    } else {
      this.salt = randomBytes(SALT_SIZE);
    }
    this.encryptionKey = this.deriveKey(this.salt);
  }

  // ============================================================
  // Load / save
  // ============================================================

  load(): CredentialStore | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const buf = readFileSync(this.filePath);
      if (buf.length < HEADER_SIZE || !buf.subarray(0, 8).equals(MAGIC_BYTES)) {
        return null;
      }

      const salt = buf.subarray(12, 12 + SALT_SIZE);
      this.salt = salt;
      this.encryptionKey = this.deriveKey(salt);

      const iv = buf.subarray(HEADER_SIZE, HEADER_SIZE + IV_SIZE);
      const tagStart = HEADER_SIZE + IV_SIZE;
      const tag = buf.subarray(tagStart, tagStart + AUTH_TAG_SIZE);
      const ciphertext = buf.subarray(tagStart + AUTH_TAG_SIZE);

      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      this.cachedStore = JSON.parse(plaintext.toString('utf-8')) as CredentialStore;
      return this.cachedStore;
    } catch {
      // Wrong machine (KDF input differs → GCM auth failure) or corruption.
      return null;
    }
  }

  save(store: CredentialStore): void {
    this.ensureKey();
    if (!this.encryptionKey || !this.salt) throw new Error('Key derivation failed');

    const plaintext = Buffer.from(JSON.stringify(store), 'utf-8');
    const iv = randomBytes(IV_SIZE);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const header = Buffer.alloc(HEADER_SIZE);
    MAGIC_BYTES.copy(header, 0);
    header.writeUInt32LE(0, 8); // flags
    this.salt.copy(header, 12);

    const payload = Buffer.concat([iv, tag, ciphertext]);
    const out = Buffer.concat([header, payload]);

    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, out);
    this.cachedStore = store;
  }

  // ============================================================
  // Credential CRUD
  // ============================================================

  getCredential(account: string): string | null {
    const store = this.cachedStore ?? this.load();
    if (!store) return null;
    return store.credentials[account] ?? null;
  }

  setCredential(account: string, value: string): void {
    const store = this.cachedStore ?? this.load() ?? {
      version: 1 as const,
      credentials: {},
      metadata: { createdAt: Date.now(), updatedAt: Date.now() },
    };
    store.credentials[account] = value;
    store.metadata.updatedAt = Date.now();
    this.save(store);
  }

  deleteCredential(account: string): boolean {
    const store = this.cachedStore ?? this.load();
    if (!store || !(account in store.credentials)) return false;
    delete store.credentials[account];
    store.metadata.updatedAt = Date.now();
    this.save(store);
    return true;
  }
}
