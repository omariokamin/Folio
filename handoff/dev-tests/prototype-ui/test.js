/* Browser test for the Prototype tab + canvas arrows. run: node .dev/prototype-ui/test.js */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const PORT = 8473;
const OUT = __dirname;
let fails = 0;
const ok = (c, msg, extra) => {
  console.log((c ? '  ok   ' : '  FAIL ') + msg + (c || extra === undefined ? '' : ' ' + JSON.stringify(extra).slice(0, 400)));
  if (!c) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.g|net::|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  try {
    await page.goto(`http://127.0.0.1:${PORT}/index.html`);
    await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
    await page.waitForFunction(() => Folio.prototype && typeof Folio.prototype.normalize === 'function', null, { timeout: 30000 });

    // ---- a small document: Home (button + nav link), Pricing, Menu ----
    const ids = await page.evaluate(() => {
      const s = Folio.store;
      s.newDoc();
      const home = s.buildFromTree({ type: 'frame', name: 'Home', x: 0, y: 0, width: 390, height: 844, layout: { mode: 'flex', direction: 'column', gap: 24, padding: [48, 24, 48, 24] }, style: { fills: [{ type: 'solid', color: '#ffffff' }] },
        children: [
          { type: 'text', name: 'Title', text: { content: 'Welcome', size: 32, weight: 700 } },
          { type: 'frame', name: 'Button / Primary', width: 200, height: 48, style: { radius: 12, fills: [{ type: 'solid', color: '#6d5efc' }] }, layout: { mode: 'flex', justify: 'center', align: 'center' }, children: [{ type: 'text', name: 'Label', text: { content: 'See pricing', size: 16, weight: 600, color: '#ffffff' } }] },
          { type: 'frame', name: 'Menu button', width: 120, height: 40, style: { radius: 8, fills: [{ type: 'solid', color: '#eef0f4' }] } },
        ] });
      const pricing = s.buildFromTree({ type: 'frame', name: 'Pricing', x: 560, y: 0, width: 390, height: 844, style: { fills: [{ type: 'solid', color: '#f7f7fb' }] } });
      const menu = s.buildFromTree({ type: 'frame', name: 'Menu', x: 1120, y: 0, width: 390, height: 500, style: { fills: [{ type: 'solid', color: '#fff7ed' }] } });
      s.commit('setup');
      s.select([]);
      Folio.canvas.zoomToFit();
      const kids = s.get(home.id).children;
      return { home: home.id, pricing: pricing.id, menu: menu.id, btn: kids[1], menuBtn: kids[2] };
    });
    await sleep(200);

    const hist = () => page.evaluate(() => Folio.store.historyIndex);
    const inter = (id) => page.evaluate((id) => Folio.store.get(id).interactions, id);
    const normalized = (id) =>
      page.evaluate((id) => {
        const l = Folio.store.get(id).interactions || [];
        return JSON.stringify(Folio.prototype.normalize(id, l).interactions) === JSON.stringify(l);
      }, id);

    // ---- tabs ----
    const tabs = await page.$$eval('#right-tabs .ai-tab', (b) => b.map((x) => x.textContent.trim()));
    ok(tabs.join('|') === 'Design|Prototype|AI', 'tabs: Design · Prototype · AI', tabs);
    ok(await page.evaluate(() => !document.querySelector('#prototype-panel') || document.querySelector('#prototype-panel').hidden), 'prototype panel hidden on Design tab');
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.pp-arrows')).display === 'none'), 'no arrows on Design tab');
    await page.click('#right-tabs [data-tab="prototype"]');
    ok(await page.evaluate(() => !document.getElementById('prototype-panel').hidden && document.getElementById('inspector').hidden && document.getElementById('ai-panel').hidden), 'Prototype tab shows #prototype-panel, hides inspector + AI');
    ok(await page.evaluate(() => localStorage.getItem('folio:ui:right-tab') === 'prototype'), 'tab remembered');
    ok(await page.evaluate(() => document.querySelector('[data-tab="prototype"]').getAttribute('aria-selected') === 'true'), 'aria-selected on the tab');
    ok(await page.evaluate(() => Folio.prototypePanel.isOpen()), 'isOpen() true');

    // ---- add interaction via UI ----
    await page.evaluate((id) => Folio.store.select([id]), ids.btn);
    await page.waitForSelector('#prototype-panel .pp-add');
    let h0 = await hist();
    await page.click('#prototype-panel .pp-add');
    let it = await inter(ids.btn);
    ok(it && it.length === 1 && it[0].action === 'navigate' && it[0].target === ids.pricing, 'Add interaction → navigate to the next screen', it);
    ok((await hist()) === h0 + 1, 'one undo step for add');
    ok(await normalized(ids.btn), 'stored data is normalized');

    async function pickAction(v) {
      const before = await hist();
      await page.selectOption('#prototype-panel [data-k="0:action"]', v);
      await sleep(60);
      const after = await hist();
      const l = await inter(ids.btn);
      ok(l && l[0].action === v && after === before + 1 && (await normalized(ids.btn)), `action → ${v}: stored, normalized, one undo step`, { l, before, after });
      return l;
    }
    for (const a of ['back', 'url', 'overlay', 'close', 'navigate']) await pickAction(a);

    // url: type a bare domain
    await pickAction('url');
    h0 = await hist();
    await page.fill('#prototype-panel [data-k="0:url"]', 'folio.dev/pricing');
    await page.press('#prototype-panel [data-k="0:url"]', 'Enter');
    await sleep(60);
    it = await inter(ids.btn);
    ok(it[0].url === 'https://folio.dev/pricing' && (await hist()) === h0 + 1, 'url field adds https:// and commits once', it);
    h0 = await hist();
    await page.fill('#prototype-panel [data-k="0:url"]', 'javascript:alert(1)');
    await page.press('#prototype-panel [data-k="0:url"]', 'Enter');
    await sleep(60);
    it = await inter(ids.btn);
    ok(it[0].url === 'https://folio.dev/pricing' && (await hist()) === h0, 'unsafe url rejected, nothing stored', it);

    // overlay options
    await pickAction('overlay');
    await page.selectOption('#prototype-panel [data-k="0:target"]', ids.menu);
    await page.selectOption('#prototype-panel [data-k="0:pos"]', 'bottom');
    h0 = await hist();
    await page.click('#prototype-panel [data-k="0:outside"]');
    await sleep(60);
    it = await inter(ids.btn);
    ok(it[0].target === ids.menu && it[0].overlay.position === 'bottom' && it[0].overlay.closeOnOutside === false && (await hist()) === h0 + 1, 'overlay target / position / close-outside', it);

    // transitions
    await page.click('#prototype-panel [data-k="0:tr:slide"]');
    await page.click('#prototype-panel [data-k="0:dir:up"]');
    h0 = await hist();
    await page.fill('#prototype-panel [data-k="0:dur"]', '450');
    await page.press('#prototype-panel [data-k="0:dur"]', 'Enter');
    await sleep(60);
    it = await inter(ids.btn);
    ok(it[0].transition.type === 'slide' && it[0].transition.direction === 'up' && it[0].transition.duration === 450 && (await hist()) === h0 + 1, 'slide up 450ms', it[0].transition);
    ok(await normalized(ids.btn), 'still normalized');
    await page.screenshot({ path: path.join(OUT, 'shot-layer.png') });

    // dangling target shows "Missing screen"
    await page.evaluate((ids) => {
      Folio.store.update(ids.menuBtn, { interactions: [{ trigger: 'click', action: 'navigate', target: 'ghost123' }] });
      Folio.store.select([ids.menuBtn]);
    }, ids);
    await sleep(80);
    ok(await page.evaluate(() => { const s = document.querySelector('#prototype-panel [data-k="0:target"]'); return s && s.classList.contains('is-missing') && s.selectedOptions[0].textContent === 'Missing screen'; }), 'dangling target shows "Missing screen"');
    await page.evaluate((id) => { Folio.store.update(id, { interactions: undefined }); Folio.store.commit('clean'); }, ids.menuBtn);

    // remove
    await page.evaluate((id) => Folio.store.select([id]), ids.btn);
    await sleep(50);
    h0 = await hist();
    await page.click('#prototype-panel [data-k="0:rm"]');
    await sleep(60);
    ok(!(await inter(ids.btn)) && (await hist()) === h0 + 1, 'remove → no interactions, one undo step');
    await page.evaluate(() => Folio.store.undo());
    await sleep(60);
    ok((await inter(ids.btn)).length === 1, 'undo brings it back');
    await page.click('#prototype-panel [data-k="0:rm"]');

    // ---- instance root: removing its last interaction keeps an explicit [] (no re-inherit from the main) ----
    const inst = await page.evaluate((ids) => {
      const s = Folio.store, K = Folio.components;
      const main = s.buildFromTree({ type: 'frame', name: 'Chip', x: 0, y: 1000, width: 80, height: 32, interactions: [{ trigger: 'click', action: 'back' }] });
      const c = K.create([main.id], { name: 'Chip' });
      s.commit('comp');
      const iid = K.createInstance(c.id, { parentId: ids.pricing });
      s.commit('inst');
      s.select([iid]);
      return { iid, main: main.id };
    }, ids);
    await sleep(250);
    ok(JSON.stringify(await inter(inst.iid)) === JSON.stringify([{ trigger: 'click', action: 'back' }]), 'instance inherits the main interaction', await inter(inst.iid));
    await page.click('#prototype-panel [data-k="0:rm"]');
    await page.evaluate(() => { Folio.components.flush && Folio.components.flush(); Folio.store.update(Folio.store.doc.roots[0], {}); });
    await sleep(300);
    const ii = await inter(inst.iid);
    ok(Array.isArray(ii) && ii.length === 0 && (await inter(inst.main)).length === 1, 'instance root keeps [] after removing its last interaction; main untouched', ii);
    await page.evaluate((ids) => { Folio.store.remove([ids.iid, Folio.store.rootOf(ids.main)]); Folio.store.commit('cleanup'); Folio.store.select([]); }, inst);
    await page.evaluate((id) => Folio.store.select([id]), ids.btn);
    await sleep(60);

    // ---- drag the handle ----
    const center = (id) => page.evaluate((id) => {
      const b = Folio.canvas.nodeRect(id);
      const p = Folio.canvas.worldToScreen(b.x + b.width / 2, b.y + b.height / 2);
      const r = document.getElementById('canvas-viewport').getBoundingClientRect();
      return { x: p.x + r.left, y: p.y + r.top };
    }, id);
    async function dragHandleTo(pt, { esc = false, shot = null } = {}) {
      const hb = await page.$eval('.pp-handle', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, vis: getComputedStyle(e).display !== 'none' }; });
      await page.mouse.move(hb.x, hb.y);
      await page.mouse.down();
      await page.mouse.move((hb.x + pt.x) / 2, (hb.y + pt.y) / 2, { steps: 4 });
      await page.mouse.move(pt.x, pt.y, { steps: 6 });
      await sleep(60);
      const mid = await page.evaluate(() => ({ drop: document.querySelectorAll('.pp-drop').length, live: document.querySelectorAll('.pp-arrow.is-live').length }));
      if (shot) await page.screenshot({ path: path.join(OUT, shot) });
      if (esc) await page.keyboard.press('Escape');
      await page.mouse.up();
      await sleep(80);
      return { hb, mid };
    }
    h0 = await hist();
    let r = await dragHandleTo(await center(ids.menu), { shot: 'shot-drag.png' });
    ok(r.hb.vis, 'handle visible on the selected layer');
    ok(r.mid.drop === 1 && r.mid.live === 1, 'live arrow + highlighted drop artboard while dragging', r.mid);
    it = await inter(ids.btn);
    ok(it && it.length === 1 && it[0].action === 'navigate' && it[0].target === ids.menu && (await hist()) === h0 + 1, 'drop on artboard adds navigate (one undo step)', it);
    ok(await page.evaluate((id) => Folio.store.selection.join() === id, ids.btn), 'selection unchanged by the handle drag');
    r = await dragHandleTo(await center(ids.pricing));
    it = await inter(ids.btn);
    ok(it.length === 1 && it[0].target === ids.pricing, 'second drag retargets the first navigate', it);
    h0 = await hist();
    r = await dragHandleTo(await page.evaluate(() => { const r = document.getElementById('canvas-viewport').getBoundingClientRect(); return { x: r.left + 30, y: r.bottom - 30 }; }));
    ok((await hist()) === h0 && (await inter(ids.btn))[0].target === ids.pricing, 'drop on empty canvas cancels');
    r = await dragHandleTo(await center(ids.menu), { esc: true });
    ok((await hist()) === h0 && (await inter(ids.btn))[0].target === ids.pricing, 'Esc cancels the drag');
    ok(await page.evaluate((id) => Folio.store.selection.join() === id, ids.btn), 'Esc during drag keeps selection');
    r = await dragHandleTo(await center(ids.home));
    ok((await hist()) === h0, 'drop on own screen does nothing');

    // normal canvas click still selects layers
    const tc = await center(ids.menuBtn);
    await page.mouse.click(tc.x, tc.y);
    await sleep(60);
    ok(await page.evaluate((id) => Folio.store.selection.join() === id, ids.menuBtn), 'canvas click selection still works', await page.evaluate(() => Folio.store.selection));

    // ---- arrows follow pan / zoom, only in Prototype tab ----
    await page.evaluate((id) => Folio.store.select([id]), ids.btn);
    await sleep(60);
    const arrowStart = () => page.evaluate(() => { const c = document.querySelector('.pp-arrow circle'); return c ? { x: +c.getAttribute('cx'), y: +c.getAttribute('cy') } : null; });
    const btnRight = () => page.evaluate((id) => { const b = Folio.canvas.nodeRect(id); return Folio.canvas.worldToScreen(b.x + b.width, b.y + b.height / 2); }, ids.btn);
    let a0 = await arrowStart();
    let br = await btnRight();
    ok(a0 && Math.abs(a0.x - br.x) < 1.5 && Math.abs(a0.y - br.y) < 1.5, 'arrow starts at the layer right edge', { a0, br });
    ok(await page.evaluate(() => document.querySelectorAll('.pp-arrow.is-hot').length === 1), 'selected layer arrow highlighted');
    await page.evaluate(() => { const v = Folio.store.viewport; Folio.store.setViewport({ x: v.x + 120, y: v.y - 40 }); });
    await sleep(80);
    let a1 = await arrowStart();
    ok(a1 && Math.abs(a1.x - a0.x - 120) < 1.5 && Math.abs(a1.y - a0.y + 40) < 1.5, 'arrow follows pan', { a0, a1 });
    await page.evaluate(() => Folio.canvas.setZoom(Folio.store.viewport.zoom * 1.5));
    await sleep(80);
    a1 = await arrowStart();
    br = await btnRight();
    ok(a1 && Math.abs(a1.x - br.x) < 1.5 && Math.abs(a1.y - br.y) < 1.5, 'arrow follows zoom', { a1, br });
    await page.evaluate(() => Folio.canvas.zoomToFit());
    await page.evaluate(() => Folio.store.select([]));
    await sleep(80);
    ok(await page.evaluate(() => document.querySelectorAll('.pp-arrow.is-faint').length === 0 && document.querySelectorAll('.pp-arrow').length === 1), 'no selection → arrows normal');
    await page.click('#right-tabs .ai-tab >> text=Design');
    await sleep(60);
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.pp-arrows')).display === 'none' && getComputedStyle(document.querySelector('.pp-flag')).display === 'none'), 'arrows + flag hidden on Design tab');
    ok(await page.evaluate(() => !document.getElementById('inspector').hidden && document.getElementById('prototype-panel').hidden), 'Design tab shows inspector again');
    await page.click('#right-tabs [data-tab="prototype"]');
    await sleep(60);
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.pp-arrows')).display !== 'none' && document.querySelectorAll('.pp-arrow').length === 1), 'arrows back on Prototype tab');

    // ---- start screen ----
    const flagNear = (id) => page.evaluate((id) => {
      const f = document.querySelector('.pp-flag');
      if (getComputedStyle(f).display === 'none') return false;
      const fr = f.getBoundingClientRect();
      const b = Folio.canvas.nodeRect(id);
      const p = Folio.canvas.worldToScreen(b.x, b.y);
      const vr = document.getElementById('canvas-viewport').getBoundingClientRect();
      return Math.abs(fr.right - (p.x + vr.left - 6)) < 2 && fr.bottom < p.y + vr.top + 2;
    }, id);
    ok(await flagNear(ids.home), 'Start flag on the first artboard by default');
    await page.evaluate((id) => Folio.store.select([id]), ids.pricing);
    await sleep(60);
    h0 = await hist();
    await page.click('#prototype-panel [data-k="start"]');
    await sleep(80);
    ok(await page.evaluate((id) => Folio.store.currentPage().start === id, ids.pricing) && (await hist()) === h0 + 1, 'Start screen toggle sets page.start (one undo step)');
    ok(await flagNear(ids.pricing), 'flag moves to the new start screen');
    await page.click('#prototype-panel [data-k="start"]');
    await sleep(60);
    ok(await page.evaluate(() => Folio.store.currentPage().start === undefined), 'unticking clears page.start');
    await page.evaluate((id) => Folio.store.select([id]), ids.home);
    await sleep(60);
    ok(await page.evaluate(() => { const c = document.querySelector('#prototype-panel [data-k="start"]'); return c.checked && c.disabled; }), 'default start: ticked and disabled');

    // ---- scroll ----
    h0 = await hist();
    await page.click('#prototype-panel [data-k="scroll:vertical"]');
    await sleep(60);
    ok(await page.evaluate((id) => Folio.store.get(id).scroll === 'vertical', ids.home) && (await hist()) === h0 + 1, 'Scroll: vertical (one undo step)');
    await page.click('#prototype-panel [data-k="scroll:none"]');
    await sleep(60);
    ok(await page.evaluate((id) => !JSON.parse(Folio.store.serialize()).nodes[id].scroll, ids.home), 'Scroll: none removes the field');
    await page.evaluate((id) => Folio.store.select([id]), ids.home);
    const textId = await page.evaluate((id) => Folio.store.get(id).children[0], ids.home);
    await page.evaluate((id) => Folio.store.select([id]), textId);
    await sleep(60);
    ok(await page.evaluate(() => !document.querySelector('#prototype-panel [data-k^="scroll"]')), 'no Scroll section for text layers');

    // ---- multi-select ----
    await page.evaluate((ids) => Folio.store.select([ids.btn, ids.menuBtn]), ids);
    await sleep(60);
    ok(await page.evaluate(() => /single layer/.test(document.getElementById('prototype-panel').textContent) && !document.querySelector('#prototype-panel .pp-add')), 'multi-select shows a hint');

    // ---- nothing selected ----
    await page.evaluate((ids) => { Folio.store.update(ids.menuBtn, { interactions: [{ trigger: 'click', action: 'overlay', target: ids.menu }] }); Folio.store.commit('x'); Folio.store.select([]); }, ids);
    await sleep(80);
    ok(await page.evaluate(() => document.querySelectorAll('#prototype-panel .pp-flow__row').length === 2), 'flow summary lists both interactions');
    ok(await page.evaluate(() => document.querySelectorAll('.pp-arrow.is-overlay').length === 1), 'overlay arrow is dashed');
    h0 = await hist();
    await page.selectOption('#prototype-panel [data-k="start"]', ids.pricing);
    await sleep(60);
    ok(await page.evaluate((id) => Folio.store.currentPage().start === id, ids.pricing) && (await hist()) === h0 + 1, 'page start dropdown');
    ok(await page.evaluate(() => !!document.querySelector('#prototype-panel .pp-play')), 'Play button present');
    await page.screenshot({ path: path.join(OUT, 'shot-page.png') });
    await page.click('#prototype-panel .pp-flow__row');
    ok(await page.evaluate((id) => Folio.store.selection.join() === id, ids.btn), 'clicking a flow row selects the layer');
    await page.evaluate(() => Folio.store.select([]));
    await sleep(50);
    const playable = await page.evaluate(() => typeof Folio.prototype.play === 'function');
    if (playable) {
      await page.click('#prototype-panel .pp-play');
      await sleep(400);
      ok(await page.evaluate(() => !!document.getElementById('play-root')), 'Play opens the player');
      await page.keyboard.press('Escape');
      await sleep(200);
    } else console.log('  skip Play (Folio.prototype.play not there yet)');

    // ---- remembered tab after reload ----
    await page.evaluate(() => Folio.store.saveNow());
    await page.reload();
    await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
    await sleep(200);
    ok(await page.evaluate(() => !document.getElementById('prototype-panel').hidden && document.getElementById('inspector').hidden && document.querySelector('[data-tab="prototype"]').classList.contains('is-active')), 'Prototype tab remembered after reload');
    ok(await page.evaluate(() => document.querySelectorAll('.pp-arrow').length === 2), 'arrows drawn after reload');

    ok(errors.length === 0, 'no page errors', errors);
  } catch (e) {
    console.error(e);
    fails++;
  } finally {
    await browser.close();
    srv.kill();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
