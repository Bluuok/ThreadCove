/**
 * Headless server entry (R12) — the same server, no window.
 *
 * Demonstrates the "transport layer only written once" claim: the exact
 * same WsRpcServer + handlers + SessionManager that the Electron main
 * process embeds, started standalone so the WebUI can connect.
 *
 * Usage: bun run apps/electron/src/server/headless.ts [port] [workspaceRoot]
 */

import { WsRpcServer } from '../transport/server.ts';
import { SessionManager } from './session-manager.ts';
import { registerHandlers } from './handlers.ts';
import { McpClientPool } from '@threadcove/shared/mcp';
import { createWorkspace, loadWorkspaceFrom } from '@threadcove/shared/workspaces';
import { join } from 'path';

const portArg = Number(process.argv[2] ?? '') || 8787;
const workspaceRoot = process.argv[3]
  ? join(process.cwd(), process.argv[3])
  : join(process.cwd(), '.threadcove-workspace');

// Ensure a workspace exists at the target root (demo convenience).
let workspace = loadWorkspaceFrom(workspaceRoot);
if (!workspace) {
  workspace = createWorkspace(
    { name: 'Headless Workspace' },
    workspaceRoot,
  );
}
const workspaceId = workspace.config.id;

const server = new WsRpcServer({ host: '127.0.0.1', port: portArg });
const sessionManager = new SessionManager(
  server,
  (id) => (id === workspaceId ? workspaceRoot : null),
  new McpClientPool(),
);
sessionManager.registerWorkspace(workspaceId, workspaceRoot);

registerHandlers(server, {
  getWorkspaceRoot: (id) => (id === workspaceId ? workspaceRoot : null),
  sessionManager,
  broadcast: (target, channel, ...args) =>
    server.broadcast(target as Parameters<typeof server.broadcast>[0], channel, ...args),
  modelProvider: () => ({ provider: (process.env['THREADCOVE_PROVIDER'] as 'anthropic' | 'pi') ?? 'anthropic' }),
  model: () => process.env['THREADCOVE_MODEL'] ?? 'claude-sonnet-4-6',
  apiKey: () => process.env['ANTHROPIC_API_KEY'],
  isLocal: true,
});

await server.start();
console.log(`[threadcove] headless server on ws://127.0.0.1:${server.port}`);
console.log(`[threadcove] workspace ${workspace.config.name} (${workspaceId})`);
console.log(`[threadcove] root ${workspaceRoot}`);

process.on('SIGINT', async () => {
  await server.stop();
  process.exit(0);
});
