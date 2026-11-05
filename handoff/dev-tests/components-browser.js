/* Playwright check: starter kit in the real app (node .dev/components-browser.js [--brand]) */
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = '/home/user/folio/.dev';
const H2I = fs.readFileSync(OUT + '/aitest/vendor/package/dist/html-to-image.js', 'utf8');
const brand = process.argv.includes('--brand');
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (c || x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::/.test(m.text()) && errors.push(m.text()));
  await page.route(/html-to-image/, (r) => r.fulfill({ body: H2I, contentType: 'application/javascript' }));
  await page.addInitScript(() => localStorage.clear());
  await page.goto('http://localhost:8131/index.html');
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  await page.waitForTimeout(300);

  const r = await page.evaluate((brand) => {
    const s = Folio.store, K = Folio.components;
    if (brand) Folio.brand.setActive(Folio.brand.create(Folio.brand.templates()[1].templateId).id);
    const ids = K.addStarterKit();
    s.commit('Add starter kit');
    const board = s.doc.roots.map((id) => s.get(id)).find((n) => n.name === 'Components');
    s.select([board.id]);
    Folio.canvas.zoomToSelection();
    return { ids: ids.length, board: board.id };
  }, brand);
  ok(r.ids === 21, 'starter kit created ' + r.ids + ' components');
  await page.waitForTimeout(600);
  const count = await page.evaluate(() => {
    const s = Folio.store;
    const comp = Folio.components.list().find((c) => c.name === 'Button' && c.variant.Style === 'Primary' && c.variant.Size === 'M');
    const inst = Object.values(s.doc.nodes).filter((n) => n.instance && n.instance.componentId === comp.id).map((n) => n.id);
    return { mainId: comp.mainId, inst, rendered: inst.filter((id) => Folio.render.el(id)).length, h: Folio.render.el(comp.mainId).getBoundingClientRect().height / s.viewport.zoom };
  });
  ok(count.inst.length >= 1 && count.rendered === count.inst.length, `Button Primary/M has ${count.inst.length} instance(s) on canvas`);
  ok(Math.round(count.h) === 40, 'Button M renders 40px tall: ' + count.h);
  await page.screenshot({ path: OUT + `/shot-components${brand ? '-brand' : ''}.png` });
  await page.evaluate((id) => { const s = Folio.store; const b = Folio.canvas.nodeRect(id); Folio.canvas.setZoom(1); const z = s.viewport.zoom; s.setViewport({ x: 260 - b.x * z, y: 70 - b.y * z }); }, r.board);
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + `/shot-components${brand ? '-brand' : ''}-zoom.png`, clip: { x: 240, y: 48, width: 920, height: 852 } });
  await page.evaluate((id) => { const s = Folio.store; const b = Folio.canvas.nodeRect(id); s.setViewport({ x: 260 - b.x, y: 70 - b.y - 760 }); }, r.board);
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + `/shot-components${brand ? '-brand' : ''}-zoom2.png`, clip: { x: 240, y: 48, width: 920, height: 852 } });

  // edit the main's fill like the inspector would (update + commit), check instances live
  await page.evaluate((id) => {
    Folio.store.update(id, { style: { fills: [{ type: 'solid', color: '#16a34a', visible: true }] } });
  }, count.mainId);
  await page.waitForTimeout(400);
  const bg = await page.evaluate((ids) => { Folio.render.sync(); return ids.map((id) => getComputedStyle(Folio.render.el(id)).backgroundColor); }, count.inst);
  ok(bg.every((c) => c === 'rgb(22, 163, 74)'), 'instances repaint live after main fill edit (debounced, before commit): ' + bg.join(', '));
  await page.evaluate(() => Folio.store.commit('fill'));
  await page.evaluate(() => Folio.store.undo());
  await page.waitForTimeout(200);
  const bg2 = await page.evaluate((ids) => { Folio.render.sync(); return ids.map((id) => getComputedStyle(Folio.render.el(id)).backgroundColor); }, count.inst);
  ok(bg2.every((c) => c !== 'rgb(22, 163, 74)'), 'undo reverts instances: ' + bg2.join(', '));
  ok(!errors.length, 'no page errors', errors);
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
