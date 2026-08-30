/**
 * DeepSeek backend integration tests — factory routing + real API smoke
 * (skipped when DEEPSEEK_API_KEY is absent, e.g. in CI).
 */
import { describe, test, expect } from 'bun:test';
import { createBackend, DeepSeekAgent } from '../src/agent/index.ts';
import type { BackendConfig } from '../src/agent/backend/types.ts';
import { OpenAICompatClient } from '../src/agent/llm/openai-compat.ts';

const API_KEY = process.env['DEEPSEEK_API_KEY'] ?? '';
const MODEL = process.env['DEEPSEEK_MODEL'] ?? 'deepseek-v4-flash';

function makeConfig(): BackendConfig {
  return {
    provider: 'deepseek',
    workspaceRootPath: '/tmp/ws',
    workspaceId: 'ws-test',
    sessionId: 'session-ds',
    workingDirectory: '/tmp/ws/session-ds',
    model: MODEL,
    apiKey: API_KEY || undefined,
  };
}

describe('DeepSeek backend (factory)', () => {
  test('deepseek provider → DeepSeekAgent with registry model', () => {
    const backend = createBackend(makeConfig());
    expect(backend).toBeInstanceOf(DeepSeekAgent);
    expect(backend.getModel()).toBe(MODEL);
    expect(backend.supportsBranching).toBe(false);
    backend.destroy();
  });

  test('missing api key yields typed_error, not a crash', async () => {
    const original = process.env['DEEPSEEK_API_KEY'];
    delete process.env['DEEPSEEK_API_KEY'];
    try {
      const backend = createBackend({ ...makeConfig(), apiKey: undefined });
      const events = [];
      for await (const event of backend.chat('hi')) {
        events.push(event);
      }
      const typed = events.find((e) => e.type === 'typed_error');
      expect(typed).toBeDefined();
      if (typed?.type === 'typed_error') {
        expect(typed.error.code).toBe('invalid_api_key');
        expect(typed.error.canRetry).toBe(false);
      }
      backend.destroy();
    } finally {
      if (original) process.env['DEEPSEEK_API_KEY'] = original;
    }
  });
});

describe('OpenAICompatClient', () => {
  (API_KEY ? describe : describe.skip)('live DeepSeek API', () => {
    test('non-streaming complete', async () => {
      const client = new OpenAICompatClient({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: API_KEY,
        model: MODEL,
      });
      const result = await client.complete(
        [{ role: 'user', content: 'Reply with exactly: OK' }],
        32,
      );
      expect(result.content).toContain('OK');
      expect(result.usage?.totalTokens).toBeGreaterThan(0);
    }, 30_000);

    test('streaming yields content and usage', async () => {
      const client = new OpenAICompatClient({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: API_KEY,
        model: MODEL,
      });
      const deltas: string[] = [];
      const result = await client.stream([{ role: 'user', content: 'Count 1 to 5, digits only.' }], {
        onTextDelta: (t) => deltas.push(t),
      });
      expect(result.content.length).toBeGreaterThan(0);
      expect(deltas.length).toBeGreaterThan(1);
      expect(result.usage?.totalTokens).toBeGreaterThan(0);
    }, 60_000);

    test('full backend chat() produces the unified event vocabulary', async () => {
      const backend = createBackend(makeConfig());
      const events = [];
      for await (const event of backend.chat('Reply with exactly: OK')) {
        events.push(event);
      }
      const types = events.map((e) => e.type);
      expect(types).toContain('text_delta');
      expect(types).toContain('text_complete');
      expect(types).toContain('complete');

      const complete = events.find((e) => e.type === 'complete');
      if (complete?.type === 'complete') {
        expect(complete.usage?.inputTokens).toBeGreaterThan(0);
      }
      backend.destroy();
    }, 60_000);

    test('abort mid-stream terminates cleanly', async () => {
      const backend = createBackend(makeConfig());
      const events = [];
      const consuming = (async () => {
        for await (const event of backend.chat('Write a 500-word essay about rivers.')) {
          events.push(event);
        }
      })();
      await new Promise((r) => setTimeout(r, 400));
      await backend.abort('user_stop');
      await consuming;
      // Stream ended without hanging; some events arrived.
      expect(events.length).toBeGreaterThan(0);
      backend.destroy();
    }, 60_000);

    test('runMiniCompletion returns a short title', async () => {
      const backend = createBackend(makeConfig());
      const title = await backend.runMiniCompletion(
        'Generate a 3-5 word title for a conversation about: deep sea trench biodiversity',
      );
      expect(title).toBeTruthy();
      expect(title!.length).toBeLessThan(120);
      backend.destroy();
    }, 60_000);
  });
});
