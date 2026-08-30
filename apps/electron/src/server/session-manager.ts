/**
 * Session Manager (R12 server side + R03/R08/R18 runtime rendezvous).
 *
 * Owns the backend lifecycle per session: creates backends via the R03
 * factory, consumes their AgentEvent streams (R10), persists transcripts
 * through R08 storage, and runs source tools through the R18 pool so
 * credentials never leave the host process.
 *
 * This is where the five points converge at runtime:
 * - R03: createBackend(provider) — backend switching is config
 * - R10: events stream through as AgentEvent, broadcast on session:event
 * - R08: session folders + workingDirectory isolation
 * - R18: MCP/API sources as tools, credentials host-side
 * - R12: transport broadcast to every connected client
 */

import type { AgentEvent } from '@threadcove/core/types';
import type { WsRpcServer } from '../transport/server.ts';
import { createBackend } from '@threadcove/shared/agent';
import type { AgentBackend, BackendConfig } from '@threadcove/shared/agent';
import { AbortReason } from '@threadcove/shared/agent';
import type { ModelProvider, ThinkingLevel, PermissionMode } from '@threadcove/shared/config';
import { getContextWindowForModel } from '@threadcove/shared/config';
import type { McpClientPool } from '@threadcove/shared/mcp';
import type { PiAgent } from '@threadcove/shared/agent';

export interface SessionManagerOptions {
  server: WsRpcServer | null;
  /** Resolve the workspace root for a workspaceId. */
  getWorkspaceRoot: (workspaceId: string) => string | null;
  /**
   * Optional backend factory override (tests inject mock backends).
   * Defaults to the R03 factory — provider switching stays config-driven.
   */
  createBackendFn?: typeof createBackend;
}

interface ActiveSession {
  sessionId: string;
  workspaceId: string;
  backend: AgentBackend;
  /** Events streamed by chat() — concurrency guard: one turn at a time. */
  processing: boolean;
  abortRequested: boolean;
}

export class SessionManager {
  private active = new Map<string, ActiveSession>(); // key: `${workspaceId}:${sessionId}`
  private workspaceRoots = new Map<string, string>();

  constructor(
    private readonly server: SessionManagerOptions['server'],
    private readonly getWorkspaceRoot: SessionManagerOptions['getWorkspaceRoot'],
    private readonly mcpPool: McpClientPool | null = null,
    private readonly createBackendFn: SessionManagerOptions['createBackendFn'] = createBackend,
  ) {}

  /** Register a workspace root (normally loaded from R08 workspace storage). */
  registerWorkspace(workspaceId: string, rootPath: string): void {
    this.workspaceRoots.set(workspaceId, rootPath);
  }

  private key(workspaceId: string, sessionId: string): string {
    return `${workspaceId}:${sessionId}`;
  }

  /**
   * Create (or reuse) a backend for a session. The provider is a
   * configuration value — this is the R03 "switching = config" claim in code.
   */
  createSession(opts: {
    workspaceId: string;
    sessionId: string;
    provider: ModelProvider;
    model?: string;
    thinkingLevel?: ThinkingLevel;
    permissionMode?: PermissionMode;
    workingDirectory: string;
    apiKey?: string;
  }): AgentBackend {
    const key = this.key(opts.workspaceId, opts.sessionId);
    const existing = this.active.get(key);
    if (existing) return existing.backend;

    const config: BackendConfig = {
      provider: opts.provider,
      workspaceRootPath: this.workspaceRoots.get(opts.workspaceId) ?? opts.workingDirectory,
      workspaceId: opts.workspaceId,
      sessionId: opts.sessionId,
      workingDirectory: opts.workingDirectory,
      model: opts.model,
      thinkingLevel: opts.thinkingLevel,
      permissionMode: opts.permissionMode,
      apiKey: opts.apiKey,
    };

    const backend = this.createBackendFn?.(config) ?? createBackend(config);
    if (this.mcpPool && 'setToolExecutor' in backend) {
      // Pi subprocess executes source tools via the host pool —
      // credentials never enter the subprocess.
      (backend as PiAgent).setToolExecutor(async (toolName, args) =>
        this.mcpPool!.callTool(toolName, args),
      );
    }

    this.active.set(key, { sessionId: opts.sessionId, workspaceId: opts.workspaceId, backend, processing: false, abortRequested: false });
    return backend;
  }

  getSession(workspaceId: string, sessionId: string): AgentBackend | null {
    return this.active.get(this.key(workspaceId, sessionId))?.backend ?? null;
  }

  isProcessing(workspaceId: string, sessionId: string): boolean {
    return this.active.get(this.key(workspaceId, sessionId))?.processing ?? false;
  }

  /**
   * Run one chat turn: consume the backend's AsyncGenerator, broadcast each
   * event on session:event, and return the collected events (the session
   * layer also persists text/tool events as StoredMessages — parity contract
   * lives in packages/shared/tests/session-event-message-parity.test.ts).
   */
  async sendMessage(opts: {
    workspaceId: string;
    sessionId: string;
    message: string;
    /** Optional broadcast sink — wired to the transport server. */
    broadcast?: (event: AgentEvent) => void;
  }): Promise<AgentEvent[]> {
    const key = this.key(opts.workspaceId, opts.sessionId);
    const entry = this.active.get(key);
    if (!entry) throw new Error(`Session not active: ${opts.sessionId}`);
    if (entry.processing) throw new Error('Session is busy');

    entry.processing = true;
    entry.abortRequested = false;
    const events: AgentEvent[] = [];

    try {
      for await (const event of entry.backend.chat(opts.message)) {
        events.push(event);
        opts.broadcast?.(event);
        if (entry.abortRequested) break;
      }
    } finally {
      entry.processing = false;
    }

    return events;
  }

  /** User stop. */
  async cancel(workspaceId: string, sessionId: string): Promise<void> {
    const entry = this.active.get(this.key(workspaceId, sessionId));
    if (!entry) return;
    entry.abortRequested = true;
    await entry.backend.abort('user_stop');
  }

  /** Respond to a permission request emitted by the session-layer pipeline. */
  respondToPermission(workspaceId: string, sessionId: string, requestId: string, allowed: boolean): void {
    this.active.get(this.key(workspaceId, sessionId))?.backend.respondToPermission(requestId, allowed);
  }

  /** Force teardown (app quit / session delete). */
  destroySession(workspaceId: string, sessionId: string, reason: AbortReason = AbortReason.InternalError): void {
    const key = this.key(workspaceId, sessionId);
    const entry = this.active.get(key);
    if (!entry) return;
    entry.backend.forceAbort(reason);
    entry.backend.destroy();
    this.active.delete(key);
  }

  /** Model context window for usage display (registry-driven capability). */
  getContextWindow(model: string): number {
    return getContextWindowForModel(model);
  }
}
