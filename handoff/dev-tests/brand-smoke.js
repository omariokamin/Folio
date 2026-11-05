const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type()==='warning') errors.push(m.type() + ': ' + m.text()); });
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await page.goto('http://localhost:8121/index.html');
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  await page.click('#left-tabs .bp-tab:nth-child(2)');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/user/folio/.dev/shot-empty.png' });
  console.log(errors.join('\n'));
  await browser.close();
})();
