// Pages UI test in the real app: node .dev/pages/pages-ui-test.js  (serve /home/user/folio on :8151)
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = '/home/user/folio/.dev/pages/out';
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const ok = (c, msg, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + msg + (c || extra === undefined ? '' : ' ' + JSON.stringify(extra).slice(0, 300))); if (!c) failures++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource|inlining remote css|loading remote stylesheet|reading CSS rules/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.route('https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js', (r) =>
    r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync('/home/user/folio/.dev/aitest/vendor/package/dist/html-to-image.js', 'utf8') }));
  await page.route(/^https?:\/\/(?!localhost)(?!cdn\.jsdelivr\.net\/npm\/html-to-image)/, (r) => r.abort());
  const boot = async () => { await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready')); await page.waitForTimeout(300); };
  await page.goto('http://localhost:8151/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await boot();
  const ev = (fn, a) => page.evaluate(fn, a);
  const st = () => ev(() => { const s = Folio.store; return { pages: s.pages().map((p) => p.name), cur: s.currentPage().name, inv: s.doc.roots === s.currentPage().roots, roots: s.doc.roots.length }; });
  const rows = () => page.$$eval('.ly-page', (r) => r.map((x) => x.querySelector('.ly-row__name, input').textContent || x.querySelector('input')?.value));
  const visibleRoots = () => ev(() => [...document.querySelectorAll('#canvas-world > .f-node')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => Folio.store.get(e.dataset.id).name));
  const shot = (n, clip) => page.screenshot({ path: `${OUT}/${n}.png`, clip });

  // ---------- initial ----------
  let s = await st();
  ok(s.pages.length === 1 && s.pages[0] === 'Page 1' && s.inv && s.roots === 3, 'demo opens on one Page 1 with its artboards', s);
  ok((await rows()).join() === 'Page 1', 'Pages list shows Page 1');
  await shot('01-initial', { x: 0, y: 0, width: 260, height: 400 });

  // ---------- add (auto rename) ----------
  await page.click('.ly-pages__head .ly__add');
  await page.waitForSelector('.ly-page input.ly-rename');
  await page.keyboard.type('Social');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  s = await st();
  ok(s.pages.join() === 'Page 1,Social' && s.cur === 'Social' && s.roots === 0 && s.inv, '+ adds a page, switches, names it', s);
  ok((await visibleRoots()).length === 0, 'the new page shows no artboards');
  ok(await page.isVisible('.ly-page.is-current:has-text("Social")'), 'current page highlighted');

  // draw an artboard on Social via the store (canvas UI is tested elsewhere)
  await ev(() => { const n = Folio.canvas.createArtboard('Instagram Post'); Folio.store.update(n.id, { name: 'Social Post' }); Folio.store.commit('rename'); });
  await page.waitForTimeout(100);
  const vpSocial = await ev(() => { Folio.canvas.setZoom(0.2); return { ...Folio.store.viewport }; });

  // ---------- switch + viewport per page ----------
  await page.click('.ly-page:has-text("Page 1")');
  await page.waitForTimeout(150);
  s = await st();
  ok(s.cur === 'Page 1' && s.roots === 3 && s.inv, 'click switches back', s);
  const vis1 = await visibleRoots();
  ok(vis1.length === 3 && !vis1.includes('Social Post'), 'only Page 1 artboards are shown', vis1);
  const vp1 = await ev(() => ({ ...Folio.store.viewport }));
  await page.click('.ly-page:has-text("Social")');
  await page.waitForTimeout(150);
  const vpBack = await ev(() => ({ ...Folio.store.viewport }));
  ok(Math.abs(vpBack.zoom - vpSocial.zoom) < 1e-6 && Math.abs(vpBack.x - vpSocial.x) < 1e-6, 'viewport restored per page', { vpBack, vpSocial });
  ok(await page.isVisible('.ly-row:has-text("Social Post")') && !(await page.isVisible('.ly-row:has-text("Landing")')), 'layers tree shows only this page');

  // ---------- shortcuts ----------
  await page.click('#canvas-viewport', { position: { x: 20, y: 400 } });
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForTimeout(100);
  ok((await st()).cur === 'Page 1', 'Alt+Up = previous page');
  const vpRestored = await ev(() => ({ ...Folio.store.viewport }));
  ok(Math.abs(vpRestored.zoom - vp1.zoom) < 1e-6, 'Page 1 viewport restored');
  await page.keyboard.press('Alt+PageDown');
  await page.waitForTimeout(100);
  ok((await st()).cur === 'Social', 'Alt+PageDown = next page');
  await page.keyboard.press('Alt+ArrowDown');
  ok((await st()).cur === 'Social', 'Alt+Down at the last page stays');

  // ---------- rename (double-click) ----------
  await page.dblclick('.ly-page:has-text("Page 1")');
  await page.waitForSelector('.ly-page input.ly-rename');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Website');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  s = await st();
  ok(s.pages.join() === 'Website,Social', 'double-click renames', s);

  // ---------- reorder (drag) ----------
  await page.dragTo ? null : null;
  await page.locator('.ly-page:has-text("Social")').dragTo(page.locator('.ly-page:has-text("Website")'), { targetPosition: { x: 40, y: 3 } });
  await page.waitForTimeout(100);
  s = await st();
  ok(s.pages.join() === 'Social,Website', 'drag reorders pages', s);
  ok((await rows()).join() === 'Social,Website', 'list follows the order');

  // ---------- move artboard to page (layers right-click) ----------
  await page.click('.ly-page:has-text("Website")');
  await page.waitForTimeout(100);
  const mob = await ev(() => Object.values(Folio.store.doc.nodes).find((n) => !n.parent && /mobile|app/i.test(n.name)).name);
  await page.click(`.ly-row.is-root:has-text("${mob}")`, { button: 'right' });
  await page.click('.f-menu__item:has-text("Move to page")');
  await page.click('.f-menu__item:has-text("Social")');
  await page.waitForTimeout(150);
  const where = await ev((name) => { const s = Folio.store; const n = Object.values(s.doc.nodes).find((x) => x.name === name); return { page: s.pageOf(n.id).name, roots: s.doc.roots.length, inv: s.doc.roots === s.currentPage().roots }; }, mob);
  ok(where.page === 'Social' && where.roots === 2 && where.inv, 'Move to page moves the artboard', where);
  ok(!(await visibleRoots()).includes(mob), 'moved artboard no longer shown here');
  // canvas right-click on an artboard gives the same menu
  const box = await ev(() => { const r = document.querySelector('.f-ov-label[data-root]').getBoundingClientRect(); return { x: r.left + 5, y: r.top + r.height / 2 }; });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  ok(await page.isVisible('.f-menu__item:has-text("Move to page")'), 'canvas right-click offers Move to page');
  await page.keyboard.press('Escape');
  // undo the move keeps the page
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(100);
  s = await st();
  ok(s.cur === 'Website' && s.roots === 3 && s.inv, 'undo the move: back on Website, artboard back', s);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(100);
  s = await st();
  ok(s.cur === 'Website' && s.roots === 2 && s.inv, 'redo the move', s);

  // ---------- starter kit → Components page, instance elsewhere updates ----------
  await page.click('.bp-tab:has-text("Components")');
  await page.waitForTimeout(250);
  await page.click('.kp-empty__kit');
  await page.waitForTimeout(500);
  s = await st();
  ok(s.pages.includes('Components') && s.cur === 'Components' && s.inv, 'Add starter kit → Components page, switched to it', s);
  await page.click('.ly-page:has-text("Website")').catch(() => {});
  await ev(() => Folio.store.switchPage(Folio.store.pages().find((p) => p.name === 'Website').id));
  await page.waitForTimeout(500);
  await ev(() => Folio.componentsPanel.refresh());
  const thumbs = await ev(() => [...document.querySelectorAll('.kp-thumb')].map((t) => !!t.querySelector('.kp-thumb__in')));
  ok(thumbs.length > 10 && thumbs.every(Boolean), 'thumbnails of mains on another page render', { n: thumbs.length, bad: thumbs.filter((x) => !x).length });
  const thumbBox = await ev(() => { const t = document.querySelector('.kp-thumb__in > *'); const r = t.getBoundingClientRect(); return { w: r.width, h: r.height, clip: t.style.clipPath, disp: getComputedStyle(t).display }; });
  ok(thumbBox.w > 5 && thumbBox.h > 5 && thumbBox.disp !== 'none', 'thumbnail clone has a size', thumbBox);
  await shot('02-components-panel-other-page', { x: 0, y: 0, width: 260, height: 600 });
  await page.click('.kp-tile__btn >> nth=0');
  await page.waitForTimeout(200);
  const inst = await ev(() => { const s = Folio.store; const id = s.selection[0]; const n = s.get(id); return { id, inst: !!(n && n.instance), page: s.pageOf(id).name }; });
  ok(inst.inst && inst.page === 'Website', 'clicking a tile inserts an instance on the current page', inst);
  const label = await ev((iid) => {
    const s = Folio.store, K = Folio.components;
    const c = K.get(s.get(iid).instance.componentId);
    const t = [c.mainId, ...s.descendants(c.mainId)].map((id) => s.get(id)).find((n) => n.type === 'text');
    s.update(t.id, { text: { size: 31 } });
    s.commit('main edit');
    const it = s.descendants(iid).map((id) => s.get(id)).find((n) => n.sourceId === t.id);
    Folio.render.sync();
    return { data: it.text.size, dom: getComputedStyle(Folio.render.el(it.id)).fontSize, mainPage: s.pageOf(c.mainId).name };
  }, inst.id);
  ok(label.data === 31 && label.dom === '31px' && label.mainPage === 'Components', 'instance updates when its main (other page) changes', label);
  // go to main switches pages
  await ev((iid) => Folio.componentsPanel.goToMain(iid), inst.id);
  await page.waitForTimeout(150);
  ok((await st()).cur === 'Components', 'Go to main switches to the Components page');
  await page.click('.bp-tab:has-text("Layers")');

  // ---------- PNG export of an artboard on an inactive page ----------
  const png = await ev(async () => {
    const s = Folio.store;
    const id = s.pages().find((p) => p.name === 'Social').roots[0];
    const url = await Folio.exporter.pngDataUrl(id, { scale: 0.25 });
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = url; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let nonblank = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) nonblank++;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const el = Folio.render.el(id);
    return { w: img.width, h: img.height, nonblank, total: px.length / 4, hidden: getComputedStyle(el).display, cur: s.currentPage().name };
  });
  ok(png.w === 270 && png.h === 270 && png.nonblank > png.total * 0.9, 'PNG export of an artboard on another page has content', png);
  ok(png.hidden === 'none' && png.cur === 'Components', 'it is hidden again afterwards, page unchanged', png);

  // ---------- delete page (with artboards → confirm) ----------
  const before = await ev(() => Object.keys(Folio.store.doc.nodes).length);
  await page.click('.ly-page:has-text("Social")', { button: 'right' });
  await page.click('.f-menu__item:has-text("Delete")');
  await page.waitForTimeout(150);
  s = await st();
  const after = await ev(() => Object.keys(Folio.store.doc.nodes).length);
  ok(!s.pages.includes('Social') && after < before && s.inv, 'Delete page removes it and its layers', s);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(100);
  s = await st();
  ok(s.pages.includes('Social') && s.inv, 'undo brings the page back', s);
  // duplicate
  await page.click('.ly-page:has-text("Social")', { button: 'right' });
  await page.click('.f-menu__item:has-text("Duplicate")');
  await page.waitForTimeout(100);
  s = await st();
  ok(s.pages.includes('Social copy') && s.cur === 'Social copy' && s.roots === 2, 'Duplicate page', s);
  await shot('03-pages-list', { x: 0, y: 0, width: 260, height: 420 });
  await page.screenshot({ path: `${OUT}/04-full.png` });

  // ---------- reload persistence ----------
  await ev(() => Folio.store.saveNow());
  const snap = await st();
  await page.reload();
  await boot();
  s = await st();
  ok(JSON.stringify(s) === JSON.stringify(snap), 'reload keeps pages, order and current page', { s, snap });
  ok((await rows()).join() === snap.pages.join(), 'list after reload');

  // ---------- File save / open round trip ----------
  const [dl] = await Promise.all([page.waitForEvent('download'), ev(() => Folio.exporter.saveFile())]);
  const file = `${OUT}/roundtrip.folio.json`;
  await dl.saveAs(file);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(Array.isArray(saved.pages) && saved.pages.length === snap.pages.length, 'saved file has pages');
  await ev(() => Folio.store.newDoc());
  s = await st();
  ok(s.pages.length === 1 && s.roots === 0 && s.inv, 'new doc: one empty page');
  await ev(() => Folio.exporter.openFile());
  await page.setInputFiles('#folio-open-file', file);
  await page.waitForTimeout(400);
  s = await st();
  ok(JSON.stringify(s) === JSON.stringify(snap), 'File → Open restores pages', { s, snap });
  ok((await visibleRoots()).length === snap.roots, 'opened doc renders the current page only');
  // old file without pages
  const old = { ...saved };
  delete old.pages; delete old.page;
  old.roots = saved.pages.flatMap((p) => p.roots);
  await ev((t) => Folio.exporter.loadText ? Folio.exporter.loadText(t, 'old.json') : Folio.store.load(JSON.parse(t)), JSON.stringify(old));
  s = await st();
  ok(s.pages.join() === 'Page 1' && s.roots === old.roots.length && s.inv, 'old file → one Page 1 with every artboard', s);

  // ---------- perf: many pages ----------
  const perf = await ev(() => {
    const s = Folio.store;
    for (let i = 0; i < 20; i++) {
      const p = s.addPage('P' + i);
      s.withPage(p.id, () => { for (let j = 0; j < 4; j++) s.buildFromTree({ type: 'frame', name: 'B', x: j * 500, y: 0, width: 400, height: 400, layout: { mode: 'flex' }, children: Array.from({ length: 40 }, () => ({ type: 'text', text: { content: 'hello' } })) }); });
    }
    Folio.render.sync();
    const id = s.doc.roots[0];
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) { s.update(id, { x: i }); Folio.render.sync(); }
    return { ms: (performance.now() - t0) / 20, nodes: Object.keys(s.doc.nodes).length };
  });
  ok(perf.ms < 8, `edit + render with ${perf.nodes} nodes on 20+ pages: ${perf.ms.toFixed(2)} ms`, perf);

  ok(errors.length === 0, 'no console errors', errors);
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})();
