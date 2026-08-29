/**
 * Server DTO types — data shapes shared by RPC handlers and clients.
 * Lives in the protocol package so both ends share one source of truth
 * instead of reaching into each other's internals.
 */
import type { SessionHeader } from '@threadcove/core/types';

/**
 * Client-facing session shape (header + runtime state, no messages —
 * messages are lazy-loaded via sessions:getMessages).
 */
export interface SessionDto extends SessionHeader {
  isProcessing?: boolean;
}

/**
 * Session list request/filter.
 */
export interface SessionListArgs {
  workspaceId: string;
  includeArchived?: boolean;
}

/**
 * Workspace DTO.
 */
export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  rootPath: string;
  defaults?: SessionDefaultsDto;
  sessionCount?: number;
}

export interface SessionDefaultsDto {
  model?: string;
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  workingDirectory?: string;
  thinkingLevel?: string;
  enabledSourceSlugs?: string[];
}

/**
 * Source DTO (config only — credentials never cross the wire).
 */
export interface SourceDto {
  slug: string;
  name: string;
  type: 'mcp' | 'api' | 'local';
  enabled: boolean;
  isAuthenticated?: boolean;
  /** Tool names currently exposed by this source (proxy names for MCP) */
  toolNames?: string[];
}
