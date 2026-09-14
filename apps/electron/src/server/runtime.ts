import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { WsRpcServer } from '../transport/server.ts';
import { SessionManager } from './session-manager.ts';
import { registerHandlers } from './handlers.ts';
import { createWorkspace, loadWorkspaceFrom } from '@threadcove/shared/workspaces';
import { DEFAULT_MODELS } from '@threadcove/shared/config';
import type { ModelProvider } from '@threadcove/shared/config';
import { sessionPersistenceQueue } from '@threadcove/shared/sessions';
import { loadOpenCodeGoKey, OPENCODE_GO_MODEL } from '../../../../packages/shared/src/config/opencode-go.ts';
import { ResearchTools } from '@threadcove/shared/research';

export function resolveProviderConfig(env: NodeJS.ProcessEnv = process.env, readGoKey = loadOpenCodeGoKey) {
  const goKey = env['OPENCODE_GO_API_KEY']?.trim() || ((!env['THREADCOVE_PROVIDER'] || (env['THREADCOVE_PROVIDER'] === 'pi' && env['THREADCOVE_PI_PROVIDER'] === 'opencode-go')) ? readGoKey() : undefined);
  const provider = env['THREADCOVE_PROVIDER'] ?? (goKey ? 'pi' : env['DEEPSEEK_API_KEY'] ? 'deepseek' : env['ANTHROPIC_API_KEY'] ? 'anthropic' : 'deepseek');
  if (!['deepseek', 'anthropic', 'pi'].includes(provider)) throw new Error('Unknown THREADCOVE_PROVIDER');
  const selected = provider as ModelProvider;
  const apiProvider = env['THREADCOVE_PI_PROVIDER'] ?? (goKey ? 'opencode-go' : 'anthropic');
  if (!['anthropic', 'opencode-go'].includes(apiProvider)) throw new Error('Unknown THREADCOVE_PI_PROVIDER');
  return { provider: selected, apiProvider, model: env['THREADCOVE_MODEL'] || (selected === 'pi' && apiProvider === 'opencode-go' ? OPENCODE_GO_MODEL : DEFAULT_MODELS[selected]),
    apiKey: (p: ModelProvider = selected, upstream = apiProvider) => {
      if (p === 'pi') {
        if (!['anthropic', 'opencode-go'].includes(upstream)) throw new Error('Unknown Pi API provider');
        if (upstream === 'opencode-go') return goKey ?? readGoKey();
      }
      return env[p === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'ANTHROPIC_API_KEY'];
    } };
}

export async function startRuntime(options: { root: string; port?: number; token?: string; origins?: string[] }) {
  const root = resolve(options.root);
  const workspace = loadWorkspaceFrom(root) ?? createWorkspace({ name: '我的研究工作区' }, root);
  const token = options.token || randomBytes(32).toString('base64url');
  const config = resolveProviderConfig();
  const workspaceId = workspace.config.id;
  const server = new WsRpcServer({ host: '127.0.0.1', port: options.port ?? 0, requireAuth: true,
    validateToken: value => value === token, workspaceId, allowedOrigins: options.origins ?? [] });
  const manager = new SessionManager(server, id => id === workspaceId ? root : null, null, undefined, new ResearchTools());
  manager.registerWorkspace(workspaceId, root);
  await manager.recoverWorkspace(root);
  registerHandlers(server, { getWorkspaceRoot: id => id === workspaceId ? root : null, sessionManager: manager,
    broadcast: (target, channel, ...args) => server.broadcast(target as Parameters<typeof server.broadcast>[0], channel, ...args),
    modelProvider: () => ({ provider: config.provider }), model: () => config.model, apiKey: config.apiKey, apiProvider: config.apiProvider, isLocal: false });
  await server.start();
  return { server, manager, token, workspaceId, root, url: `ws://127.0.0.1:${server.port}`,
    async close() { await manager.shutdown(); await sessionPersistenceQueue.flushAll(); await server.stop(); } };
}
