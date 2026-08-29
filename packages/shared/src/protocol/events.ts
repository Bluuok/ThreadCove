/**
 * Typed event map for server → client push channels.
 * Keys are channel string literals, values are argument tuples.
 */
import type { RPC_CHANNELS } from './channels.ts';
import type { AgentEvent } from '@threadcove/core/types';

/**
 * A session event: the unified AgentEvent wrapped with the session it
 * belongs to, broadcast by the session layer over R12 transport.
 * R10 defines the event shape; R12 carries it to every client.
 */
export type SessionEvent =
  | { sessionId: string; event: AgentEvent }
  | {
      sessionId: string;
      event: { type: 'user_message'; message: unknown };
    };

export interface BroadcastEventMap {
  [RPC_CHANNELS.session.EVENT]: [event: SessionEvent];
  [RPC_CHANNELS.sources.CHANGED]: [workspaceId: string, sources: unknown[]];
}
