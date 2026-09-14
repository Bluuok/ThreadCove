// Explicit live integration check. Uses configured OpenCode Go and anonymous Exa; never CI.
import { mkdtempSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { startRuntime, resolveProviderConfig } from '../apps/electron/src/server/runtime.ts';
const config = resolveProviderConfig();
if (config.provider !== 'pi' || config.apiProvider !== 'opencode-go' || !config.apiKey()) throw new Error('Configure Pi + OpenCode Go first');
const root = mkdtempSync(join(tmpdir(), 'threadcove-research-live-'));
const output = resolve('artifacts/qa/research'); mkdirSync(output, { recursive: true });
const staticRoot = resolve('apps/webui/dist');
const web = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const pathname = new URL(request.url).pathname;
  const file = resolve(staticRoot, pathname === '/' ? 'index.html' : `.${pathname}`);
  if (!file.startsWith(staticRoot + '/') && !file.startsWith(staticRoot + '\\')) return new Response('', { status: 403 });
  if (!existsSync(file)) return new Response('', { status: 404 });
  const type = extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html';
  return new Response(readFileSync(file), { headers: { 'Content-Type': type } });
} });
const origin = `http://127.0.0.1:${web.port}`;
const runtime = await startRuntime({ root: join(root, 'web'), origins: [origin] });
try {
  const ui = Bun.spawn(['node', 'scripts/verify-research-ui.cjs'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  ui.stdin.write(JSON.stringify({ origin, server: runtime.url, token: runtime.token, output, desktopRoot: join(root, 'desktop') })); ui.stdin.end();
  const [stdout, stderr, code] = await Promise.all([new Response(ui.stdout).text(), new Response(ui.stderr).text(), ui.exited]);
  console.log(stdout.trim());
  if (code !== 0) throw new Error(`Research UI verification failed: ${stderr.replaceAll(config.apiKey()!, '[redacted]')}`);
  const sessions = join(root, 'web', 'sessions');
  const reports: Array<{ status: string; sources: string[] }> = [];
  let search = 0, fetch = 0, delegated = false;
  for (const id of readdirSync(sessions)) {
    const folder = join(sessions, id); if (!existsSync(join(folder, 'data'))) continue;
    delegated ||= readFileSync(join(folder, 'session.jsonl'), 'utf8').includes('delegate_research');
    for (const file of readdirSync(join(folder, 'data'))) {
      if (file.startsWith('research-agent-')) reports.push(JSON.parse(readFileSync(join(folder, 'data', file), 'utf8')));
      if (file.startsWith('research-search-')) search++;
      if (file.startsWith('research-page-')) fetch++;
    }
  }
  if (!delegated || reports.length !== 2 || reports.some(r => r.status !== 'completed' || !r.sources.length) || search < 1 || fetch < 1) throw new Error(`Incomplete live orchestration: ${JSON.stringify({ delegated, reports, search, fetch })}`);
  const result = { model: config.model, anonymousSearch: true, publicFetch: true, parentDelegation: true, completedChildren: reports.length, sourceArtifacts: search + fetch, webAndElectron: true, workspace: root };
  await Bun.write(join(output, 'verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await runtime.close(); web.stop(true); }
