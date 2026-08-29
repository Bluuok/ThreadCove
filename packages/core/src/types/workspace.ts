/**
 * Workspace types — the top-level organizational unit.
 *
 * Everything (sources, skills, sessions) is scoped to a workspace.
 * Directory structure:
 *   ~/.<app>/workspaces/{slug}/
 *     ├── workspace.json   - Workspace settings (defaults)
 *     ├── sources/         - Data sources (MCP, API, local)
 *     ├── skills/          - Skills (SKILL.md)
 *     └── sessions/        - Conversation sessions
 */

/**
 * Default settings for new sessions in this workspace.
 * This is the workspace-level preference isolation surface.
 */
export interface WorkspaceDefaults {
  model?: string;
  /** Default LLM connection slug for new sessions */
  defaultLlmConnection?: string;
  /** Sources enabled by default */
  enabledSourceSlugs?: string[];
  /** Default permission mode */
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  /** Working directory override for new sessions */
  workingDirectory?: string;
  /** Default thinking level for new sessions */
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

/**
 * Workspace configuration (stored in workspace.json).
 */
export interface WorkspaceConfig {
  id: string;
  name: string;
  slug: string; // Folder name (URL-safe)
  defaults?: WorkspaceDefaults;
  createdAt: number;
  updatedAt: number;
}

/**
 * Workspace with resolved paths.
 */
export interface Workspace {
  config: WorkspaceConfig;
  /** Absolute path to the workspace folder (supports any disk location) */
  rootPath: string;
}

/**
 * Workspace creation input.
 */
export interface CreateWorkspaceInput {
  name: string;
  slug?: string;
  defaults?: WorkspaceDefaults;
}
