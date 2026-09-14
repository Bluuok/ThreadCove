import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SecureStorageBackend } from '../credentials/secure-storage.ts';
import { getAppRootPath } from './models.ts';

export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1';
export const OPENCODE_GO_MODEL = 'deepseek-v4.1-flash';
const ACCOUNT = 'llm_api_key::opencode-go';

export function openCodeGoCredentialPath(): string {
  return join(getAppRootPath(), 'opencode-go.credentials.enc');
}

export function loadOpenCodeGoKey(): string | undefined {
  const filePath = openCodeGoCredentialPath();
  if (!existsSync(filePath)) return undefined;
  const key = new SecureStorageBackend({ filePath }).getCredential(ACCOUNT);
  if (!key) throw new Error('Cannot read the local OpenCode Go credential. Reconfigure the connection.');
  return key;
}

export function saveOpenCodeGoKey(key: string): void {
  if (!key.trim()) throw new Error('OpenCode Go API key is required');
  new SecureStorageBackend({ filePath: openCodeGoCredentialPath() }).setCredential(ACCOUNT, key.trim());
}
