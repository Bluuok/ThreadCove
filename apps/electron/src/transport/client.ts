/**
 * WsRpcClient — WebSocket-based RPC client (R12 client side).
 *
 * Used in both Node (Electron main / tests / WebUI dev server) and browser
 * (renderer / WebUI) contexts. Handles handshake, request/response
 * correlation, event subscriptions, and reconnection.
 */

import {
  PROTOCOL_VERSION,
  REQUEST_TIMEOUT_MS,
  type ErrorCode,
  type ListenerFn,
  type MessageEnvelope,
  type RpcClient,
} from '@threadcove/shared/protocol';
import { serializeEnvelope, deserializeEnvelope } from '@threadcove/shared/protocol';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface WsRpcClientOptions {
  /** Bearer token sent on handshake (remote mode). */
  token?: string;
  /** Workspace advertised on handshake. */
  workspaceId?: string;
  /** Client capabilities advertised on handshake. */
  clientCapabilities?: string[];
  /** Auto-reconnect with backoff. Default: true */
  autoReconnect?: boolean;
}

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

export class WsRpcClient implements RpcClient {
  private ws: WebSocket | null = null;
  private url: string;
  private options: WsRpcClientOptions;
  private pending = new Map<string, PendingRequest>();
  private listeners = new Map<string, Set<ListenerFn>>();
  private state: ConnectionState = 'idle';
  private stateListeners = new Set<(state: ConnectionState) => void>();
  private reconnectAttempts = 0;
  private disposed = false;
  private nextId = 0;

  constructor(url: string, options?: WsRpcClientOptions) {
    this.url = url;
    this.options = options ?? {};
  }

  // ==========================================================================
  // Connection
  // ==========================================================================

  get connectionState(): ConnectionState {
    return this.state;
  }

  onConnectionStateChanged(cb: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    for (const cb of this.stateListeners) {
      cb(state);
    }
  }

  connect(): void {
    if (this.disposed) return;
    this.setState('connecting');

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.sendEnvelope({
        id: this.nextRequestId(),
        type: 'handshake',
        protocolVersion: PROTOCOL_VERSION,
        token: this.options.token,
        workspaceId: this.options.workspaceId,
        clientCapabilities: this.options.clientCapabilities ?? [],
      });
    });

    ws.addEventListener('message', (ev) => {
      this.handleMessage(typeof ev.data === 'string' ? ev.data : String(ev.data));
    });

    ws.addEventListener('close', () => {
      if (this.ws === ws) this.ws = null;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Connection closed'));
      }
      this.pending.clear();

      if (this.disposed) {
        this.setState('disconnected');
        return;
      }
      if (this.state === 'connected' || this.state === 'connecting') {
        this.scheduleReconnect();
      }
    });

    ws.addEventListener('error', () => {
      if (this.state !== 'connected') {
        this.scheduleReconnect();
      }
    });
  }

  disconnect(): void {
    this.disposed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }

  private scheduleReconnect(): void {
    if (this.disposed || !this.options.autoReconnect) {
      this.setState('failed');
      return;
    }
    this.setState('reconnecting');
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10_000);
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), delay);
  }

  // ==========================================================================
  // RPC
  // ==========================================================================

  async invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
    if (!this.ws || this.state !== 'connected') {
      throw new Error(`Not connected (state: ${this.state})`);
    }
    const id = this.nextRequestId();
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out: ${channel}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timeout });
      this.sendEnvelope({ id, type: 'request', channel, args });
    });
  }

  on(channel: string, listener: ListenerFn): () => void {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  // ==========================================================================
  // Message handling
  // ==========================================================================

  private handleMessage(raw: string): void {
    let envelope: MessageEnvelope;
    try {
      envelope = deserializeEnvelope(raw);
    } catch {
      return;
    }

    switch (envelope.type) {
      case 'handshake_ack':
        this.setState('connected');
        break;
      case 'error': {
        // Handshake-time errors reject everything pending with the wire code.
        const err = new Error(envelope.error?.message ?? 'Transport error');
        if (envelope.error) {
          (err as Error & { code?: ErrorCode }).code = envelope.error.code;
        }
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timeout);
          pending.reject(err);
        }
        this.pending.clear();
        break;
      }
      case 'response': {
        const pending = this.pending.get(envelope.id);
        if (!pending) return;
        this.pending.delete(envelope.id);
        clearTimeout(pending.timeout);
        if (envelope.error) {
          const err = new Error(envelope.error.message);
          (err as Error & { code?: ErrorCode }).code = envelope.error.code;
          pending.reject(err);
        } else {
          pending.resolve(envelope.result);
        }
        break;
      }
      case 'event': {
        const channel = envelope.channel ?? '';
        const set = this.listeners.get(channel);
        if (set) {
          for (const fn of set) {
            try {
              fn(...(envelope.args ?? []));
            } catch {
              // listener error must not break the event loop
            }
          }
        }
        break;
      }
      default:
        break;
    }
  }

  private sendEnvelope(envelope: MessageEnvelope): void {
    if (this.ws && this.ws.readyState === 1 /* WebSocket.OPEN */) {
      this.ws.send(serializeEnvelope(envelope));
    }
  }

  private nextRequestId(): string {
    this.nextId += 1;
    return `req-${Date.now().toString(36)}-${this.nextId}`;
  }
}
