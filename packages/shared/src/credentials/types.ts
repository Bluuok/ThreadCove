/**
 * Credential types (R18).
 *
 * Credentials are stored in an encrypted vault and injected at the Source
 * boundary. They never appear in RPC payloads, logs, or subprocess
 * environments — the Pi subprocess asks the host to execute source tools
 * precisely so secrets stay in the host process.
 */

/** Multi-header credential: several secret headers stored together. */
export type MultiHeaderCredential = Record<string, string>;

/** Basic auth credential pair. */
export interface BasicAuthCredential {
  username: string;
  password: string;
}

/** Credential shapes stored per source. */
export type ApiCredential = string | BasicAuthCredential | MultiHeaderCredential;

/** Distinguish multi-header credentials from plain tokens. */
export function isMultiHeaderCredential(cred: ApiCredential | null | undefined): cred is MultiHeaderCredential {
  return typeof cred === 'object' && cred !== null && !('username' in cred && 'password' in cred);
}

/** Credential identifier: kind + owner + slug. */
export type CredentialId =
  | { kind: 'source_token'; workspaceId: string; sourceSlug: string }
  | { kind: 'llm_api_key'; slug: string };

export function credentialIdToAccount(id: CredentialId): string {
  switch (id.kind) {
    case 'source_token':
      return `source_token::${id.workspaceId}::${id.sourceSlug}`;
    case 'llm_api_key':
      return `llm_api_key::${id.slug}`;
  }
}

export function accountToCredentialId(account: string): CredentialId | null {
  const parts = account.split('::');
  if (parts[0] === 'source_token' && parts.length === 3) {
    return { kind: 'source_token', workspaceId: parts[1]!, sourceSlug: parts[2]! };
  }
  if (parts[0] === 'llm_api_key' && parts.length === 2) {
    return { kind: 'llm_api_key', slug: parts[1]! };
  }
  return null;
}
