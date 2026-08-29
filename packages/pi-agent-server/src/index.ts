#!/usr/bin/env bun
/**
 * Pi Agent Server (R03 support package).
 *
 * Out-of-process Pi agent server communicating via JSONL over stdio.
 * Wraps @earendil-works/pi-coding-agent and talks to the host (main
 * process) with line-delimited JSON.
 *
 * Process isolation: the Pi SDK's heavy ESM dependency tree runs here,
 * so a crash never takes down the host. All source-tool (MCP/API)
 * executions are NOT done here — the server sends `tool_execute_request`
 * lines back to the host and waits for `tool_execute_response`, so
 * credentials only ever live in the host process.
 *
 * JSONL protocol (host → server, stdin):
 *   { type: 'init', apiKey, model, cwd, thinkingLevel, sessionId, sessionPath, workingDirectory, ... }
 *   { type: 'prompt', id, message, systemPrompt }
 *   { type: 'abort' }
 *   { type: 'steer', message }
 *   { type: 'register_tools', tools: [{ name, description, inputSchema }] }
 *   { type: 'tool_execute_response', requestId, result: { content, isError } }
 *   { type: 'shutdown' }
 *
 * JSONL protocol (server → host, stdout):
 *   { type: 'ready', sessionId }
 *   { type: 'event', event: AgentSessionEvent }        — raw Pi SDK event, adapted host-side
 *   { type: 'tool_execute_request', requestId, toolName, args }
 *   { type: 'mini_completion_result', id, text }
 *   { type: 'session_id_update', sessionId }
 *   { type: 'error', message, code? }
 *
 * Debug output goes to stderr so it never corrupts the JSONL stream.
 */

import { createInterface } from 'node:readline';

// ============================================================
// Types — JSONL protocol
// ============================================================

/** Tool definition sent by the host for proxy tools (MCP/API sources). */
export interface ProxyToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface InitMessage {
  type: 'init';
  apiKey: string;
  model: string;
  cwd: string;
  thinkingLevel: string;
  sessionId: string;
  sessionPath: string;
  workingDirectory: string;
  workspaceRootPath?: string;
  systemPrompt?: string;
}

export type InboundMessage =
  | InitMessage
  | { type: 'prompt'; id: string; message: string; systemPrompt?: string }
  | { type: 'abort' }
  | { type: 'steer'; message: string }
  | { type: 'register_tools'; tools: ProxyToolDef[] }
  | { type: 'tool_execute_response'; requestId: string; result: { content: string; isError: boolean } }
  | { type: 'mini_completion'; id: string; prompt: string }
  | { type: 'shutdown' };

export type OutboundMessage =
  | { type: 'ready'; sessionId: string | null }
  | { type: 'event'; event: Record<string, unknown> }
  | { type: 'tool_execute_request'; requestId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'mini_completion_result'; id: string; text: string | null }
  | { type: 'session_id_update'; sessionId: string }
  | { type: 'error'; message: string; code?: string };

// ============================================================
// JSONL I/O
// ============================================================

export function send(msg: OutboundMessage): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

export function debugLog(message: string): void {
  process.stderr.write(`[pi-server] ${message}\n`);
}

// ============================================================
// State
// ============================================================

interface PendingToolExecution {
  resolve: (result: { content: string; isError: boolean }) => void;
  reject: (error: Error) => void;
}

let proxyToolDefs: ProxyToolDef[] = [];
/** Proxy tool executions awaiting a host response (credentials stay host-side). */
const pendingToolExecutions = new Map<string, PendingToolExecution>();
let requestCounter = 0;

// ============================================================
// Tool execution proxy
// ============================================================

/**
 * Execute a proxy tool by asking the host. The Pi SDK's custom tool
 * `execute` calls this; the promise resolves when the host writes a
 * `tool_execute_response` line back.
 */
export function executeToolViaHost(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  const requestId = `treq-${++requestCounter}-${Date.now()}`;
  return new Promise((resolve, reject) => {
    pendingToolExecutions.set(requestId, { resolve, reject });
    send({ type: 'tool_execute_request', requestId, toolName, args });
    // Timeout guard — a lost response must not wedge the server forever.
    const timer = setTimeout(() => {
      if (pendingToolExecutions.has(requestId)) {
        pendingToolExecutions.delete(requestId);
        reject(new Error(`Tool execution timed out in host: ${toolName}`));
      }
    }, 120_000);
    const originalResolve = resolve;
    // Clear timer on settle by wrapping resolve/reject
    pendingToolExecutions.set(requestId, {
      resolve: (result) => {
        clearTimeout(timer);
        originalResolve(result);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
  });
}

// ============================================================
// Message dispatch
// ============================================================

async function handleMessage(msg: InboundMessage): Promise<void> {
  switch (msg.type) {
    case 'init': {
      debugLog(`init: model=${msg.model} cwd=${msg.cwd}`);
      send({ type: 'ready', sessionId: msg.sessionId });
      break;
    }

    case 'register_tools': {
      proxyToolDefs = msg.tools;
      debugLog(`registered ${proxyToolDefs.length} proxy tools`);
      break;
    }

    case 'tool_execute_response': {
      const pending = pendingToolExecutions.get(msg.requestId);
      if (pending) {
        pendingToolExecutions.delete(msg.requestId);
        pending.resolve(msg.result);
      } else {
        debugLog(`no pending tool execution for ${msg.requestId}`);
      }
      break;
    }

    case 'prompt': {
      // Real Pi SDK session happens here. In this skeleton, the heavy Pi
      // SDK wiring lands with Gate 1's PiAgent work; the protocol frame
      // (prompt → events → completion) is exercised end-to-end via the
      // host-side tests with a mock child process.
      debugLog('prompt received — Pi SDK session wiring arrives with R03 implementation');
      send({ type: 'error', message: 'Pi SDK session not yet wired (Gate 1)', code: 'not_implemented' });
      break;
    }

    case 'steer': {
      debugLog(`steer requested: ${msg.message.slice(0, 80)}`);
      break;
    }

    case 'abort': {
      debugLog('abort requested');
      break;
    }

    case 'mini_completion': {
      send({ type: 'mini_completion_result', id: msg.id, text: null });
      break;
    }

    case 'shutdown': {
      process.exit(0);
      break;
    }
  }
}

// ============================================================
// Main loop
// ============================================================

function main(): void {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line: string) => {
    if (!line.trim()) return;
    let msg: InboundMessage;
    try {
      msg = JSON.parse(line) as InboundMessage;
    } catch {
      // Bad JSONL line: log to stderr and keep the stream alive.
      debugLog(`invalid JSONL line (ignored): ${line.slice(0, 200)}`);
      return;
    }
    void handleMessage(msg).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      debugLog(`handler error: ${message}`);
      send({ type: 'error', message });
    });
  });
  rl.on('close', () => {
    debugLog('stdin closed, shutting down');
    process.exit(0);
  });
}

// Only run the loop when executed directly (not when imported by tests).
if (import.meta.main) {
  main();
}
