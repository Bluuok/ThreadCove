/**
 * Protocol package — wire types for the WS-based RPC layer (R12).
 *
 * Shared between the server (Electron main process / headless) and clients
 * (Electron renderer / WebUI / Node).
 */

export const PROTOCOL_VERSION = '1.0';

/** Default request timeout in ms. */
export const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Message envelope
// ---------------------------------------------------------------------------

export type MessageType =
  | 'handshake'
  | 'handshake_ack'
  | 'request'
  | 'response'
  | 'event'
  | 'error';

export interface MessageEnvelope {
  /** Correlation ID. UUIDv4 for requests; echoed in responses. */
  id: string;
  type: MessageType;
  /** Required for request / event. */
  channel?: string;
  /** Request args or event payload. */
  args?: unknown[];
  /** Response payload. */
  result?: unknown;
  /** Structured error. */
  error?: WireError;
  /** Sent on handshake / handshake_ack. */
  protocolVersion?: string;
  /** Sent on handshake by the client. */
  workspaceId?: string;
  /** Sent on handshake for remote auth. */
  token?: string;
  /** Assigned by server in handshake_ack. */
  clientId?: string;
  /** Client capabilities advertised on handshake. */
  clientCapabilities?: string[];
  /** Server-registered channels, sent in handshake_ack. */
  registeredChannels?: string[];
}

export interface WireError {
  code: ErrorCode;
  message: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'HANDLER_ERROR'
  | 'CHANNEL_NOT_FOUND'
  | 'AUTH_FAILED'
  | 'PROTOCOL_VERSION_UNSUPPORTED'
  | 'REQUEST_TIMEOUT';

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  'HANDLER_ERROR',
  'CHANNEL_NOT_FOUND',
  'AUTH_FAILED',
  'PROTOCOL_VERSION_UNSUPPORTED',
  'REQUEST_TIMEOUT',
]);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && KNOWN_ERROR_CODES.has(value);
}

/**
 * Sender-side helper for throwing transport errors with a typed `code`.
 *
 * Class identity is lost across the wire — the transport reconstructs a plain
 * `Error` with `.code` on the receiving side. Receivers MUST branch on
 * `err.code === 'X'`, never `err instanceof CodedError`.
 */
export class CodedError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CodedError';
  }
}

// ---------------------------------------------------------------------------
// Push target (server → clients)
// ---------------------------------------------------------------------------

export type PushTarget =
  | { to: 'all'; exclude?: string }
  | { to: 'workspace'; workspaceId: string; exclude?: string }
  | { to: 'client'; clientId: string };

// ---------------------------------------------------------------------------
// Client / server interfaces
// ---------------------------------------------------------------------------

export type ListenerFn = (...args: unknown[]) => void;

export interface RpcClient {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  on(channel: string, listener: ListenerFn): () => void;
}

export type HandlerFn = (
  ...args: unknown[]
) => unknown | Promise<unknown>;

export interface RequestContext {
  clientId: string;
  workspaceId: string | null;
}

export interface RpcServer {
  handle(channel: string, fn: HandlerFn): void;
  broadcast(target: PushTarget, channel: string, ...args: unknown[]): void;
  invokeClient(clientId: string, channel: string, ...args: unknown[]): Promise<unknown>;
}
