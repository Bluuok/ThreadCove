// Explicit live check: makes small billable requests to OpenCode Go. Never run in CI.
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { PiAgent } from '../packages/shared/src/agent/pi-agent.ts';
import { loadOpenCodeGoKey, OPENCODE_GO_MODEL } from '../packages/shared/src/config/opencode-go.ts';
import { resolveProviderConfig, startRuntime } from '../apps/electron/src/server/runtime.ts';

const key = process.env['OPENCODE_GO_API_KEY']?.trim() || loadOpenCodeGoKey();
if (!key) throw new Error('Configure OpenCode Go before running this live check');
const config = resolveProviderConfig();
if (config.provider !== 'pi' || config.apiProvider !== 'opencode-go' || config.model !== OPENCODE_GO_MODEL) {
  throw new Error('Live UI check requires Pi + OpenCode Go + deepseek-v4.1-flash runtime configuration');
}
const root = mkdtempSync(join(tmpdir(), 'threadcove-opencode-live-'));
const output = resolve('artifacts/qa/opencode-go');
mkdirSync(output, { recursive: true });
const probe = crypto.randomUUID();
let toolsCalled = 0, deltas = 0, answer = '';
const agent = new PiAgent({ provider: 'pi', apiProvider: 'opencode-go', apiKey: key,
  model: OPENCODE_GO_MODEL, workspaceId: 'live-check', sessionId: 'sdk-check',
  workspaceRootPath: root, workingDirectory: root, thinkingLevel: 'off' });
agent.onDebug = message => { if (/error|exit/i.test(message)) console.error(message.replaceAll(key, '[redacted]')); };
agent.setToolDefinitions([{ name: 'connection_probe', description: 'Returns the nonce for this API connection validation.',
  parameters: { type: 'object', properties: {}, required: [] } }]);
agent.setToolExecutor(async name => {
  if (name !== 'connection_probe') throw new Error('Unexpected tool requested');
  toolsCalled++;
  return { content: probe, isError: false };
});
const deadline = setTimeout(() => agent.destroy(), 90_000);
try {
  for await (const event of agent.chat('Call connection_probe once, then reply with only the returned nonce. This is a coding-agent integration check.')) {
    if (event.type === 'text_delta') { deltas++; answer += event.text; }
    if (event.type === 'error') throw new Error(event.message);
  }
  if (toolsCalled !== 1 || !answer.includes(probe) || deltas === 0) throw new Error('SDK stream/tool/result round trip failed');
  console.log(JSON.stringify({ stage: 'sdk', stream: true, toolRoundTrip: true }));
} finally { clearTimeout(deadline); agent.destroy(); }

const staticRoot = resolve('apps/webui/dist');
const web = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const pathname = new URL(request.url).pathname;
  const file = resolve(staticRoot, pathname === '/' ? 'index.html' : `.${pathname}`);
  if (!file.startsWith(staticRoot + '/') && !file.startsWith(staticRoot + '\\')) return new Response('', { status: 403 });
  if (!existsSync(file)) return new Response('', { status: 404 });
  const contentType = extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html';
  return new Response(readFileSync(file), { headers: { 'Content-Type': contentType } });
} });
const origin = `http://127.0.0.1:${web.port}`;
const runtime = await startRuntime({ root: join(root, 'ui'), origins: [origin] });
try {
  const ui = Bun.spawn(['node', 'scripts/verify-opencode-ui.cjs'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  ui.stdin.write(JSON.stringify({ origin, server: runtime.url, token: runtime.token, output, desktopRoot: join(root, 'desktop') }));
  ui.stdin.end();
  const [stdout, stderr, code] = await Promise.all([new Response(ui.stdout).text(), new Response(ui.stderr).text(), ui.exited]);
  if (code !== 0) throw new Error(`Live browser verification failed: ${stderr.replaceAll(key, '[redacted]')}`);
  console.log(stdout.trim());
  const result = { provider: 'opencode-go', model: OPENCODE_GO_MODEL, sdkStream: true, hostToolRoundTrip: true,
    uiRealApi: true, electronRealApi: true, contextWindowMetadata: 1_000_000, fullContextWindowTested: false };
  await Bun.write(join(output, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await runtime.close(); web.stop(true); }
