/**
 * AgentBackend abstraction types (R03).
 *
 * Defines the core interface that all AI backends (Claude, Pi) implement.
 * The session layer delegates to these backends, enabling provider
 * switching while keeping one consistent API surface:
 * - Provider-agnostic events: every backend emits the same AgentEvent union
 * - AsyncGenerator for streaming: `chat()` is the single consumption shape
 * - redirect() returns boolean: the interface does not pretend all backends
 *   behave the same (steering-capable backends inject mid-stream and return
 *   true; others forceAbort and return false so the session layer re-queues)
 */

import type { AgentEvent } from '@threadcove/core/types';
import type { ThinkingLevel, PermissionMode } from '../../config/models.ts';
import type { ModelProvider } from '../../config/models.ts';
import type { EventQueue } from './event-queue.ts';

export type { ModelProvider };

// ============================================================
// Lifecycle types
// ============================================================

/**
 * Result of backend post-initialization (auth injection, config setup).
 * Returned by postInit() so the session layer can surface warnings.
 */
export interface PostInitResult {
  /** Whether auth credentials were successfully injected */
  authInjected: boolean;
  /** Optional warning message to surface in UI */
  authWarning?: string;
  /** Severity level for the warning */
  authWarningLevel?: 'error' | 'warning' | 'info';
}

/**
 * Options for the chat method.
 */
export interface ChatOptions {
  /** Retry flag (internal use for session recovery) */
  isRetry?: boolean;
  /** Override thinking level for this message only */
  thinkingOverride?: ThinkingLevel;
}

// ============================================================
// Core backend interface
// ============================================================

export interface AgentBackend {
  // ------------------------------------------------------------
  // Chat & lifecycle
  // ------------------------------------------------------------

  /**
   * Send a message and stream back events.
   * The core consumption contract: an AsyncGenerator of the unified
   * AgentEvent vocabulary.
   */
  chat(message: string, options?: ChatOptions): AsyncGenerator<AgentEvent>;

  /** Abort current query (user stop or internal abort). */
  abort(reason?: string): Promise<void>;

  /** Force abort with a specific reason (hard-stop semantics). */
  forceAbort(reason: AbortReason): void;

  /**
   * Interrupt the current turn because control is being handed to the UI
   * (plan submission, auth requests). Uses the backend's cooperative
   * interrupt path rather than the hardest abort primitive.
   */
  interruptForHandoff(reason: AbortReason): void;

  /**
   * Redirect the agent mid-stream with a new user message.
   *
   * - Backends with native steering (Pi) inject the message into the
   *   current stream and return true — events continue through the
   *   existing generator, no abort needed.
   * - Backends without steering (Claude here) store the message as a
   *   pending steer and return true while streaming; when not streaming
   *   they forceAbort(Redirect) and return false — the session layer
   *   queues the message for re-send.
   */
  redirect(message: string): boolean;

  /** Run a simple text completion using the backend's auth infrastructure. */
  runMiniCompletion(prompt: string): Promise<string | null>;

  /** Post-construction initialization (auth injection). */
  postInit(): Promise<PostInitResult>;

  /** Clean up resources (processes, connections). */
  destroy(): void;

  /** Alias for destroy() for consistency. */
  dispose(): void;

  // ------------------------------------------------------------
  // Processing state
  // ------------------------------------------------------------

  /** Check if currently processing a query. */
  isProcessing(): boolean;

  // ------------------------------------------------------------
  // Model / thinking / permission mode
  // ------------------------------------------------------------

  getModel(): string;
  setModel(model: string): void;

  getThinkingLevel(): ThinkingLevel;
  setThinkingLevel(level: ThinkingLevel): void;

  getPermissionMode(): PermissionMode;
  setPermissionMode(mode: PermissionMode): void;
  cyclePermissionMode(): PermissionMode;

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------

  /** Get backend session ID (for resume; null if none). */
  getSessionId(): string | null;
  setSessionId(sessionId: string | null): void;

  /** Whether this backend supports session branching (concept-level flag). */
  readonly supportsBranching: boolean;

  /** Update the working directory (session isolation surface). */
  updateWorkingDirectory(path: string): void;

  // ------------------------------------------------------------
  // Permission resolution
  // ------------------------------------------------------------

  respondToPermission(requestId: string, allowed: boolean, alwaysAllow?: boolean): void;

  // ------------------------------------------------------------
  // Callbacks (set by the session layer after construction)
  // ------------------------------------------------------------

  /** Called when the backend determines authentication is required. */
  onBackendAuthRequired: ((reason: string) => void) | null;

  /** Called with debug messages. */
  onDebug: ((message: string) => void) | null;
}

// ============================================================
// Abort reasons
// ============================================================

/**
 * Reason for aborting agent execution.
 * Distinguishes user-initiated stops from internal aborts.
 */
export enum AbortReason {
  /** User clicked stop button */
  UserStop = 'user_stop',
  /** New message sent while processing (redirect fallback) */
  Redirect = 'redirect',
  /** Source activation needs a restart */
  SourceActivated = 'source_activated',
  /** Session timeout */
  Timeout = 'timeout',
  /** Internal error requiring abort */
  InternalError = 'internal_error',
}

// ============================================================
// Backend configuration
// ============================================================

/**
 * Configuration for creating a backend.
 * `provider` decides which backend class is instantiated.
 */
export interface BackendConfig {
  provider: ModelProvider;
  /** Absolute path to the workspace folder */
  workspaceRootPath: string;
  /** Workspace ID */
  workspaceId: string;
  /** Session ID */
  sessionId: string;
  /** Working directory for tool execution (session isolation) */
  workingDirectory: string;
  /** Initial model ID */
  model?: string;
  /** Initial thinking level */
  thinkingLevel?: ThinkingLevel;
  /** Initial permission mode */
  permissionMode?: PermissionMode;
  /** API key (injected post-creation, never logged) */
  apiKey?: string;
}

// ============================================================
// Provider driver
// ============================================================

/**
 * Provider driver — per-provider factory knowledge kept out of the shared
 * factory. `buildRuntime` assembles provider-specific SDK parameters; the
 * optional `fetchModels` pulls a dynamic model list.
 */
export interface ProviderDriver {
  provider: ModelProvider;
  /** Assemble provider-specific runtime parameters from the backend config. */
  buildRuntime(config: BackendConfig): Record<string, unknown>;
  /** Dynamically fetch available models for this provider. */
  fetchModels?(config: BackendConfig): Promise<string[]>;
}

export interface BackendFactoryResult {
  backend: AgentBackend;
  /** Event queue bridging async callbacks into chat()'s AsyncGenerator (Pi). */
  eventQueue?: EventQueue;
}

export type BackendFactory = (config: BackendConfig) => AgentBackend;
