/**
 * WsRpcServer — WebSocket-based RPC server (R12 server side).
 *
 * Owns transport concerns: connection lifecycle, handshake, auth,
 * request dispatching, and push routing.
 *
 * Same class serves locally (127.0.0.1, token generated at startup) and
 * remotely (0.0.0.0, explicit token) — the difference is configuration,
 * not code.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  PROTOCOL_VERSION,
  REQUEST_TIMEOUT_MS,
  type ErrorCode,
  type HandlerFn,
  type MessageEnvelope,
  type PushTarget,
  type RpcServer,
} from '@threadcove/shared/protocol';
import { serializeEnvelope, deserializeEnvelope, CodedError } from '@threadcove/shared/protocol';

// ---------------------------------------------------------------------------
// Client connection state
// ---------------------------------------------------------------------------

interface ClientConnection {
  id: string;
  ws: WebSocket;
  workspaceId: string | null;
  capabilities: Set<string>;
}

interface PendingInvoke {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Server options
// ---------------------------------------------------------------------------

export interface WsRpcServerOptions {
  allowedOrigins?: string[];
  workspaceId?: string;
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string;
  /** Port to bind to. 0 = random available port. Default: 0 */
  port?: number;
  /** Whether to require a bearer token on handshake. Default: false */
  requireAuth?: boolean;
  /** Token validator. Called when requireAuth is true. */
  validateToken?: (token: string) => boolean | Promise<boolean>;
  /** Called when a client completes handshake. */
  onClientConnected?: (info: { clientId: string }) => void;
  /** Called when a client disconnects. */
  onClientDisconnected?: (clientId: string) => void;
}

// ---------------------------------------------------------------------------
// WsRpcServer
// ---------------------------------------------------------------------------

export class WsRpcServer implements RpcServer {
  private options: WsRpcServerOptions;
  private wss: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private clients = new Map<string, ClientConnection>();
  private handlers = new Map<string, HandlerFn>();
  private pendingInvokes = new Map<string, PendingInvoke>();

  private readonly host: string;
  private readonly requestedPort: number;
  private readonly requireAuth: boolean;
  private readonly validateToken: ((token: string) => boolean | Promise<boolean>) | null;
  private readonly onClientConnected: WsRpcServerOptions['onClientConnected'];
  private readonly onClientDisconnected: WsRpcServerOptions['onClientDisconnected'];

  constructor(opts?: WsRpcServerOptions) {
    this.options = opts ?? {};
    if (opts?.requireAuth && !opts.validateToken) throw new Error('Authentication requires a token validator');
    this.host = opts?.host ?? '127.0.0.1';
    this.requestedPort = opts?.port ?? 0;
    this.requireAuth = opts?.requireAuth ?? false;
    this.validateToken = opts?.validateToken ?? null;
    this.onClientConnected = opts?.onClientConnected;
    this.onClientDisconnected = opts?.onClientDisconnected;
  }

  get port(): number {
    return this.httpServer?.address() && typeof this.httpServer.address() === 'object'
      ? (this.httpServer.address() as { port: number }).port
      : this.requestedPort;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get channelNames(): string[] {
    return [...this.handlers.keys()];
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async start(): Promise<void> {
    if (this.httpServer) return;

    this.httpServer = createHttpServer((req, res) => {
      res.writeHead(426).end('Upgrade Required');
    });

    this.wss = new WebSocketServer({ server: this.httpServer, maxPayload: 2 * 1024 * 1024,
      verifyClient: ({ origin }: { origin: string }) => !origin || (this.options.allowedOrigins ?? []).includes(origin),
    });
    this.wss.on('connection', (ws) => this.handleConnection(ws));

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', reject);
      this.httpServer!.listen(this.requestedPort, this.host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    for (const client of this.wss?.clients ?? []) client.terminate();
    this.clients.clear();
    for (const pending of this.pendingInvokes.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Server stopped'));
    }
    this.pendingInvokes.clear();

    const wss = this.wss;
    const httpServer = this.httpServer;
    this.wss = null;
    this.httpServer = null;

    if (wss) {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  }

  // ==========================================================================
  // Handler registration
  // ==========================================================================

  handle(channel: string, fn: HandlerFn): void {
    if (this.handlers.has(channel)) {
      throw new Error(`Handler already registered for channel: ${channel}`);
    }
    this.handlers.set(channel, fn);
  }

  // ==========================================================================
  // Push routing
  // ==========================================================================

  broadcast(target: PushTarget, channel: string, ...args: unknown[]): void {
    const payload: MessageEnvelope = {
      id: randomUUID(),
      type: 'event',
      channel,
      args,
    };
    const raw = serializeEnvelope(payload);

    for (const client of this.clients.values()) {
      if (target.to === 'all' && target.exclude && target.exclude === client.id) continue;
      if (target.to === 'workspace' && client.workspaceId !== target.workspaceId) continue;
      if (target.to === 'client' && client.id !== target.clientId) continue;
      if (client.ws.readyState === 1 /* WebSocket.OPEN */) {
        client.ws.send(raw);
      }
    }
  }

  /** Reverse RPC: server calls a client-registered channel. */
  async invokeClient(clientId: string, channel: string, ...args: unknown[]): Promise<unknown> {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new CodedError('CLIENT_DISCONNECTED' as ErrorCode, `Client not connected: ${clientId}`);
    }
    const id = randomUUID();
    const payload: MessageEnvelope = {
      id,
      type: 'request',
      channel,
      args,
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingInvokes.delete(id);
        reject(new CodedError('REQUEST_TIMEOUT', `Client invoke timed out: ${channel}`));
      }, REQUEST_TIMEOUT_MS);
      this.pendingInvokes.set(id, { resolve, reject, timeout });
      client.ws.send(serializeEnvelope(payload));
    });
  }

  // ==========================================================================
  // Connection handling
  // ==========================================================================

  private handleConnection(ws: WebSocket): void {
    let clientId: string | null = null;
    let handshaking = false;
    const deadline = setTimeout(() => ws.terminate(), 10_000);

    ws.on('message', (data) => {
      let envelope: MessageEnvelope;
      try {
        envelope = deserializeEnvelope(String(data));
      } catch {
        this.safeSend(ws, {
          id: randomUUID(),
          type: 'error',
          error: { code: 'HANDLER_ERROR', message: 'Invalid envelope' },
        });
        return;
      }

      // Before handshake, only 'handshake' is accepted.
      if (!clientId) {
        if (handshaking) return;
        if (envelope.type !== 'handshake') {
          this.safeSend(ws, {
            id: envelope.id,
            type: 'error',
            error: { code: 'AUTH_FAILED', message: 'Handshake required before requests' },
          });
          return;
        }
        handshaking = true;
        void this.handleHandshake(ws, envelope).then((id) => {
          if (id) { clientId = id; clearTimeout(deadline); }
        }).catch(() => ws.close(1008, 'handshake failed'));
        return;
      }

      void this.routeEnvelope(clientId, envelope);
    });

    ws.on('close', () => {
      clearTimeout(deadline);
      if (clientId) {
        this.clients.delete(clientId);
        this.onClientDisconnected?.(clientId);
      }
    });

    ws.on('error', () => {
      if (clientId) {
        this.clients.delete(clientId);
        this.onClientDisconnected?.(clientId);
      }
    });
  }

  private async handleHandshake(ws: WebSocket, envelope: MessageEnvelope): Promise<string | null> {
    const clientCapabilities = Array.isArray(envelope.clientCapabilities)
      ? envelope.clientCapabilities.filter((c): c is string => typeof c === 'string')
      : [];

    if (this.requireAuth && this.validateToken) {
      const ok = await this.validateToken(envelope.token ?? '');
      if (!ok) {
        this.safeSend(ws, {
          id: envelope.id,
          type: 'error',
          error: { code: 'AUTH_FAILED', message: 'Invalid token' },
        });
        ws.close(1008, 'auth failed');
        return null;
      }
    }

    if (envelope.protocolVersion !== PROTOCOL_VERSION) {
      this.safeSend(ws, {
        id: envelope.id,
        type: 'error',
        error: {
          code: 'PROTOCOL_VERSION_UNSUPPORTED',
          message: `Unsupported protocol version: ${envelope.protocolVersion}`,
        },
      });
      ws.close(1002, 'protocol mismatch');
      return null;
    }

    const clientId = randomUUID();
    const workspaceId = envelope.workspaceId ?? this.options.workspaceId;
    if (this.options.workspaceId && workspaceId !== this.options.workspaceId) { ws.close(1008, 'workspace denied'); return null; }
    if (ws.readyState !== 1) return null;
    const client: ClientConnection = {
      id: clientId,
      ws,
      workspaceId: typeof workspaceId === 'string' ? workspaceId : null,
      capabilities: new Set(clientCapabilities),
    };
    this.clients.set(clientId, client);

    this.safeSend(ws, {
      id: envelope.id,
      type: 'handshake_ack',
      clientId,
      protocolVersion: PROTOCOL_VERSION,
      registeredChannels: [...this.handlers.keys()],
    });
    this.onClientConnected?.({ clientId });
    return clientId;
  }

  private async routeEnvelope(clientId: string, envelope: MessageEnvelope): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (envelope.type) {
      case 'request':
        await this.handleRequest(client, envelope);
        break;
      case 'response':
        // Result of a server→client invokeClient call.
        this.resolvePendingInvoke(envelope);
        break;
      case 'event':
        // Client-emitted events are not part of this protocol revision.
        break;
      default:
        break;
    }
  }

  private async handleRequest(client: ClientConnection, envelope: MessageEnvelope): Promise<void> {
    const channel = envelope.channel ?? '';
    const handler = this.handlers.get(channel);

    if (!handler) {
      this.safeSend(client.ws, {
        id: envelope.id,
        type: 'response',
        channel,
        error: { code: 'CHANNEL_NOT_FOUND', message: `No handler for channel: ${channel}` },
      });
      return;
    }

    try {
      if (/^(sessions|sources|files|workspaces):/.test(channel) && (!client.workspaceId || envelope.args?.[0] !== client.workspaceId)) {
        throw new CodedError('AUTH_FAILED', 'Workspace does not match the authenticated connection');
      }
      const result = await handler(...(envelope.args ?? []));
      this.safeSend(client.ws, {
        id: envelope.id,
        type: 'response',
        channel,
        result: result ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof CodedError ? err.code : 'HANDLER_ERROR';
      this.safeSend(client.ws, {
        id: envelope.id,
        type: 'response',
        channel,
        error: { code, message },
      });
    }
  }

  private resolvePendingInvoke(envelope: MessageEnvelope): void {
    const pending = this.pendingInvokes.get(envelope.id);
    if (!pending) return;
    this.pendingInvokes.delete(envelope.id);
    clearTimeout(pending.timeout);
    if (envelope.error) {
      const err = new Error(envelope.error.message);
      (err as Error & { code?: string }).code = envelope.error.code;
      pending.reject(err);
    } else {
      pending.resolve(envelope.result);
    }
  }

  private safeSend(ws: WebSocket, envelope: MessageEnvelope): void {
    if (ws.readyState === 1 /* WebSocket.OPEN */) {
      try {
        ws.send(serializeEnvelope(envelope));
      } catch {
        // connection raced closed — nothing to do
      }
    }
  }
}
