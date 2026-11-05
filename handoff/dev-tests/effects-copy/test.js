/* Glass & gradients (v0.9) — node .dev/effects/test.js   (serve the worktree on :8191) */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const H2I = '/home/user/folio/.dev/aitest/vendor/package/dist/html-to-image.js';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const saveUrl = (name, d) => fs.writeFileSync(path.join(OUT, name), Buffer.from(d.split(',')[1], 'base64'));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_|inlining remote css|remote stylesheet|CSS rules/.test(m.text()) && errors.push(m.text()));
  await page.route('https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(H2I, 'utf8') }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('http://localhost:8191/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  const ev = (fn, a) => page.evaluate(fn, a);

  // ---------- artboard with two cards ----------
  const ids = await ev(() => {
    const S = Folio.store;
    const card = (name, x) => ({
      type: 'frame', name, x, y: 140, width: 340, height: 260, layout: { mode: 'flex', direction: 'column', gap: 10, padding: [28, 28, 28, 28] },
      style: { fills: [{ type: 'solid', color: '#ffffff' }] },
      children: [
        { type: 'text', name: 'Eyebrow', text: { content: 'MEMBERSHIP', size: 12, weight: 600, letterSpacing: 0.12, color: '#ffffffcc' } },
        { type: 'text', name: 'Title', sizing: { w: 'fill', h: 'hug' }, text: { content: 'Studio Pass', size: 34, weight: 700, color: '#ffffff', lineHeight: 1.1 } },
        { type: 'text', name: 'Body', sizing: { w: 'fill', h: 'hug' }, text: { content: 'Unlimited classes, guest passes and early booking for every season.', size: 15, color: '#ffffffd9', lineHeight: 1.45 } },
      ],
    });
    const ab = S.buildFromTree({ type: 'frame', name: 'Glass test', x: 0, y: 0, width: 860, height: 540, layout: { mode: 'none' }, style: { fills: [{ type: 'solid', color: '#222222' }] }, children: [card('Card A', 60), card('Card B', 460)] });
    S.commit('setup');
    return { ab: ab.id, a: ab.children[0], b: ab.children[1] };
  });

  // ---------- mesh preset via the fill section ----------
  await ev((id) => Folio.store.select([id]), ids.ab);
  await page.waitForTimeout(100);
  await page.click('[data-sec="fill"] button[title="Mesh gradient presets"]');
  const names = await page.$$eval('.ins-mesh-presets .ins-mesh-preset span', (s) => s.map((x) => x.textContent));
  ok(['Aurora', 'Dusk', 'Lagoon', 'Ember', 'Chrome'].every((n) => names.includes(n)) && names.length === 10 && new Set(names).size === 10, 'ten distinct mesh presets incl. the new five', names);
  await page.click('.ins-mesh-presets .ins-mesh-preset[title^="Aurora"]');
  let fills = await ev((id) => Folio.store.get(id).style.fills, ids.ab);
  ok(fills.length === 2 && fills[1].type === 'mesh' && fills[1].base === '#03111a' && fills[1].spread === 52, 'Aurora mesh added on top with its own spread', fills[1]);

  // + grain toggle
  const grain = '[data-sec="fill"] .ins-grain';
  await page.waitForTimeout(150);
  ok((await page.$$(grain)).length === 1, 'one "+ grain" toggle (mesh row only)');
  await page.click(grain);
  fills = await ev((id) => Folio.store.get(id).style.fills, ids.ab);
  ok(fills.length === 3 && fills[2].type === 'noise' && fills[2].opacity === 0.12, 'grain adds a noise fill right above the mesh', fills.map((f) => f.type));
  await page.waitForTimeout(100);
  ok((await page.getAttribute(grain, 'aria-pressed')) === 'true', 'toggle shows pressed');
  await page.click(grain);
  fills = await ev((id) => Folio.store.get(id).style.fills, ids.ab);
  ok(fills.length === 2 && fills[1].type === 'mesh', 'grain off removes it', fills.map((f) => f.type));
  await page.click(grain);
  // applying another preset in the editor keeps the grain and switches spread
  if (!(await page.$('.ins-editor .ins-mesh-preset'))) await page.click('.ins-fill:has(.ins-grain) .ins-swatch');
  await page.click('.ins-editor .ins-mesh-preset[title^="Ember"]');
  fills = await ev((id) => Folio.store.get(id).style.fills, ids.ab);
  ok(fills[1].base === '#170705' && fills[1].spread === 52 && fills[2].type === 'noise', 'Ember applied in the editor, grain kept', fills.map((f) => f.type + ':' + (f.base || '')));

  // ---------- liquid glass on a multi-selection ----------
  const undoDepth = () => ev(() => (Folio.store.history ? Folio.store.history.length : null));
  await ev((x) => Folio.store.select([x.a, x.b]), ids);
  await page.waitForTimeout(100);
  const effHead = '[data-sec="effects"] .ins-sec__title';
  if (await page.$('[data-sec="effects"].is-collapsed')) await page.click(effHead);
  await page.click('.ins-glass__btn:has-text("Liquid glass")');
  const st = await ev((x) => [x.a, x.b].map((id) => Folio.store.get(id).style), ids);
  const want = {
    fills: [{ type: 'linear', angle: 160, stops: [{ color: '#ffffff47', pos: 0 }, { color: '#ffffff14', pos: 100 }], visible: true }],
    backdropBlur: 24, backdropSaturate: 180, border: { width: 1, color: '#ffffff59', style: 'solid' }, radius: 24,
  };
  st.forEach((s, i) => {
    ok(JSON.stringify(s.fills) === JSON.stringify(want.fills) && s.backdropBlur === 24 && s.backdropSaturate === 180 && JSON.stringify(s.border) === JSON.stringify(want.border) && s.radius === 24 && s.shadows.length === 3, `card ${i} has the glass style`, s);
  });
  const css = await ev((id) => Folio.css.nodeStyles(Folio.store.get(id), { mode: 'export' }), ids.a);
  ok(css['backdrop-filter'] === 'blur(24px) saturate(180%)' && css['-webkit-backdrop-filter'] === css['backdrop-filter'], 'CSS backdrop-filter + -webkit-', css['backdrop-filter']);
  ok(css['box-shadow'] === 'inset 0px 1px 0px 0px #ffffff80, inset 0px -1px 0px 0px #ffffff1a, 0px 8px 32px -8px #0f172a2e', 'box-shadow', css['box-shadow']);
  const preview = await page.textContent('.ins-code');
  ok(/backdrop-filter: blur\(24px\) saturate\(180%\);/.test(preview) && /-webkit-backdrop-filter/.test(preview), 'CSS preview shows it');
  ok((await ev((id) => getComputedStyle(Folio.render.el(id)).backdropFilter, ids.a)).includes('saturate'), 'canvas renders backdrop-filter');
  // one undo step
  await ev(() => Folio.store.undo());
  const back = await ev((x) => [x.a, x.b].map((id) => Folio.store.get(id).style), ids);
  ok(back.every((s) => s.backdropBlur === 0 && s.backdropSaturate === 100 && s.fills[0].type === 'solid' && !s.shadows.length), 'one undo reverts both cards', back.map((s) => s.backdropBlur));
  await ev(() => Folio.store.redo());
  ok(await ev((x) => Folio.store.get(x.b).style.backdropSaturate === 180, ids), 'redo re-applies');
  // dark variant
  await ev((x) => Folio.store.select([x.b]), ids);
  await page.waitForTimeout(100);
  await page.click('.ins-glass__btn:has-text("Dark glass")');
  ok(await ev((x) => Folio.store.get(x.b).style.fills[0].stops.map((s) => s.color).join() === '#ffffff1f,#ffffff0a', ids), 'Dark glass: white 12% -> 4%');
  await ev(() => Folio.store.undo());
  // text selection: no glass buttons; selection with a text: text untouched
  const textId = await ev((x) => Folio.store.get(x.a).children[1], ids);
  await ev((t) => Folio.store.select([t]), textId);
  await page.waitForTimeout(100);
  ok(!(await page.$('.ins-glass__btn')), 'no glass preset for a text layer');
  // backdrop saturate field
  await ev((x) => Folio.store.select([x.a]), ids);
  await page.waitForTimeout(100);
  const sat = await page.inputValue('[data-k="bsat"]');
  ok(sat === '180', 'Backdrop sat. field shows 180', sat);

  // brand radius-lg
  const brandR = await ev((x) => {
    const B = Folio.brand;
    if (!B || !B.create) return 'no brand';
    const b = B.create((B.templates && B.templates()[0] && B.templates()[0].id) || {});
    B.update(b.id, { style: Object.assign({}, b.style, { radius: { sm: 4, md: 10, lg: 28 } }) });
    B.setActive(b.id);
    return b.id;
  }, ids);
  await page.waitForTimeout(200);
  await ev((x) => Folio.store.select([x.a]), ids);
  await page.waitForTimeout(100);
  await page.click('.ins-glass__btn:has-text("Liquid glass")');
  ok(await ev((x) => Folio.store.get(x.a).style.radius === 'var(--radius-lg)', ids), 'with a brand, radius links radius-lg', brandR);
  await ev(() => Folio.store.undo());
  await ev(() => Folio.brand.setActive(null));

  // ---------- export page, PNG ----------
  const html = await ev((id) => Folio.exporter.pageFor(id), ids.ab);
  ok(/backdrop-filter: blur\(24px\) saturate\(180%\)/.test(html) && /-webkit-backdrop-filter: blur\(24px\) saturate\(180%\)/.test(html), 'export page has both declarations');
  fs.writeFileSync(path.join(OUT, 'export.html'), html);
  const p2 = await ctx.newPage();
  await p2.setViewportSize({ width: 860, height: 540 });
  await p2.setContent(html);
  await p2.screenshot({ path: path.join(OUT, 'export-page.png') });
  await p2.close();
  const png = await ev((id) => Folio.exporter.pngDataUrl(id, { scale: 1 }), ids.ab);
  saveUrl('export-png.png', png);
  // blur check: variance inside the card vs. the bare mesh at the same spot (rendered from the PNG)
  const blurred = await ev(async (src) => {
    const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const px = (X, Y) => Array.from(x.getImageData(X, Y, 1, 1).data.slice(0, 3));
    return { inCard: px(380, 380), outside: px(30, 30) };
  }, png);
  ok(blurred.inCard.join() !== blurred.outside.join(), 'PNG rendered something in the card', blurred);

  // ---------- import round trip ----------
  const rt = await ev(async (id) => {
    const res = await Folio.importer.fromHtml(Folio.exporter.pageFor(id), { selector: 'body > :first-child', width: 860, name: 'RT' });
    Folio.store.commit('import');
    const walk = (nid, acc = []) => { const n = Folio.store.get(nid); acc.push(n); n.children.forEach((c) => walk(c, acc)); return acc; };
    return walk(res.rootId).filter((n) => n.style.backdropBlur).map((n) => [n.name, n.style.backdropBlur, n.style.backdropSaturate]);
  }, ids.ab);
  ok(rt.length === 2 && rt.every((r) => r[1] === 24 && r[2] === 180), 'import keeps backdropBlur 24 + backdropSaturate 180', rt);
  const rt2 = await ev(async () => {
    const res = await Folio.importer.fromHtml('<div style="width:200px;height:100px;backdrop-filter:saturate(1.5);background:#fff3"></div><div style="width:200px;height:100px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)"></div>', { width: 400 });
    Folio.store.commit('import');
    const kids = Folio.store.get(res.rootId).children.map((c) => Folio.store.get(c).style);
    return kids.map((s) => [s.backdropBlur, s.backdropSaturate]);
  });
  ok(rt2[0][1] === 150 && rt2[1][0] === 8 && rt2[1][1] === 100, 'import: saturate(1.5) -> 150, blur only -> default 100', rt2);

  // ---------- AI update_nodes ----------
  const ai = await ev(async (id) => {
    const r1 = await Folio.aiTools.execute('update_nodes', { updates: [{ id, patch: { style: { backdropSaturate: 999 } } }] });
    const a = Folio.store.get(id).style.backdropSaturate;
    const r2 = await Folio.aiTools.execute('update_nodes', { updates: [{ id, patch: { style: { backdropSaturate: 'saturate(160%)' } } }] });
    const b = Folio.store.get(id).style.backdropSaturate;
    const r3 = await Folio.aiTools.execute('update_nodes', { updates: [{ id, patch: { backdropSaturate: '140%' } }] });
    const c = Folio.store.get(id).style.backdropSaturate;
    const doc = await Folio.aiTools.execute('get_tree', { id, depth: 1 }).catch(() => null);
    return { a, b, c, warn1: JSON.stringify(r1.content).slice(0, 300), err: [r1.isError, r2.isError, r3.isError], doc: doc ? JSON.stringify(doc.content).includes('backdropSaturate') : null };
  }, ids.a);
  ok(ai.a === 400 && /clamped/.test(ai.warn1), 'AI: 999 clamps to 400 with a warning', ai);
  ok(ai.b === 160 && ai.c === 140, 'AI: "saturate(160%)" and hoisted "140%" accepted', ai);

  // ---------- design screenshots: glass over each new mesh ----------
  const shotCtx = await browser.newContext({ viewport: { width: 860, height: 540 }, deviceScaleFactor: 2 });
  const sp = await shotCtx.newPage();
  for (const name of ['Aurora', 'Dusk', 'Lagoon', 'Ember', 'Chrome']) {
    const h2 = await ev(([x, name]) => {
      const S = Folio.store;
      const pr = Folio.inspector.meshPresets.find((p) => p.name === name);
      const pos = [{ x: 12, y: 18 }, { x: 88, y: 12 }, { x: 82, y: 88 }, { x: 18, y: 82 }];
      S.update(x.ab, { style: { fills: [{ type: 'mesh', base: pr.base, spread: pr.spread, points: pr.points.map((c, i) => ({ color: c, ...pos[i] })), visible: true }, { type: 'noise', opacity: 0.12, visible: true }] } });
      const light = name === 'Lagoon' || name === 'Chrome';
      [x.a, x.b].forEach((id, k) => S.get(id).children.forEach((c, j) => S.update(c, { text: { color: light ? ['#0f2a33b3', '#0f2a33', '#0f2a33cc'][j] : ['#ffffffcc', '#ffffff', '#ffffffd9'][j] } })));
      return Folio.exporter.pageFor(x.ab);
    }, [ids, name]);
    await sp.setContent(h2);
    await sp.screenshot({ path: path.join(OUT, `glass-${name.toLowerCase()}.png`) });
  }
  await shotCtx.close();
  // inspector UI screenshot
  await ev((x) => Folio.store.select([x.ab]), ids);
  await page.waitForTimeout(150);
  await page.click('[data-sec="fill"] button[title="Mesh gradient presets"]');
  await page.waitForTimeout(100);
  await (await page.$('[data-sec="fill"]')).screenshot({ path: path.join(OUT, 'ui-fill.png') });
  await ev((x) => Folio.store.select([x.a]), ids);
  await page.waitForTimeout(150);
  await (await page.$('[data-sec="effects"]')).screenshot({ path: path.join(OUT, 'ui-effects.png') });

  ok(!errors.length, 'no page errors', errors);
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
