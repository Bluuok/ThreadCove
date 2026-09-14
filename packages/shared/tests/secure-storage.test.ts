import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecureStorageBackend } from '../src/credentials/secure-storage.ts';

test('encrypted credentials survive opening a new storage instance', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tc-vault-'));
  try {
    const options = { filePath: join(directory, 'credentials.enc'), machineId: () => 'fixture-machine', iterations: 1000 };
    new SecureStorageBackend(options).setCredential('llm_api_key::fixture', 'fixture-value');
    expect(new SecureStorageBackend(options).getCredential('llm_api_key::fixture')).toBe('fixture-value');
    expect(readFileSync(options.filePath).includes(Buffer.from('fixture-value'))).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
