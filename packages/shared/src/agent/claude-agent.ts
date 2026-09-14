/**
 * Claude Agent — in-process backend via @anthropic-ai/claude-agent-sdk (R03).
 *
 * The SDK's query() streams SDKMessage objects; the Claude event adapter
 * (R10) maps them onto the unified AgentEvent vocabulary. This class owns
 * the lifecycle: query creation, abort via AbortController, redirect
 * (no native steering — forceAbort fallback + pending steer), and the
 * mini completion path.
 *
 * Gate 0 note: the full event-adapter wiring lands with R10 (Gate 1);
 * this skeleton already routes SDKMessage objects through the adapter
 * seam so the chain is exercised end to end.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKMessage,
  SDKResultMessage,
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, StoredMessage } from '@threadcove/core/types';
import { promptWithHistory, restoreTextHistory } from './backend/history.ts';
import { BaseAgent } from './backend/base-agent.ts';
import { AbortReason } from './backend/types.ts';
import type { BackendConfig } from './backend/types.ts';
import { ClaudeEventAdapter } from './backend/claude/event-adapter.ts';
import { getModelById, getContextWindowForModel } from '../config/models.ts';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export class ClaudeAgent extends BaseAgent {
  protected backendName = 'claude';
  readonly supportsBranching = false;

  private abortController: AbortController | null = null;
  private currentQuery: AsyncGenerator<SDKMessage, void> | null = null;
  private pendingSteerMessage: string | null = null;
  private adapter: ClaudeEventAdapter;
  private destroyed = false;
  private history: StoredMessage[] = [];

  restoreHistory(messages: StoredMessage[]): void { this.history = restoreTextHistory(messages); }

  constructor(config: BackendConfig) {
    super(config, DEFAULT_MODEL);
    this.adapter = new ClaudeEventAdapter();
  }

  // ============================================================
  // Core loop
  // ============================================================

  protected async *chatImpl(message: string): AsyncGenerator<AgentEvent> {
    if (this.destroyed) {
      yield { type: 'error', message: 'Backend destroyed' };
      return;
    }

    this.abortController = new AbortController();
    this.adapter.startTurn();

    const sdkQuery = query({
      prompt: promptWithHistory(this.history, message),
      options: {
        env: { ...process.env, ...(this.config.apiKey ? { ANTHROPIC_API_KEY: this.config.apiKey } : {}) },
        abortController: this.abortController,
        cwd: this.workingDirectory,
        model: this._model,
        maxTurns: 50,
        permissionMode: 'default',
        includePartialMessages: true,
        settingSources: [],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        stderr: (data: string) => this.debug(`stderr: ${data.slice(0, 200)}`),
      },
    });
    this.currentQuery = sdkQuery;
    this.history.push({ id: crypto.randomUUID(), type: 'user', content: message, timestamp: Date.now() });
    let partial = '';

    try {
      for await (const sdkMessage of sdkQuery) {
        // Deliver a pending steer as soon as the turn yields control
        // (no native steering in Claude — this is the adaptation).
        if (this.pendingSteerMessage && this.lastAbortReason === null) {
          const steered = this.pendingSteerMessage;
          this.pendingSteerMessage = null;
          yield { type: 'info', message: `Redirected: ${steered}` };
        }

        const events = this.adapter.adapt(sdkMessage);
        for (const event of events) {
          if (event.type === 'text_delta') partial += event.text;
          if (event.type === 'text_complete') {
            this.history.push({ id: crypto.randomUUID(), type: 'assistant', content: event.text, timestamp: Date.now() });
            partial = '';
          }
          yield event;
        }
      }
    } catch (err) {
      if (this.lastAbortReason !== null) {
        // Aborted on purpose — the abort already surfaced its own event.
        this.debug(`stream ended after abort: ${String(err)}`);
      } else {
        const messageText = err instanceof Error ? err.message : String(err);
        yield { type: 'error', message: messageText };
      }
    } finally {
      if (partial) this.history.push({ id: crypto.randomUUID(), type: 'assistant', content: partial, timestamp: Date.now() });
      this.history = restoreTextHistory(this.history);
      this.currentQuery = null;
      this.abortController = null;
    }

    yield { type: 'complete' };
  }

  // ============================================================
  // Abort / redirect / handoff
  // ============================================================

  protected async abortImpl(_reason: string): Promise<void> {
    this.abortController?.abort();
    this.currentQuery = null;
  }

  protected forceAbortImpl(reason: AbortReason): void {
    this.lastAbortReason = reason;
    this.abortController?.abort();
    this.currentQuery = null;
    this._processing = false;
  }

  /**
   * Claude has no native mid-stream steering. While streaming we hold the
   * message as a pending steer (delivered next turn) and return true; when
   * idle we forceAbort and return false so the session layer re-queues.
   */
  redirect(message: string): boolean {
    if (!this.isProcessing() || !this.currentQuery) {
      this.forceAbort(AbortReason.Redirect);
      return false;
    }
    this.debug(`redirect mid-stream (pending steer): "${message.slice(0, 80)}"`);
    this.pendingSteerMessage = message;
    return true;
  }

  interruptForHandoff(reason: AbortReason): void {
    this.lastAbortReason = reason;
    this.pendingSteerMessage = null;
    void this.abortController?.abort();
  }

  // ============================================================
  // Mini completion (title generation / summaries)
  // ============================================================

  async runMiniCompletion(prompt: string): Promise<string | null> {
    try {
      let text: string | null = null;
      const q = query({
        prompt,
        options: {
          maxTurns: 1,
          systemPrompt: 'You generate concise titles and summaries. Reply with the text only.',
          settingSources: [],
        },
      });
      for await (const msg of q) {
        if (msg.type === 'result') {
          const result = msg as SDKResultMessage;
          if (result.subtype === 'success') {
            text = result.result;
          }
        }
      }
      return text;
    } catch (err) {
      this.debug(`mini completion failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  async postInit() {
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      return {
        authInjected: false,
        authWarning: 'No API key configured — set ANTHROPIC_API_KEY or configure a connection.',
        authWarningLevel: 'warning' as const,
      };
    }
    // The SDK picks up ANTHROPIC_API_KEY from the environment; a configured
    // key is surfaced as injected. Credential values are never logged.
    return { authInjected: true };
  }

  destroy(): void {
    this.destroyed = true;
    this.forceAbortImpl(AbortReason.InternalError);
  }

  // ============================================================
  // Permission resolution
  // ============================================================

  respondToPermission(_requestId: string, _allowed: boolean, _alwaysAllow?: boolean): void {
    // Permission prompts arrive via canUseTool in the full pipeline;
    // no pending prompt state in this backend skeleton.
    this.debug('respondToPermission: no pending permission request');
  }
}

// Re-export SDK message types for adapter typing convenience
export type { SDKMessage, SDKAssistantMessage, SDKPartialAssistantMessage, SDKUserMessage };
export { getContextWindowForModel, getModelById };
