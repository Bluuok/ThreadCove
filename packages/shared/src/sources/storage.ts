/**
 * Source Storage (R18) — directory-based source CRUD.
 *
 * Each source is a folder under {workspaceRoot}/sources/{slug}/:
 *   config.json  (FolderSourceConfig)
 *   guide.md     (YAML frontmatter + usage markdown)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join, basename } from 'path';
import type { FolderSourceConfig, LoadedSource, SourceGuide, CreateSourceInput } from './types.ts';
import type { ApiCredential } from '../credentials/types.ts';
import { credentialIdToAccount } from '../credentials/types.ts';
import type { SecureStorageBackend } from '../credentials/secure-storage.ts';

/** Minimal frontmatter parser (key: value lines between --- fences). */
export function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: {}, body: normalized };

  const frontmatter: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) frontmatter[key] = value;
    }
  }
  return { frontmatter, body: normalized.slice(match[0]!.length) };
}

export function getSourcesPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'sources');
}

export function getSourcePath(workspaceRootPath: string, sourceSlug: string): string {
  // Defense-in-depth: strip path components from the slug.
  return join(getSourcesPath(workspaceRootPath), basename(sourceSlug));
}

export function getSourceConfigPath(workspaceRootPath: string, sourceSlug: string): string {
  return join(getSourcePath(workspaceRootPath, sourceSlug), 'config.json');
}

/** Load a source folder (config + guide). */
export function loadSource(workspaceRootPath: string, sourceSlug: string): LoadedSource | null {
  const folderPath = getSourcePath(workspaceRootPath, sourceSlug);
  const configPath = getSourceConfigPath(workspaceRootPath, sourceSlug);
  if (!existsSync(configPath)) return null;

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as FolderSourceConfig;
    let guide: SourceGuide | null = null;
    const guidePath = join(folderPath, 'guide.md');
    if (existsSync(guidePath)) {
      const raw = readFileSync(guidePath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(raw);
      guide = { raw: body, cache: Object.keys(frontmatter).length > 0 ? frontmatter : undefined };
    }
    return { config, guide, folderPath, workspaceRootPath };
  } catch {
    return null;
  }
}

/** List all sources in a workspace. */
export function listSources(workspaceRootPath: string): LoadedSource[] {
  const root = getSourcesPath(workspaceRootPath);
  if (!existsSync(root)) return [];
  const sources: LoadedSource[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = loadSource(workspaceRootPath, entry.name);
    if (source) sources.push(source);
  }
  return sources;
}

/** Create a source folder with config.json (and optional guide.md). */
export function createSource(
  workspaceRootPath: string,
  input: CreateSourceInput,
  guide?: string,
): LoadedSource {
  const slug = basename(input.slug);
  const folderPath = getSourcePath(workspaceRootPath, slug);
  if (existsSync(getSourceConfigPath(workspaceRootPath, slug))) {
    throw new Error(`Source already exists: ${slug}`);
  }

  mkdirSync(folderPath, { recursive: true });
  const now = Date.now();
  const config: FolderSourceConfig = {
    slug,
    name: input.name,
    provider: input.provider,
    type: input.type,
    enabled: input.enabled ?? true,
    isAuthenticated: false,
    createdAt: now,
    updatedAt: now,
    ...(input.type === 'mcp' ? { mcp: input.mcp } : {}),
    ...(input.type === 'api' ? { api: input.api } : {}),
    ...(input.type === 'local' ? { local: input.local } : {}),
  };

  writeFileSync(getSourceConfigPath(workspaceRootPath, slug), JSON.stringify(config, null, 2), 'utf-8');
  if (guide !== undefined) {
    writeFileSync(join(folderPath, 'guide.md'), guide, 'utf-8');
  }

  return loadSource(workspaceRootPath, slug)!;
}

/** Delete a source folder entirely (credentials are managed separately). */
export function deleteSource(workspaceRootPath: string, sourceSlug: string): boolean {
  const folderPath = getSourcePath(workspaceRootPath, sourceSlug);
  if (!existsSync(folderPath)) return false;
  rmSync(folderPath, { recursive: true, force: true });
  return true;
}

// ============================================================
// Credential integration
// ============================================================

/**
 * Source credential manager: bridges source slugs to the encrypted vault.
 * Credentials are keyed per workspace + source, and never leave the host
 * process once stored.
 */
export class SourceCredentialManager {
  constructor(
    private readonly storage: SecureStorageBackend,
    private readonly workspaceId: string,
  ) {}

  /** Vault account key for a source's bearer/API token. */
  private account(sourceSlug: string): string {
    return credentialIdToAccount({ kind: 'source_token', workspaceId: this.workspaceId, sourceSlug });
  }

  getToken(sourceSlug: string): string | null {
    return this.storage.getCredential(this.account(sourceSlug));
  }

  setToken(sourceSlug: string, token: string): void {
    this.storage.setCredential(this.account(sourceSlug), token);
  }

  setCredential(sourceSlug: string, credential: ApiCredential): void {
    this.storage.setCredential(
      this.account(sourceSlug),
      typeof credential === 'string' ? credential : JSON.stringify(credential),
    );
  }

  removeCredential(sourceSlug: string): boolean {
    return this.storage.deleteCredential(this.account(sourceSlug));
  }
}
