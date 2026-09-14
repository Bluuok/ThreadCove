#!/usr/bin/env bun
/** Isolated Pi SDK process. Only explicitly registered host tools are enabled. */
import { createInterface } from 'node:readline';
import { AuthStorage, ModelRegistry, createAgentSession, DefaultResourceLoader, SettingsManager, SessionManager, type AgentSession, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { complete, type Message } from '@earendil-works/pi-ai/compat';

export interface ProxyToolDef { name: string; description: string; inputSchema: Record<string, unknown> }
export interface InitMessage {
  type: 'init'; apiKey: string; apiProvider?: string; model: string; cwd: string;
  thinkingLevel: string; sessionId: string; workspaceId?: string; sessionPath: string;
  workingDirectory: string; systemPrompt?: string;
  history?: Array<{ type: string; content: string }>;
}
export type InboundMessage = InitMessage
  | { type: 'prompt'; id: string; message: string; model?: string; thinkingLevel?: string; systemPrompt?: string }
  | { type: 'abort'; promptId?: string } | { type: 'steer'; message: string }
  | { type: 'register_tools'; tools: ProxyToolDef[] }
  | { type: 'tool_execute_response'; requestId: string; result: { content: string; isError: boolean } }
  | { type: 'mini_completion'; id: string; prompt: string } | { type: 'shutdown' };
export type OutboundMessage =
  | { type: 'ready'; sessionId: string | null }
  | { type: 'event'; promptId?: string; event: Record<string, unknown> }
  | { type: 'tool_execute_request'; promptId?: string; requestId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'mini_completion_result'; id: string; text: string | null }
  | { type: 'error'; promptId?: string; message: string; code?: string };
export function send(message: OutboundMessage): void { process.stdout.write(JSON.stringify(message) + '\n'); }
export function debugLog(message: string): void { process.stderr.write(`[pi-server] ${message}\n`); }
let config: InitMessage;
let session: AgentSession | undefined;
let registry: ModelRegistry;
let tools: ProxyToolDef[] = [];
let promptId: string | undefined;
let serial = Promise.resolve();
let counter = 0;
const cancelledPrompts = new Set<string>();
const pending = new Map<string, { resolve: (result: { content: string; isError: boolean }) => void; reject: (error: Error) => void }>();
function thinkingLevel(value: string) { return value === 'off' ? 'off' : value === 'low' ? 'low' : value === 'max' || value === 'xhigh' ? 'max' : value === 'high' ? 'high' : 'medium'; }
export function executeToolViaHost(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ content: string; isError: boolean }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Tool execution aborted')); return; }
    const requestId = `tool-${++counter}`;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); pending.delete(requestId); };
    const abort = () => { cleanup(); reject(new Error('Tool execution aborted')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Host tool timed out')); }, 120_000);
    pending.set(requestId, { resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); } });
    signal?.addEventListener('abort', abort, { once: true });
    send({ type: 'tool_execute_request', promptId, requestId, toolName, args });
  });
}
async function initialize(msg: InitMessage): Promise<void> {
  config = msg;
  if (!msg.apiKey) throw new Error('Pi API key is required');
  const authStorage = AuthStorage.inMemory();
  const provider = msg.apiProvider ?? 'anthropic';
  authStorage.setRuntimeApiKey(provider, msg.apiKey);
  registry = ModelRegistry.inMemory(authStorage);
  if (provider === 'opencode-go') registry.registerProvider(provider, {
    baseUrl: 'https://opencode.ai/zen/go/v1', api: 'openai-completions', apiKey: msg.apiKey,
    headers: { 'User-Agent': 'ThreadCove/0.1.0', 'x-opencode-session': `${msg.workspaceId ?? 'workspace'}/${msg.sessionId}` },
    models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', reasoning: true, input: ['text', 'image'],
      thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', max: 'max' },
      contextWindow: 1_000_000, maxTokens: 384_000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens', requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek' } }],
  });
  const model = registry.find(provider, msg.model);
  if (!model) throw new Error(`Unknown Pi model: ${provider}/${msg.model}`);
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({ cwd: msg.cwd, agentDir: msg.cwd, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPrompt: msg.systemPrompt ?? 'You are ThreadCove, a research assistant. Use only tools explicitly made available.' });
  await resourceLoader.reload();
  const customTools: ToolDefinition[] = tools.map(tool => ({ name: tool.name, label: tool.name, description: tool.description,
    parameters: tool.inputSchema as ToolDefinition['parameters'],
    async execute(_id, args, signal) {
      const result = await executeToolViaHost(tool.name, args as Record<string, unknown>, signal);
      if (result.isError) throw new Error(result.content);
      return { content: [{ type: 'text', text: result.content }], details: {} };
    },
  }));
  ({ session } = await createAgentSession({ cwd: msg.cwd, agentDir: msg.cwd, authStorage, modelRegistry: registry, model,
    thinkingLevel: thinkingLevel(msg.thinkingLevel), settingsManager, resourceLoader, sessionManager: SessionManager.inMemory(msg.cwd),
    noTools: 'builtin', tools: tools.map(tool => tool.name), customTools }));
  const streamFn = session.agent.streamFn;
  session.agent.streamFn = (m, context, options) => streamFn(m, context, { ...options, maxTokens: 8192 });
  session.agent.state.messages = (msg.history ?? []).filter(m => m.type === 'user' || m.type === 'assistant').map(m => m.type === 'user'
    ? { role: 'user', content: m.content, timestamp: Date.now() }
    : { role: 'assistant', content: [{ type: 'text', text: m.content }], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() });
  session.subscribe(event => { if (promptId) send({ type: 'event', promptId, event: event as unknown as Record<string, unknown> }); });
  send({ type: 'ready', sessionId: msg.sessionId });
}
async function handle(msg: InboundMessage): Promise<void> {
  switch (msg.type) {
    case 'init': await initialize(msg); break;
    case 'register_tools': tools = msg.tools; break;
    case 'prompt': {
      if (cancelledPrompts.delete(msg.id)) return;
      if (!session) throw new Error('Pi session is not initialized');
      promptId = msg.id;
      try {
        if (msg.thinkingLevel) session.setThinkingLevel(thinkingLevel(msg.thinkingLevel));
        if (msg.model && msg.model !== session.model?.id) {
          const model = registry.find(config.apiProvider ?? 'anthropic', msg.model);
          if (!model) throw new Error(`Unknown Pi model: ${msg.model}`);
          await session.setModel(model);
        }
        await session.prompt(msg.message);
      } catch (error) {
        send({ type: 'error', promptId: msg.id, message: error instanceof Error ? error.message : 'Pi prompt failed' });
      } finally { cancelledPrompts.delete(msg.id); promptId = undefined; }
      break;
    }
    case 'mini_completion': {
      try {
        if (!session?.model) throw new Error('Pi session is not initialized');
        const auth = await registry.getApiKeyAndHeaders(session.model);
        const result = await complete(session.model, { messages: [{ role: 'user', content: msg.prompt, timestamp: Date.now() } as Message] },
          { ...auth, maxTokens: 512, signal: AbortSignal.timeout(25_000) });
        send({ type: 'mini_completion_result', id: msg.id, text: result.content.filter(c => c.type === 'text').map(c => c.text).join('') || null });
      } catch { send({ type: 'mini_completion_result', id: msg.id, text: null }); }
      break;
    }
    case 'shutdown': await session?.abort(); session?.dispose(); process.exit(0);
  }
}
export function main(): void {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', line => {
    let msg: InboundMessage;
    try { msg = JSON.parse(line) as InboundMessage; } catch { debugLog('invalid JSONL ignored'); return; }
    // Control and tool replies must bypass the serial prompt chain.
    if (msg.type === 'tool_execute_response') { pending.get(msg.requestId)?.resolve(msg.result); return; }
    if (msg.type === 'abort') {
      if (msg.promptId) cancelledPrompts.add(msg.promptId);
      if (!msg.promptId || msg.promptId === promptId) void session?.abort();
      return;
    }
    if (msg.type === 'steer') { void session?.steer(msg.message).catch(() => undefined); return; }
    serial = serial.then(() => handle(msg)).catch(error => send({ type: 'error', message: error instanceof Error ? error.message : 'Pi initialization failed', code: 'initialization_failed' }));
  });
  rl.on('close', () => { session?.dispose(); process.exit(0); });
}
if (import.meta.main) main();
