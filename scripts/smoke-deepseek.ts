#!/usr/bin/env bun
/**
 * DeepSeek end-to-end smoke: createBackend('deepseek') → real streaming
 * chat → unified AgentEvent vocabulary. Run:
 *   DEEPSEEK_API_KEY=... bun run scripts/smoke-deepseek.ts
 */

const apiKey = process.env['DEEPSEEK_API_KEY'];
if (!apiKey) {
  console.error('DEEPSEEK_API_KEY not set');
  process.exit(1);
}

const { createBackend } = await import('../packages/shared/src/agent/index.ts');

const backend = createBackend({
  provider: 'deepseek',
  workspaceRootPath: process.cwd(),
  workspaceId: 'smoke',
  sessionId: `smoke-${Date.now()}`,
  workingDirectory: process.cwd(),
  model: process.env['DEEPSEEK_MODEL'] ?? 'deepseek-v4-flash',
  apiKey,
});

console.log('=== ThreadCove DeepSeek streaming smoke ===');
console.log(`model: ${backend.getModel()}`);
console.log('');

let firstTokenMs: number | null = null;
const start = Date.now();
const events = [];

for await (const event of backend.chat('用三句话介绍ThreadCove这个项目：个人深度研究工作台。')) {
  events.push(event);
  switch (event.type) {
    case 'text_delta':
      if (firstTokenMs === null) firstTokenMs = Date.now() - start;
      process.stdout.write(event.text);
      break;
    case 'text_complete':
      process.stdout.write('\n');
      break;
    case 'complete':
      console.log(`\n--- complete: in=${event.usage?.inputTokens} out=${event.usage?.outputTokens} tokens, TTFT=${firstTokenMs}ms, total=${Date.now() - start}ms`);
      break;
    case 'typed_error':
      console.error(`\nTYPED_ERROR [${event.error.code}] ${event.error.title}: ${event.error.message}`);
      break;
    case 'error':
      console.error(`\nERROR: ${event.message}`);
      break;
  }
}

// Mini completion (title generation)
const title = await backend.runMiniCompletion('Generate a 3-5 word title for a conversation about: ThreadCove, a personal deep-research workbench');
console.log(`--- mini completion title: ${title}`);

// Second turn exercises conversation continuity
console.log('\n=== turn 2 (continuity) ===');
for await (const event of backend.chat('用一句话总结你刚才说的')) {
  if (event.type === 'text_delta') process.stdout.write(event.text);
  if (event.type === 'text_complete') process.stdout.write('\n');
}

backend.destroy();
console.log('\n=== smoke OK ===');
