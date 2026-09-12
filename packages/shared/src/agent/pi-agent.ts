/**
 * Pi Agent — out-of-process JSONL subprocess backend (R03).
 *
 * Spawns the pi-agent-server child process and communicates over
 * line-delimited JSON on stdin/stdout. The Pi SDK runs in the child;
 * heavy-dependency crashes never take down the host, and credentials
 * never leave the host process (source tools execute via
 * tool_execute_request → host → tool_execute_response).
 *
 * Protocol (host → child): init / prompt / abort / steer / shutdown
 * Protocol (child → host): ready / event / tool_execute_request /
 *                          mini_completion_result / session_id_update / error
 *
 * The child's raw Pi SDK events flow through the R10-owned PiEventAdapter
 * and EventQueue so chat() yields the same AsyncGenerator surface as
 * ClaudeAgent.
 */

import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { join } from 'path';
import type { AgentEvent } from '@threadcove/core/types';
import { BaseAgent } from './backend/base-agent.ts';
import { AbortReason } from './backend/types.ts';
import type { BackendConfig } from './backend/types.ts';
import { EventQueue } from './backend/event-queue.ts';
import { PiEventAdapter } from './backend/pi/event-adapter.ts';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

// ============================================================
// JSONL protocol message types
// ============================================================

interface InboundInitMessage {
  type: 'init';
  apiKey: string;
  model: string;
  cwd: string;
  thinkingLevel: string;
  sessionId: string;
  sessionPath: string;
  workingDirectory: string;
}

type InboundMessage =
  | InboundInitMessage
  | { type: 'prompt'; id: string; message: string }
  | { type: 'abort' }
  | { type: 'steer'; message: string }
  | { type: 'mini_completion'; id: string; prompt: string }
  | { type: 'tool_execute_response'; requestId: string; result: { content: string; isError: boolean } }
  | { type: 'shutdown' };

type OutboundMessage =
  | { type: 'ready'; sessionId: string | null }
  | { type: 'event'; event: Record<string, unknown> }
  | { type: 'tool_execute_request'; requestId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'mini_completion_result'; id: string; text: string | null }
  | { type: 'session_id_update'; sessionId: string }
  | { type: 'error'; message: string; code?: string };

interface PendingToolExecution {
  resolve: (result: { content: string; isError: boolean }) => void;
  reject: (error: Error) => void;
}

// ============================================================
// PiAgent
// ============================================================

export class PiAgent extends BaseAgent {
  protected backendName = 'pi';
  readonly supportsBranching = false;

  private subprocess: ChildProcess | null = null;
  private eventQueue = new EventQueue();
  private adapter = new PiEventAdapter();
  private readyResolve: (() => void) | null = null;
  private readyPromise: Promise<void> | null = null;
  private pendingToolExecutions = new Map<string, PendingToolExecution>();
  private pendingMiniCompletions = new Map<string, { resolve: (text: string | null) => void }>();
  private promptCounter = 0;
  private destroyed = false;
  /** Injected host-side tool executor (MCP pool); credentials stay host-side. */
  private toolExecutor: ((toolName: string, args: Record<string, unknown>) => Promise<{ content: string; isError: boolean }>) | null = null;

  constructor(
    config: BackendConfig,
    /** Path to the pi-agent-server entry (defaults to the workspace package). */
    private readonly serverModulePath: string | null = null,
  ) {
    super(config, DEFAULT_MODEL);
  }

  /** Register the host-side tool executor for proxy tool calls. */
  setToolExecutor(executor: PiAgent['toolExecutor']): void {
    this.toolExecutor = executor;
  }

  /** Expose the queue for tests. */
  getQueue(): EventQueue {
    return this.eventQueue;
  }

  // ============================================================
  // Subprocess lifecycle
  // ============================================================

  private resolveServerPath(): string {
    if (this.serverModulePath) return this.serverModulePath;
    // Workspace layout: packages/pi-agent-server/src/index.ts.
    // Bun runs TS directly — no build step needed.
    return join(process.cwd(), 'packages/pi-agent-server/src/index.ts');
  }

  private async ensureSubprocess(): Promise<void> {
    if (this.subprocess && !this.subprocess.killed) return;
    if (this.destroyed) throw new Error('PiAgent destroyed');

    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });

    const child = spawn(process.execPath, [this.resolveServerPath()], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this.subprocess = child;
    const onPipeError = (error: Error) => {
      if (!this.destroyed) this.eventQueue.enqueue({ type: 'error', message: error.message });
      this.readyResolve?.();
      this.readyResolve = null;
      this.eventQueue.complete();
    };
    child.on('error', onPipeError);
    child.stdin?.on('error', onPipeError);

    child.stderr?.on('data', (data: Buffer) => {
      this.debug(`child stderr: ${data.toString().slice(0, 200)}`);
    });

    child.on('exit', (code) => {
      this.debug(`child exited with code ${code}`);
      this.subprocess = null;
      // Wake any pending waits so chat() can terminate.
      this.readyResolve?.();
      this.readyResolve = null;
      this.eventQueue.complete();
    });

    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line: string) => this.handleLine(line));

    this.send({
      type: 'init',
      apiKey: this.config.apiKey ?? '',
      model: this._model,
      cwd: this.workingDirectory,
      thinkingLevel: this._thinkingLevel,
      sessionId: this._sessionId ?? '',
      sessionPath: this.workingDirectory,
      workingDirectory: this.workingDirectory,
    });

    await this.readyPromise;
    this.debug('subprocess ready');
  }

  /**
   * Parse a JSONL line from the child and dispatch by type.
   * Bad JSONL lines are logged and skipped — the stream survives.
   */
  private handleLine(line: string): void {
    if (!line.trim()) return;

    let msg: OutboundMessage;
    try {
      msg = JSON.parse(line) as OutboundMessage;
    } catch {
      this.debug(`invalid JSONL from child (ignored): ${line.slice(0, 200)}`);
      return;
    }

    switch (msg.type) {
      case 'ready':
        if (msg.sessionId) {
          this._sessionId = msg.sessionId;
        }
        this.readyResolve?.();
        this.readyResolve = null;
        break;

      case 'event':
        // Raw Pi SDK event → R10 adapter → unified AgentEvents → queue.
        for (const event of this.adapter.adaptEvent(msg.event)) {
          this.eventQueue.enqueue(event);
        }
        // agent_end marks the turn boundary — close the queue so chat()'s
        // drain() terminates after buffered events flush.
        if (msg.event['type'] === 'agent_end') {
          this.eventQueue.complete();
        }
        break;

      case 'tool_execute_request': {
        // Child asks the host to run a source tool — credentials stay here.
        void this.handleToolExecuteRequest(msg);
        break;
      }

      case 'mini_completion_result': {
        const pending = this.pendingMiniCompletions.get(msg.id);
        if (pending) {
          this.pendingMiniCompletions.delete(msg.id);
          pending.resolve(msg.text);
        }
        break;
      }

      case 'session_id_update':
        this._sessionId = msg.sessionId;
        break;

      case 'error':
        this.debug(`child error: ${msg.message}`);
        this.eventQueue.enqueue({ type: 'error', message: msg.message });
        break;

      default:
        // Unknown message types: drop (tolerance contract).
        break;
    }
  }

  private async handleToolExecuteRequest(msg: Extract<OutboundMessage, { type: 'tool_execute_request' }>): Promise<void> {
    const requestId = msg.requestId;
    try {
      if (!this.toolExecutor) {
        throw new Error(`No tool executor registered for tool: ${msg.toolName}`);
      }
      const result = await this.toolExecutor(msg.toolName, msg.args);
      this.send({ type: 'tool_execute_response', requestId, result });
    } catch (err) {
      const content = err instanceof Error ? err.message : String(err);
      this.send({ type: 'tool_execute_response', requestId, result: { content, isError: true } });
    }
  }

  /** Send a JSONL command to the child's stdin. */
  private send(cmd: InboundMessage): void {
    if (!this.subprocess?.stdin?.writable) {
      this.debug('cannot send to child: stdin not writable');
      return;
    }
    this.subprocess.stdin.write(JSON.stringify(cmd) + '\n', error => {
      if (error && !this.destroyed) { this.eventQueue.enqueue({ type: 'error', message: error.message }); this.eventQueue.complete(); }
    });
  }

  // ============================================================
  // Core loop
  // ============================================================

  protected async *chatImpl(message: string): AsyncGenerator<AgentEvent> {
    await this.ensureSubprocess();

    this.adapter.startTurn();
    this.eventQueue.reset();

    const promptId = `prompt-${++this.promptCounter}`;
    this.send({ type: 'prompt', id: promptId, message });

    // The queue bridges async child events into this generator.
    yield* this.eventQueue.drain();
    yield { type: 'complete' };
  }

  // ============================================================
  // Abort / redirect
  // ============================================================

  protected async abortImpl(_reason: string): Promise<void> {
    this.send({ type: 'abort' });
    this.eventQueue.complete();
  }

  protected forceAbortImpl(reason: AbortReason): void {
    this.lastAbortReason = reason;
    this.send({ type: 'abort' });
    this.eventQueue.complete();
    this._processing = false;
  }

  /**
   * Pi has native steering: inject the message into the current stream
   * and return true — events continue through the existing generator.
   */
  redirect(message: string): boolean {
    if (!this.isProcessing() || !this.subprocess) {
      this.forceAbort(AbortReason.Redirect);
      return false;
    }
    this.debug(`steering mid-stream: "${message.slice(0, 80)}"`);
    this.send({ type: 'steer', message });
    return true;
  }

  interruptForHandoff(reason: AbortReason): void {
    this.lastAbortReason = reason;
    this.send({ type: 'abort' });
    this.eventQueue.complete();
  }

  // ============================================================
  // Mini completion
  // ============================================================

  async runMiniCompletion(prompt: string): Promise<string | null> {
    await this.ensureSubprocess();
    const id = `mini-${++this.promptCounter}`;
    return new Promise<string | null>((resolve) => {
      this.pendingMiniCompletions.set(id, { resolve });
      this.send({ type: 'mini_completion', id, prompt });
      // Timeout fallback: never wedge title generation.
      setTimeout(() => {
        const pending = this.pendingMiniCompletions.get(id);
        if (pending) {
          this.pendingMiniCompletions.delete(id);
          pending.resolve(null);
        }
      }, 30_000);
    });
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  respondToPermission(_requestId: string, _allowed: boolean, _alwaysAllow?: boolean): void {
    // Permission requests are surfaced by the session-layer safety pipeline;
    // no pending permission state in this backend.
    this.debug('respondToPermission: no pending permission request');
  }

  async postInit() {
    await this.ensureSubprocess();
    return { authInjected: Boolean(this.config.apiKey) };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.subprocess) {
      // Killing immediately after an async shutdown write races stdin on Windows.
      this.subprocess.kill();
      this.subprocess = null;
    }
  }
}
