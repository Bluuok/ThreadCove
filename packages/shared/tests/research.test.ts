import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@threadcove/core/types';
import type { BackendConfig } from '../src/agent/backend/types.ts';
import { PiAgent } from '../src/agent/pi-agent.ts';
import { ResearchTools } from '../src/research/tools.ts';
import { McpClientPool } from '../src/mcp/mcp-pool.ts';
import { abortable, extractPage, isPublicAddress, parseSearchResponse, validatePublicUrl } from '../src/research/web.ts';

function config(): BackendConfig {
  const root = mkdtempSync(join(tmpdir(), 'tc-research-test-'));
  mkdirSync(join(root, 'sessions', 'parent', 'data'), { recursive: true });
  return { provider: 'pi', apiProvider: 'opencode-go', apiKey: 'secret-must-not-be-saved', model: 'deepseek-v4.1-flash', workspaceId: 'test', sessionId: 'parent', workspaceRootPath: root, workingDirectory: root };
}
const tasks = (n = 3) => ({ tasks: Array.from({ length: n }, (_, i) => ({ title: `Task ${i}`, question: 'Find evidence' })) });

test('public URL validation rejects private, encoded, mapped and mixed DNS destinations', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', '2002:7f00:1::']) expect(isPublicAddress(address)).toBe(false);
  expect(isPublicAddress('1.1.1.1')).toBe(true);
  expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  for (const url of ['file:///etc/passwd', 'http://2130706433', 'http://0x7f000001', 'http://[::ffff:127.0.0.1]', 'http://localhost', 'https://user:pass@example.com', 'http://example.com:8080']) await expect(validatePublicUrl(url)).rejects.toThrow();
  const mixed = async () => [{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }];
  await expect(validatePublicUrl('https://example.com', mixed)).rejects.toThrow('Private');
});

test('DNS wait can be cancelled even when resolver does not settle', async () => {
  const controller = new AbortController();
  const pending = abortable(new Promise(() => {}), controller.signal);
  controller.abort(new Error('stop DNS'));
  await expect(pending).rejects.toThrow('stop DNS');
});

test('search parses JSON and SSE; HTML extraction drops active content and keeps paragraphs', () => {
  const payload = JSON.stringify({ result: { content: [{ type: 'text', text: 'Source https://example.com' }] } });
  expect(parseSearchResponse(payload)).toContain('https://example.com');
  expect(parseSearchResponse(`event: message\ndata: ${payload}\n\n`)).toContain('Source');
  expect(() => parseSearchResponse('{"result":{"isError":true}}')).toThrow('error');
  const page = extractPage('<html><head><title>A &amp; B</title></head><body><nav>noise</nav><main><p>First</p><p>Second &amp; third</p><script>evil()</script></main></body></html>', 'text/html');
  expect(page.title).toBe('A & B');
  expect(page.text).toBe('First\nSecond & third');
});

test('concurrent parent batches share three slots; children are isolated, leaf-only and persisted', async () => {
  const parent = config(); let active = 0, peak = 0, destroyed = 0;
  const folders: string[] = [];
  class Child extends PiAgent {
    private execute!: Parameters<PiAgent['setToolExecutor']>[0];
    override setToolDefinitions(defs: Parameters<PiAgent['setToolDefinitions']>[0]) { expect(defs.map(d => d.name)).toEqual(['web_search', 'web_fetch']); }
    override setToolExecutor(executor: Parameters<PiAgent['setToolExecutor']>[0]) { this.execute = executor; }
    override async *chat(): AsyncGenerator<AgentEvent> {
      active++; peak = Math.max(peak, active);
      try {
        await expect(this.execute!('delegate_research', tasks(1), new AbortController().signal)).rejects.toThrow('cannot delegate');
        await this.execute!('web_search', { query: 'evidence' }, new AbortController().signal);
        await Bun.sleep(20);
        yield { type: 'text_complete', text: 'Evidence https://example.com', turnId: 'answer' };
        yield { type: 'complete' };
      } finally { active--; }
    }
    override destroy() { destroyed++; }
  }
  const service = new ResearchTools({ search: async () => 'URL: https://example.com\nEvidence', childFactory: c => { folders.push(c.workingDirectory!); return new Child(c); } });
  const bound = service.bind(parent);
  const controller = new AbortController();
  const results = await Promise.all([bound.execute('delegate_research', tasks(), controller.signal), bound.execute('delegate_research', tasks(), controller.signal)]);
  expect(peak).toBe(3); expect(active).toBe(0); expect(destroyed).toBe(6);
  expect(new Set(folders).size).toBe(6);
  expect(results.every(r => r.content.includes('Status: completed'))).toBe(true);
  await expect(bound.execute('delegate_research', tasks(1), controller.signal)).rejects.toThrow('six-subtask');
  const data = join(parent.workspaceRootPath, 'sessions', 'parent', 'data');
  const reports = readdirSync(data).filter(name => name.startsWith('research-agent-')).map(name => readFileSync(join(data, name), 'utf8'));
  expect(reports).toHaveLength(6);
  expect(reports.every(text => JSON.parse(text).sources.includes('https://example.com'))).toBe(true);
  expect(reports.join('')).not.toContain(parent.apiKey!);
});

test('parent cancellation drains running and queued children and saves terminal status', async () => {
  const parent = config(); const controller = new AbortController(); let started = 0;
  class Child extends PiAgent {
    private stop!: () => void;
    override async *chat(): AsyncGenerator<AgentEvent> {
      started++;
      await new Promise<void>(resolve => { this.stop = resolve; });
      yield { type: 'complete' };
    }
    override destroy() { this.stop?.(); }
  }
  const service = new ResearchTools({ childFactory: c => new Child(c) }).bind(parent);
  const work = Promise.all([service.execute('delegate_research', tasks(), controller.signal), service.execute('delegate_research', tasks(), controller.signal)]);
  while (started < 3) await Bun.sleep(1);
  controller.abort();
  await work;
  expect(started).toBe(3);
  const data = join(parent.workspaceRootPath, 'sessions', 'parent', 'data');
  const reports = readdirSync(data).filter(n => n.startsWith('research-agent-')).map(n => JSON.parse(readFileSync(join(data, n), 'utf8')));
  expect(reports).toHaveLength(6);
  expect(reports.every(r => r.status === 'cancelled' && r.finishedAt)).toBe(true);
});

test('a failed child does not discard a successful sibling; web budget is shared per run', async () => {
  const parent = config(); let count = 0;
  class Child extends PiAgent {
    override async *chat(): AsyncGenerator<AgentEvent> {
      if (++count === 1) throw new Error('provider failed');
      yield { type: 'text_complete', text: 'Good report' }; yield { type: 'complete' };
    }
    override destroy() {}
  }
  const service = new ResearchTools({ search: async () => 'https://example.com', childFactory: c => new Child(c) }).bind(parent);
  const signal = new AbortController().signal;
  const result = await service.execute('delegate_research', tasks(2), signal);
  expect(result.content).toContain('Status: failed'); expect(result.content).toContain('Status: completed');
  for (let i = 0; i < 24; i++) await service.execute('web_search', { query: 'test' }, signal);
  await expect(service.execute('web_search', { query: 'test' }, signal)).rejects.toThrow('24-request');
});

test('startup marks orphaned child reports interrupted without changing completed reports', () => {
  const parent = config(); const data = join(parent.workspaceRootPath, 'sessions', 'parent', 'data');
  writeFileSync(join(data, 'research-agent-a.json'), JSON.stringify({ status: 'running', answer: 'partial' }));
  writeFileSync(join(data, 'research-agent-b.json'), JSON.stringify({ status: 'completed', answer: 'done' }));
  new ResearchTools().recoverSession(parent.workspaceRootPath, parent.sessionId);
  const interrupted = JSON.parse(readFileSync(join(data, 'research-agent-a.json'), 'utf8'));
  expect(interrupted.status).toBe('interrupted'); expect(interrupted.answer).toBe('partial'); expect(interrupted.finishedAt).toBeTruthy();
  expect(JSON.parse(readFileSync(join(data, 'research-agent-b.json'), 'utf8')).status).toBe('completed');
});

test('artifact failure still drains every sibling before delegation settles', async () => {
  const parent = config(); let cleaned = false, index = 0;
  class Child extends PiAgent {
    override async *chat(): AsyncGenerator<AgentEvent> {
      if (++index === 1) {
        // Corrupt only this task report destination to inject a final write failure.
        const data = join(parent.workspaceRootPath, 'sessions', 'parent', 'data');
        const own = readdirSync(data).find(name => name.startsWith('research-agent-'))!;
        const { unlinkSync } = await import('node:fs'); unlinkSync(join(data, own)); mkdirSync(join(data, own));
      } else { await Bun.sleep(40); cleaned = true; }
      yield { type: 'text_complete', text: 'report' }; yield { type: 'complete' };
    }
    override destroy() {}
  }
  const service = new ResearchTools({ childFactory: c => new Child(c) }).bind(parent);
  await expect(service.execute('delegate_research', tasks(2), new AbortController().signal)).rejects.toThrow();
  expect(cleaned).toBe(true);
});

test('child deadline cleans up the worker and reports a time budget failure', async () => {
  const parent = config(); let destroyed = false;
  class Child extends PiAgent {
    private stop!: () => void;
    override async *chat(): AsyncGenerator<AgentEvent> { await new Promise<void>(resolve => { this.stop = resolve; }); yield { type: 'complete' }; }
    override destroy() { destroyed = true; this.stop?.(); }
  }
  const service = new ResearchTools({ childFactory: c => new Child(c), childTimeoutMs: 20 }).bind(parent);
  const result = await service.execute('delegate_research', tasks(1), new AbortController().signal);
  expect(destroyed).toBe(true); expect(result.content).toContain('Subtask time budget exceeded');
});

test('MCP execution passes cancellation and a bounded timeout to the SDK', async () => {
  const pool = new McpClientPool(); const controller = new AbortController(); let called = false;
  const internals = pool as unknown as {
    proxyTools: Map<string, { slug: string; originalName: string }>;
    clients: Map<string, { client: { callTool: (args: unknown, schema: unknown, options: { signal: AbortSignal; timeout: number }) => Promise<never> } }>;
  };
  internals.proxyTools.set('mcp__test__slow', { slug: 'test', originalName: 'slow' });
  internals.clients.set('test', { client: { callTool: async (_args, _schema, options) => {
    expect(options.signal).toBe(controller.signal); expect(options.timeout).toBe(25_000); called = true;
    return new Promise<never>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } } });
  const result = pool.callTool('mcp__test__slow', {}, controller.signal);
  expect(called).toBe(true); controller.abort();
  expect(await result).toEqual({ content: 'cancelled', isError: true });
});
