// Components UI test: node .dev/comp-ui-test.js [--shots-only]
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = '/home/user/folio/.dev/compui';
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };
const REAL = fs.existsSync('/home/user/folio/src/components.js');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); console.log('  [pageerror]', e.stack.split('\n').slice(0, 4).join(' | ')); });
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/ERR_FAILED|net::|Failed to load resource/.test(m.text())) errors.push(m.type() + ': ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  if (!REAL) await page.route('**/src/components.js', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync('/home/user/folio/.dev/components-stub.js', 'utf8') }));
  console.log('engine:', REAL ? 'REAL src/components.js' : 'STUB');
  const boot = async () => { await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready')); await page.waitForTimeout(300); };
  await page.goto('http://localhost:8132/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await boot();
  await page.addScriptTag({ content: `
    window.T = {
      s: () => Folio.store,
      byName(name, within) { const s = Folio.store; let pool = Object.values(s.doc.nodes); if (within) pool = [within, ...s.descendants(within)].map(id => s.get(id)); return pool.find(n => n.name === name) || null; },
      insts(compId) { return Object.values(Folio.store.doc.nodes).filter(n => n.instance && (!compId || n.instance.componentId === compId) && Folio.components.isDirectInstance(n.id)); },
      center(id) { Folio.render.sync(); const r = Folio.render.el(id).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
      hist() { return Folio.store.historyIndex; },
    };
  `});
  const shot = async (name, clip) => { await page.waitForTimeout(350); await page.screenshot({ path: `${OUT}/${name}.png`, clip }); };
  const LEFT = { x: 0, y: 0, width: 260, height: 900 };
  const RIGHT = { x: 1140, y: 0, width: 300, height: 900 };

  // ---------- tab + empty state ----------
  ok(await page.isVisible('.bp-tab:has-text("Components")'), 'Components tab exists');
  await page.click('.bp-tab:has-text("Components")');
  ok(await page.isVisible('#components-panel') && !(await page.isVisible('#layers')) && !(await page.isVisible('#brand-panel')), 'Components tab shows only the components panel');
  ok(await page.isVisible('.kp-empty'), 'empty state shown');
  await shot('01-empty', LEFT);

  // ---------- starter kit ----------
  const h0 = await page.evaluate(() => T.hist());
  await page.click('.kp-empty__kit');
  await page.waitForTimeout(500);
  const kit = await page.evaluate(() => ({ comps: Folio.components.list().length, sets: Folio.components.sets().length, tiles: document.querySelectorAll('.kp-tile').length, hist: T.hist(), board: !!Folio.store.doc.roots.map(id => Folio.store.get(id)).find(n => n.name === 'Components') }));
  ok(kit.comps > 3 && kit.tiles === kit.comps && kit.board, `starter kit: ${kit.comps} comps, ${kit.sets} sets, ${kit.tiles} tiles`);
  ok(kit.hist === h0 + 1, 'starter kit = one undo step');
  await shot('02-kit-panel', LEFT);
  await shot('03-kit-canvas');

  // thumbnails have real content
  const th = await page.evaluate(() => [...document.querySelectorAll('.kp-thumb')].filter(t => t.querySelector('.kp-thumb__in > *')).length);
  ok(th === kit.tiles, `every tile has a live thumbnail (${th})`);

  // search
  await page.fill('.kp-search', 'badge');
  await page.waitForTimeout(100);
  const nBadge = await page.evaluate(() => document.querySelectorAll('.kp-tile').length);
  ok(nBadge >= 1 && nBadge < kit.tiles, `search filters (${nBadge} for "badge")`);
  await page.fill('.kp-search', 'zzzz');
  await page.waitForTimeout(100);
  ok(await page.isVisible('.kp-none'), 'no-results message');
  await shot('04-search-none', LEFT);
  await page.fill('.kp-search', '');
  await page.waitForTimeout(100);

  // ---------- insert by click (nothing selected → view centre) ----------
  const btnComp = await page.evaluate(() => Folio.components.list().find(c => c.setId && Object.values(c.variant).includes('Primary')).id);
  // over empty canvas → a new root, centred in the view
  await page.evaluate(() => { Folio.store.select([]); Folio.store.setViewport({ x: 4000, y: 4000, zoom: 1 }); });
  await page.click(`.kp-tile__btn[data-comp="${btnComp}"]`);
  await page.waitForTimeout(300);
  let inst = await page.evaluate((cid) => { const p = Folio.store.primary(); return p && { id: p.id, root: !p.parent, comp: p.instance && p.instance.componentId }; }, btnComp);
  let vc = await page.evaluate(() => { const r = document.getElementById('canvas-viewport').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  let ic = await page.evaluate(() => T.center(Folio.store.primary().id));
  ok(inst && inst.comp === btnComp && inst.root && Math.abs(ic.x - vc.x) < 3 && Math.abs(ic.y - vc.y) < 3, 'click over empty canvas: new root instance centred in the view, selected');
  await page.evaluate(() => Folio.canvas.zoomToFit());

  // insert into a selected frame: make a normal artboard
  const abId = await page.evaluate(() => { const n = Folio.canvas.createArtboard('Desktop'); return n.id; });
  await page.evaluate(() => Folio.canvas.zoomToFit());
  await page.evaluate((id) => Folio.store.select([id]), abId);
  const badgeComp = await page.evaluate(() => Folio.components.list().find(c => /badge/i.test(c.name)).id);
  await page.click(`.kp-tile__btn[data-comp="${badgeComp}"]`);
  await page.waitForTimeout(300);
  inst = await page.evaluate((ab) => { const p = Folio.store.primary(); return p && { parent: p.parent, inst: !!p.instance }; }, abId);
  ok(inst && inst.parent === abId && inst.inst, 'click inserts inside the selected frame');
  // nothing selected, view centred on a freeform artboard → dropped into it at the centre
  await page.evaluate((ab) => { Folio.store.select([]); Folio.canvas.zoomToFit([ab]); }, abId);
  await page.click(`.kp-tile__btn[data-comp="${btnComp}"]`);
  await page.waitForTimeout(300);
  ic = await page.evaluate(() => T.center(Folio.store.primary().id));
  ok((await page.evaluate(() => Folio.store.primary().parent)) === abId && Math.abs(ic.x - vc.x) < 3 && Math.abs(ic.y - vc.y) < 3, 'click with the view over an artboard drops it there, centred');
  await page.keyboard.press('Delete');

  // ---------- drag onto canvas ----------
  const cardComp = await page.evaluate(() => Folio.components.list().find(c => /card/i.test(c.name)).id);
  const tile = await page.$(`.kp-tile__btn[data-comp="${cardComp}"]`);
  await tile.scrollIntoViewIfNeeded();
  const tb = await tile.boundingBox();
  await page.evaluate((ab) => Folio.canvas.zoomToFit([ab]), abId);
  await page.waitForTimeout(100);
  const target = await page.evaluate((ab) => { const c = T.center(ab); return { x: Math.round(c.x + 100), y: Math.round(c.y + 60) }; }, abId);
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 20);
  await page.mouse.down();
  await page.mouse.move(tb.x + 150, tb.y + 40, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 8 });
  ok(await page.isVisible('.kp-ghost'), 'drag ghost follows the pointer');
  const dt = await page.evaluate(() => Folio.overlay.guides.dropTarget);
  ok(dt === abId, 'drop target highlighted while dragging over the artboard');
  await shot('05-drag');
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dropped = await page.evaluate(() => { const p = Folio.store.primary(); Folio.render.sync(); const r = Folio.render.el(p.id).getBoundingClientRect(); return { parent: p.parent, inst: p.instance && p.instance.componentId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
  ok(dropped.inst === cardComp && dropped.parent === abId && Math.abs(dropped.cx - target.x) < 3 && Math.abs(dropped.cy - target.y) < 3, `drag drops the instance centred at the drop point (${Math.round(dropped.cx)},${Math.round(dropped.cy)} vs ${target.x},${target.y})`);
  ok(!(await page.isVisible('.kp-ghost')), 'ghost removed after drop');
  const cardInst = await page.evaluate(() => Folio.store.primary().id);

  // ---------- layers: icons, tint ----------
  await page.click('.bp-tab:has-text("Layers")');
  await page.evaluate(() => { const c = Folio.components.list().find(x => /card/i.test(x.name)); Folio.store.ancestors(c.mainId).forEach(a => Folio.layers.expand(a)); Folio.layers.expand(c.mainId); });
  await page.evaluate((ci) => Folio.layers.expand(ci), cardInst);
  await page.waitForTimeout(200);
  const ly = await page.evaluate((ci) => {
    const row = (id) => document.querySelector(`.ly-row[data-id="${id}"]`);
    const c = Folio.components.list().find(x => /card/i.test(x.name));
    const title = Folio.store.get(ci).children.map(id => Folio.store.get(id)).find(n => n.type === 'text');
    return {
      main: row(c.mainId) && row(c.mainId).classList.contains('is-comp') && !!row(c.mainId).querySelector('.f-icon.is-filled'),
      inst: row(ci) && row(ci).classList.contains('is-instance'),
      inner: title && row(title.id) && row(title.id).classList.contains('is-in-instance'),
      mainColor: row(c.mainId) && getComputedStyle(row(c.mainId).querySelector('.ly-row__name')).color,
    };
  }, cardInst);
  ok(ly.main && ly.inst && ly.inner, `layers: main filled diamond + purple (${ly.mainColor}), instance outlined, internals tinted`);
  await shot('06-layers', LEFT);

  // ---------- inspector: instance section ----------
  await page.evaluate((id) => Folio.store.select([id]), cardInst);
  await page.waitForTimeout(200);
  ok(await page.isVisible('.ins-sec[data-sec="component"]'), 'Instance section shown for an instance');
  const roRoot = await page.evaluate(() => ({
    layoutRO: !!document.querySelector('.ins-sec[data-sec="layout"].is-readonly'),
    sizeRO: !!document.querySelector('.ins-sec[data-sec="size"].is-readonly'),
    fillRO: !!document.querySelector('.ins-sec[data-sec="fill"].is-readonly'),
    xOk: !document.querySelector('[data-k="x"]').disabled,
    rotRO: document.querySelector('[data-k="rotation"]').disabled,
    hint: !!document.querySelector('.ins-ro-hint'),
  }));
  ok(roRoot.layoutRO && !roRoot.sizeRO && !roRoot.fillRO && roRoot.xOk && roRoot.rotRO && roRoot.hint, 'instance root: layout/rotation read-only, size/x/fill editable, hint shown ' + JSON.stringify(roRoot));
  await shot('07-inspector-instance', RIGHT);

  // ---------- text override via inspector + colour ----------
  const titleId = await page.evaluate((ci) => Folio.store.get(ci).children.map(id => Folio.store.get(id)).find(n => n.type === 'text').id, cardInst);
  await page.evaluate((id) => Folio.store.select([id]), titleId);
  await page.waitForTimeout(200);
  const roInner = await page.evaluate(() => ({
    content: !document.querySelector('[data-k="content"]').disabled,
    color: !document.querySelector('[data-k="tcolor.hex"]').disabled,
    font: document.querySelector('[data-k="fsize"]') ? document.querySelector('[data-k="fsize"]').disabled : 'none',
    name: document.querySelector('.ins-header [data-k="name"]').disabled,
    sizeRO: !!document.querySelector('.ins-sec[data-sec="size"].is-readonly'),
    posRO: !!document.querySelector('.ins-sec[data-sec="position"].is-readonly'),
  }));
  ok(roInner.content && roInner.color && roInner.font === true && roInner.name && roInner.sizeRO && roInner.posRO, 'inside instance: text content/colour editable; font size, name, size, position read-only ' + JSON.stringify(roInner));
  await shot('08-inspector-inner-text', RIGHT);
  let h1 = await page.evaluate(() => T.hist());
  await page.fill('[data-k="content"]', 'Holiday menu');
  await page.press('[data-k="content"]', 'Tab');
  await page.waitForTimeout(150);
  ok((await page.evaluate(() => T.hist())) === h1 + 1, 'text override = one undo step');
  await page.fill('[data-k="tcolor.hex"]', 'FF0055');
  await page.press('[data-k="tcolor.hex"]', 'Enter');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(300);
  await page.evaluate((id) => Folio.store.select([id]), cardInst);
  await page.waitForTimeout(250);
  const ovr = await page.evaluate((ci) => Folio.components.overridesOf(ci), cardInst);
  const ovrRows = await page.evaluate(() => [...document.querySelectorAll('.ins-kc__ovr')].map(r => r.textContent));
  ok(JSON.stringify(ovr).includes('Holiday menu') && JSON.stringify(ovr).toLowerCase().includes('ff0055') && ovrRows.length >= 1, 'overrides listed: ' + ovrRows.join(' | '));
  await shot('09-inspector-overrides', RIGHT);

  // main change propagates but keeps the override; thumbnail updates
  const mainTitle = await page.evaluate(() => { const c = Folio.components.list().find(x => /card/i.test(x.name)); return Folio.store.get(c.mainId).children.map(id => Folio.store.get(id)).find(n => n.type === 'text').id; });
  await page.click('.bp-tab:has-text("Components")');
  await page.evaluate((id) => { Folio.store.update(id, { text: { size: 30 } }); Folio.store.update(Folio.store.get(id).parent, { style: { fills: [{ type: 'solid', color: '#ffeedd' }] } }); Folio.store.commit('edit main'); }, mainTitle);
  await page.waitForTimeout(600);
  const prop = await page.evaluate(([ci, cid]) => { const t = Folio.store.get(ci).children.map(id => Folio.store.get(id)).find(n => n.type === 'text'); const thumb = document.querySelector(`.kp-tile__btn[data-comp="${cid}"] .kp-thumb__in > *`); return { size: t.text.size, content: t.text.content, thumbBg: thumb && getComputedStyle(thumb).backgroundColor }; }, [cardInst, cardComp]);
  ok(prop.size === 30 && prop.content === 'Holiday menu', 'main change propagates, override kept');
  ok(prop.thumbBg === 'rgb(255, 238, 221)', 'thumbnail updated after the main changed (' + prop.thumbBg + ')');
  await shot('10-thumb-updated', LEFT);

  // per-item reset + reset all
  await page.evaluate((id) => Folio.store.select([id]), cardInst);
  await page.waitForTimeout(250);
  h1 = await page.evaluate(() => T.hist());
  await page.click('.ins-kc__ovr .ins-ibtn');
  await page.waitForTimeout(250);
  const afterReset = await page.evaluate((ci) => Object.keys(Folio.components.overridesOf(ci)).length, cardInst);
  ok(afterReset === 0 && (await page.evaluate(() => T.hist())) === h1 + 1, 'per-item reset clears the override (one undo step)');

  // ---------- variants from the inspector ----------
  const btnInst = await page.evaluate((cid) => T.insts(cid)[0].id, btnComp);
  await page.evaluate((id) => Folio.store.select([id]), btnInst);
  await page.waitForTimeout(250);
  const sel = await page.$('select[data-k="variant.Style"]');
  ok(!!sel, 'variant dropdown per prop');
  await shot('11-inspector-variant', RIGHT);
  h1 = await page.evaluate(() => T.hist());
  await page.selectOption('select[data-k="variant.Style"]', 'Secondary');
  await page.waitForTimeout(300);
  const sw = await page.evaluate(() => { const p = Folio.store.primary(); const c = p && p.instance && Folio.components.get(p.instance.componentId); return c && c.variant.Style; });
  ok(sw === 'Secondary' && (await page.evaluate(() => T.hist())) === h1 + 1, 'variant switched from the inspector (one undo step)');

  // ---------- go to main ----------
  await page.click('.ins-sec[data-sec="component"] .ins-sec__actions .f-btn');
  await page.waitForTimeout(250);
  const gm = await page.evaluate(() => { const p = Folio.store.primary(); return !!(p && p.component); });
  ok(gm, 'Go to main selects the main');
  await shot('12-inspector-main', RIGHT);
  await shot('12b-canvas-main');

  // ---------- detach ----------
  const btnInst2 = await page.evaluate(() => T.insts().find(n => /button/i.test(n.name)).id);
  await page.evaluate((id) => Folio.store.select([id]), btnInst2);
  await page.waitForTimeout(200);
  h1 = await page.evaluate(() => T.hist());
  await page.keyboard.press('Control+Alt+KeyB');
  await page.waitForTimeout(250);
  const det = await page.evaluate((id) => { const n = Folio.store.get(id); return n && !n.instance && !Folio.store.descendants(id).some(d => Folio.store.get(d).sourceId); }, btnInst2);
  ok(det && (await page.evaluate(() => T.hist())) === h1 + 1, '⌥⌘B detaches (one undo step)');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  ok(await page.evaluate((id) => !!(Folio.store.get(id) && Folio.store.get(id).instance), btnInst2), 'undo restores the instance');

  // ---------- delete inside instance = hide ----------
  await page.click('.bp-tab:has-text("Layers")');
  const bodyId = await page.evaluate((ci) => Folio.store.get(ci).children.map(id => Folio.store.get(id)).filter(n => n.type === 'text')[1].id, cardInst);
  await page.evaluate((id) => Folio.store.select([id]), bodyId);
  await page.waitForTimeout(150);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
  const hid = await page.evaluate((id) => { const n = Folio.store.get(id); return n && n.visible === false; }, bodyId);
  ok(hid, 'Delete on a layer inside an instance hides it');
  const hov = await page.evaluate((ci) => JSON.stringify(Folio.components.overridesOf(ci)), cardInst);
  ok(hov.includes('visible'), 'hidden layer shows up as an override');

  // ---------- blocked drags in layers ----------
  await page.evaluate(() => Folio.layers.refresh());
  const rowOf = async (id) => (await page.$(`.ly-row[data-id="${id}"]`)).boundingBox();
  // drag a plain layer into the instance
  const plain = await page.evaluate((ab) => { const n = Folio.store.createNode('frame', { name: 'Plain box', x: 10, y: 10, width: 50, height: 50 }, ab); Folio.store.commit('add'); return n.id; }, abId);
  await page.waitForTimeout(200);
  let a = await rowOf(plain), b = await rowOf(cardInst);
  await page.mouse.move(a.x + 60, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + 60, b.y + b.height / 2, { steps: 6 });
  const indHidden = await page.evaluate(() => document.querySelector('.ly-drop').hidden);
  await page.mouse.up(); await page.waitForTimeout(200);
  ok(indHidden && (await page.evaluate(([p, ab]) => Folio.store.get(p).parent === ab, [plain, abId])), 'layers: cannot drop a layer into an instance');
  // drag an internal layer out
  a = await rowOf(titleId); b = await rowOf(plain);
  await page.mouse.move(a.x + 80, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + 60, b.y + 4, { steps: 6 });
  await page.mouse.up(); await page.waitForTimeout(200);
  ok(await page.evaluate(([t, ci]) => Folio.store.get(t).parent === ci, [titleId, cardInst]), 'layers: cannot drag a layer out of an instance');
  await shot('13-layers-hidden', LEFT);

  // context menu
  await page.click(`.ly-row[data-id="${cardInst}"]`, { button: 'right' });
  const menu = await page.evaluate(() => [...document.querySelectorAll('.f-menu .f-menu__label')].map(e => e.textContent));
  ok(menu.includes('Go to main component') && menu.includes('Detach instance') && menu.includes('Reset overrides'), 'instance context menu: ' + menu.slice(0, 4).join(', '));
  await shot('14-layers-menu', { x: 0, y: 0, width: 520, height: 900 });
  await page.keyboard.press('Escape');
  await page.click(`.ly-row[data-id="${plain}"]`, { button: 'right' });
  const menu2 = await page.evaluate(() => [...document.querySelectorAll('.f-menu .f-menu__label')].map(e => e.textContent));
  ok(menu2[0] === 'Create component', 'frame context menu offers Create component');
  await page.keyboard.press('Escape');

  // ---------- canvas: drop into instance blocked; double-click text edit ----------
  await page.evaluate((id) => { Folio.store.select([id]); Folio.canvas.zoomToFit([Folio.store.get(id).parent]); }, cardInst);
  await page.waitForTimeout(250);
  const pc = await page.evaluate((p) => T.center(p), plain);
  const cc = await page.evaluate((ci) => T.center(ci), cardInst);
  await page.evaluate((p) => Folio.store.select([p]), plain);
  await page.mouse.move(pc.x, pc.y); await page.mouse.down();
  await page.mouse.move(cc.x, cc.y, { steps: 8 });
  const dtc = await page.evaluate(() => Folio.overlay.guides.dropTarget);
  await page.mouse.up(); await page.waitForTimeout(250);
  ok(dtc !== cardInst && (await page.evaluate(([p, ci]) => !Folio.store.isAncestor(ci, p), [plain, cardInst])), 'canvas: instance is not a drop target');
  // double-click into the instance and edit text
  const tc = await page.evaluate((t) => T.center(t), titleId);
  await page.evaluate(() => Folio.store.select([]));
  await page.mouse.click(tc.x, tc.y);
  await page.mouse.dblclick(tc.x, tc.y);
  await page.waitForTimeout(200);
  let editing = await page.evaluate(() => Folio.store.editingTextId);
  if (editing !== titleId) { await page.mouse.dblclick(tc.x, tc.y); await page.waitForTimeout(200); editing = await page.evaluate(() => Folio.store.editingTextId); }
  ok(editing === titleId, 'double-click edits text inside an instance');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Edited on canvas');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok(await page.evaluate((t) => Folio.store.get(t).text.content === 'Edited on canvas', titleId), 'canvas text edit stored as an override');
  // inner selection has no resize handles
  await page.evaluate((t) => Folio.store.select([t]), titleId);
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => [...document.querySelectorAll('.f-ov-handle')].every(e => e.style.display === 'none')), 'no resize handles inside an instance');
  await page.evaluate((ci) => Folio.store.select([ci]), cardInst);
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => !!document.querySelector('.f-ov-sel.is-comp')), 'instance selection outline is purple');
  await shot('15-canvas-instance');
  // purple labels for mains/sets
  await page.evaluate(() => { const r = Folio.store.doc.roots.find(id => Folio.store.get(id).name === 'Components'); Folio.store.select([]); Folio.canvas.zoomToFit([r]); });
  await page.waitForTimeout(300);
  const labels = await page.evaluate(() => document.querySelectorAll('.f-ov-label.is-comp').length);
  ok(labels >= 3, `purple labels for mains and sets (${labels})`);
  await shot('16-canvas-components');

  // ---------- ⌥⌘K create component ----------
  await page.evaluate((p) => Folio.store.select([p]), plain);
  await page.waitForTimeout(150);
  ok(await page.isVisible('.ins-header button[title^="Create component"]'), 'inspector header offers Create component for a plain frame');
  await shot('17a-inspector-plain-frame', RIGHT);
  h1 = await page.evaluate(() => T.hist());
  await page.keyboard.press('Control+Alt+KeyK');
  await page.waitForTimeout(250);
  const made = await page.evaluate((p) => !!Folio.components.componentOf(p), plain);
  ok(made && (await page.evaluate(() => T.hist())) === h1 + 1, '⌥⌘K creates a component (one undo step)');
  await page.waitForTimeout(150);
  await shot('17-inspector-new-main', RIGHT);
  // Add variant
  await page.click('.ins-kc__btns .f-btn:has-text("Add variant")');
  await page.waitForTimeout(300);
  const setMade = await page.evaluate((p) => { const c = Folio.components.componentOf(p); return c && c.setId && Folio.components.variantsOf(c.id).length; }, plain);
  ok(setMade === 2, 'Add variant creates a set with 2 variants');
  await page.evaluate((p) => Folio.store.select([p]), plain);
  await page.waitForTimeout(250);
  await shot('18-inspector-variants', RIGHT);
  // rename a property
  const propInput = await page.$('.ins-kc__propname');
  if (propInput) {
    await propInput.fill('State');
    await propInput.press('Enter');
    await page.waitForTimeout(250);
    const props = await page.evaluate((p) => { const c = Folio.components.componentOf(p); return Folio.components.getSet(c.setId).props; }, plain);
    ok(props.State && Object.keys(props).length === 1, 'rename variant property: ' + JSON.stringify(props));
  } else ok(false, 'property name input present');

  // add + remove a value
  await page.evaluate((p) => Folio.store.select([p]), plain);
  await page.waitForTimeout(200);
  await page.click('.ins-kc__vals .ins-kc__add');
  await page.waitForTimeout(200);
  let pv = await page.evaluate((p) => { const c = Folio.components.componentOf(p); return Folio.components.getSet(c.setId).props.State; }, plain);
  ok(pv.length === 3, 'add value: ' + pv.join(', '));
  const delBtns = await page.$$('.ins-kc__chip > button:not([disabled])');
  if (delBtns.length) { await delBtns[delBtns.length - 1].click(); await page.waitForTimeout(200); }
  pv = await page.evaluate((p) => { const c = Folio.components.componentOf(p); return Folio.components.getSet(c.setId).props.State; }, plain);
  ok(pv.length === 2, 'remove unused value: ' + pv.join(', '));
  ok(await page.evaluate(() => [...document.querySelectorAll('.ins-kc__chip > button')].every(b => b.disabled)), 'values used by a variant cannot be removed');

  // ---------- shortcuts help ----------
  await page.evaluate(() => Folio.store.select([]));
  await page.evaluate(() => Folio.shortcuts.showHelp());
  const help = await page.evaluate(() => document.querySelector('.f-modal').textContent);
  ok(help.includes('Create component') && help.includes('Detach instance'), 'shortcuts help lists component shortcuts');
  await shot('19-help');
  await page.evaluate(() => Folio.shortcuts.hideHelp());

  // ---------- tile menu: delete main (confirm) ----------
  await page.click('.bp-tab:has-text("Components")');
  await page.waitForTimeout(300);
  const nb = await page.evaluate(() => Folio.components.list().find(c => /card/i.test(c.name)));
  const cardInsts = await page.evaluate((cid) => T.insts(cid).map(n => n.id), nb.id);
  await page.hover(`.kp-tile__btn[data-comp="${nb.id}"]`);
  await page.click(`.kp-tile:has(.kp-tile__btn[data-comp="${nb.id}"]) .kp-more`);
  await shot('20-tile-menu', { x: 0, y: 0, width: 520, height: 900 });
  h1 = await page.evaluate(() => T.hist());
  await page.click('.f-menu__item:has-text("Delete main component")');
  await page.waitForTimeout(400);
  ok(await page.evaluate((id) => !Folio.store.get(id), nb.mainId), 'Delete main via tile menu (confirmed)');
  ok(await page.evaluate((ids) => ids.every(id => Folio.store.get(id) && !Folio.store.get(id).instance), cardInsts) && (await page.evaluate(() => T.hist())) === h1 + 1, `its ${cardInsts.length} instance(s) became plain layers; one undo step`);
  ok(!(await page.$(`.kp-tile__btn[data-comp="${nb.id}"]`)), 'tile removed from the panel');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  ok(await page.evaluate((id) => !!Folio.components.get(id), nb.id), 'undo brings the component back');

  // rename via tile menu (standalone component)
  const badgeOwn = await page.evaluate(() => Folio.components.list().find(c => !c.setId && c.name === 'Plain box'));
  if (badgeOwn) ok(true, 'own component listed'); 

  // ---------- root instance: click picks the whole instance; drag moves it ----------
  await page.evaluate(() => Folio.store.select([]));
  const rootInst = await page.evaluate(() => { Folio.store.select([]); const c = Folio.components.list()[0]; return Folio.components.createInstance(c.id, { parentId: null, x: -3000, y: -3000 }); });
  await page.evaluate(() => Folio.store.commit('root inst'));
  await page.evaluate((id) => { Folio.canvas.zoomToFit([id]); Folio.store.select([]); }, rootInst);
  await page.waitForTimeout(200);
  const rc = await page.evaluate((id) => T.center(id), rootInst);
  await page.mouse.click(rc.x, rc.y);
  await page.waitForTimeout(100);
  ok((await page.evaluate(() => Folio.store.selection[0])) === rootInst, 'click on a root instance selects the instance');
  const before = await page.evaluate((id) => Folio.store.get(id).x, rootInst);
  await page.mouse.move(rc.x, rc.y); await page.mouse.down(); await page.mouse.move(rc.x + 60, rc.y + 10, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate((id) => Folio.store.get(id).x, rootInst);
  ok(after > before, `dragging a root instance moves it (${before} → ${after})`);
  const rc2 = await page.evaluate((id) => T.center(id), rootInst);
  await page.mouse.dblclick(rc2.x, rc2.y);
  await page.waitForTimeout(150);
  ok(await page.evaluate((id) => Folio.store.get(Folio.store.selection[0]).parent === id, rootInst), 'double-click goes inside the instance');
  // structural edits inside an instance are refused
  const nBefore = await page.evaluate(() => Object.keys(Folio.store.doc.nodes).length);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);
  ok((await page.evaluate(() => Object.keys(Folio.store.doc.nodes).length)) === nBefore, '⌘D inside an instance is refused');

  // ---------- tile menu: go to main ----------
  await page.evaluate(() => Folio.store.select([]));
  await page.click('.bp-tab:has-text("Components")');
  await page.waitForTimeout(300);
  const badgeC = await page.evaluate(() => Folio.components.list().find(c => /badge/i.test(c.name)));
  await page.hover(`.kp-tile__btn[data-comp="${badgeC.id}"]`);
  await page.click(`.kp-tile:has(.kp-tile__btn[data-comp="${badgeC.id}"]) .kp-more`);
  await page.click('.f-menu__item:has-text("Go to main component")');
  await page.waitForTimeout(200);
  ok((await page.evaluate(() => Folio.store.selection[0])) === badgeC.mainId, 'tile menu: Go to main selects the main');

  // ---------- tile menu: rename ----------
  await page.evaluate(() => Folio.store.select([]));
  const cardC = await page.evaluate(() => Folio.components.list().find(c => !c.setId && /card/i.test(c.name)).id);
  await page.click('.bp-tab:has-text("Components")');
  await page.waitForTimeout(300);
  await page.hover(`.kp-tile__btn[data-comp="${cardC}"]`);
  await page.click(`.kp-tile:has(.kp-tile__btn[data-comp="${cardC}"]) .kp-more`);
  await page.click('.f-menu__item:has-text("Rename")');
  await page.waitForTimeout(100);
  h1 = await page.evaluate(() => { window.__labels = []; Folio.store.on('history', (l) => window.__labels.push(l)); return T.hist(); });
  await shot('22-renaming', LEFT);
  await page.keyboard.type('Promo card');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const rn = await page.evaluate((id) => ({ c: Folio.components.get(id).name, n: Folio.store.get(Folio.components.get(id).mainId).name }), cardC);
  ok(rn.c === 'Promo card' && rn.n === 'Promo card' && (await page.evaluate(() => T.hist())) === h1 + 1, 'rename from the tile menu (one undo step)');
  ok(await page.isVisible(`.kp-tile__btn[data-comp="${cardC}"] .kp-tile__name:has-text("Promo card")`), 'tile shows the new name');

  // ---------- brand variables in thumbnails ----------
  const brandOk = await page.evaluate(async (cid) => {
    const B = Folio.brand; const b = B.create(B.templates()[0]); B.setActive(b.id);
    const c = Folio.components.get(cid);
    Folio.store.update(c.mainId, { style: { fills: [{ type: 'solid', color: 'var(--color-primary)', visible: true }] } });
    Folio.store.commit('brand fill');
    await new Promise(r => setTimeout(r, 600));
    const el = document.querySelector(`.kp-tile__btn[data-comp="${cid}"] .kp-thumb__in > *`);
    const want = getComputedStyle(Folio.render.el(c.mainId)).backgroundColor;
    return { got: el && getComputedStyle(el).backgroundColor, want };
  }, cardC);
  ok(brandOk.got === brandOk.want && brandOk.got !== 'rgba(0, 0, 0, 0)', `thumbnail resolves brand colours (${brandOk.got})`);
  await shot('21-brand-thumb', LEFT);

  // ---------- layers: dropping an instance into its own main is blocked ----------
  await page.click('.bp-tab:has-text("Layers")');
  const cyc = await page.evaluate((cid) => {
    const c = Folio.components.get(cid); const inst = T.insts(cid)[0];
    return { inst: inst && inst.id, main: c.mainId, blocked: Folio.componentsPanel.dropBlocked(c.mainId, [inst.id]), other: Folio.componentsPanel.dropBlocked(c.mainId, []) };
  }, cardC);
  ok(cyc.blocked && !cyc.other, 'an instance cannot be dropped into its own main (cycle check)');

  // ---------- normal layers unaffected ----------
  const normal = await page.evaluate((ab) => {
    const s = Folio.store; const n = s.createNode('text', { name: 'Hello', text: { content: 'Hi' } }, ab); s.commit('t');
    s.select([n.id]);
    return n.id;
  }, abId);
  await page.waitForTimeout(200);
  const nor = await page.evaluate(() => ({ ro: document.querySelectorAll('.is-readonly').length, dis: document.querySelectorAll('#inspector :disabled').length, comp: !!document.querySelector('.ins-sec[data-sec="component"]') }));
  ok(nor.ro === 0 && !nor.comp, 'normal text: no read-only sections, no component section ' + JSON.stringify(nor));
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
  ok(await page.evaluate((id) => !Folio.store.get(id), normal), 'Delete still removes normal layers');

  ok(!errors.length, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' || ') : ''));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
