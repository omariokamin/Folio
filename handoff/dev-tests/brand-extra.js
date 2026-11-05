const { chromium } = require('playwright');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await page.goto('http://localhost:8121/index.html');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  await page.click('.bp-tab:has-text("Brand")');
  // blank brand + inline rename
  await page.click('.bp-empty__row button:has-text("Blank brand")');
  await page.waitForSelector('.bp-switch .bp-inline');
  await page.fill('.bp-switch .bp-inline', 'Studio Moss');
  await page.press('.bp-switch .bp-inline', 'Enter');
  await page.waitForTimeout(50);
  ok((await page.textContent('.bp-switch__name')) === 'Studio Moss' && (await page.evaluate(() => Folio.brand.active().name)) === 'Studio Moss', 'blank brand + inline rename');
  // link something, then None → detached, undo → linked again
  const id = await page.evaluate(() => { const n = Object.values(Folio.store.doc.nodes).find(n => n.type === 'text'); Folio.store.select([n.id]); return n.id; });
  await page.click('.bp-color[data-id="accent"] .bp-color__sw');
  await page.click('.bp-switch'); await page.click('.bp-menu .f-menu__item:has-text("None")');
  const none = await page.evaluate((id) => ({ c: Folio.store.get(id).text.color, b: !!Folio.brand.active(), v: document.getElementById('canvas-world').style.getPropertyValue('--color-accent') }), id);
  ok(none.c === '#f59e0b' && !none.b && none.v === '', 'None → tokens detached, vars removed: ' + JSON.stringify(none));
  await page.evaluate(() => Folio.store.undo());
  const und = await page.evaluate((id) => ({ c: Folio.store.get(id).text.color, b: Folio.brand.active() && Folio.brand.active().name }), id);
  ok(und.c === 'var(--color-accent)' && und.b === 'Studio Moss', 'undo None → linked again');
  // collapse a section, persists
  await page.click('.bp-sec[data-sec="voice"] .bp-sec__toggle');
  ok(await page.evaluate(() => document.querySelector('.bp-sec[data-sec="voice"]').classList.contains('is-collapsed') && JSON.parse(localStorage.getItem('folio:brandPanel:collapsed')).voice === true), 'section collapse remembered');
  // panel does not rebuild while typing
  await page.click('.bp-sec[data-sec="style"] .bp-radius input >> nth=0');
  const el1 = await page.evaluateHandle(() => document.activeElement);
  await page.keyboard.type('3');
  await page.evaluate(() => Folio.store.emit('brand', {}));
  await page.waitForTimeout(50);
  ok(await page.evaluate((e) => e === document.activeElement && e.isConnected, el1), 'field keeps focus while panel would re-render');
  await page.keyboard.press('Tab');
  // Load demo / new doc → no brand
  await page.evaluate(() => Folio.store.newDoc());
  await page.waitForTimeout(50);
  ok(await page.evaluate(() => !Folio.brand.active() && !!document.querySelector('.bp-empty') && Folio.brand.library().length === 1), 'new document starts with no brand; library kept');
  // layers tab back
  await page.click('.bp-tab:has-text("Layers")');
  ok(await page.isVisible('#layers') && !(await page.isVisible('#brand-panel')), 'Layers tab');
  console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'no page errors'); console.log(fails ? fails + ' FAIL' : 'ALL PASS');
  await browser.close();
})();
