import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { WsRpcServer } from '../transport/server.ts';
import { SessionManager } from './session-manager.ts';
import { registerHandlers } from './handlers.ts';
import { createWorkspace, loadWorkspaceFrom } from '@threadcove/shared/workspaces';
import { DEFAULT_MODELS } from '@threadcove/shared/config';
import type { ModelProvider } from '@threadcove/shared/config';
import { sessionPersistenceQueue } from '@threadcove/shared/sessions';

export function resolveProviderConfig(env: NodeJS.ProcessEnv = process.env) {
  const provider = env['THREADCOVE_PROVIDER'] ?? (env['DEEPSEEK_API_KEY'] ? 'deepseek' : env['ANTHROPIC_API_KEY'] ? 'anthropic' : 'deepseek');
  if (!['deepseek', 'anthropic', 'pi'].includes(provider)) throw new Error('Unknown THREADCOVE_PROVIDER');
  const selected = provider as ModelProvider;
  return { provider: selected, model: env['THREADCOVE_MODEL'] || DEFAULT_MODELS[selected],
    apiKey: (p: ModelProvider = selected) => env[p === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'ANTHROPIC_API_KEY'] };
}

export async function startRuntime(options: { root: string; port?: number; token?: string; origins?: string[] }) {
  const root = resolve(options.root);
  const workspace = loadWorkspaceFrom(root) ?? createWorkspace({ name: '我的研究工作区' }, root);
  const token = options.token || randomBytes(32).toString('base64url');
  const config = resolveProviderConfig();
  const workspaceId = workspace.config.id;
  const server = new WsRpcServer({ host: '127.0.0.1', port: options.port ?? 0, requireAuth: true,
    validateToken: value => value === token, workspaceId, allowedOrigins: options.origins ?? [] });
  const manager = new SessionManager(server, id => id === workspaceId ? root : null);
  manager.registerWorkspace(workspaceId, root);
  await manager.recoverWorkspace(root);
  registerHandlers(server, { getWorkspaceRoot: id => id === workspaceId ? root : null, sessionManager: manager,
    broadcast: (target, channel, ...args) => server.broadcast(target as Parameters<typeof server.broadcast>[0], channel, ...args),
    modelProvider: () => ({ provider: config.provider }), model: () => config.model, apiKey: config.apiKey, isLocal: false });
  await server.start();
  return { server, manager, token, workspaceId, root, url: `ws://127.0.0.1:${server.port}`,
    async close() { await manager.shutdown(); await sessionPersistenceQueue.flushAll(); await server.stop(); } };
}
