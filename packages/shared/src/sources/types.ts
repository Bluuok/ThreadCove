/**
 * Source Types (R18).
 *
 * Sources are external data connections (MCP servers, APIs, local
 * filesystems). One directory per source:
 *   {workspaceRoot}/sources/{sourceSlug}/
 *     ├── config.json   - Source settings
 *     └── guide.md      - Usage guidelines (YAML frontmatter + markdown)
 */

/** Source types — how we connect. */
export type SourceType = 'mcp' | 'api' | 'local';

/** MCP source authentication types. */
export type SourceMcpAuthType = 'oauth' | 'bearer' | 'none';

/** API authentication types. */
export type ApiAuthType = 'bearer' | 'header' | 'query' | 'basic' | 'oauth' | 'none';

/** MCP transport type for sources. */
export type McpTransport = 'http' | 'sse' | 'stdio';

/**
 * MCP-specific configuration.
 * Supports HTTP-based and local stdio-based MCP servers.
 */
export interface McpSourceConfig {
  /** Transport type. Defaults to 'http' if not specified. */
  transport?: McpTransport;

  // === HTTP/SSE transport fields ===
  /** URL endpoint for HTTP or SSE transport. */
  url?: string;

  /** Authentication type for HTTP/SSE servers. */
  authType?: SourceMcpAuthType;

  /** Static headers from config (non-secret). Lowest precedence. */
  headers?: Record<string, string>;

  // === Stdio transport fields ===
  /** Command to spawn for stdio transport. */
  command?: string;
  /** Arguments to pass to the command. */
  args?: string[];
  /** Environment variables for the spawned process. */
  env?: Record<string, string>;
}

/**
 * API-specific configuration.
 */
export interface ApiSourceConfig {
  baseUrl: string;
  authType: ApiAuthType;
  /** For 'header' auth (e.g., "X-API-Key") */
  headerName?: string;
  /** For 'bearer' auth (default "Bearer", could be "Token") */
  authScheme?: string;
  /** Headers included with every request. */
  defaultHeaders?: Record<string, string>;
  /** Human-readable documentation path or description. */
  documentation?: string;
}

/**
 * Local filesystem/app configuration.
 */
export interface LocalSourceConfig {
  path: string;
  /** Optional hint: 'filesystem' | 'obsidian' | 'git' | 'sqlite' | etc. */
  format?: string;
}

/**
 * Main source configuration (stored in config.json).
 */
export interface FolderSourceConfig {
  slug: string;
  name: string;
  /** Freeform label (e.g., "linear", "arxiv", "my-notes") */
  provider: string;
  type: SourceType;
  enabled: boolean;

  // Type-specific configuration (exactly one present, matching `type`)
  mcp?: McpSourceConfig;
  api?: ApiSourceConfig;
  local?: LocalSourceConfig;

  /** Status tracking */
  isAuthenticated?: boolean;

  createdAt?: number;
  updatedAt?: number;
}

/**
 * Source creation input (config.json content, without auto-generated fields).
 */
export interface CreateSourceInput {
  slug: string;
  name: string;
  provider: string;
  type: SourceType;
  enabled?: boolean;
  mcp?: McpSourceConfig;
  api?: ApiSourceConfig;
  local?: LocalSourceConfig;
}

/**
 * Parsed guide.md content.
 */
export interface SourceGuide {
  /** Full raw markdown (without frontmatter) */
  raw: string;
  /** Parsed frontmatter cache (arbitrary key-values) */
  cache?: Record<string, unknown>;
}

/**
 * Fully loaded source with its files.
 */
export interface LoadedSource {
  config: FolderSourceConfig;
  guide: SourceGuide | null;
  /** Absolute path to source folder */
  folderPath: string;
  /** Absolute path to workspace folder */
  workspaceRootPath: string;
}
