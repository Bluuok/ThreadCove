/**
 * Claude Event Adapter (R10).
 *
 * Maps Claude SDK messages to the unified AgentEvent vocabulary.
 * Key Claude-specific behavior:
 * - stream_event (SDKPartialAssistantMessage) → text_delta in real time
 * - pendingText defers text_complete until stop_reason arrives via
 *   message_delta (so an intermediate assistant message followed by tool
 *   use can be marked isIntermediate)
 * - usage tracked per assistant message
 * - parentToolUseId passes through the SDK value (native transparency)
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@threadcove/core/types';

export class ClaudeEventAdapter {
  private turnIndex = 0;
  private currentTurnId: string | null = null;
  /** Accumulated text for the in-flight assistant message. */
  private pendingText: string | null = null;
  private pendingSdkMessageId: string | null = null;
  private toolNames: Map<string, string> = new Map();

  /** Start a new turn — resets per-turn state. */
  startTurn(turnId?: string): void {
    this.turnIndex++;
    this.currentTurnId = turnId ?? null;
    this.pendingText = null;
    this.pendingSdkMessageId = null;
    this.toolNames.clear();
  }

  /**
   * Convert one SDK message into zero or more AgentEvents.
   * Unknown message types are dropped with a debug note — the renderer's
   * contract is to tolerate unknown events, and so is this adapter.
   */
  adapt(sdkMessage: SDKMessage): AgentEvent[] {
    const events: AgentEvent[] = [];

    switch (sdkMessage.type) {
      case 'stream_event': {
        const partial = sdkMessage as SDKPartialAssistantMessageLike;
        const event = partial.event;
        if (!event) break;
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const delta = event.delta.text;
          if (delta) {
            this.pendingText = (this.pendingText ?? '') + delta;
            events.push({
              type: 'text_delta',
              text: delta,
              turnId: this.currentTurnId ?? undefined,
              parentToolUseId: partial.parent_tool_use_id ?? undefined,
            });
          }
        }
        break;
      }

      case 'assistant': {
        const assistant = sdkMessage as SDKAssistantMessageLike;
        const messageId = assistant.message?.id;
        if (messageId && !this.currentTurnId) {
          // First assistant message of the turn supplies the turnId
          // (correlation ID from the API's message.id).
          this.currentTurnId = messageId;
        }
        if (messageId) this.pendingSdkMessageId = messageId;

        const blocks = assistant.message?.content ?? [];
        for (const block of blocks) {
          if (block.type === 'tool_use' && block.id && block.name) {
            // Flush pending text first so ordering is text → tool.
            this.flushPendingText(events, true);
            this.toolNames.set(block.id, block.name);
            events.push({
              type: 'tool_start',
              toolName: block.name,
              toolUseId: block.id,
              input: (block.input as Record<string, unknown>) ?? {},
              turnId: this.currentTurnId ?? undefined,
              parentToolUseId: assistant.parent_tool_use_id ?? undefined,
            });
          }
        }
        break;
      }

      case 'user': {
        // Tool results arrive as user messages with tool_result blocks.
        const userMsg = sdkMessage as SDKUserMessageLike;
        const content = userMsg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              const toolUseId = block.tool_use_id ?? '';
              const toolName = this.toolNames.get(toolUseId);
              const resultText = this.extractResultText(block.content);
              events.push({
                type: 'tool_result',
                toolUseId,
                toolName,
                result: resultText,
                isError: block.is_error === true,
                turnId: this.currentTurnId ?? undefined,
                parentToolUseId: userMsg.parent_tool_use_id ?? undefined,
              });
            }
          }
        }
        break;
      }

      case 'result': {
        const result = sdkMessage as SDKResultMessageLike;
        // Flush any pending final text before completion.
        this.flushPendingText(events, false);
        if (result.subtype === 'success') {
          const usage = result.usage;
          events.push({
            type: 'complete',
            usage: {
              inputTokens: usage?.input_tokens ?? 0,
              outputTokens: usage?.output_tokens ?? 0,
              cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
              costUsd: result.total_cost_usd,
            },
          });
        } else {
          events.push({ type: 'error', message: result.result ?? 'Query failed' });
          events.push({ type: 'complete' });
        }
        break;
      }

      default:
        // Unknown SDK message types: drop silently (tolerance contract).
        break;
    }

    return events;
  }

  /** Emit text_complete for accumulated text and clear the buffer. */
  private flushPendingText(events: AgentEvent[], isIntermediate: boolean): void {
    if (this.pendingText === null) return;
    events.push({
      type: 'text_complete',
      text: this.pendingText,
      isIntermediate: isIntermediate || undefined,
      turnId: this.currentTurnId ?? undefined,
      sdkMessageId: this.pendingSdkMessageId ?? undefined,
    });
    this.pendingText = null;
  }

  private extractResultText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((block) => {
          if (typeof block === 'string') return block;
          if (typeof block === 'object' && block !== null && 'text' in block) {
            return String((block as { text: unknown }).text);
          }
          return '';
        })
        .join('');
    }
    return '';
  }
}

// ============================================================
// Structural SDK message shapes (avoid leaking full SDK types here)
// ============================================================

interface SDKPartialAssistantMessageLike {
  type: 'stream_event';
  event?: {
    type: string;
    delta?: { type: string; text?: string };
  };
  parent_tool_use_id: string | null;
}

interface SDKAssistantMessageLike {
  type: 'assistant';
  message?: {
    id?: string;
    content?: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
  };
  parent_tool_use_id: string | null;
}

interface SDKUserMessageLike {
  type: 'user';
  message?: {
    content?: unknown;
  };
  parent_tool_use_id: string | null;
}

interface SDKResultMessageLike {
  type: 'result';
  subtype: string;
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
  };
}
