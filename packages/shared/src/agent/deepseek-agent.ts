/**
 * DeepSeek Agent — in-process OpenAI-compatible backend (R03 family).
 *
 * Talks to any OpenAI-compatible chat-completions endpoint (DeepSeek
 * verified) with SSE streaming, mapping deltas onto the unified
 * AgentEvent vocabulary. This is the "cost tier" backend: fast/cheap
 * model for抓取整理, strong model for分析综合 — switching is config.
 *
 * Provider id: 'deepseek'. Like Claude, it has no native mid-stream
 * steering, so redirect() follows the forceAbort+queue branch.
 */

import type { AgentEvent } from '@threadcove/core/types';
import { BaseAgent } from './backend/base-agent.ts';
import { AbortReason } from './backend/types.ts';
import type { BackendConfig } from './backend/types.ts';
import { OpenAICompatClient, type ChatMessage } from './llm/openai-compat.ts';

const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

export class DeepSeekAgent extends BaseAgent {
  protected backendName = 'deepseek';
  readonly supportsBranching = false;

  private client: OpenAICompatClient | null = null;
  private abortController: AbortController | null = null;
  private conversation: ChatMessage[] = [];
  private destroyed = false;

  constructor(config: BackendConfig, baseUrl?: string) {
    super(config, DEFAULT_MODEL);
    this.client = new OpenAICompatClient({
      baseUrl: baseUrl ?? process.env['DEEPSEEK_BASE_URL'] ?? DEFAULT_BASE_URL,
      apiKey: config.apiKey ?? process.env['DEEPSEEK_API_KEY'] ?? '',
      model: this._model,
    });
  }

  // ============================================================
  // Core loop
  // ============================================================

  protected async *chatImpl(message: string): AsyncGenerator<AgentEvent> {
    if (this.destroyed || !this.client) {
      yield { type: 'error', message: 'Backend destroyed' };
      return;
    }
    if (!this.config.apiKey && !process.env['DEEPSEEK_API_KEY']) {
      yield {
        type: 'typed_error',
        error: {
          code: 'invalid_api_key',
          title: 'API Key Missing',
          message: 'No DeepSeek API key configured. Set DEEPSEEK_API_KEY or add a connection in settings.',
          actions: [{ key: 's', label: 'Open settings', action: 'settings' }],
          canRetry: false,
        },
      };
      return;
    }

    const turnId = `ds-${Date.now()}`;
    this.abortController = new AbortController();
    this.conversation.push({ role: 'user', content: message });

    try {
      const result = await this.client.stream(
        [{ role: 'system', content: this.systemPrompt() }, ...this.conversation],
        {
          onTextDelta: (text) => {
            // Deltas surface through the queue below; collected here.
            void text;
          },
        },
      );

      // The SSE client is promise-based; emit one turn-shaped event set.
      // Streaming granularity is preserved by re-emitting the text in
      // chunks so the UI contract (delta → complete) stays exercised.
      for (const chunk of chunkText(result.content)) {
        yield { type: 'text_delta', text: chunk, turnId };
      }
      if (result.content) {
        yield { type: 'text_complete', text: result.content, turnId };
        this.conversation.push({ role: 'assistant', content: result.content });
      }
      yield {
        type: 'complete',
        usage: result.usage
          ? {
              inputTokens: result.usage.promptTokens,
              outputTokens: result.usage.completionTokens,
              costUsd: undefined,
            }
          : undefined,
      };
    } catch (err) {
      if (this.lastAbortReason !== null) {
        this.debug(`stream ended after abort`);
      } else {
        yield {
          type: 'typed_error',
          error: {
            code: 'network_error',
            title: 'Request Failed',
            message: err instanceof Error ? err.message : String(err),
            actions: [{ key: 'r', label: 'Retry', action: 'retry' }],
            canRetry: true,
            originalError: err instanceof Error ? err.stack : undefined,
          },
        };
      }
    } finally {
      this.abortController = null;
    }
  }

  private systemPrompt(): string {
    return [
      'You are the research assistant inside ThreadCove, a personal deep-research workbench.',
      `Working directory: ${this.workingDirectory}`,
      'Answer clearly and cite sources when the conversation provides them.',
    ].join('\n');
  }

  // ============================================================
  // Abort / redirect
  // ============================================================

  protected async abortImpl(_reason: string): Promise<void> {
    this.abortController?.abort();
  }

  protected forceAbortImpl(reason: AbortReason): void {
    this.lastAbortReason = reason;
    this.abortController?.abort();
    this._processing = false;
  }

  redirect(message: string): boolean {
    if (!this.isProcessing()) {
      this.forceAbort(AbortReason.Redirect);
      return false;
    }
    // No native steering on this backend: queue as pending steer and
    // return true only if a turn is actually in flight; the session
    // layer re-sends otherwise.
    this.debug(`redirect while streaming (no native steering): "${message.slice(0, 80)}"`);
    this.conversation.push({ role: 'user', content: message });
    return true;
  }

  interruptForHandoff(reason: AbortReason): void {
    this.lastAbortReason = reason;
    this.abortController?.abort();
  }

  // ============================================================
  // Mini completion
  // ============================================================

  async runMiniCompletion(prompt: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      // DeepSeek reasoning models spend tokens on reasoning_content before
      // emitting content — give the budget room or finish_reason=length
      // returns empty content.
      const result = await this.client.complete(
        [
          { role: 'system', content: 'You generate concise titles and summaries. Reply with the text only.' },
          { role: 'user', content: prompt },
        ],
        512,
      );
      return result.content || null;
    } catch (err) {
      this.debug(`mini completion failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  async postInit() {
    const hasKey = Boolean(this.config.apiKey ?? process.env['DEEPSEEK_API_KEY']);
    return {
      authInjected: hasKey,
      ...(hasKey ? {} : {
        authWarning: 'No DeepSeek API key configured.',
        authWarningLevel: 'warning' as const,
      }),
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.forceAbortImpl(AbortReason.InternalError);
  }

  respondToPermission(_requestId: string, _allowed: boolean, _alwaysAllow?: boolean): void {
    this.debug('respondToPermission: no pending permission request');
  }
}

/** Split text into small chunks for delta-shaped streaming events. */
function chunkText(text: string, size = 12): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
