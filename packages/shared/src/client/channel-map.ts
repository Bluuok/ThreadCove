/**
 * Channel map — maps ElectronAPI method names to RPC channels.
 *
 * Single source of truth for the method→channel mapping used by
 * buildClientApi(). The type of an entry decides dispatch:
 * - invoke:   request/response via client.invoke
 * - listener: subscribe via client.on
 */

import { RPC_CHANNELS } from '@threadcove/shared/protocol';
import type { ChannelMap, ChannelMapEntry } from './build-api.ts';

function invoke(channel: string, transform?: (result: unknown) => unknown): ChannelMapEntry {
  return { type: 'invoke' as const, channel, ...(transform && { transform }) };
}

function listener(channel: string): ChannelMapEntry {
  return { type: 'listener' as const, channel };
}

export const CHANNEL_MAP = {
  // Server / workspaces
  getStatus: invoke(RPC_CHANNELS.server.GET_STATUS),
  getWorkspaces: invoke(RPC_CHANNELS.server.GET_WORKSPACES),

  // Sessions
  getSessions: invoke(RPC_CHANNELS.sessions.GET),
  getSessionMessages: invoke(RPC_CHANNELS.sessions.GET_MESSAGES),
  createSession: invoke(RPC_CHANNELS.sessions.CREATE),
  deleteSession: invoke(RPC_CHANNELS.sessions.DELETE),
  archiveSession: invoke(RPC_CHANNELS.sessions.ARCHIVE),
  flagSession: invoke(RPC_CHANNELS.sessions.FLAG),
  sendMessage: invoke(RPC_CHANNELS.sessions.SEND_MESSAGE),
  cancelProcessing: invoke(RPC_CHANNELS.sessions.CANCEL),
  retryLast: invoke(RPC_CHANNELS.sessions.RETRY_LAST),
  respondToPermission: invoke(RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION),
  setModel: invoke(RPC_CHANNELS.sessions.SET_MODEL),
  getModel: invoke(RPC_CHANNELS.sessions.GET_MODEL),

  // Sources
  getSources: invoke(RPC_CHANNELS.sources.LIST),
  createSource: invoke(RPC_CHANNELS.sources.CREATE),
  deleteSource: invoke(RPC_CHANNELS.sources.DELETE),
  setSourceCredential: invoke(RPC_CHANNELS.sources.SET_CREDENTIAL),
  getSourceTools: invoke(RPC_CHANNELS.sources.GET_TOOLS),

  // Files
  listFiles: invoke(RPC_CHANNELS.files.LIST),
  readFile: invoke(RPC_CHANNELS.files.READ),
  writeFile: invoke(RPC_CHANNELS.files.WRITE),

  // LOCAL_ONLY — native dialog / shell
  openFileDialog: invoke(RPC_CHANNELS.dialog.OPEN_FILE),
  openExternal: invoke(RPC_CHANNELS.system.OPEN_EXTERNAL),

  // Events
  onSessionEvent: listener(RPC_CHANNELS.session.EVENT),
  onSourcesChanged: listener(RPC_CHANNELS.sources.CHANGED),
} satisfies ChannelMap;
