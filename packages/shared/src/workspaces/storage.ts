/**
 * Workspaces — the top-level organizational unit (R08).
 *
 * Workspace = rootPath (any disk location) + config (defaults).
 * Sessions/sources/skills live under the rootPath; deleting a Session
 * never damages Workspace-accumulated material.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join, basename } from 'path';
import type { Workspace, WorkspaceConfig, CreateWorkspaceInput, WorkspaceDefaults } from '@threadcove/core/types';
import { getWorkspacesRootPath } from '../config/models.ts';

const SCHEMA_VERSION = 1;

// ============================================================
// Slug utilities
// ============================================================

/** Convert a workspace name to a URL-safe folder slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'workspace';
}

// ============================================================
// Path helpers
// ============================================================

export function getWorkspacesPath(): string {
  return getWorkspacesRootPath();
}

export function getWorkspacePath(slug: string): string {
  // Defense-in-depth: strip path components from the slug.
  return join(getWorkspacesPath(), basename(slug));
}

export function getWorkspaceSessionsPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'sessions');
}

export function getWorkspaceSourcesPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'sources');
}

export function getWorkspaceSkillsPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'skills');
}

export function getWorkspaceConfigPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'workspace.json');
}

// ============================================================
// CRUD
// ============================================================

/**
 * Create a workspace. rootPath defaults under ~/.threadcove/workspaces/
 * but any absolute path can be supplied (portable data locations).
 */
export function createWorkspace(input: CreateWorkspaceInput, rootPathOverride?: string): Workspace {
  const slug = input.slug ?? slugify(input.name);
  const rootPath = rootPathOverride ?? getWorkspacePath(slug);

  if (existsSync(getWorkspaceConfigPath(rootPath))) {
    throw new Error(`Workspace already exists at: ${rootPath}`);
  }

  mkdirSync(rootPath, { recursive: true });
  mkdirSync(getWorkspaceSessionsPath(rootPath), { recursive: true });
  mkdirSync(getWorkspaceSourcesPath(rootPath), { recursive: true });
  mkdirSync(getWorkspaceSkillsPath(rootPath), { recursive: true });

  const now = Date.now();
  const config: WorkspaceConfig = {
    id: `ws-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    slug,
    defaults: input.defaults ?? {},
    createdAt: now,
    updatedAt: now,
  };

  writeFileSync(
    getWorkspaceConfigPath(rootPath),
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...config }, null, 2),
    'utf-8',
  );

  return { config, rootPath };
}

/** Load a workspace by slug (folder under the workspaces root). */
export function loadWorkspace(slug: string): Workspace | null {
  const rootPath = getWorkspacePath(slug);
  return loadWorkspaceFrom(rootPath);
}

/** Load a workspace from an explicit rootPath. */
export function loadWorkspaceFrom(rootPath: string): Workspace | null {
  const configPath = getWorkspaceConfigPath(rootPath);
  if (!existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as WorkspaceConfig & { schemaVersion?: number };
    return { config: parsed, rootPath };
  } catch {
    return null;
  }
}

/** List all workspaces under the default root. */
export function listWorkspaces(): Workspace[] {
  const root = getWorkspacesPath();
  if (!existsSync(root)) return [];
  const workspaces: Workspace[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const ws = loadWorkspaceFrom(join(root, entry.name));
    if (ws) workspaces.push(ws);
  }
  return workspaces;
}

/** Delete a workspace folder entirely. Sessions inside are destroyed. */
export function deleteWorkspace(slug: string): void {
  const rootPath = getWorkspacePath(slug);
  if (existsSync(rootPath)) {
    rmSync(rootPath, { recursive: true, force: true });
  }
}

/** Update workspace defaults (preference isolation surface). */
export function updateWorkspaceDefaults(
  workspace: Workspace,
  defaults: Partial<WorkspaceDefaults>,
): void {
  workspace.config.defaults = { ...workspace.config.defaults, ...defaults };
  workspace.config.updatedAt = Date.now();
  writeFileSync(
    getWorkspaceConfigPath(workspace.rootPath),
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...workspace.config }, null, 2),
    'utf-8',
  );
}
