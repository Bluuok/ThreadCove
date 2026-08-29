/**
 * Mock Pi agent server — scripted JSONL subprocess for protocol tests.
 *
 * Protocol behaviors (keyed off the prompt message):
 * - any prompt: emits text_delta → text_complete → complete-ready signal
 * - 'use the tool': also sends tool_execute_request, waits for response,
 *   emits tool_result
 * - 'fail the tool': sends tool_execute_request; host response is error
 *   but the mock still reports the result
 * - 'trigger bad lines': interleaves invalid JSONL lines (stream must survive)
 * - 'long stream': emits events slowly so tests can abort/redirect mid-stream
 * - 'hello': single fast burst
 */

import { createInterface } from 'node:readline';

interface InboundMessage {
  type: string;
  id?: string;
  message?: string;
  requestId?: string;
  sessionId?: string;
  result?: { content: string; isError: boolean };
}

function send(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const rl = createInterface({ input: process.stdin });

let inited = false;
let turnCounter = 0;

function emitTurn(prefix: string, text: string): void {
  const turnId = `turn-${++turnCounter}`;
  send({ type: 'event', event: { type: 'message_update', delta: { type: 'text_delta', text } } });
  send({ type: 'event', event: { type: 'message_end', message: { content: [{ type: 'text', text }] } } });
  send({ type: 'event', event: { type: 'agent_end', turnId } });
}

rl.on('line', (line: string) => {
  if (!line.trim()) return;
  let msg: InboundMessage;
  try {
    msg = JSON.parse(line) as InboundMessage;
  } catch {
    return;
  }

  switch (msg.type) {
    case 'init':
      inited = true;
      send({ type: 'ready', sessionId: msg.sessionId ? String(msg.sessionId) : 'mock-session' });
      break;

    case 'prompt': {
      if (!inited) {
        send({ type: 'error', message: 'not initialized' });
        break;
      }
      const prompt = msg.message ?? '';

      if (prompt === 'long stream') {
        // Slow drip: three events spaced out so tests can abort/redirect.
        void (async () => {
          for (let i = 0; i < 3; i++) {
            send({ type: 'event', event: { type: 'message_update', delta: { type: 'text_delta', text: `chunk${i}` } } });
            await new Promise((r) => setTimeout(r, 150));
          }
          send({ type: 'event', event: { type: 'message_end', message: { content: [{ type: 'text', text: 'chunk0chunk1chunk2' }] } } });
          send({ type: 'event', event: { type: 'agent_end' } });
        })();
        break;
      }

      if (prompt === 'use the tool' || prompt === 'fail the tool') {
        send({
          type: 'tool_execute_request',
          requestId: 'mock-treq-1',
          toolName: 'mcp__test__search',
          args: { query: 'test' },
        });
        break;
      }

      if (prompt === 'trigger bad lines') {
        process.stdout.write('THIS IS NOT JSON\n');
        send({ type: 'event', event: { type: 'message_update', delta: { type: 'text_delta', text: 'still alive' } } });
        process.stdout.write('{broken json\n');
        send({ type: 'event', event: { type: 'message_end', message: { content: [{ type: 'text', text: 'still alive' }] } } });
        send({ type: 'event', event: { type: 'agent_end' } });
        break;
      }

      emitTurn(String(msg.id ?? 'p'), 'mock response');
      break;
    }

    case 'tool_execute_response': {
      const result = msg.result ?? { content: '', isError: false };
      send({
        type: 'event',
        event: {
          type: 'tool_execution_start',
          toolCallId: 'tc-mock',
          toolName: 'mcp__test__search',
          args: {},
        },
      });
      send({
        type: 'event',
        event: {
          type: 'tool_execution_end',
          toolCallId: 'tc-mock',
          result: { content: result.content },
          isError: result.isError,
        },
      });
      send({ type: 'event', event: { type: 'agent_end' } });
      break;
    }

    case 'abort':
      // No further events — simulates a stopped child.
      break;

    case 'shutdown':
      process.exit(0);
      break;
  }
});

rl.on('close', () => process.exit(0));
