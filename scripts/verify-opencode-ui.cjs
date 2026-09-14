// Invoked by verify-opencode-go.ts; use Node for Playwright on Windows.
const { chromium, _electron } = require('playwright');
const { resolve, join } = require('node:path');
const { readFileSync } = require('node:fs');
const options = JSON.parse(readFileSync(0, 'utf8'));
let browser, desktopApp;
(async () => {
  const faults = [];
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => faults.push(error.message));
  await page.goto(`${options.origin}/#server=${encodeURIComponent(options.server)}&token=${encodeURIComponent(options.token)}`);
  await page.getByRole('textbox', { name: '研究问题' }).fill('这是字符串复制测试，请仅输出 TC_GO_WEB_REPLY_OK，不要判断任何系统的连接状态。');
  await page.getByRole('button', { name: '开始研究' }).click();
  await page.getByText('TC_GO_WEB_REPLY_OK', { exact: true }).last().waitFor({ timeout: 90_000 });
  await page.getByRole('button', { name: '开始研究' }).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: join(options.output, 'live-ui.png'), animations: 'disabled' });
  console.log(JSON.stringify({ stage: 'web', realApi: true }));
  const env = { ...process.env, THREADCOVE_WORKSPACE: options.desktopRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  desktopApp = await _electron.launch({ executablePath: require('electron'), args: [resolve('apps/electron')], env, timeout: 30_000 });
  const desktop = await desktopApp.firstWindow();
  desktop.on('pageerror', error => faults.push(error.message));
  await desktop.getByRole('textbox', { name: '研究问题' }).fill('这是字符串复制测试，请仅输出 TC_GO_DESKTOP_REPLY_OK，不要判断任何系统的连接状态。');
  await desktop.getByRole('button', { name: '开始研究' }).click();
  await desktop.getByText('TC_GO_DESKTOP_REPLY_OK', { exact: true }).last().waitFor({ timeout: 90_000 });
  await desktop.getByRole('button', { name: '开始研究' }).waitFor({ timeout: 15_000 });
  await desktop.screenshot({ path: join(options.output, 'live-electron.png'), animations: 'disabled' });
  if (faults.length) throw new Error(faults.join('\n'));
  console.log(JSON.stringify({ stage: 'electron', realApi: true, pageErrors: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await desktopApp?.close();
  await browser?.close();
});
