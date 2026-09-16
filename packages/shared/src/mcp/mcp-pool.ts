/**
 * McpClientPool (R18) — central pool of MCP source connections in the host.
 *
 * All MCP sources connect through this pool (single code path), connections
 * are shared across sessions, credentials stay in the host, and sources can
 * switch at runtime without restarting the app.
 *
 * Proxy tool naming: every source tool is exposed to backends as
 * `mcp__{slug}__{originalName}` (sanitized to [a-zA-Z0-9_-]); the pool maps
 * proxy name → { slug, originalName } for dispatch.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface PoolEntry {
  client: Client;
  tools: McpToolDef[];
}

/**
 * Build the proxy tool name exposed to model backends for an MCP source
 * tool. Characters outside [a-zA-Z0-9_-] are sanitized to `_` because some
 * providers reject other characters in function names. Safe because the
 * proxy name is used only as an opaque key into the pool's proxyTools map;
 * dispatch invokes the untouched originalName.
 */
export function proxyToolName(slug: string, toolName: string): string {
  return `mcp__${slug}__${toolName}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export class McpClientPool {
  /** Active clients keyed by source slug */
  private clients = new Map<string, PoolEntry>();
  /** Proxy tool name → { slug, originalName } */
  private proxyTools = new Map<string, { slug: string; originalName: string }>();

  /** Called after sync() connects/disconnects sources. */
  onToolsChanged?: () => void;

  get connectedSlugs(): string[] {
    return [...this.clients.keys()];
  }

  // ============================================================
  // Connection
  // ============================================================

  /**
   * Connect to an MCP source server and register its proxy tools.
   * If already connected, this is a no-op.
   */
  async connect(
    slug: string,
    config:
      | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
      | { type: 'http' | 'sse'; url: string; headers?: Record<string, string> },
  ): Promise<void> {
    if (this.clients.has(slug)) return;

    const client = new Client({ name: 'threadcove', version: '0.1.0' });

    if (config.type === 'stdio') {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: config.env as Record<string, string> | undefined,
      });
      await client.connect(transport);
    } else if (config.type === 'http') {
      const transport = new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      });
      await client.connect(transport);
    } else {
      const transport = new SSEClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      });
      await client.connect(transport);
    }

    const result = await client.listTools();
    const tools: McpToolDef[] = (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
    }));

    this.clients.set(slug, { client, tools });
    for (const tool of tools) {
      const proxyName = proxyToolName(slug, tool.name);
      const existing = this.proxyTools.get(proxyName);
      if (existing && existing.originalName !== tool.name) {
        // Two distinct names sanitized to the same proxy name. Keep first.
        console.warn(`[McpClientPool] proxy collision on ${proxyName}: keeping ${existing.originalName}, skipping ${tool.name}`);
        continue;
      }
      this.proxyTools.set(proxyName, { slug, originalName: tool.name });
    }

    this.onToolsChanged?.();
  }

  /** Disconnect a source and drop its proxy tools. */
  async disconnect(slug: string): Promise<void> {
    const entry = this.clients.get(slug);
    if (!entry) return;
    try {
      await entry.client.close();
    } catch {
      // best-effort close
    }
    this.clients.delete(slug);
    for (const [proxyName, mapping] of [...this.proxyTools.entries()]) {
      if (mapping.slug === slug) this.proxyTools.delete(proxyName);
    }
    this.onToolsChanged?.();
  }

  // ============================================================
  // Tool surface
  // ============================================================

  /** All proxy tool definitions (for backend registration). */
  getProxyToolDefs(): McpToolDef[] {
    const defs: McpToolDef[] = [];
    for (const slug of this.clients.keys()) {
      const entry = this.clients.get(slug)!;
      for (const tool of entry.tools) {
        defs.push({
          name: proxyToolName(slug, tool.name),
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    }
    return defs;
  }

  /** Resolve a proxy name to { slug, originalName }, or null. */
  resolveProxyTool(proxyName: string): { slug: string; originalName: string } | null {
    return this.proxyTools.get(proxyName) ?? null;
  }

  /** Execute a tool by proxy name. */
  async callTool(
    proxyName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ content: string; isError: boolean }> {
    const mapping = this.proxyTools.get(proxyName);
    if (!mapping) {
      return { content: `Unknown tool: ${proxyName}`, isError: true };
    }
    const entry = this.clients.get(mapping.slug);
    if (!entry) {
      return { content: `Source not connected: ${mapping.slug}`, isError: true };
    }
    try {
      const result = await entry.client.callTool({
        name: mapping.originalName,
        arguments: args,
      }, undefined, { signal, timeout: 25_000 });
      const contentBlocks = (result.content ?? []) as Array<{ type: string; text?: string }>;
      const text = contentBlocks
        .map((block) => (block.type === 'text' && block.text ? block.text : ''))
        .join('');
      return { content: text, isError: result.isError === true };
    } catch (err) {
      return { content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }
}
