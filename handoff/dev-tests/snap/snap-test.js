// Smart guides UI test in the real app: node .dev/snap/snap-test.js  (serve /home/user/folio on :8181)
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = '/home/user/folio/.dev/snap/out';
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const ok = (c, msg, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + msg + (extra === undefined ? '' : ' ' + JSON.stringify(extra).slice(0, 300))); if (!c) failures++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const boot = async () => { await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready')); await page.waitForTimeout(300); };
  await page.goto('http://localhost:8181/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await boot();
  const ev = (fn, a) => page.evaluate(fn, a);
  const raf = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  // ---------- scene ----------
  const scene = async () => { const ids = await scene0(); await raf(); await raf(); return ids; }; // let the auto zoom-to-fit after newDoc run first
  const scene0 = () => ev(() => {
    const s = Folio.store;
    s.newDoc();
    const fill = (c) => ({ fills: [{ type: 'solid', color: c, visible: true }] });
    const A = s.createNode('frame', { name: 'Artboard A', x: 0, y: 0, width: 1000, height: 800, style: fill('#ffffff') });
    const mk = (name, x, y, w, h, parent, extra) => s.createNode('frame', { name, x, y, width: w, height: h, style: fill('#88a'), ...(extra || {}) }, parent).id;
    const ids = { A: A.id };
    ids.r1 = mk('R1', 100, 100, 200, 100, A.id);
    ids.r2 = mk('R2', 160, 260, 120, 80, A.id);
    ids.rot = mk('Rot', 850, 650, 100, 100, A.id, { style: { ...fill('#a88'), rotation: 45 } });
    ids.F = s.createNode('frame', { name: 'Frame Flex', x: 500, y: 500, width: 400, height: 140, layout: { mode: 'flex', direction: 'row', gap: 10, padding: [10, 10, 10, 10] }, style: fill('#eee') }, A.id).id;
    ids.c1 = mk('C1', 0, 0, 120, 120, ids.F);
    ids.c2 = mk('C2', 0, 0, 120, 120, ids.F);
    ids.c3 = mk('C3', 0, 0, 120, 120, ids.F);
    ids.B = s.createNode('frame', { name: 'Artboard B', x: 1100, y: 450, width: 400, height: 300, style: fill('#ffffff') }).id;
    s.select([]);
    s.commit('scene');
    Folio.render.rerender();
    return ids;
  });
  const view = (z, wx, wy) => ev(([z, wx, wy]) => {
    const c = Folio.canvas;
    c.setZoom(z);
    const vp = document.getElementById('canvas-viewport');
    Folio.store.setViewport({ x: vp.clientWidth / 2 - wx * z, y: vp.clientHeight / 2 - wy * z });
  }, [z, wx, wy]);
  const client = (wx, wy) => ev(([wx, wy]) => {
    const r = document.getElementById('canvas-viewport').getBoundingClientRect();
    const p = Folio.canvas.worldToScreen(wx, wy);
    return { x: r.left + p.x, y: r.top + p.y };
  }, [wx, wy]);
  const node = (id) => ev((id) => { const n = Folio.store.get(id); return { x: n.x, y: n.y, width: n.width, height: n.height, parent: n.parent }; }, id);
  const rect = (id) => ev((id) => Folio.canvas.nodeRect(id), id);
  // drag from world point a by world delta (dx,dy); opts.meta presses ⌘ mid-drag, opts.mid(…) runs before release
  async function drag(a, dx, dy, opts = {}) {
    const z = await ev(() => Folio.store.viewport.zoom);
    await view(z, a.x + dx / 2, a.y + dy / 2); // keep the whole gesture on screen
    await raf();
    const p = await client(a.x, a.y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 5, p.y + 5, { steps: 2 });
    if (opts.meta) await page.keyboard.down('Meta');
    if (opts.shift) await page.keyboard.down('Shift');
    await page.mouse.move(p.x + dx * z, p.y + dy * z, { steps: 8 });
    await raf();
    if (opts.mid) await opts.mid();
    await page.mouse.up();
    if (opts.meta) await page.keyboard.up('Meta');
    if (opts.shift) await page.keyboard.up('Shift');
    await raf();
  }
  const centre = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  const guidesNow = () => ev(() => ({
    lines: [...document.querySelectorAll('.f-ov-snap')].filter((e) => e.style.display !== 'none').length,
    pills: [...document.querySelectorAll('.f-ov-pill')].filter((e) => e.style.display !== 'none').map((e) => e.textContent),
    data: Folio.overlay.guides.snap,
  }));

  for (const z of [0.25, 1, 3]) {
    const off = 3 / z; // half the 6px threshold, in world units
    let ids = await scene();
    await view(z, 250, 250);
    await raf();
    const T = `@${z * 100}%`;

    // move: left edge to R1's left
    let r2 = await rect(ids.r2);
    await ev((id) => Folio.store.select([id]), ids.r2);
    const h0 = await ev(() => Folio.store.historyIndex);
    await drag(centre(r2), 100 + off - 160, 0);
    let n = await node(ids.r2);
    ok(n.x === 100 && n.y === 260, `${T} move snaps left edge to sibling's left edge`, n);
    ok((await ev(() => Folio.store.historyIndex)) === h0 + 1, `${T} one undo step per move`);
    ok((await guidesNow()).lines === 0, `${T} guides gone after pointerup`);

    // move: centre to R1's centre (x 200) — screenshot mid-gesture at 100%
    r2 = await rect(ids.r2);
    let mid = null;
    await drag(centre(r2), 200 + off - (n.x + 60), 0, {
      mid: async () => {
        mid = await guidesNow();
        if (z === 1) await page.screenshot({ path: `${OUT}/mid-centre-100.png` });
      },
    });
    n = await node(ids.r2);
    ok(n.x === 140, `${T} move snaps centre to sibling centre`, n);
    ok(mid && mid.lines >= 1, `${T} guide line visible mid-drag`, mid && { lines: mid.lines, pills: mid.pills });

    // move: bottom edge to R1's bottom (200), x kept clear of candidates
    r2 = await rect(ids.r2);
    await drag(centre(r2), 340 - n.x, 200 - off / 3 - 340, { // small offset: R1's centre (150) is also near r2's centre
      mid: async () => {
        mid = await guidesNow();
        if (z === 1) await page.screenshot({ path: `${OUT}/mid-bottom-100.png` });
      },
    });
    n = await node(ids.r2);
    ok(n.y === 120 && n.x === 340, `${T} move snaps bottom edge to sibling bottom`, n);
    ok(mid && mid.pills.includes('40'), `${T} distance pill shows 40px gap to R1`, mid && mid.pills);

    // ⌘ held → no snap
    r2 = await rect(ids.r2);
    await drag(centre(r2), 100 + off - n.x, 0, { meta: true });
    n = await node(ids.r2);
    ok(n.x !== 100 && Math.abs(n.x - (100 + off)) <= Math.max(1, 1 / z), `${T} ⌘ disables snapping`, n);

    // resize right edge to R1's right edge (300)
    ids = await scene();
    await view(z, 250, 250);
    await ev((id) => Folio.store.select([id]), ids.r2);
    await raf();
    let hb = await page.locator('.f-ov-handle[data-handle="e"]').boundingBox();
    const hcw = await ev(([x, y]) => { const r = document.getElementById('canvas-viewport').getBoundingClientRect(); return Folio.canvas.screenToWorld(x - r.left, y - r.top); }, [hb.x + hb.width / 2, hb.y + hb.height / 2]);
    await drag(hcw, 300 - off - 280, 0);
    n = await node(ids.r2);
    ok(n.x === 160 && n.width === 140 && n.height === 80, `${T} resize snaps the dragged edge`, n);

    // shift-resize corner: width snaps, height follows the ratio
    ids = await scene();
    await view(z, 250, 250);
    await ev((id) => Folio.store.select([id]), ids.r2);
    await raf();
    hb = await page.locator('.f-ov-handle[data-handle="se"]').boundingBox();
    const hcs = await ev(([x, y]) => { const r = document.getElementById('canvas-viewport').getBoundingClientRect(); return Folio.canvas.screenToWorld(x - r.left, y - r.top); }, [hb.x + hb.width / 2, hb.y + hb.height / 2]);
    await drag(hcs, 300 - off - 280, 0, { shift: true });
    n = await node(ids.r2);
    ok(n.width === 140 && n.height === 93, `${T} shift-resize keeps the ratio with a snapped edge`, n);

    // draw a rectangle: start + corner snap to R1's left/right
    await page.keyboard.press('r');
    await drag({ x: 100 + off, y: 450 }, 200 - 2 * off, 100);
    const drawn = await ev(() => { const n = Folio.store.primary(); return { x: n.x, y: n.y, width: n.width, height: n.height, name: n.name }; });
    ok(drawn.name === 'Rectangle' && drawn.x === 100 && drawn.width === 200, `${T} drawing snaps start point and corner`, drawn);

    // artboard to artboard
    let rb = await rect(ids.B);
    await ev((id) => Folio.store.select([id]), ids.B);
    await drag(centre(rb), 0, off - 50);
    n = await node(ids.B);
    ok(n.y === 400 && n.x === 1100 && !n.parent, `${T} artboard snaps to another artboard's centre`, n);

    // multi-select union box to the parent's inner left edge
    await ev((a) => Folio.store.select(a), [ids.r1, ids.r2]);
    const r1 = await rect(ids.r1);
    await drag(centre(r1), off - 100, 0);
    const m1 = await node(ids.r1);
    const m2 = await node(ids.r2);
    ok(m1.x === 0 && m2.x === 60, `${T} multi-selection snaps its union box`, { m1, m2 });

    // rotated layer snaps its bounding box
    let rr = await rect(ids.rot);
    await ev((id) => Folio.store.select([id]), ids.rot);
    await drag(centre(rr), 900 + off - rr.x, 0); // AABB left → the flex frame's right edge
    rr = await rect(ids.rot);
    ok(Math.abs(rr.x - 900) <= 0.5, `${T} rotated layer snaps its bounding box`, rr);

    // child of an auto-layout frame: no snap, reorder still works
    const c1 = await rect(ids.c1);
    const c2 = await rect(ids.c2);
    await ev((id) => Folio.store.select([id]), ids.c1);
    await drag(centre(c1), c2.x + c2.width / 2 + 15 - (c1.x + c1.width / 2), 0, { mid: async () => (mid = await guidesNow()) });
    const order = await ev((id) => Folio.store.get(id).children.map((c) => Folio.store.get(c).name).join(), ids.F);
    ok(order === 'C2,C1,C3' && mid.lines === 0 && !mid.data, `${T} flex child: reorders, no snapping`, { order, mid });
  }

  // ---------- toggle in the zoom menu, remembered after reload ----------
  let ids = await scene();
  await view(1, 250, 250);
  await page.click('.tb-zoom');
  await page.click('.f-menu__item:has-text("Snap to layers")');
  ok((await ev(() => localStorage.getItem('folio:snap'))) === '0', 'menu toggles snapping off (stored)');
  let r2 = await rect(ids.r2);
  await ev((id) => Folio.store.select([id]), ids.r2);
  await drag(centre(r2), 102 - 160, 0);
  let n = await node(ids.r2);
  ok(n.x === 102, 'toggle off → no snap', n);
  await page.reload();
  await boot();
  ok((await ev(() => Folio.canvas.snapEnabled())) === false, 'snap setting persists after reload');
  await page.click('.tb-zoom');
  ok(!(await page.locator('.f-menu__item:has-text("Snap to layers")').evaluate((e) => e.classList.contains('is-checked'))), 'menu item shows unchecked');
  await page.screenshot({ path: `${OUT}/menu.png`, clip: { x: 1000, y: 0, width: 440, height: 400 } });
  await page.click('.f-menu__item:has-text("Snap to layers")');
  ok((await ev(() => Folio.canvas.snapEnabled())) === true, 'menu toggles snapping back on');

  // ---------- performance: 500 siblings ----------
  const big = await ev(() => {
    const s = Folio.store;
    s.newDoc();
    const P = s.createNode('frame', { name: 'Perf', x: 0, y: 0, width: 2500, height: 2000 });
    for (let i = 0; i < 500; i++) s.createNode('frame', { name: 'R' + i, x: (i % 25) * 100, y: Math.floor(i / 25) * 100, width: 60, height: 60, style: { fills: [{ type: 'solid', color: '#99c', visible: true }] } }, P.id);
    s.commit('perf');
    Folio.render.rerender();
    return P.children[260];
  });
  await view(0.5, 1000, 1000);
  await raf();
  await ev(() => {
    window.__pm = [];
    window.__frames = [];
    let t0 = 0;
    window.addEventListener('pointermove', () => (t0 = performance.now()), { capture: true });
    window.addEventListener('pointermove', () => window.__pm.push(performance.now() - t0)); // runs after canvas.js's listener
    let last = performance.now();
    const tick = (t) => { window.__frames.push(t - last); last = t; if (window.__frames.length < 2000) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await ev((id) => Folio.store.select([id]), big);
  const br = await rect(big);
  const bp = await client(br.x + 30, br.y + 30);
  await page.mouse.move(bp.x, bp.y);
  await page.mouse.down();
  await ev(() => { window.__pm = []; window.__frames = []; });
  for (let i = 1; i <= 120; i++) await page.mouse.move(bp.x + i * 3, bp.y + i * 2);
  const perf = await ev(() => {
    const pm = window.__pm.slice().sort((a, b) => a - b);
    const fr = window.__frames.slice(1).sort((a, b) => a - b);
    return { moves: pm.length, median: pm[pm.length >> 1], p95: pm[Math.floor(pm.length * 0.95)], max: pm[pm.length - 1], frameMedian: fr[fr.length >> 1], frameP95: fr[Math.floor(fr.length * 0.95)] };
  });
  await page.screenshot({ path: `${OUT}/perf-mid.png` });
  await page.mouse.up();
  console.log('perf (ms per pointermove handler / frame interval):', JSON.stringify(perf));
  ok(perf.p95 < 8, 'drag over 500 siblings: p95 pointermove handler < 8ms', perf);

  ok(!errors.length, 'no page errors', errors);
  await browser.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})();
