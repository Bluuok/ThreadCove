import { test, expect } from 'bun:test';
import { PiAgent } from '../src/agent/pi-agent.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentEvent } from '@threadcove/core/types';

const fixture = join(import.meta.dir, 'fixtures/real-pi-fixture.ts');
test('real Pi SDK streams, executes only proxy tools, resumes after abort, and rejects invalid model', async () => {
  const requests: Record<string, unknown>[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as Record<string, unknown>;
    requests.push(body);
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const last = messages.at(-1)!;
    const useTool = JSON.stringify(last.content).includes('use proxy');
    const slow = JSON.stringify(last.content).includes('slow request');
    const chunk = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    if (body.stream !== true) return Response.json({ choices: [{ message: { role: 'assistant', content: 'Mini title' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } });
    return new Response(new ReadableStream({ async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(chunk({ role: 'assistant', content: useTool ? 'Checking. ' : 'SDK response' })));
      if (slow) await Bun.sleep(350);
      if (useTool) controller.enqueue(encoder.encode(chunk({ tool_calls: [{ index: 0, id: 'call_fixture', type: 'function', function: { name: 'fixture_echo', arguments: '{"text":"hello"}' } }] }, 'tool_calls')));
      else controller.enqueue(encoder.encode(chunk({}, 'stop')));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    } }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const old = process.env.THREADCOVE_TEST_API_URL;
  process.env.THREADCOVE_TEST_API_URL = `http://127.0.0.1:${server.port}`;
  const agent = new PiAgent({ provider: 'pi', apiProvider: 'opencode-go', apiKey: 'fixture-only', model: 'deepseek-v4.1-flash', workspaceId: 'fixture', sessionId: 'sdk', workspaceRootPath: tmpdir(), workingDirectory: tmpdir() }, fixture);
  let calls = 0;
  agent.setToolDefinitions([{ name: 'fixture_echo', description: 'Echo text', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }]);
  agent.setToolExecutor(async (_name, args) => { calls++; return { content: String(args.text), isError: false }; });
  const collect = async (prompt: string) => { const events: AgentEvent[] = []; for await (const event of agent.chat(prompt)) events.push(event); return events; };
  try {
    agent.restoreHistory([{ id: 'restored', type: 'user', content: 'Remember restored context', timestamp: Date.now() }]);
    await agent.postInit();
    const events = await collect('use proxy');
    expect(calls).toBe(1);
    expect(events.filter(e => e.type === 'text_complete')).toHaveLength(2);
    expect(events.some(e => e.type === 'tool_result')).toBe(true);
    expect((requests[0]!.tools as Array<{ function: { name: string } }>).map(t => t.function.name)).toEqual(['fixture_echo']);
    expect(requests[0]!.max_tokens).toBe(8192);
    const bounded = new PiAgent({ provider: 'pi', apiProvider: 'opencode-go', apiKey: 'fixture-only', model: 'deepseek-v4.1-flash', workspaceId: 'fixture', sessionId: 'bounded', workspaceRootPath: tmpdir(), workingDirectory: tmpdir(), maxModelTurns: 1, maxOutputTokens: 256 }, fixture);
    bounded.setToolDefinitions([{ name: 'fixture_echo', description: 'Echo', parameters: { type: 'object', properties: { text: { type: 'string' } } } }]);
    bounded.setToolExecutor(async () => ({ content: 'ok', isError: false }));
    try {
      const start = requests.length; const errors: string[] = [];
      for await (const event of bounded.chat('use proxy')) if (event.type === 'error') errors.push(event.message);
      expect(requests.length - start).toBe(1); expect(requests[start]!.max_tokens).toBe(256);
      expect(errors.join(' ')).toContain('budget exceeded');
    } finally { bounded.destroy(); }
    let hostStarted!: () => void; const hostReady = new Promise<void>(resolve => { hostStarted = resolve; }); let hostCancelled = false;
    agent.setToolExecutor(async (_name, _args, signal) => {
      hostStarted();
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { hostCancelled = true; resolve(); }, { once: true }));
      return { content: 'cancelled', isError: true };
    });
    const waitingForHost = collect('use proxy'); await hostReady; await agent.abort(); await waitingForHost;
    expect(hostCancelled).toBe(true);
    agent.setToolExecutor(async (_name, args) => ({ content: String(args.text), isError: false }));
    expect(JSON.stringify(requests[0]!.messages)).toContain('Remember restored context');
    for await (const event of agent.chat('slow request')) { if (event.type === 'text_delta') { await agent.abort(); break; } }
    const resumed = await collect('resume request');
    expect(resumed.some(e => e.type === 'text_complete' && e.text === 'SDK response')).toBe(true);
    expect(await agent.runMiniCompletion('title')).toBe('SDK response');
    // Cancellation must cover a prompt queued behind a mini completion, not just active HTTP requests.
    const beforeMini = requests.length;
    const mini = agent.runMiniCompletion('slow request title');
    while (requests.length === beforeMini) await Bun.sleep(5);
    const queued = collect('cancelled queued prompt must never reach API');
    await Bun.sleep(20);
    await agent.abort();
    await queued;
    await mini;
    await Bun.sleep(30);
    expect(JSON.stringify(requests)).not.toContain('cancelled queued prompt must never reach API');
    const initializing = new PiAgent({ provider: 'pi', apiProvider: 'opencode-go', apiKey: 'fixture-only', model: 'deepseek-v4.1-flash', workspaceId: 'fixture', sessionId: 'early-cancel', workspaceRootPath: tmpdir(), workingDirectory: tmpdir() }, fixture);
    try {
      const initialRun = (async () => { for await (const _event of initializing.chat('cancel before ready')) { /* drain */ } })();
      await initializing.abort();
      await initialRun;
      expect(JSON.stringify(requests)).not.toContain('cancel before ready');
    } finally { initializing.destroy(); }
    agent.setModel('missing-model');
    expect((await collect('bad model')).some(e => e.type === 'error')).toBe(true);
  } finally { agent.destroy(); server.stop(true); if (old === undefined) delete process.env.THREADCOVE_TEST_API_URL; else process.env.THREADCOVE_TEST_API_URL = old; }
}, 30_000);

test('Pi initialization failure rejects and child crash surfaces an error', async () => {
  const config = { provider: 'pi' as const, apiProvider: 'opencode-go', model: 'deepseek-v4.1-flash', workspaceId: 'fixture', sessionId: 'failure', workspaceRootPath: tmpdir(), workingDirectory: tmpdir() };
  const invalid = new PiAgent(config, fixture);
  try { await expect(invalid.postInit()).rejects.toThrow('Pi API key is required'); } finally { invalid.destroy(); }
  const crashing = new PiAgent({ ...config, apiKey: 'fixture-only' }, join(import.meta.dir, 'fixtures/crashing-pi-server.ts'));
  try {
    const events: AgentEvent[] = [];
    for await (const event of crashing.chat('crash')) events.push(event);
    expect(events.some(event => event.type === 'error' && event.message.includes('unexpectedly'))).toBe(true);
  } finally { crashing.destroy(); }
}, 10_000);
