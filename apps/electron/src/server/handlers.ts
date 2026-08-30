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
import type { StoredSession, StoredMessage, AgentEvent } from '@threadcove/core/types';
import {
  createSession,
  deleteSession,
  archiveSession,
  flagSession,
  appendMessages,
  loadSession,
  loadSessionHeader,
  listSessionHeaders,
  resolveWorkingDirectory,
  getSessionPath,
} from '@threadcove/shared/sessions';
import { listSources } from '@threadcove/shared/sources';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
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
  apiKey: () => string | undefined;
  /** Whether this server instance supports LOCAL_ONLY channels. */
  isLocal: boolean;
}

export interface ModelProviderChoice {
  provider: 'anthropic' | 'pi';
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
    return { version: '0.1.0', workspaceCount: 1 };
  });

  // ============================================================
  // Sessions (REMOTE_ELIGIBLE — workspace content)
  // ============================================================

  server.handle(RPC_CHANNELS.sessions.GET, (...args: unknown[]) => {
    const [workspaceId, includeArchived] = args as [string, boolean | undefined];
    const root = requireRoot(ctx, workspaceId);
    return listSessionHeaders(root, includeArchived === true);
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
    const [workspaceId, sessionId, message] = args as [string, string, string];
    const root = requireRoot(ctx, workspaceId);

    // Ensure the manager has a backend (e.g., after server restart).
    if (!ctx.sessionManager.getSession(String(workspaceId), String(sessionId))) {
      const session = loadSession(root, String(sessionId));
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      ctx.sessionManager.createSession({
        workspaceId: String(workspaceId),
        sessionId: String(sessionId),
        provider: (session.provider as 'anthropic' | 'pi') ?? ctx.modelProvider().provider,
        model: session.model ?? ctx.model(),
        workingDirectory: resolveWorkingDirectory(session),
        apiKey: ctx.apiKey(),
      });
    }

    const userMessage: StoredMessage = {
      id: `msg-${Date.now()}`,
      type: 'user',
      content: String(message),
      timestamp: Date.now(),
    };
    await appendMessages(root, String(sessionId), [userMessage]);

    // Persist the user message broadcast shape too.
    ctx.broadcast({ to: 'all' }, RPC_CHANNELS.session.EVENT, {
      sessionId: String(sessionId),
      event: { type: 'user_message', message: userMessage },
    });

    const events = await ctx.sessionManager.sendMessage({
      workspaceId: String(workspaceId),
      sessionId: String(sessionId),
      message: String(message),
      broadcast: (event) =>
        ctx.broadcast({ to: 'all' }, RPC_CHANNELS.session.EVENT, {
          sessionId: String(sessionId),
          event,
        }),
    });

    // Persist assistant-visible events as messages (parity fields).
    const stored = eventToStoredMessages(events);
    if (stored.length > 0) {
      await appendMessages(root, String(sessionId), stored);
    }
    return { accepted: true };
  });

  server.handle(RPC_CHANNELS.sessions.CANCEL, (...args: unknown[]) => {
    const [workspaceId, sessionId] = args as [string, string];
    return ctx.sessionManager
      .cancel(String(workspaceId), String(sessionId))
      .then(() => ({ success: true }));
  });

  server.handle(RPC_CHANNELS.sessions.DELETE, (...args: unknown[]) => {
    const [workspaceId, sessionId] = args as [string, string];
    const root = requireRoot(ctx, workspaceId);
    ctx.sessionManager.destroySession(String(workspaceId), String(sessionId));
    return { success: deleteSession(root, String(sessionId)) };
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
    const backend = ctx.sessionManager.getSession(String(workspaceId), String(sessionId));
    return { model: backend?.getModel() ?? ctx.model() };
  });

  server.handle(RPC_CHANNELS.sessions.SET_MODEL, (...args: unknown[]) => {
    const [workspaceId, sessionId, model] = args as [string, string, string];
    const backend = ctx.sessionManager.getSession(String(workspaceId), String(sessionId));
    backend?.setModel(String(model));
    return { success: true };
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
    const dir = join(getSessionPath(root, String(sessionId)), String(subPath ?? ''));
    if (!existsSync(dir)) return { entries: [] };
    const entries = readdirSync(dir, { withFileTypes: true }).map((e) => {
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
    const file = join(getSessionPath(root, String(sessionId)), String(subPath));
    if (!existsSync(file)) throw new Error(`File not found: ${String(subPath)}`);
    return { content: readFileSync(file, 'utf-8') };
  });

  server.handle(RPC_CHANNELS.files.WRITE, (...args: unknown[]) => {
    const [workspaceId, sessionId, subPath, content] = args as [string, string, string, string];
    const root = requireRoot(ctx, workspaceId);
    // getSessionPath imported at module top (defense-in-depth sanitize inside)
    const file = join(getSessionPath(root, String(sessionId)), String(subPath));
    writeFileSync(file, String(content), 'utf-8');
    return { success: true };
  });
}

/**
 * Map AgentEvents to StoredMessages for persistence.
 * Field-for-field parity with the renderer's mapping is locked by the
 * session-event-message parity test.
 */
function eventToStoredMessages(events: AgentEvent[]): StoredMessage[] {
  const messages: StoredMessage[] = [];
  for (const event of events) {
    switch (event.type) {
      case 'text_complete':
        if (!event.isIntermediate) {
          messages.push({
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'assistant',
            content: event.text,
            timestamp: Date.now(),
            turnId: event.turnId,
            parentToolUseId: event.parentToolUseId,
          });
        }
        break;
      case 'tool_result':
        messages.push({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'tool',
          content: event.result,
          timestamp: Date.now(),
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          isError: event.isError,
          turnId: event.turnId,
          parentToolUseId: event.parentToolUseId,
        });
        break;
      case 'typed_error':
        messages.push({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'error',
          content: event.error.message,
          timestamp: Date.now(),
          errorCode: event.error.code,
          errorTitle: event.error.title,
          errorDetails: event.error.details,
          errorOriginal: event.error.originalError,
          errorCanRetry: event.error.canRetry,
          errorActions: event.error.actions,
          turnId: event.turnId,
        });
        break;
      default:
        // status/info/usage deltas are transient — not persisted.
        break;
    }
  }
  return messages;
}
