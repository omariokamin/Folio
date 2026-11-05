const { chromium } = require('playwright');
const OUT = '/home/user/folio/.dev';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await page.goto('http://localhost:8121/index.html');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  await page.click('.bp-tab:has-text("Brand")');
  await page.click('.bp-tpl >> nth=0');
  await page.click('.bp-head .bp-ibtn'); await page.click('.bp-menu .f-menu__item:has-text("New from template")'); await page.click('.bp-menu .f-menu__item:has-text("Neon Club")');
  await page.waitForTimeout(3000); // let toasts go
  await page.click('.bp-switch'); await page.waitForTimeout(250);
  await page.screenshot({ path: OUT + '/shot2-switcher.png', clip: { x: 0, y: 40, width: 480, height: 500 } });
  await page.keyboard.press('Escape');
  await page.click('.bp-head .bp-ibtn'); await page.waitForTimeout(250);
  await page.screenshot({ path: OUT + '/shot2-actions.png', clip: { x: 0, y: 40, width: 480, height: 500 } });
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('.bp-sec[data-sec="style"]').scrollIntoView());
  await page.waitForTimeout(100);
  await page.screenshot({ path: OUT + '/shot2-style.png', clip: { x: 0, y: 0, width: 480, height: 900 } });
  await page.evaluate(() => (document.getElementById('left-panel').scrollTop = 0));
  await page.screenshot({ path: OUT + '/shot2-top.png', clip: { x: 0, y: 0, width: 480, height: 900 } });
  await browser.close();
})();
