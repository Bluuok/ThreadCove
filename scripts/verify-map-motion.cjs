const assert = require('node:assert/strict');

module.exports = async function verifyMapMotion(page, entryUrl) {
  const nodes = page.locator('.map-node');
  const edges = page.locator('.research-map svg path[pathLength="1"]');
  assert.equal(await nodes.count(), 4);
  assert.equal(await edges.count(), 3);
  const geometry = await nodes.evaluateAll(items => items.map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, transform: getComputedStyle(el).transform })));
  await nodes.first().hover();
  await page.waitForFunction(() => [...document.querySelectorAll('.research-map svg path[pathLength="1"]')].some(el => +getComputedStyle(el).opacity > .99 && parseFloat(getComputedStyle(el).strokeDashoffset) === 0));
  assert.equal(await edges.evaluateAll(items => items.filter(el => +getComputedStyle(el).opacity > .99).length), 1);
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => [...document.querySelectorAll('.research-map svg path[pathLength="1"]')].every(el => +getComputedStyle(el).opacity === 0));
  await page.keyboard.press('Tab');
  await nodes.nth(1).focus();
  await page.waitForFunction(() => [...document.querySelectorAll('.research-map svg path[pathLength="1"]')].some(el => +getComputedStyle(el).opacity > .99));
  await page.keyboard.press('Enter');
  assert.equal(await page.getByRole('textbox', { name: '研究问题' }).inputValue(), '请帮我列出研究这个问题需要寻找的关键证据：');
  assert.deepEqual(await nodes.evaluateAll(items => items.map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, transform: getComputedStyle(el).transform }))), geometry);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await nodes.nth(2).focus();
  await page.waitForFunction(() => [...document.querySelectorAll('.research-map svg path[pathLength="1"]')].every(el => +getComputedStyle(el).opacity === 1));
  assert(await edges.evaluateAll(items => items.every(el => getComputedStyle(el).transitionDuration === '0s' && getComputedStyle(el).animationName === 'none')));
  await page.getByRole('textbox', { name: '研究问题' }).focus();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const touch = await context.newPage();
    await touch.goto(entryUrl);
    const first = touch.locator('.map-node').first();
    await first.waitFor();
    const before = await first.boundingBox();
    await first.evaluate(el => { window.__mapClicks = 0; el.addEventListener('click', () => window.__mapClicks++); });
    await first.tap();
    assert.equal(await touch.getByRole('textbox', { name: '研究问题' }).inputValue(), '我想厘清一个问题：');
    assert.equal(await touch.evaluate(() => window.__mapClicks), 1);
    assert.deepEqual(await first.boundingBox(), before);
    assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await touch.waitForTimeout(450);
    assert(await touch.locator('.research-map svg path[pathLength="1"]').evaluateAll(items => items.every(el => +getComputedStyle(el).opacity === 0)), 'touch must not leave a sticky hover');
  } finally { await context.close(); }
};
