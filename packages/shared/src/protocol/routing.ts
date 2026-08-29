/**
 * Exhaustive channel routing table for hybrid local/remote transport (R12).
 *
 * Every RPC channel must belong to exactly one of two sets:
 * - LOCAL_ONLY: Always runs on the local Electron server, never proxied
 *   (needs native OS / Electron: dialogs, shell.openExternal, system info).
 * - REMOTE_ELIGIBLE: Runs on whichever server owns the workspace
 *   (workspace content: sessions, sources, files).
 *
 * An exhaustiveness test forces new channels to be classified or CI goes
 * red — "every channel has been explicitly decided" is the soul of this
 * design point.
 */
import { RPC_CHANNELS } from './channels.ts';

export const LOCAL_ONLY_CHANNELS = new Set<string>([
  // dialog — native file dialog
  RPC_CHANNELS.dialog.OPEN_FILE,

  // system — local OS info / shell
  RPC_CHANNELS.system.GET_VERSIONS,
  RPC_CHANNELS.system.OPEN_EXTERNAL,
]);

export const REMOTE_ELIGIBLE_CHANNELS = new Set<string>([
  // server
  RPC_CHANNELS.server.GET_STATUS,
  RPC_CHANNELS.server.GET_WORKSPACES,

  // sessions — workspace content
  RPC_CHANNELS.sessions.GET,
  RPC_CHANNELS.sessions.CREATE,
  RPC_CHANNELS.sessions.DELETE,
  RPC_CHANNELS.sessions.ARCHIVE,
  RPC_CHANNELS.sessions.FLAG,
  RPC_CHANNELS.sessions.GET_MESSAGES,
  RPC_CHANNELS.sessions.SEND_MESSAGE,
  RPC_CHANNELS.sessions.CANCEL,
  RPC_CHANNELS.sessions.SET_MODEL,
  RPC_CHANNELS.sessions.GET_MODEL,
  RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION,
  RPC_CHANNELS.sessions.RETRY_LAST,
  RPC_CHANNELS.session.EVENT,

  // workspaces
  RPC_CHANNELS.workspaces.GET,
  RPC_CHANNELS.workspaces.CREATE,
  RPC_CHANNELS.workspaces.GET_DEFAULTS,
  RPC_CHANNELS.workspaces.SET_WORKING_DIRECTORY,

  // sources — workspace content
  RPC_CHANNELS.sources.LIST,
  RPC_CHANNELS.sources.CREATE,
  RPC_CHANNELS.sources.DELETE,
  RPC_CHANNELS.sources.SET_CREDENTIAL,
  RPC_CHANNELS.sources.GET_TOOLS,
  RPC_CHANNELS.sources.CHANGED,

  // files — workspace content (web goes through the server as proxy)
  RPC_CHANNELS.files.LIST,
  RPC_CHANNELS.files.READ,
  RPC_CHANNELS.files.WRITE,
]);
