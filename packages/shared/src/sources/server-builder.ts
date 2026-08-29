/**
 * SourceServerBuilder (R18).
 *
 * Builds MCP and API server configurations from LoadedSource objects.
 * Handles URL normalization and server config creation, but does NOT
 * fetch credentials — credentials are passed in by the caller.
 *
 * Separation of concerns:
 * - SourceCredentialManager: handles credential lookup
 * - SourceServerBuilder: handles server configuration
 */

import type { LoadedSource, McpTransport } from './types.ts';
import { isMultiHeaderCredential, type ApiCredential } from '../credentials/types.ts';

/**
 * Standard error messages for server build failures.
 * Use these constants instead of string literals for consistent matching.
 */
export const SERVER_BUILD_ERRORS = {
  AUTH_REQUIRED: 'Authentication required',
  TOKEN_EXPIRED: 'Token expired',
  CREDENTIALS_NEEDED: 'Credentials needed',
} as const;

/**
 * MCP server configuration compatible with the Claude Agent SDK.
 * Supports HTTP/SSE (remote) and stdio (local subprocess) transports.
 */
export type McpServerConfig =
  | { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> };

/**
 * Source with its credential pre-loaded.
 */
export interface SourceWithCredential {
  source: LoadedSource;
  /** Token for MCP sources, or ApiCredential for API sources */
  token?: string | null;
  credential?: ApiCredential | null;
}

/** Normalize MCP URLs: bare hosts default to http, /mcp path appended. */
export function normalizeMcpUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  const parsed = new URL(url);
  if (parsed.pathname === '/' || parsed.pathname === '') {
    parsed.pathname = '/mcp';
  }
  return parsed.toString();
}

/**
 * Build the Authorization header value from an auth scheme and token.
 * Three states:
 * - scheme "Bearer" (default):  "Bearer {token}"
 * - custom scheme (e.g. "Token"): "{scheme} {token}"
 * - empty scheme "":            "{token}" (bare token)
 */
export function buildAuthorizationHeader(authScheme: string | undefined, token: string): string {
  // Nullish coalescing: empty string "" is preserved, only undefined/null → 'Bearer'
  const scheme = authScheme ?? 'Bearer';
  return scheme ? `${scheme} ${token}` : token;
}

/**
 * SourceServerBuilder — builds server configs from sources.
 */
export class SourceServerBuilder {
  /**
   * Build an MCP server config from a source.
   *
   * Header precedence (three layers, lowest → highest):
   * 1. Static headers from config (non-secret)
   * 2. Credential-store multi-headers (secret API keys)
   * 3. Authorization: Bearer token (auth token overrides everything)
   *
   * A source claiming isAuthenticated but missing its token returns null
   * (needs re-auth) rather than silently connecting unauthenticated.
   */
  buildMcpServer(
    source: LoadedSource,
    token: string | null,
    credential?: ApiCredential | null,
  ): McpServerConfig | null {
    if (source.config.type !== 'mcp' || !source.config.mcp) {
      return null;
    }

    const mcp = source.config.mcp;

    // Stdio transport (local subprocess servers)
    if ((mcp.transport ?? 'http') === 'stdio') {
      if (!mcp.command) {
        return null; // invalid stdio config
      }
      return {
        type: 'stdio',
        command: mcp.command,
        args: mcp.args,
        env: mcp.env,
      };
    }

    const transport: McpTransport = mcp.transport ?? 'http';
    if (!mcp.url) {
      return null;
    }

    const url = normalizeMcpUrl(mcp.url);
    const config: McpServerConfig = {
      type: transport === 'sse' ? 'sse' : 'http',
      url,
    };

    let mergedHeaders: Record<string, string> = {};

    // 1. Static headers from config (e.g., X-Custom-Header: value)
    if (mcp.headers) {
      mergedHeaders = { ...mcp.headers };
    }

    // 2. Credential-store headers (e.g., X-API-Key from the vault)
    if (credential && isMultiHeaderCredential(credential)) {
      mergedHeaders = { ...mergedHeaders, ...credential };
    }

    // 3. Auth token (highest priority — bearer overrides everything)
    const authType = mcp.authType ?? 'none';
    if (authType !== 'none') {
      if (token) {
        mergedHeaders = { ...mergedHeaders, Authorization: `Bearer ${token}` };
      } else if (source.config.isAuthenticated) {
        // Claims authenticated but token missing — needs re-auth.
        return null;
      }
    }

    if (Object.keys(mergedHeaders).length > 0) {
      (config as { headers?: Record<string, string> }).headers = mergedHeaders;
    }

    return config;
  }

  /**
   * Build all MCP server configs from a list of sources.
   * Failed builds are collected in `errors` (missing auth, invalid config).
   */
  buildAllMcpServers(
    sources: Array<SourceWithCredential>,
  ): {
    mcpServers: Record<string, McpServerConfig>;
    errors: Array<{ sourceSlug: string; error: string }>;
  } {
    const mcpServers: Record<string, McpServerConfig> = {};
    const errors: Array<{ sourceSlug: string; error: string }> = [];

    for (const { source, token, credential } of sources) {
      if (source.config.type !== 'mcp') continue;
      if (!source.config.enabled) continue;

      const config = this.buildMcpServer(source, token ?? null, credential ?? null);
      if (config) {
        mcpServers[source.config.slug] = config;
      } else {
        errors.push({ sourceSlug: source.config.slug, error: SERVER_BUILD_ERRORS.AUTH_REQUIRED });
      }
    }

    return { mcpServers, errors };
  }
}
