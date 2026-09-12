const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { chromium, _electron } = require('playwright');
const root = resolve(__dirname, '..');
const output = resolve(process.env.THREADCOVE_QA_OUTPUT || join(root, 'artifacts/qa'));
mkdirSync(output, { recursive: true });
const data = mkdtempSync(join(tmpdir(), 'threadcove-ui-'));
const requests = [];
const faults = [];
let browser, electron, backend;
const children = [];
const servers = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
async function listen(server) { servers.push(server); await new Promise(r => server.listen(0, '127.0.0.1', r)); return server.address().port; }
async function unusedPort() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port; }
function spawnBun(args, env) { const child = spawn(process.env.THREADCOVE_BUN || 'bun', args, { cwd: root, env, windowsHide: true, stdio: ['ignore','pipe','pipe'] }); children.push(child); return child; }
async function startBackend(port, env) {
  const child = spawnBun(['run', 'apps/electron/src/server/headless.ts', String(port), data], env);
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('Backend startup timed out')), 15000);
    child.stdout.on('data', chunk => { if (String(chunk).includes('[threadcove] server')) { clearTimeout(timer); ok(); } });
    child.stderr.on('data', chunk => { if (/error:/i.test(String(chunk))) faults.push(String(chunk)); });
    child.on('exit', code => { clearTimeout(timer); fail(new Error(`Backend exited: ${code}`)); });
  });
  return child;
}
async function stopChild(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; child.kill(); await new Promise(r => child.once('exit', r)); }
async function screenshot(page, name) { await page.screenshot({ path: join(output, name), fullPage: false, animations: 'disabled' }); }
async function send(page, text) { await page.getByRole('textbox', { name: '研究问题' }).fill(text); await page.getByRole('button', { name: '开始研究' }).click(); }
async function idle(page) { await page.getByRole('button', { name: '开始研究' }).waitFor({ timeout: 15000 }); }
(async () => {
  const llm = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    const request = JSON.parse(body); requests.push(request);
    res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache' });
    const slow = request.messages.at(-1).content.includes('慢速');
    const text = slow ? ['慢速研究已经开始。', '这段内容不应该在取消后出现。'] : ['这是本地验收服务的第一段。', '\n\n完整回答：历史与模型配置均已接入真实应用。'];
    const emit = chunk => res.write(`data: ${JSON.stringify({choices:[{delta:{content:chunk}}]})}\n\n`);
    emit(text[0]);
    const timer = setTimeout(() => { if (res.destroyed) return; emit(text[1]); res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'); }, slow ? 6000 : 300);
    res.on('close', () => clearTimeout(timer));
  });
  const llmPort = await listen(llm);
  const web = createServer((req,res) => {
    const name = (req.url || '/').split('?')[0];
    const file = join(root, 'apps/webui/dist', name === '/' ? 'index.html' : name);
    if (!existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(file));
  });
  const webPort = await listen(web);
  const rpcPort = await unusedPort();
  const env = { ...process.env, THREADCOVE_PROVIDER:'deepseek', THREADCOVE_MODEL:'mock-model-a', DEEPSEEK_API_KEY:'local-test-key', DEEPSEEK_BASE_URL:`http://127.0.0.1:${llmPort}`, THREADCOVE_TOKEN:'local-qa-token', THREADCOVE_WEB_ORIGINS:`http://127.0.0.1:${webPort}`, THREADCOVE_WORKSPACE:data };
  delete env.ELECTRON_RUN_AS_NODE;
  backend = await startBackend(rpcPort, env);
  browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{width:1440,height:1000} });
  page.on('pageerror', error => faults.push(error.message));
  await page.goto(`http://127.0.0.1:${webPort}/#server=${encodeURIComponent(`ws://127.0.0.1:${rpcPort}`)}&token=local-qa-token`);
  await page.getByRole('button', { name:'新建研究任务' }).waitFor();
  await screenshot(page, 'web-desktop-empty.png');
  await page.getByRole('button', { name:'新建研究任务' }).click();
  await page.locator('.task.active').waitFor();
  await send(page, '请记住验收口令 COVE-7429，然后给出简短回答。');
  await page.getByText('这是本地验收服务的第一段。', { exact:true }).waitFor();
  await idle(page);
  await page.getByText('完整回答：历史与模型配置均已接入真实应用。', { exact:false }).first().waitFor();
  await page.getByRole('button', { name:'执行详情' }).click();
  await screenshot(page, 'web-desktop-conversation.png');
  await page.getByRole('button', { name:'工作台设置', exact:true }).first().click();
  await page.getByLabel('此任务使用的模型').fill('mock-model-b');
  await page.getByRole('button', { name:'保存模型' }).click();
  await page.getByRole('dialog').waitFor({ state:'hidden' });
  await send(page, '开始慢速回答，用于验证停止');
  await page.getByText('慢速研究已经开始。', { exact:true }).waitFor();
  await page.getByRole('button', { name:'停止', exact:false }).click();
  await idle(page);
  assert(!await page.getByText('这段内容不应该在取消后出现。', { exact:false }).count());
  await page.reload();
  await page.getByText('慢速研究已经开始。', { exact:true }).waitFor();
  await stopChild(backend);
  backend = await startBackend(rpcPort, env);
  await page.waitForFunction(() => Boolean(document.querySelector('.connection i.online')), { timeout:20000 });
  await send(page, '我之前的口令是什么？');
  await idle(page);
  assert.equal(requests.at(-1).model, 'mock-model-b');
  assert(requests.at(-1).messages.some(m => m.content.includes('COVE-7429')));
  await page.setViewportSize({width:390,height:844});
  if (await page.getByRole('button', { name:'关闭执行详情' }).count()) await page.getByRole('button', { name:'关闭执行详情' }).click();
  await screenshot(page, 'web-mobile-conversation.png');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const box = await page.getByRole('button',{name:'开始研究'}).boundingBox();
  assert(box && box.y + box.height <= 844);
  await page.getByRole('button',{name:'打开任务列表'}).click();
  await screenshot(page, 'web-mobile-tasks.png');
  await page.getByRole('button',{name:'新建研究任务'}).click();
  await page.getByRole('button',{name:'开始研究'}).waitFor();
  await screenshot(page, 'web-mobile-empty.png');
  await browser.close(); browser = undefined;
  await stopChild(backend);
  const electronExe = require(require.resolve('electron', { paths:[join(root,'apps/electron')] }));
  electron = await _electron.launch({ executablePath:electronExe, args:[join(root,'apps/electron')], env, timeout:25000 });
  const desktop = await electron.firstWindow();
  desktop.on('pageerror', error => faults.push(error.message));
  await desktop.getByRole('button',{name:'新建研究任务'}).waitFor({timeout:20000});
  await desktop.getByRole('button',{name:'新建研究任务'}).click();
  await desktop.locator('.task.active').waitFor();
  await send(desktop,'Electron 实际窗口发送验收');
  await idle(desktop);
  await desktop.getByText('完整回答：历史与模型配置均已接入真实应用。',{exact:false}).first().waitFor();
  await screenshot(desktop,'electron-conversation.png');
  await send(desktop,'Electron 慢速取消验收');
  await desktop.getByText('慢速研究已经开始。',{exact:true}).waitFor();
  await desktop.getByRole('button',{name:'停止',exact:false}).click();
  await idle(desktop);
  await desktop.reload();
  await desktop.getByText('慢速研究已经开始。',{exact:true}).waitFor();
  assert.equal(faults.length, 0, faults.join('\n'));
  writeFileSync(join(output,'verification.json'),JSON.stringify({passed:true,web:true,electron:true,mobileWidth:390,requests:requests.length,modelSwitch:true,restartHistory:true,stoppedPartialSaved:true,consoleErrors:faults},null,2));
  console.log(JSON.stringify({passed:true,output,requests:requests.length}));
})().catch(error => { console.error(error); process.exitCode=1; }).finally(async () => {
  if (browser) await browser.close().catch(()=>{});
  if (electron) await electron.close().catch(()=>{});
  for (const child of children) await stopChild(child).catch(()=>{});
  for (const server of servers) { server.closeAllConnections(); server.close(); }
});
