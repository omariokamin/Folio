// Logo tools in the real index.html. node .dev/logo/test.js   (needs a server on 8142)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const H2I = path.join(__dirname, '../aitest/vendor/package/dist/html-to-image.js');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++; };

const WORDMARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 236 64"><text x="0" y="50" font-family="Archivo" font-weight="800" font-size="60" letter-spacing="-2" fill="#111111">halden</text><rect x="203" y="4" width="14" height="14" rx="7" fill="#111111"/></svg>`;
const MONOGRAM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><path d="M0 0h20v96H0zM76 0h20v96H76z" fill="#111111"/><path fill-rule="evenodd" d="M48 26a22 22 0 1 1 0 44a22 22 0 1 1 0-44zm0 12a10 10 0 1 0 0 20a10 10 0 1 0 0-20z" fill="#111111"/><path d="M20 42h8v12h-8zM68 42h8v12h-8z" fill="#111111"/></svg>`;
const COMBO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 72"><path d="M0 0h16v72H0zM48 0h16v72H48zM16 28h32v16H16z" fill="#1f4d3a"/><text x="84" y="54" font-family="Fraunces" font-weight="600" font-size="56" letter-spacing="-1.5" fill="#111111">Halden</text></svg>`;
const HOSTILE = `<svg onload="alert(1)" width="40" height="20"><script>alert(1)</script><style>rect{fill:red}</style><image href="https://evil.example/x.png" width="10" height="10"/><rect width="40" height="20" fill="url(https://evil.example/a)" style="fill:red" onclick="alert(2)"/><foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject><a href="javascript:alert(1)"><circle cx="10" cy="10" r="6" fill="#111"/></a><use href="https://evil.example/s.svg#x"/></svg>`;

(async () => {
  const launch = {};
  if (process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' };
  const browser = await chromium.launch(launch);
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true })).newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
  page.on('dialog', (d) => { logs.push('DIALOG ' + d.message()); d.dismiss(); });
  await page.route(/^https:\/\/(cdn\.jsdelivr\.net|esm\.sh)\//, (route) => {
    if (/html-to-image/.test(route.request().url())) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(H2I, 'utf8') });
    return route.abort();
  });
  await page.route(/evil\.example/, (r) => { logs.push('FETCHED ' + r.request().url()); r.abort(); });
  await page.goto('http://localhost:8142/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready') && window.Folio && Folio.aiTools);
  const realSvg = await page.evaluate(() => !!(Folio.svg && !Folio.svg.stub));
  if (!realSvg) await page.addScriptTag({ path: path.join(__dirname, 'svg-stub.js') });
  console.log('Folio.svg:', realSvg ? 'REAL src/svg.js' : 'stub');
  await page.evaluate(() => Folio.store.newDoc());
  const call = async (name, input, shot) => {
    const r = await page.evaluate(async ([n, i]) => Folio.aiTools.execute(n, i), [name, input]);
    if (Array.isArray(r.content)) {
      const img = r.content.find((b) => b.type === 'image');
      if (img && shot) fs.writeFileSync(path.join(OUT, shot + '.png'), Buffer.from(img.source.data, 'base64'));
      r.content = r.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
    }
    try { r.json = JSON.parse(r.content); } catch (e) { r.json = null; }
    return r;
  };

  // --- bad inputs never throw
  for (const [inp, m] of [[{}, 'empty'], [{ name: 'X' }, 'no svg'], [{ name: 'X', svg: 'hello' }, 'not svg'], [{ name: 'X', svg: '<svg>' + 'x'.repeat(210000) + '</svg>' }, 'too big'], [{ svg: WORDMARK }, 'no name'], [{ name: 'X', svg: '<svg><path d="M0 0" </svg>' }, 'broken xml']]) {
    const r = await call('draft_logo', inp);
    ok(r.isError && typeof r.content === 'string', `draft_logo ${m} → error: ${r.content.slice(0, 110)}`);
  }
  ok(!(await page.evaluate(() => Folio.store.doc.roots.length)), 'bad inputs created nothing');

  // --- three concepts
  const a = await call('draft_logo', { name: 'Lowercase wordmark', svg: WORDMARK, concept: 'A heavy lowercase name whose dot is a hub, set tight so it holds at 16 px.' });
  ok(!a.isError && a.json.card && a.json.image, `wordmark drafted: ${a.content.slice(0, 260)}`);
  const b = await call('draft_logo', { name: 'Hub monogram', svg: MONOGRAM, concept: 'Two stems joined by a wheel hub instead of a crossbar.' });
  ok(!b.isError, `monogram drafted ${b.summary}`);
  const c = await call('draft_logo', { name: 'Frame + name', svg: COMBO, concept: 'A square H like a bike frame, next to the name in a confident serif.' });
  ok(!c.isError, `combination drafted ${c.summary}`);
  const boardId = a.json.artboard.split(' ')[0];
  ok(!a.isError && /Logos/.test(a.json.page || ''), 'drafts go on the Logos page: ' + a.json.page);
  await call('manage_pages', { action: 'switch', page_id: 'Logos' }); // v0.6: measure on the page the drafts live on
  let info = await page.evaluate((id) => { const n = Folio.store.get(id); return { kids: n.children.map((k) => Folio.store.get(k).name), roots: Folio.store.doc.roots.length, w: n.width }; }, boardId);
  ok(info.roots === 1 && info.kids.length === 3, 'one Logo concepts artboard with 3 cards: ' + info.kids.join(', '));
  const sizes = await page.evaluate((id) => Folio.store.get(id).children.map((k) => Folio.aiTools.renderedSize(k).join('×')), boardId);
  ok(new Set(sizes).size === 1, 'cards are the same size: ' + sizes.join(', '));
  const rects = await page.evaluate((id) => Folio.store.get(id).children.map((k) => Folio.canvas.nodeRect(k)).map((r) => Math.round(r.y)), boardId);
  ok(new Set(rects).size === 1, 'cards sit side by side in one row');

  // replacing by name keeps the slot
  const b2 = await call('draft_logo', { name: 'hub monogram', svg: MONOGRAM.replace('h8v12h-8z', 'h8v12h-8z'), concept: 'Two stems joined by a wheel hub instead of a crossbar (redrawn).' });
  info = await page.evaluate((id) => Folio.store.get(id).children.map((k) => Folio.store.get(k).name), boardId);
  ok(!b2.isError && b2.json.replaced && info.length === 3 && info[1] === 'Concept / hub monogram', 'same name replaces that card in place: ' + info.join(', '));

  await page.waitForTimeout(800);
  const shot = await call('screenshot', { node_id: boardId }, 'concepts');
  ok(!shot.isError, 'screenshot ' + shot.content);
  await call('screenshot', { node_id: a.json.card }, 'card-wordmark');

  // --- hostile svg
  const h = await call('draft_logo', { name: 'Hostile', svg: HOSTILE, concept: 'test' });
  ok(!h.isError, 'hostile draft accepted after sanitizing; warnings: ' + JSON.stringify(h.json && h.json.warnings).slice(0, 300));
  const src = await page.evaluate((id) => decodeURIComponent(Folio.store.get(id).image.src.split(',')[1]), h.json.image);
  ok(!/script|onload|onclick|foreignObject|evil|javascript|<style|style=|<image/i.test(src), 'hostile markup stripped: ' + src.slice(0, 200));
  ok(/viewBox/.test(src), 'viewBox added from width/height');
  await call('delete_nodes', { ids: [h.json.card] });

  // --- save_logo
  let r = await call('save_logo', { name: 'Halden' });
  ok(r.isError, 'save_logo without node_id/svg → error: ' + r.content.slice(0, 100));
  r = await call('save_logo', { node_id: 'n_nope', name: 'Halden' });
  ok(r.isError, 'save_logo unknown node → error');
  r = await call('save_logo', { node_id: c.json.card, name: 'Halden', symbol_svg: MONOGRAM });
  ok(!r.isError && r.json.logos['on-light'] && r.json.logos['on-dark'] && r.json.logos.mono && r.json.logos.symbol, 'save_logo → ' + r.content.slice(0, 400));
  ok(r.json && r.json.createdKit, 'no active kit → minimal kit created and reported');
  const kit = await page.evaluate(() => Folio.brand.active());
  ok(kit && kit.logos.length === 4, `brand kit ${kit && kit.name} has ${kit && kit.logos.length} logos: ${kit && kit.logos.map((l) => l.name + (l.version ? ' [' + l.version + ']' : '')).join(', ')}`);
  ok(kit && kit.logos.every((l) => l.version && l.group), 'logos carry version + group (needs the svg/brand agent\'s brand.js)');
  const mono = await page.evaluate((t) => { const id = t.split(':')[1]; return decodeURIComponent(Folio.brand.active().logos.find((l) => l.id === id).src.split(',')[1]); }, r.json.logos.mono);
  ok(!/#1f4d3a/i.test(mono), 'mono version has no green');
  const dark = await page.evaluate((t) => { const id = t.split(':')[1]; return decodeURIComponent(Folio.brand.active().logos.find((l) => l.id === id).src.split(',')[1]); }, r.json.logos['on-dark']);
  ok(/#ffffff/i.test(dark) && !/#111111/i.test(dark), 'on-dark turns the black ink white');

  // place the versions with brand-logo:<id>
  const L = r.json.logos;
  const place = await call('create_nodes', { parent_id: null, nodes: [{ type: 'frame', name: 'Logo use', width: 900, layout: { direction: 'row', gap: 0 }, children: [
    { type: 'frame', name: 'Light', width: 300, height: 200, layout: { justify: 'center', align: 'center' }, style: { fills: [{ type: 'solid', color: '#ffffff' }] }, children: [{ type: 'image', name: 'Logo', width: 220, image: { src: L['on-light'], fit: 'contain' } }] },
    { type: 'frame', name: 'Dark', width: 300, height: 200, layout: { justify: 'center', align: 'center' }, style: { fills: [{ type: 'solid', color: '#16181d' }] }, children: [{ type: 'image', name: 'Logo', width: 220, image: { src: L['on-dark'], fit: 'contain' } }] },
    { type: 'frame', name: 'Mono', width: 300, height: 200, layout: { direction: 'row', gap: 24, justify: 'center', align: 'center' }, style: { fills: [{ type: 'solid', color: '#e9e8e4' }] }, children: [{ type: 'image', name: 'Logo', width: 150, image: { src: L.mono, fit: 'contain' } }, { type: 'image', name: 'Symbol', width: 48, image: { src: L.symbol, fit: 'contain' } }] },
  ] }] });
  ok(!place.isError, 'placed brand-logo images ' + (place.json && JSON.stringify(place.json.warnings || '')));
  const loaded = await page.evaluate(async () => {
    await new Promise((res) => setTimeout(res, 500));
    return [...document.querySelectorAll('#canvas-world img')].filter((i) => /svg/.test(i.src)).map((i) => i.complete && i.naturalWidth > 0);
  });
  ok(loaded.length >= 4 && loaded.every(Boolean), `brand-logo images render (${loaded.length} loaded)`);
  await call('screenshot', { node_id: place.json.artboards[0].split(' ')[0] }, 'logo-use');

  // save by svg with an active kit (no new kit), and set_brand data: refusal points to save_logo
  r = await call('save_logo', { svg: WORDMARK, name: 'Halden wordmark' });
  ok(!r.isError && !r.json.createdKit && Object.keys(r.json.logos).length === 3, 'save_logo svg into the active kit: ' + Object.keys((r.json && r.json.logos) || {}).join(','));
  const fr = await call('create_nodes', { parent_id: null, nodes: [{ type: 'frame', name: 'Frame logo', layout: { direction: 'row', gap: 12, align: 'center', padding: 8 }, style: { fills: [] }, children: [{ type: 'frame', name: 'Dot', width: 40, height: 40, style: { radius: 9999, fills: [{ type: 'solid', color: '#1f4d3a' }] } }, { type: 'text', name: 'Name', text: { content: 'Halden', font: 'DM Sans', size: 36, weight: 700 } }] }] });
  r = await call('save_logo', { node_id: fr.json.artboards[0].split(' ')[0], name: 'Frame logo' });
  ok(!r.isError && Object.keys(r.json.logos).length === 3, 'save_logo from a Folio frame (fromNode): ' + r.content.slice(0, 160));
  r = await call('save_logo', { node_id: fr.json.artboards[0].split(' ')[0], name: 'X', symbol_svg: '<div>nope</div>' });
  ok(!r.isError && /symbol was skipped/.test(r.content), 'bad symbol_svg is skipped with a warning');
  r = await call('set_brand', { patch: { logos: [{ name: 'x', src: 'data:image/svg+xml,<svg/>' }] } });
  ok(/save_logo/.test(r.content), 'set_brand data: URL → points to save_logo: ' + r.content.slice(0, 200));

  console.log(logs.length ? logs.join('\n') : '(no page errors)');
  ok(!logs.some((l) => /DIALOG|FETCHED|pageerror/.test(l)), 'no dialogs, no hostile fetches, no page errors');
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL OK');
  process.exit(fails ? 1 : 0);
})();
