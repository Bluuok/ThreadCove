import { randomUUID } from 'node:crypto';
import type { AgentEvent, StoredMessage } from '@threadcove/core/types';
import { mutateSession } from '@threadcove/shared/sessions';

/** Keep a checkpoint of the current segment without duplicating its text_complete. */
export class RunTranscript {
  private messages: StoredMessage[] = [];
  private segment: StoredMessage | undefined;
  private savedAt = 0;
  constructor(private root: string, private sessionId: string, private runId: string) {}
  async consume(event: AgentEvent): Promise<AgentEvent> {
    if (event.type === 'text_delta' || event.type === 'text_complete') {
      if (!this.segment) {
        this.segment = { id: randomUUID(), type: 'assistant', content: '', timestamp: Date.now(), runId: this.runId, turnId: event.turnId, parentToolUseId: event.parentToolUseId };
        this.messages.push(this.segment);
      }
      this.segment.content = event.type === 'text_delta' ? this.segment.content + event.text : event.text;
      event = event.type === 'text_delta'
        ? { ...event, messageId: this.segment.id, textSnapshot: this.segment.content }
        : { ...event, messageId: this.segment.id };
      if (event.type === 'text_complete') { this.segment.isIntermediate = event.isIntermediate; this.segment = undefined; }
    } else if (event.type === 'tool_result') {
      this.messages.push({ id: randomUUID(), type: 'tool', content: event.result, timestamp: Date.now(), runId: this.runId, toolName: event.toolName, toolUseId: event.toolUseId, isError: event.isError, turnId: event.turnId, parentToolUseId: event.parentToolUseId });
    } else if (event.type === 'typed_error') {
      this.messages.push({ id: randomUUID(), type: 'error', content: event.error.message, timestamp: Date.now(), runId: this.runId, errorCode: event.error.code, errorTitle: event.error.title, errorDetails: event.error.details, errorOriginal: event.error.originalError, errorCanRetry: event.error.canRetry, errorActions: event.error.actions, turnId: event.turnId });
    } else if (event.type === 'error') {
      this.messages.push({ id: randomUUID(), type: 'error', content: event.message, timestamp: Date.now(), runId: this.runId });
    } else return event;
    if (event.type !== 'text_delta' || Date.now() - this.savedAt >= 750) await this.flush();
    return event;
  }
  async flush(): Promise<void> {
    if (!this.messages.length) return;
    const messages = structuredClone(this.messages);
    const saved = await mutateSession(this.root, this.sessionId, session => {
      for (const message of messages) {
        const index = session.messages.findIndex(existing => existing.id === message.id);
        if (index === -1) session.messages.push(message);
        else session.messages[index] = message;
      }
    });
    if (!saved) throw new Error('Session not found while checkpointing');
    this.savedAt = Date.now();
  }
}
