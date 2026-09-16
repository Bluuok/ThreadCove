const assert = require('node:assert/strict');

// Protocol-driven presentation checks; injected events are test fixtures, not live-model claims.
module.exports = async function verifyRunMotion(page, emit, message) {
  const indicator = page.locator('.run-indicator');
  const state = async value => { await page.waitForFunction(value => document.querySelector('.run-indicator')?.dataset.state === value, value); };
  const finishCount = () => page.evaluate(() => window.__runAnimations.filter(n => n === 'research-finish').length);
  const start = runId => emit({ type: 'user_message', message: { id: `qa-user-${runId}`, runId, type: 'user', content: '状态呈现测试', timestamp: Date.now() } });
  await page.evaluate(() => { window.__runAnimations = []; window.__stableMessage = document.querySelector('.message-assistant'); });
  start('qa-live-run');
  await state('running');
  await page.waitForFunction(() => window.__runAnimations.includes('research-travel'));
  for (let i = 0; i < 3; i++) emit({ type: 'text_delta', messageId: message.id, text: '', textSnapshot: message.content });
  emit({ type: 'text_complete', messageId: message.id, text: message.content });
  await page.waitForTimeout(100);
  assert.equal(await indicator.getAttribute('data-state'), 'running', 'text_complete must not finish a run');
  assert.equal(await finishCount(), 0);
  assert.equal(await page.evaluate(() => window.__runAnimations.filter(n => n === 'research-travel').length), 1, 'stream chunks must not restart animation');
  assert(await page.evaluate(() => window.__stableMessage === document.querySelector('.message-assistant')), 'message DOM identity must remain stable');
  emit({ type: 'permission_request', request: { requestId: 'qa-permission', toolName: 'fixture', description: '验收用权限请求' } });
  await state('waiting');
  assert.equal(await indicator.locator('.research-ink').evaluate(el => getComputedStyle(el).animationName), 'none');
  if (await page.getByRole('button', { name: '关闭执行详情' }).count()) await page.getByRole('button', { name: '关闭执行详情' }).click();
  await page.getByRole('button', { name: '允许这次', exact: true }).click();
  await state('running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await indicator.locator('.research-ink').evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  emit({ type: 'run_status', status: 'completed', runId: 'qa-live-run' });
  await state('completed');
  await page.waitForFunction(() => window.__runAnimations.includes('research-finish'));
  await page.waitForFunction(() => !document.querySelector('.run-indicator')?.classList.contains('is-finishing'));
  assert.equal(await finishCount(), 1);
  emit({ type: 'run_status', status: 'completed', runId: 'qa-live-run' });
  await page.waitForTimeout(100);
  assert.equal(await finishCount(), 1, 'duplicate terminal event cannot celebrate twice');
  for (const terminal of ['failed', 'cancelled', 'interrupted']) {
    start(terminal); await state('running');
    emit({ type: 'run_status', status: terminal, runId: terminal }); await state(terminal);
    assert.equal(await indicator.locator('.research-ink').evaluate(el => getComputedStyle(el).animationName), 'none');
  }
  assert.equal(await finishCount(), 1);
  await page.reload();
  await state('completed');
  assert.equal(await finishCount(), 0, 'history load must be static');
};
