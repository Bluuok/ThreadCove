/**
 * ElectronAPI — the front-end API surface.
 *
 * The renderer talks to this interface only; how a method resolves
 * (local WS server vs remote workspace server) is invisible here.
 * buildClientApi() generates the runtime implementation from CHANNEL_MAP,
 * and the parity guard (OPTIONAL) asserts the method set matches.
 */

import type { AgentEvent } from '@threadcove/core/types';
import type { SessionDto, SourceDto, WorkspaceDto } from '@threadcove/shared/protocol';

/** Listener registered via api.onSessionEvent. */
export type SessionEventListener = (payload: unknown) => void;

export interface ElectronAPI {
  ready(): Promise<void>;
  getConnectionState(): TransportConnectionState;
  onConnectionStateChanged(listener: (state: TransportConnectionState) => void): () => void;
  dispose(): void;
  // Server / workspaces
  getStatus(): Promise<{ version: string; workspaceCount: number }>;
  getWorkspaces(): Promise<WorkspaceDto[]>;

  // Sessions
  getSessions(workspaceId: string, includeArchived?: boolean): Promise<SessionDto[]>;
  getSessionMessages(workspaceId: string, sessionId: string): Promise<unknown[]>;
  createSession(workspaceId: string, options?: { name?: string; model?: string }): Promise<SessionDto>;
  deleteSession(workspaceId: string, sessionId: string): Promise<{ success: boolean }>;
  archiveSession(workspaceId: string, sessionId: string, archived: boolean): Promise<{ success: boolean }>;
  flagSession(workspaceId: string, sessionId: string, flagged: boolean): Promise<{ success: boolean }>;
  sendMessage(workspaceId: string, sessionId: string, message: string, requestId?: string): Promise<{ accepted: boolean; runId: string }>;
  cancelProcessing(workspaceId: string, sessionId: string): Promise<{ success: boolean }>;
  retryLast(workspaceId: string, sessionId: string): Promise<{ accepted: boolean }>;
  respondToPermission(
    workspaceId: string,
    sessionId: string,
    requestId: string,
    allowed: boolean,
  ): Promise<{ success: boolean }>;
  setModel(workspaceId: string, sessionId: string, model: string): Promise<{ success: boolean }>;
  getModel(workspaceId: string, sessionId: string): Promise<{ model: string }>;

  // Sources
  getSources(workspaceId: string): Promise<SourceDto[]>;
  createSource(workspaceId: string, config: unknown): Promise<SourceDto>;
  deleteSource(workspaceId: string, slug: string): Promise<{ success: boolean }>;
  setSourceCredential(workspaceId: string, slug: string, credential: unknown): Promise<{ success: boolean }>;
  getSourceTools(workspaceId: string, slug: string): Promise<{ names: string[] }>;

  // Files (workspace content)
  listFiles(workspaceId: string, sessionId: string, subPath?: string): Promise<{ entries: unknown[] }>;
  readFile(workspaceId: string, sessionId: string, subPath: string): Promise<{ content: string }>;
  writeFile(workspaceId: string, sessionId: string, subPath: string, content: string): Promise<{ success: boolean }>;

  // LOCAL_ONLY — native dialog (Electron only; WebUI overrides with input[type=file])
  openFileDialog(): Promise<{ paths: string[] }>;
  // LOCAL_ONLY — open URL in external browser (WebUI overrides with window.open)
  openExternal(url: string): Promise<{ opened: boolean }>;

  // Events
  onSessionEvent(listener: SessionEventListener): () => void;
  onSourcesChanged(listener: (workspaceId: string, sources: SourceDto[]) => void): () => void;
}

/** Connection state exposed for UI indicators. */
export type TransportConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

/** Shape of the session event payload broadcast over 'session:event'. */
export interface SessionEventPayload {
  sessionId: string;
  event: AgentEvent | { type: 'user_message'; message: unknown };
}
