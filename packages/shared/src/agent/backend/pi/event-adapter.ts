/**
 * Pi SDK Event Adapter (R10).
 *
 * Maps Pi Agent Core events to the unified AgentEvent vocabulary.
 * The Pi subprocess forwards raw SDK events over JSONL; this adapter
 * translates them into the same event words the renderer already
 * understands from the Claude backend.
 *
 * Mapping table (main lines, tolerance for the rest):
 * - message_update (text_delta)   → text_delta
 * - message_end                   → text_complete
 * - tool_execution_start          → tool_start
 * - tool_execution_end            → tool_result
 * - agent_end                     → complete (queue closed by the caller)
 * - compaction_start              → status ("Compacting…")
 * - compaction_end                → info / error
 * - auto_retry_start/end          → status
 * - queue_update                  → ignored
 *
 * parentToolUseId note (honest field limitation): the Pi backend
 * approximates nested tool correlation with sub-turn isolation — each
 * tool call inside a turn gets its own sub-turnId — while the Claude
 * backend passes the SDK value through natively. The vocabulary aligns
 * across backends; field population varies by backend capability.
 */

import type { AgentEvent } from '@threadcove/core/types';

export class PiEventAdapter {
  private turnIndex = 0;
  private currentTurnId: string | null = null;
  private subTurnCounter = 0;
  private messageSubTurnId: string | null = null;
  private toolNames: Map<string, string> = new Map();
  private hasEmittedFinalText = false;

  /** Start a new turn — resets per-turn state. */
  startTurn(turnId?: string): void {
    this.turnIndex++;
    this.currentTurnId = turnId ?? null;
    this.subTurnCounter = 0;
    this.messageSubTurnId = null;
    this.toolNames.clear();
    this.hasEmittedFinalText = false;
  }

  /**
   * Convert one raw Pi SDK event into zero or more AgentEvents.
   * Unknown event types are dropped (tolerance contract — the stream
   * must survive new upstream event kinds).
   */
  adaptEvent(rawEvent: Record<string, unknown>): AgentEvent[] {
    const events: AgentEvent[] = [];
    const type = rawEvent['type'];

    switch (type) {
      case 'message_update': {
        // Pi streams assistant message updates; extract text deltas.
        const delta = this.extractTextDelta(rawEvent);
        if (delta) {
          if (!this.messageSubTurnId) {
            this.subTurnCounter += 1;
            this.messageSubTurnId = `${this.currentTurnId ?? 'turn'}-sub${this.subTurnCounter}`;
          }
          events.push({
            type: 'text_delta',
            text: delta,
            turnId: this.messageSubTurnId,
          });
        }
        break;
      }

      case 'message_end': {
        const text = this.extractFinalText(rawEvent);
        if (text && !this.hasEmittedFinalText) {
          this.hasEmittedFinalText = true;
          events.push({
            type: 'text_complete',
            text,
            turnId: this.messageSubTurnId ?? this.currentTurnId ?? undefined,
          });
        }
        this.messageSubTurnId = null;
        break;
      }

      case 'tool_execution_start': {
        const toolUseId = String(rawEvent['toolCallId'] ?? rawEvent['id'] ?? `tool-${Date.now()}`);
        const toolName = String(rawEvent['toolName'] ?? 'unknown');
        this.toolNames.set(toolUseId, toolName);
        events.push({
          type: 'tool_start',
          toolName,
          toolUseId,
          input: (rawEvent['args'] as Record<string, unknown>) ?? {},
          turnId: this.currentTurnId ?? undefined,
        });
        break;
      }

      case 'tool_execution_end': {
        const toolUseId = String(rawEvent['toolCallId'] ?? rawEvent['id'] ?? '');
        const toolName = this.toolNames.get(toolUseId);
        const result = this.extractToolResult(rawEvent);
        events.push({
          type: 'tool_result',
          toolUseId,
          toolName,
          result,
          isError: rawEvent['isError'] === true,
          turnId: this.currentTurnId ?? undefined,
        });
        break;
      }

      case 'agent_end':
        // Turn boundary — nothing to map. PiAgent closes the EventQueue
        // after the child signals agent_end, completing chat()'s stream.
        this.hasEmittedFinalText = false;
        break;

      case 'compaction_start':
        events.push({ type: 'status', message: 'Compacting conversation…' });
        break;

      case 'compaction_end': {
        if (rawEvent['errorMessage']) {
          events.push({
            type: 'error',
            message: String(rawEvent['errorMessage']),
          });
        } else {
          events.push({ type: 'info', message: 'Context compacted' });
        }
        break;
      }

      case 'auto_retry_start':
        events.push({
          type: 'status',
          message: `Retrying (attempt ${String(rawEvent['attempt'] ?? '?')})…`,
        });
        break;

      case 'auto_retry_end':
        events.push({ type: 'status', message: 'Retry finished' });
        break;

      case 'queue_update':
        // No UI consumer — deliberately ignored.
        break;

      default:
        // Unknown Pi SDK event: drop (tolerance contract).
        break;
    }

    return events;
  }

  // ============================================================
  // Payload extraction helpers (defensive — Pi event shapes vary)
  // ============================================================

  private extractTextDelta(event: Record<string, unknown>): string | null {
    const delta = event['delta'];
    if (typeof delta === 'object' && delta !== null) {
      const d = delta as Record<string, unknown>;
      if (d['type'] === 'text_delta' && typeof d['text'] === 'string') {
        return d['text'];
      }
    }
    if (typeof delta === 'string') return delta;
    return null;
  }

  private extractFinalText(event: Record<string, unknown>): string | null {
    const message = event['message'];
    if (typeof message !== 'object' || message === null) return null;
    const msg = message as Record<string, unknown>;
    const content = msg['content'];
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      let text = '';
      for (const block of content) {
        if (typeof block === 'object' && block !== null) {
          const b = block as Record<string, unknown>;
          if (b['type'] === 'text' && typeof b['text'] === 'string') {
            text += b['text'];
          }
        }
      }
      return text || null;
    }
    return null;
  }

  private extractToolResult(event: Record<string, unknown>): string {
    const result = event['result'];
    if (typeof result === 'string') return result;
    if (typeof result === 'object' && result !== null) {
      const r = result as Record<string, unknown>;
      const content = r['content'];
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .map((block) => {
            if (typeof block === 'object' && block !== null && 'text' in block) {
              return String((block as Record<string, unknown>)['text']);
            }
            return '';
          })
          .join('');
      }
    }
    return '';
  }
}
