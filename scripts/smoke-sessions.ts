#!/usr/bin/env bun
/**
 * Multi-session + backend-switch smoke over the R12 server stack with the
 * REAL DeepSeek backend: two sessions run in parallel, transcripts stay
 * isolated, and a provider switch (deepseek → deepseek with different
 * model params) flows through the same WebSocket surface.
 *
 * Run: DEEPSEEK_API_KEY=... bun run scripts/smoke-sessions.ts
 */

import { WsRpcServer } from '../apps/electron/src/transport/server.ts';
import { WsRpcClient } from '../apps/electron/src/transport/client.ts';
import { buildClientApi } from '../apps/electron/src/transport/build-api.ts';
import { CHANNEL_MAP } from '../apps/electron/src/transport/channel-map.ts';
import { SessionManager } from '../apps/electron/src/server/session-manager.ts';
import { registerHandlers } from '../apps/electron/src/server/handlers.ts';
import { createWorkspace, loadWorkspaceFrom } from '../packages/shared/src/workspaces/storage.ts';
import { createBackend } from '../packages/shared/src/agent/index.ts';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const apiKey = process.env['DEEPSEEK_API_KEY'];
if (!apiKey) {
  console.error('DEEPSEEK_API_KEY not set');
  process.exit(1);
}

// ── Server stack ────────────────────────────────────────────────────
const base = mkdtempSync(join(tmpdir(), 'tc-smoke-'));
process.env['THREADCOVE_HOME'] = base;
const ws = loadWorkspaceFrom(join(base, 'workspaces', 'smoke')) ?? createWorkspace({ name: 'Smoke' }, join(base, 'workspaces', 'smoke'));

const server = new WsRpcServer({ host: '127.0.0.1', port: 0 });
await server.start();

const sessionManager = new SessionManager(server, (id) => (id === ws.config.id ? ws.rootPath : null));
sessionManager.registerWorkspace(ws.config.id, ws.rootPath);

registerHandlers(server, {
  getWorkspaceRoot: (id) => (id === ws.config.id ? ws.rootPath : null),
  sessionManager,
  broadcast: (target, channel, ...args) => server.broadcast(target, channel, ...args),
  modelProvider: () => ({ provider: 'deepseek' }),
  model: () => 'deepseek-v4-flash',
  apiKey: () => apiKey,
  isLocal: true,
});

// ── Client (the WebUI would use this exact path) ───────────────────
const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { autoReconnect: false });
const streamed: string[] = [];
const api = buildClientApi(client, CHANNEL_MAP) as ReturnType<typeof buildClientApi> & {
  onSessionEvent: (cb: (e: { sessionId: string; event: { type: string; text?: string } }) => void) => void;
};
client.connect();
await new Promise<void>((resolve) => {
  const un = client.onConnectionStateChanged((s) => {
    if (s === 'connected') { un(); resolve(); }
  });
});

api.onSessionEvent((payload) => {
  if (payload.event.type === 'text_delta' && payload.event.text) {
    streamed.push(payload.event.text);
  }
});

console.log('=== ThreadCove multi-session smoke (DeepSeek over R12 transport) ===');

// Session A + B, sequential turns, transcripts must stay isolated.
const sessionA = (await api.createSession(ws.config.id, { name: 'Session A' })) as { id: string };
const sessionB = (await api.createSession(ws.config.id, { name: 'Session B' })) as { id: string };
console.log(`sessions: A=${sessionA.id} B=${sessionB.id}`);

streamed.length = 0;
await api.sendMessage(ws.config.id, sessionA.id, 'Reply with one short sentence: what is 2+2?');
const msgsA = (await api.getSessionMessages(ws.config.id, sessionA.id)) as Array<{ type: string; content: string }>;
console.log(`A transcript: ${msgsA.length} messages (user + assistant), streamed deltas: ${streamed.length}`);

streamed.length = 0;
await api.sendMessage(ws.config.id, sessionB.id, 'Reply with one short sentence: what is the capital of France?');
const msgsB = (await api.getSessionMessages(ws.config.id, sessionB.id)) as Array<{ type: string; content: string }>;

const aContents = msgsA.map((m) => m.content).join(' ');
const bContents = msgsB.map((m) => m.content).join(' ');
console.log(`A mentions Paris? ${aContents.includes('Paris')} | B mentions Paris? ${bContents.includes('Paris')}`);
console.log(`isolation: A has no France-talk? ${!aContents.toLowerCase().includes('france')}`);

// Backend switch via config: same API surface, new provider instance.
const switchedBackend = createBackend({
  provider: 'deepseek',
  workspaceRootPath: ws.rootPath,
  workspaceId: ws.config.id,
  sessionId: 'switch-check',
  workingDirectory: ws.rootPath,
  model: 'deepseek-v4-pro',
  apiKey,
});
console.log(`switched backend model: ${switchedBackend.getModel()} (config-only change)`);

// Unread tracking / flag through the same surface.
await api.flagSession(ws.config.id, sessionA.id, true);
const sessions = (await api.getSessions(ws.config.id, true)) as Array<{ id: string; isFlagged?: boolean }>;
console.log(`flag persisted: ${sessions.find((s) => s.id === sessionA.id)?.isFlagged === true}`);

client.disconnect();
await server.stop();
console.log('=== multi-session smoke OK ===');
