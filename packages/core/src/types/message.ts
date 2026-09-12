/**
 * Message types for conversations.
 *
 * This module defines the runtime Message shape used by UI layers, the
 * persistence-friendly StoredMessage shape, and — most importantly — the
 * `AgentEvent` discriminated union: the unified event vocabulary every
 * backend must emit so the renderer can branch on `type` alone.
 *
 * The union is a rendering/recovery contract, not a log format:
 * - `turnId` groups all events belonging to one assistant turn
 *   (correlation ID taken from the API's message.id).
 * - `parentToolUseId` hangs nested tool calls onto their parent node so the
 *   UI can draw a tool tree instead of a flat timeline. The field is
 *   optional by design: the Claude backend passes the SDK value through
 *   natively; the Pi backend approximates with sub-turn isolation. The
 *   vocabulary is aligned across backends; field population varies by
 *   backend capability and the UI treats it as optional.
 */

/**
 * Message roles for display (runtime).
 */
export type MessageRole =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'error'
  | 'status'
  | 'info';

/**
 * Tool execution status
 */
export type ToolStatus = 'pending' | 'executing' | 'completed' | 'error';

// ============================================================
// Token usage
// ============================================================

/**
 * Usage data emitted by the agent in `complete` events.
 * A subset of TokenUsage — totalTokens/contextTokens are computed by consumers.
 */
export interface AgentEventUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
  /** Model's context window size in tokens (reported by the backend SDK) */
  contextWindow?: number;
}

// ============================================================
// Typed errors (structured recovery)
// ============================================================

/**
 * Recovery action offered alongside a typed error.
 */
export interface RecoveryAction {
  /** Unique key for the action */
  key: string;
  /** Human-readable label */
  label: string;
  /** Typed action for programmatic handling by the UI/session layer */
  action?: 'retry' | 'settings' | 'reauth' | 'open_url' | 'reconnect_source';
  /** URL to open (for open_url action) */
  url?: string;
  /** Source slug (for reconnect_source action) */
  sourceSlug?: string;
}

/**
 * Error codes for typed errors.
 */
export type ErrorCode =
  | 'invalid_api_key'
  | 'invalid_credentials'
  | 'expired_token'
  | 'rate_limited'
  | 'service_unavailable'
  | 'network_error'
  | 'mcp_auth_required'
  | 'mcp_unreachable'
  | 'billing_error'
  | 'model_not_found'
  | 'invalid_request'
  | 'provider_error'
  | 'timeout'
  | 'unknown_error';

/**
 * Typed error from an agent.
 *
 * Unlike a bare `error` (a string message, toast-only), a typed error gives
 * the UI everything it needs for an error card: title, expandable details,
 * action buttons, and a retry entry point. Recovery itself is decided by the
 * consumer (UI/session layer) — the protocol provides structured information
 * and a unified recovery entry point, not automatic retry.
 */
export interface AgentError {
  /** Error code for programmatic handling */
  code: ErrorCode;
  /** User-friendly title */
  title: string;
  /** Detailed message explaining what went wrong */
  message: string;
  /** Suggested recovery actions */
  actions: RecoveryAction[];
  /** Whether retry is possible */
  canRetry: boolean;
  /** Retry delay in ms (if canRetry is true) */
  retryDelayMs?: number;
  /** Diagnostic check results for debugging */
  details?: string[];
  /** Original error message for debugging */
  originalError?: string;
}

// ============================================================
// Permission requests
// ============================================================

/**
 * Permission request type categories.
 */
export type PermissionRequestType =
  | 'bash'
  | 'file_write'
  | 'mcp_mutation'
  | 'api_mutation'
  | 'admin_approval';

/**
 * Permission request payload.
 *
 * NOTE on provenance: this event is NOT produced by the backend event
 * adapters. It is emitted by the session-layer safety pipeline which
 * intercepts tool execution (PreToolUse) before it runs, surfaces the
 * request to the user, and either releases the tool or records the block
 * reason.
 */
export interface PermissionRequest {
  requestId: string;
  toolName: string;
  /** Optional: bash commands have it, MCP tools may not */
  command?: string;
  description: string;
  type?: PermissionRequestType;
}

// ============================================================
// AgentEvent — the unified event vocabulary
// ============================================================

/**
 * Events emitted by an agent backend during chat.
 *
 * Core five classes (interview-facing vocabulary):
 * 1. Text deltas      — text_delta / text_complete
 * 2. Tools            — tool_start / tool_result
 * 3. Permission       — permission_request
 * 4. Structured error — error / typed_error
 * 5. Completion       — complete (+ usage_update)
 *
 * plus auxiliary events (status / info / working_directory_changed) that
 * carry non-content lifecycle hints. The union is open to extension by
 * need; the renderer's `default` branch drops unknown event types without
 * breaking the stream.
 *
 * turnId: correlation ID from the API's message.id, groups all events in an
 * assistant turn.
 */
export type AgentEvent =
  // Auxiliary: status / info
  | { type: 'status'; message: string }
  | { type: 'info'; message: string; infoLevel?: 'info' | 'warning' | 'error' | 'success' }
  // 1. Text deltas
  | { type: 'text_delta'; text: string; messageId?: string; textSnapshot?: string; turnId?: string; parentToolUseId?: string }
  | {
      type: 'text_complete';
      messageId?: string;
      text: string;
      isIntermediate?: boolean;
      turnId?: string;
      parentToolUseId?: string;
      sdkMessageId?: string;
    }
  // 2. Tools
  | {
      type: 'tool_start';
      toolName: string;
      toolUseId: string;
      input: Record<string, unknown>;
      displayName?: string;
      turnId?: string;
      parentToolUseId?: string;
    }
  | {
      type: 'tool_result';
      toolUseId: string;
      toolName?: string;
      result: string;
      isError: boolean;
      turnId?: string;
      parentToolUseId?: string;
    }
  // 3. Permission
  | {
      type: 'permission_request';
      request: PermissionRequest;
      turnId?: string;
    }
  // 4. Errors
  | { type: 'error'; message: string }
  | { type: 'typed_error'; error: AgentError; turnId?: string }
  // 5. Completion & usage
  | { type: 'complete'; usage?: AgentEventUsage }
  | { type: 'usage_update'; usage: Pick<AgentEventUsage, 'inputTokens' | 'contextWindow'> }
  // Auxiliary: environment
  | { type: 'working_directory_changed'; workingDirectory: string };

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// Runtime message
// ============================================================

/**
 * Runtime message type (includes transient fields like isStreaming).
 */
export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  // Tool-specific fields
  toolName?: string;
  toolUseId?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolStatus?: ToolStatus;
  toolDuration?: number;
  toolDisplayName?: string;
  // Parent tool ID for nested tool calls (e.g., child tools inside a task tool)
  parentToolUseId?: string;
  isError?: boolean;
  isStreaming?: boolean;
  isPending?: boolean;
  isIntermediate?: boolean;
  // Turn grouping: correlation ID from the API's message.id
  turnId?: string;
  // Status type for special status messages (e.g., compacting)
  statusType?: 'compacting' | 'compaction_complete';
  // Info level for info messages (determines icon/color)
  infoLevel?: 'info' | 'warning' | 'error' | 'success';
  // Error-specific fields (for typed errors with diagnostics)
  errorCode?: string;
  errorTitle?: string;
  errorDetails?: string[];
  errorOriginal?: string;
  errorCanRetry?: boolean;
  errorActions?: RecoveryAction[];
}

/**
 * Stored message format (persistence).
 * Excludes transient runtime-only fields (isStreaming, isPending).
 */
export interface StoredMessage {
  requestId?: string;
  runId?: string;
  id: string;
  type: MessageRole;
  content: string;
  timestamp?: number;
  // Tool-specific fields
  toolName?: string;
  toolUseId?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolStatus?: ToolStatus;
  toolDuration?: number;
  toolDisplayName?: string;
  // Parent tool ID for nested tool calls (persisted for session restore)
  parentToolUseId?: string;
  isError?: boolean;
  isIntermediate?: boolean;
  turnId?: string;
  statusType?: 'compacting' | 'compaction_complete';
  infoLevel?: 'info' | 'warning' | 'error' | 'success';
  errorCode?: string;
  errorTitle?: string;
  errorDetails?: string[];
  errorOriginal?: string;
  errorCanRetry?: boolean;
  errorActions?: RecoveryAction[];
}

/**
 * Map a runtime Message to its persistable StoredMessage form.
 * Strips transient fields only; both shapes otherwise agree field-for-field
 * (the session-event-message parity test locks this).
 */
export function messageToStored(message: Message): StoredMessage {
  const { isStreaming: _s, isPending: _p, ...rest } = message;
  return {
    ...rest,
    type: message.role,
  };
}

/**
 * Expand a StoredMessage back into a runtime Message.
 */
export function storedToMessage(stored: StoredMessage): Message {
  const { type, ...rest } = stored;
  return {
    ...rest,
    id: stored.id,
    role: type,
    content: stored.content,
    timestamp: stored.timestamp ?? Date.now(),
  };
}
