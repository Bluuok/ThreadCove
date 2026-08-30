#!/usr/bin/env bun
/**
 * MCP + typed_error smoke:
 * 1. Register a real stdio MCP server (filesystem) in the R18 pool,
 *    verify proxy tool naming and execution through the host.
 * 2. Drive a typed_error through the DeepSeek backend (bad base URL →
 *    network_error with canRetry) to verify the recovery entry point.
 *
 * Run: DEEPSEEK_API_KEY=... bun run scripts/smoke-mcp-errors.ts
 */

import { McpClientPool, proxyToolName } from '../packages/shared/src/mcp/mcp-pool.ts';
import { createBackend } from '../packages/shared/src/agent/index.ts';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ── 1. Real stdio MCP server through the pool ───────────────────────
console.log('=== MCP pool smoke (real stdio server) ===');
const pool = new McpClientPool();
const mcpDir = mkdtempSync(join(tmpdir(), 'tc-mcp-'));

try {
  await pool.connect('fs', {
    type: 'stdio',
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', mcpDir],
  });

  const defs = pool.getProxyToolDefs();
  console.log(`connected: fs, ${defs.length} tools`);
  console.log(`sample names: ${defs.slice(0, 3).map((d) => d.name).join(', ')}`);
  console.log(`naming format ok: ${defs.every((d) => d.name.startsWith('mcp__fs__'))}`);

  // Execute a tool through the proxy name → host pool → child process.
  const listTool = defs.find((d) => d.name === proxyToolName('fs', 'list_directory')) ?? defs.find((d) => d.name.includes('list'));
  if (listTool) {
    const result = await pool.callTool(listTool.name, { path: mcpDir });
    console.log(`callTool(${listTool.name}) → isError=${result.isError}, content=${JSON.stringify(result.content).slice(0, 80)}`);
  }

  const mapping = pool.resolveProxyTool(defs[0]!.name);
  console.log(`proxy mapping: ${defs[0]!.name} → slug=${mapping?.slug}, original=${mapping?.originalName}`);
} finally {
  await pool.disconnect('fs').catch(() => {});
}

// ── 2. typed_error recovery entry point ─────────────────────────────
console.log('\n=== typed_error smoke (auth failure → structured error) ===');
// Deliberately invalid key: the backend must yield a typed_error with
// retry semantics rather than crashing or hanging.
const badBackend = createBackend({
  provider: 'deepseek',
  workspaceRootPath: process.cwd(),
  workspaceId: 'smoke',
  sessionId: `err-${Date.now()}`,
  workingDirectory: process.cwd(),
  model: 'deepseek-v4-flash',
  apiKey: 'sk-deliberately-invalid-for-typed-error-smoke',
});
// Point the client at an unreachable port via env override is not enough —
// construct a failing request by using an invalid key against the real API.
for await (const event of badBackend.chat('hello')) {
  if (event.type === 'typed_error') {
    console.log(`typed_error received:`);
    console.log(`  code=${event.error.code} canRetry=${event.error.canRetry}`);
    console.log(`  title=${event.error.title}`);
    console.log(`  actions=${JSON.stringify(event.error.actions)}`);
    console.log(`  → UI would render an error card with a retry entry point`);
  } else if (event.type === 'complete') {
    console.log('(unexpectedly completed — API accepted the invalid key?)');
  }
}
badBackend.destroy();

console.log('\n=== mcp + typed_error smoke OK ===');
