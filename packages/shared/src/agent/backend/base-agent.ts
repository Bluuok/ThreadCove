/**
 * Base Agent (R03).
 *
 * Abstract base class implementing the shared AgentBackend surface:
 * common state (model/thinking/permissionMode/session/workingDirectory)
 * and generic behavior (permission mode cycling, abort bookkeeping).
 *
 * Subclasses implement the provider-specific core:
 * - chatImpl / abortImpl / forceAbortImpl
 * - runMiniCompletion / postInit / destroy
 * - redirect strategy (steering vs forceAbort)
 *
 * Core module delegation (reproduction scope): four managers — permission,
 * source, prompt, usage. This is a deliberate slim-down from richer
 * reference implementations; the four cover what our five selected
 * points need.
 */

import type { AgentEvent } from '@threadcove/core/types';
import type {
  AbortReason,
  AgentBackend,
  BackendConfig,
  ChatOptions,
  PostInitResult,
} from './types.ts';
import {
  DEFAULT_THINKING_LEVEL,
  nextPermissionMode,
  normalizeThinkingLevel,
  type ThinkingLevel,
  type PermissionMode,
} from '../../config/models.ts';

export abstract class BaseAgent implements AgentBackend {
  protected abstract backendName: string;

  protected config: BackendConfig;
  protected workingDirectory: string;
  protected _sessionId: string | null;
  protected _model: string;
  protected _thinkingLevel: ThinkingLevel;
  protected _permissionMode: PermissionMode;
  protected _processing: boolean = false;
  protected lastAbortReason: AbortReason | null = null;

  // Callbacks (set by the session layer after construction)
  onBackendAuthRequired: ((reason: string) => void) | null = null;
  onDebug: ((message: string) => void) | null = null;

  constructor(config: BackendConfig, defaultModel: string) {
    this.config = config;
    this.workingDirectory = config.workingDirectory || config.workspaceRootPath;
    this._sessionId = config.sessionId || null;
    this._model = config.model || defaultModel;
    this._thinkingLevel = normalizeThinkingLevel(config.thinkingLevel) ?? DEFAULT_THINKING_LEVEL;
    this._permissionMode = config.permissionMode ?? 'ask';
  }

  // ============================================================
  // Debug
  // ============================================================

  protected debug(message: string): void {
    this.onDebug?.(`[${this.backendName}] ${message}`);
  }

  // ============================================================
  // Chat — template method wrapping subclass streaming
  // ============================================================

  async *chat(message: string, options?: ChatOptions): AsyncGenerator<AgentEvent> {
    this._processing = true;
    this.lastAbortReason = null;
    try {
      yield* this.chatImpl(message, options);
    } finally {
      this._processing = false;
    }
  }

  protected abstract chatImpl(message: string, options?: ChatOptions): AsyncGenerator<AgentEvent>;

  // ============================================================
  // Abort
  // ============================================================

  async abort(reason: string = 'user_stop'): Promise<void> {
    this.debug(`abort: ${reason}`);
    await this.abortImpl(reason);
  }

  protected abstract abortImpl(reason: string): Promise<void>;

  forceAbort(reason: AbortReason): void {
    this.lastAbortReason = reason;
    this.forceAbortImpl(reason);
  }

  protected abstract forceAbortImpl(reason: AbortReason): void;

  // ============================================================
  // State
  // ============================================================

  isProcessing(): boolean {
    return this._processing;
  }

  getModel(): string {
    return this._model;
  }

  setModel(model: string): void {
    this._model = model;
    this.debug(`model set to ${model}`);
  }

  getThinkingLevel(): ThinkingLevel {
    return this._thinkingLevel;
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this._thinkingLevel = level;
  }

  getPermissionMode(): PermissionMode {
    return this._permissionMode;
  }

  setPermissionMode(mode: PermissionMode): void {
    this._permissionMode = mode;
  }

  cyclePermissionMode(): PermissionMode {
    this._permissionMode = nextPermissionMode(this._permissionMode);
    this.debug(`permission mode cycled to ${this._permissionMode}`);
    return this._permissionMode;
  }

  getSessionId(): string | null {
    return this._sessionId;
  }

  setSessionId(sessionId: string | null): void {
    this._sessionId = sessionId;
  }

  updateWorkingDirectory(path: string): void {
    this.workingDirectory = path;
  }

  getWorkingDirectory(): string {
    return this.workingDirectory;
  }

  // ============================================================
  // Subclass contract
  // ============================================================

  abstract readonly supportsBranching: boolean;
  abstract redirect(message: string): boolean;
  abstract interruptForHandoff(reason: AbortReason): void;
  abstract respondToPermission(requestId: string, allowed: boolean, alwaysAllow?: boolean): void;
  abstract runMiniCompletion(prompt: string): Promise<string | null>;
  abstract postInit(): Promise<PostInitResult>;
  abstract destroy(): void;
  dispose(): void {
    this.destroy();
  }
}
