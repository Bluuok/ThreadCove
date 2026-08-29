/**
 * RPC channel names — organized by domain namespace.
 * Wire-format strings (values) are the stable API contract.
 * Key paths are internal and may be reorganized freely.
 *
 * Scope note (reproduction): only the channels our five selected points
 * actually need are declared here — sessions, workspaces, sources, files,
 * server status. The exhaustive routing test (routing.ts + routing.test)
 * forces every new channel to be classified before it can ship.
 */
export const RPC_CHANNELS = {
  server: {
    GET_STATUS: 'server:getStatus',
    GET_WORKSPACES: 'server:getWorkspaces',
  },
  sessions: {
    GET: 'sessions:get',
    CREATE: 'sessions:create',
    DELETE: 'sessions:delete',
    ARCHIVE: 'sessions:archive',
    FLAG: 'sessions:flag',
    GET_MESSAGES: 'sessions:getMessages',
    SEND_MESSAGE: 'sessions:sendMessage',
    CANCEL: 'sessions:cancel',
    SET_MODEL: 'sessions:setModel',
    GET_MODEL: 'sessions:getModel',
    RESPOND_TO_PERMISSION: 'sessions:respondToPermission',
    RETRY_LAST: 'sessions:retryLast',
  },
  session: {
    EVENT: 'session:event',
  },
  workspaces: {
    GET: 'workspaces:get',
    CREATE: 'workspaces:create',
    GET_DEFAULTS: 'workspaces:getDefaults',
    SET_WORKING_DIRECTORY: 'workspaces:setWorkingDirectory',
  },
  sources: {
    LIST: 'sources:list',
    CREATE: 'sources:create',
    DELETE: 'sources:delete',
    SET_CREDENTIAL: 'sources:setCredential',
    GET_TOOLS: 'sources:getTools',
    CHANGED: 'sources:changed',
  },
  files: {
    LIST: 'files:list',
    READ: 'files:read',
    WRITE: 'files:write',
  },
  dialog: {
    OPEN_FILE: 'dialog:openFile',
  },
  system: {
    GET_VERSIONS: 'system:getVersions',
    OPEN_EXTERNAL: 'system:openExternal',
  },
} as const;
