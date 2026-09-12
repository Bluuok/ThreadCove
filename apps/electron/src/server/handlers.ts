/**
 * RPC Handlers (R12) — server-side channel implementations.
 *
 * Registers handlers on the WsRpcServer for sessions/workspaces/sources/
 * files channels. Backing state: R08 storage + R03 SessionManager + R18
 * sources. LOCAL_ONLY channels (dialog/system) are handled here too —
 * they're registered only on the local server instance (Electron main);
 * a headless server simply does not register them.
 */

import { RPC_CHANNELS } from '@threadcove/shared/protocol';
import type { RpcServer as RpcServerLike } from '@threadcove/shared/protocol';
import type { StoredSession } from '@threadcove/core/types';
import {
  createSession,
  deleteSessionSafely,
  archiveSession,
  flagSession,
  loadSession,
  loadSessionHeader,
  listSessionHeaders,
  resolveWorkingDirectory,
  resolveSessionFilePath,
  updateSessionConfig,
  validateSessionId,
} from '@threadcove/shared/sessions';
import { listSources } from '@threadcove/shared/sources';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import type { ModelProvider } from '@threadcove/shared/config';
import type { SessionManager } from './session-manager.ts';

export interface HandlerContext {
  /** Resolve workspace root path from workspace ID. */
  getWorkspaceRoot: (workspaceId: string) => string | null;
  sessionManager: SessionManager;
  /** Broadcast helper (wired to the transport server). */
  broadcast: (
    target: { to: 'all' | 'workspace' | 'client'; workspaceId?: string; clientId?: string },
    channel: string,
    ...args: unknown[]
  ) => void;
  modelProvider: () => ModelProviderChoice;
  model: () => string;
  apiKey: (provider?: ModelProvider) => string | undefined;
  /** Whether this server instance supports LOCAL_ONLY channels. */
  isLocal: boolean;
}

export interface ModelProviderChoice {
  provider: ModelProvider;
  model?: string;
  thinkingLevel?: string;
  permissionMode?: 'safe' | 'ask' | 'allow-all';
}

function requireRoot(ctx: HandlerContext, workspaceId: unknown): string {
  const root = ctx.getWorkspaceRoot(String(workspaceId));
  if (!root) throw new Error(`Unknown workspace: ${String(workspaceId)}`);
  return root;
}

export function registerHandlers(server: RpcServerLike, ctx: HandlerContext): void {
  // ============================================================
  // Server / workspaces
  // ============================================================

  server.handle(RPC_CHANNELS.server.GET_STATUS, () => {
    return { version: '0.1.0', workspaceCount: ctx.sessionManager.listWorkspaces().length };
  });

  // ============================================================
  server.handle(RPC_CHANNELS.server.GET_WORKSPACES, () => ctx.sessionManager.listWorkspaces());

  // Sessions (REMOTE_ELIGIBLE — workspace content)
  // ============================================================

  server.handle(RPC_CHANNELS.sessions.GET, (...args: unknown[]) => {
    const [workspaceId, includeArchived] = args as [string, boolean | undefined];
    const root = requireRoot(ctx, workspaceId);
    return listSessionHeaders(root, includeArchived === true).map(session => ({ ...session, isProcessing: ctx.sessionManager.isProcessing(String(workspaceId), session.id) }));
  });

  server.handle(RPC_CHANNELS.sessions.CREATE, async (...args: unknown[]) => {
    const [workspaceId, options] = args as [string, { name?: string; model?: string } | undefined];
    const root = requireRoot(ctx, workspaceId);
    const session: StoredSession = await createSession(root, {
      name: options?.name,
      model: options?.model ?? ctx.model(),
      provider: ctx.modelProvider().provider,
    });
    // Register with the SessionManager so sendMessage can run turns.
    ctx.sessionManager.createSession({
      workspaceId: String(workspaceId),
      sessionId: session.id,
      provider: ctx.modelProvider().provider,
      model: session.model,
      workingDirectory: resolveWorkingDirectory(session),
      apiKey: ctx.apiKey(),
    });
    return loadSessionHeader(root, session.id);
  });

  server.handle(RPC_CHANNELS.sessions.GET_MESSAGES, (...args: unknown[]) => {
    const [workspaceId, sessionId] = args as [string, string];
    const root = requireRoot(ctx, workspaceId);
    return loadSession(root, String(sessionId))?.messages ?? [];
  });

  server.handle(RPC_CHANNELS.sessions.SEND_MESSAGE, async (...args: unknown[]) => {
    const [workspaceId, sessionId, message, suppliedRequestId] = args as [string, string, string, string | undefined];
    const root = requireRoot(ctx, workspaceId);
    validateSessionId(sessionId);
    if (typeof message !== 'string' || !message.trim() || message.length > 200_000) throw new Error('Message must contain 1–200000 characters');
    const requestId = suppliedRequestId ?? crypto.randomUUID();
    if (typeof requestId !== 'string' || !/^[\w-]{1,128}$/.test(requestId)) throw new Error('Invalid request ID');
    if (!ctx.sessionManager.getSession(workspaceId, sessionId)) {
      const session = loadSession(root, sessionId);
      if (!session) throw new Error('Session not found');
      const provider = (session.provider ?? ctx.modelProvider().provider) as ModelProvider;
      ctx.sessionManager.createSession({ workspaceId, sessionId, provider, model: session.model ?? ctx.model(),
        workingDirectory: resolveWorkingDirectory(session), apiKey: ctx.apiKey(provider), history: session.messages });
    }
    return ctx.sessionManager.submitMessage({ workspaceId, sessionId, message, requestId,
      broadcast: event => ctx.broadcast({ to: 'workspace', workspaceId }, RPC_CHANNELS.session.EVENT, { workspaceId, sessionId, event }),
    });
  });

  server.handle(RPC_CHANNELS.sessions.CANCEL, (...args: unknown[]) => {
    const [workspaceId, sessionId] = args as [string, string];
    return ctx.sessionManager
      .cancel(String(workspaceId), String(sessionId))
      .then(() => ({ success: true }));
  });

  server.handle(RPC_CHANNELS.sessions.DELETE, async (...args: unknown[]) => {
    const [workspaceId, sessionId] = args as [string, string];
    const root = requireRoot(ctx, workspaceId);
    await ctx.sessionManager.cancel(String(workspaceId), String(sessionId));
    await ctx.sessionManager.waitForIdle(String(workspaceId), String(sessionId));
    return ctx.sessionManager.withIdleSession(String(workspaceId), String(sessionId), async () => {
      const success = await deleteSessionSafely(root, String(sessionId));
      ctx.sessionManager.destroySession(String(workspaceId), String(sessionId));
      return { success };
    });
  });

  server.handle(RPC_CHANNELS.sessions.ARCHIVE, async (...args: unknown[]) => {
    const [workspaceId, sessionId, archived] = args as [string, string, boolean];
    const root = requireRoot(ctx, workspaceId);
    return { success: await archiveSession(root, String(sessionId), archived === true) };
  });

  server.handle(RPC_CHANNELS.sessions.FLAG, async (...args: unknown[]) => {
    const [workspaceId, sessionId, flagged] = args as [string, string, boolean];
    const root = requireRoot(ctx, workspaceId);
    return { success: await flagSession(root, String(sessionId), flagged === true) };
  });

  server.handle(RPC_CHANNELS.sessions.GET_MODEL, (...args: unknown[]) => {
    const [workspaceId, sessionId] = args as [string, string];
    const session = loadSession(requireRoot(ctx, workspaceId), sessionId);
    if (!session) throw new Error('Session not found');
    return { model: session.model ?? ctx.model() };
  });

  server.handle(RPC_CHANNELS.sessions.SET_MODEL, async (...args: unknown[]) => {
    const [workspaceId, sessionId, model] = args as [string, string, string];
    const root = requireRoot(ctx, workspaceId);
    if (typeof model !== 'string' || !model.trim() || model.length > 200) throw new Error('Invalid model');
    return ctx.sessionManager.withIdleSession(workspaceId, sessionId, async () => {
      const saved = await updateSessionConfig(root, sessionId, { model });
      if (!saved) throw new Error('Session not found');
      ctx.sessionManager.getSession(workspaceId, sessionId)?.setModel(model);
      return { success: true };
    });
  });

  server.handle(RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION, (...args: unknown[]) => {
    const [workspaceId, sessionId, requestId, allowed] = args as [string, string, string, boolean];
    ctx.sessionManager.respondToPermission(String(workspaceId), String(sessionId), String(requestId), allowed === true);
    return { success: true };
  });

  // ============================================================
  // Sources (REMOTE_ELIGIBLE)
  // ============================================================

  server.handle(RPC_CHANNELS.sources.LIST, (...args: unknown[]) => {
    const [workspaceId] = args as [string];
    const root = requireRoot(ctx, workspaceId);
    return listSources(root).map((s) => ({
      slug: s.config.slug,
      name: s.config.name,
      type: s.config.type,
      enabled: s.config.enabled,
      isAuthenticated: s.config.isAuthenticated ?? false,
    }));
  });

  // ============================================================
  // Files (REMOTE_ELIGIBLE — workspace content via server proxy)
  // ============================================================

  server.handle(RPC_CHANNELS.files.LIST, (...args: unknown[]) => {
    const [workspaceId, sessionId, subPath] = args as [string, string, string | undefined];
    const root = requireRoot(ctx, workspaceId);
    // getSessionPath imported at module top (defense-in-depth sanitize inside)
    const dir = resolveSessionFilePath(root, String(sessionId), String(subPath ?? ''));
    if (!existsSync(dir)) return { entries: [] };
    const entries = readdirSync(dir, { withFileTypes: true }).filter(e => !e.isSymbolicLink()).map((e) => {
      const full = join(dir, e.name);
      return {
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        size: e.isFile() ? statSync(full).size : undefined,
      };
    });
    return { entries };
  });

  server.handle(RPC_CHANNELS.files.READ, (...args: unknown[]) => {
    const [workspaceId, sessionId, subPath] = args as [string, string, string];
    const root = requireRoot(ctx, workspaceId);
    // getSessionPath imported at module top (defense-in-depth sanitize inside)
    const file = resolveSessionFilePath(root, String(sessionId), String(subPath));
    if (!existsSync(file)) throw new Error(`File not found: ${String(subPath)}`);
    return { content: readFileSync(file, 'utf-8') };
  });

  server.handle(RPC_CHANNELS.files.WRITE, (...args: unknown[]) => {
    const [workspaceId, sessionId, subPath, content] = args as [string, string, string, string];
    const root = requireRoot(ctx, workspaceId);
    // getSessionPath imported at module top (defense-in-depth sanitize inside)
    const file = resolveSessionFilePath(root, String(sessionId), String(subPath));
    writeFileSync(file, String(content), 'utf-8');
    return { success: true };
  });
}
