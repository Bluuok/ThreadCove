// Read the key from stdin; never accept credentials in command-line arguments.
import { OPENCODE_GO_BASE_URL, OPENCODE_GO_MODEL, saveOpenCodeGoKey } from '../packages/shared/src/config/opencode-go.ts';

const key = (await Bun.stdin.text()).trim();
if (!key) throw new Error('Provide the OpenCode Go API key on stdin');
const response = await fetch(`${OPENCODE_GO_BASE_URL}/chat/completions`, {
  method: 'POST',
  redirect: 'error',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
    'User-Agent': 'ThreadCove/0.1.0', 'x-opencode-session': crypto.randomUUID() },
  body: JSON.stringify({ model: OPENCODE_GO_MODEL, max_tokens: 64,
    thinking: { type: 'disabled' }, messages: [{ role: 'user', content: 'Reply with only OK to confirm this coding-agent API connection.' }] }),
  signal: AbortSignal.timeout(60_000),
});
if (!response.ok) throw new Error(`OpenCode Go connection failed: HTTP ${response.status}`);
const data = await response.json() as { model?: string; choices?: { message?: { content?: string } }[] };
if (!data.choices?.[0]?.message?.content) throw new Error('OpenCode Go returned no answer');
saveOpenCodeGoKey(key);
console.log(JSON.stringify({ connected: true, model: OPENCODE_GO_MODEL, returnedModel: data.model,
  credentialStorage: 'local encrypted app storage', responseReceived: true }));
