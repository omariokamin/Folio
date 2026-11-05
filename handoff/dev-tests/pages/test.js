// AI pages tools in the real index.html. node .dev/pages/test.js   (needs a server on 8152)
// Uses the real store page API when present, else a SPEC-shaped stub (STUB=1 forces the stub).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const H2I = path.join(__dirname, '../aitest/vendor/package/dist/html-to-image.js');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++; };

function stub() {
  const st = Folio.store;
  let seq = 0;
  const fix = () => {
    const d = st.doc;
    if (!d.pages) { d.pages = [{ id: 'p_stub' + seq++, name: 'Page 1', roots: d.roots }]; d.page = d.pages[0].id; }
    const p = d.pages.find((x) => x.id === d.page) || d.pages[0];
    d.page = p.id; d.roots = p.roots;
  };
  const byId = (id) => (fix(), st.doc.pages.find((p) => p.id === id));
  Object.assign(st, {
    pages: () => (fix(), st.doc.pages),
    currentPage: () => byId(st.doc.page),
    pageOf(id) { fix(); const r = st.rootOf(id); return st.doc.pages.find((p) => p.roots.includes(r)) || null; },
    addPage(name, o = {}) {
      fix();
      const p = { id: 'p_stub' + seq++, name: name || 'Page ' + (st.doc.pages.length + 1), roots: [] };
      st.doc.pages.splice(o.index == null ? st.doc.pages.length : o.index, 0, p);
      if (o.activate) st.switchPage(p.id); else st.emit('change');
      return p;
    },
    renamePage(id, name) { byId(id).name = name; st.emit('change'); },
    removePage(id) {
      fix();
      if (st.doc.pages.length < 2) return false;
      const p = byId(id);
      st.withPage(id, () => st.remove(p.roots.slice()));
      const i = st.doc.pages.indexOf(p);
      st.doc.pages.splice(i, 1);
      if (st.doc.page === id) st.switchPage(st.doc.pages[Math.max(0, i - 1)].id); else st.emit('change');
      return true;
    },
    movePage(id, index) { const p = byId(id); const a = st.doc.pages; a.splice(a.indexOf(p), 1); a.splice(index, 0, p); st.emit('change'); },
    switchPage(id) { const p = byId(id); st.doc.page = p.id; st.doc.roots = p.roots; st.select([]); st.emit('page'); st.emit('change'); },
    moveToPage(ids, pageId) {
      const t = byId(pageId);
      ids.forEach((id) => { const s = st.pageOf(id); if (s) s.roots.splice(s.roots.indexOf(id), 1); t.roots.push(id); });
      st.emit('change');
    },
    withPage(pageId, fn) { fix(); const prev = st.doc.roots; st.doc.roots = byId(pageId).roots; try { return fn(); } finally { st.doc.roots = prev; } },
    ensurePage(name) { fix(); return st.doc.pages.find((p) => p.name === name) || st.addPage(name); },
  });
  return 'stub';
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !/fetch|stylesheet|cssRules|ERR_FAILED|font/i.test(m.text()) && logs.push('console ' + m.text()));
  await page.route(/^https:\/\/(cdn\.jsdelivr\.net|esm\.sh|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => {
    if (/html-to-image/.test(route.request().url())) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(H2I, 'utf8') });
    return route.abort();
  });
  await page.goto('http://localhost:8152/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready') && window.Folio && Folio.aiTools && Folio.components);
  await page.evaluate(() => Folio.store.newDoc());
  const mode = await page.evaluate(`(${process.env.STUB ? 'true' : 'false'} || typeof Folio.store.withPage !== 'function') ? (${stub})() : 'real'`);
  console.log('store page API:', mode);
  const call = async (name, input, shot) => {
    const r = await page.evaluate(async ([n, i]) => Folio.aiTools.execute(n, i), [name, input]);
    if (Array.isArray(r.content)) {
      const img = r.content.find((b) => b.type === 'image');
      r.image = img ? img.source.data.length : 0;
      if (img && shot) fs.writeFileSync(path.join(OUT, shot + '.png'), Buffer.from(img.source.data, 'base64'));
      r.content = r.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
    }
    try { r.json = JSON.parse(r.content); } catch (e) { r.json = null; }
    return r;
  };
  const cur = () => page.evaluate(() => Folio.store.currentPage().name);
  const pageOf = (id) => page.evaluate((i) => (Folio.store.pageOf(i) || {}).name, id);

  let r = await call('get_document', {});
  ok(!r.isError && r.json.pages.length === 1 && r.json.pages[0].current && r.json.pages[0].artboards === 0, 'get_document lists one current page: ' + JSON.stringify(r.json.pages));
  const p1 = r.json.pages[0].id;

  r = await call('create_nodes', { parent_id: null, nodes: [{ type: 'frame', name: 'Home', width: 1440, sizing: { h: 'hug' }, children: [{ type: 'text', name: 'Headline', text: { content: 'Home page', size: 64 } }] }] });
  const home = r.json.artboards[0].split(' ')[0];
  ok(!r.isError && !r.json.page, 'artboard on current page has no page note');

  // --- manage_pages: list / create / switch / rename / move / delete
  r = await call('manage_pages', { action: 'list' });
  ok(!r.isError && r.json.pages[0].artboards.length === 1 && /Home/.test(r.json.pages[0].artboards[0]), 'list shows artboards of every page: ' + r.content);
  r = await call('manage_pages', { action: 'create', name: '  Social  ' });
  ok(!r.isError && (await cur()) === 'Social', 'create switches to the new page: ' + r.json.done);
  const social = r.json.pages.find((p) => p.name === 'Social').id;
  r = await call('manage_pages', { action: 'create', name: 'social' });
  ok(r.isError && /already exists/.test(r.content), 'duplicate page name refused');
  r = await call('create_nodes', { parent_id: null, nodes: [{ type: 'frame', name: 'Post', width: 1080, height: 1080 }] });
  const post = r.json.artboards[0].split(' ')[0];
  ok((await pageOf(post)) === 'Social', 'create_nodes parent_id null lands on the current page');
  r = await call('manage_pages', { action: 'switch', page_id: 'page 1' });
  ok(!r.isError && (await cur()) === 'Page 1', 'switch by name (case-insensitive)');
  r = await call('manage_pages', { action: 'switch', page_id: p1 });
  ok(!r.isError && /already/.test(r.content), 'switch to current page says already there');
  r = await call('get_document', {});
  const soc = r.json.pages.find((p) => p.id === social);
  ok(r.json.artboards.length === 1 && Array.isArray(soc.artboards) && /Post/.test(soc.artboards[0]), 'get_document: current page in full, others summarised: ' + JSON.stringify(r.json.pages));
  const ctx = await page.evaluate(() => Folio.aiPrompt.contextFor());
  ok(/Pages \(2\)/.test(ctx) && /Artboards on this page \(1\)/.test(ctx), 'contextFor lists pages: ' + ctx.split('\n').slice(0, 3).join(' | '));

  // --- create_nodes page_id
  r = await call('create_nodes', { parent_id: null, page_id: social, nodes: [{ type: 'frame', name: 'Story', width: 1080, height: 1920 }, { type: 'frame', name: 'Ad', width: 1200, height: 628 }] });
  const story = r.json && r.json.artboards[0].split(' ')[0];
  ok(!r.isError && (await pageOf(story)) === 'Social' && (await cur()) === 'Page 1' && /Social/.test(r.json.page) && /Social/.test(r.summary), 'page_id creates on another page without switching: ' + r.json.page + ' | ' + r.summary);
  const sel = await page.evaluate(() => Folio.store.selection.slice());
  ok(!sel.includes(story), 'off-page artboards are not selected');
  const xs = await page.evaluate((ids) => ids.map((id) => Folio.store.get(id).x), [post, story]);
  ok(xs[1] > xs[0], 'placed right of the page\'s own artboards: ' + xs);
  r = await call('create_nodes', { parent_id: null, page_id: 'Nope', nodes: [{ type: 'frame', name: 'X' }] });
  ok(r.isError && /No page/.test(r.content) && /Social/.test(r.content), 'unknown page_id lists pages: ' + r.content);
  r = await call('create_nodes', { parent_id: home, page_id: social, nodes: [{ type: 'text', name: 'Sub', text: { content: 'x' } }] });
  ok(!r.isError && /page_id only applies/.test(JSON.stringify(r.json.warnings)), 'page_id with a parent is ignored with a warning');
  for (const bad of [{ a: 1 }, 42, ['x'], '__proto__', 'constructor']) {
    r = await call('create_nodes', { parent_id: null, page_id: bad, nodes: [{ type: 'frame', name: 'Bad' }] });
    ok(r.isError && /No page|page_id is missing/.test(r.content), 'hostile page_id ' + JSON.stringify(bad) + ' refused');
  }

  // --- acting on another page switches the view
  r = await call('update_nodes', { updates: [{ id: story, patch: { name: 'Story / Launch' } }] });
  ok(!r.isError && (await cur()) === 'Social' && /switched/.test(r.json.page), 'update_nodes on another page switches the view: ' + r.json.page);
  await call('manage_pages', { action: 'switch', page_id: p1 });
  r = await call('screenshot', { node_id: post }, 'post');
  ok(!r.isError && r.image > 100 && (await cur()) === 'Social' && /switched/.test(r.content), 'screenshot on another page switches and captures: ' + r.content);
  r = await call('screenshot', { node_id: post });
  ok(!r.isError && !/switched/.test(r.content), 'second screenshot on the same page: no switch note');
  await call('manage_pages', { action: 'switch', page_id: p1 });
  r = await call('create_nodes', { parent_id: story, nodes: [{ type: 'text', name: 'Hook', text: { content: 'Launch day', size: 120 } }] });
  ok(!r.isError && (await cur()) === 'Social', 'create_nodes into an off-page artboard switches');
  await call('manage_pages', { action: 'switch', page_id: p1 });
  r = await call('get_tree', { node_id: post });
  ok(!r.isError && (await cur()) === 'Page 1', 'get_tree (read-only) does not switch');

  // --- starter kit / logos land on their pages
  r = await call('add_starter_kit', {});
  const kitBoard = r.json && r.json.artboard && r.json.artboard.split(' ')[0];
  ok(!r.isError && (await pageOf(kitBoard)) === 'Components' && (await cur()) === 'Page 1' && /Components/.test(r.json.page), 'add_starter_kit → Components page: ' + (r.json && r.json.page));
  r = await call('add_starter_kit', {});
  ok(!r.isError && /already/.test(r.content) && (await page.evaluate(() => Folio.store.pages().filter((p) => p.name === 'Components').length)) === 1, 'second add_starter_kit reuses the page');
  r = await call('create_instances', { items: [{ component: 'Button', parent_id: home }] });
  ok(!r.isError && (await cur()) === 'Page 1', 'instances placed on Page 1 from a main on Components page: ' + r.summary);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#111111"/></svg>';
  r = await call('draft_logo', { name: 'Dot', svg, concept: 'A single dot.' });
  const logoCard = r.json && r.json.card;
  ok(!r.isError && (await pageOf(logoCard)) === 'Logos' && (await cur()) === 'Page 1' && /Logos/.test(r.json.page), 'draft_logo → Logos page: ' + (r.json && r.json.page));
  r = await call('draft_logo', { name: 'Ring', svg: svg.replace('fill="#111111"', 'fill="none" stroke="#111111" stroke-width="8"'), concept: 'A ring.' });
  ok(!r.isError && r.json.artboard.split(' ')[0] === (await page.evaluate((id) => Folio.store.rootOf(id), logoCard)), 'second draft reuses the Logo concepts board');
  r = await call('get_document', {});
  ok(['Components', 'Logos'].every((n) => r.json.pages.some((p) => p.name === n && p.artboards.length === 1)), 'get_document reflects Components and Logos pages: ' + JSON.stringify(r.json.pages.map((p) => p.name)));
  r = await call('screenshot', { node_id: logoCard }, 'logos');
  ok(!r.isError && (await cur()) === 'Logos', 'screenshot of a logo draft switches to Logos');

  // --- rename / move / delete
  r = await call('manage_pages', { action: 'rename', page_id: social, name: 'Logos' });
  ok(r.isError && /already called/.test(r.content), 'rename to an existing name refused');
  r = await call('manage_pages', { action: 'rename', page_id: social, name: 'Social media' });
  ok(!r.isError && (await page.evaluate((id) => Folio.store.pages().find((p) => p.id === id).name, social)) === 'Social media', 'rename');
  r = await call('manage_pages', { action: 'rename', page_id: social, name: '   ' });
  ok(r.isError, 'rename to blank refused');
  r = await call('manage_pages', { action: 'move', page_id: social, index: 0 });
  ok(!r.isError && (await page.evaluate(() => Folio.store.pages()[0].name)) === 'Social media', 'move page to index 0');
  r = await call('manage_pages', { action: 'move', page_id: social, index: 1e9 });
  ok(!r.isError && (await page.evaluate(() => Folio.store.pages().slice(-1)[0].name)) === 'Social media', 'huge index clamps to the end');
  r = await call('manage_pages', { action: 'move', page_id: social });
  ok(r.isError && /needs/.test(r.content), 'move without node_ids or index refused');
  const sub = await page.evaluate((id) => Folio.store.get(id).children[0], home);
  r = await call('manage_pages', { action: 'move', page_id: social, node_ids: [sub] });
  ok(r.isError && /not an artboard/.test(r.content), 'moving a non-artboard refused');
  r = await call('manage_pages', { action: 'move', page_id: social, node_ids: ['n_nope'] });
  ok(r.isError && /No layer/.test(r.content), 'moving an unknown id refused');
  r = await call('manage_pages', { action: 'move', page_id: social, node_ids: [home] });
  ok(!r.isError && (await pageOf(home)) === 'Social media', 'move artboard to another page: ' + (r.json && r.json.done));
  r = await call('manage_pages', { action: 'move', page_id: social, node_ids: [home] });
  ok(!r.isError && /already/.test(r.content), 'moving to the page it is on is a no-op');
  r = await call('manage_pages', { action: 'delete', page_id: social });
  ok(r.isError && /confirm/.test(r.content) && (await pageOf(home)) === 'Social media', 'delete of a page with artboards needs confirm');
  r = await call('manage_pages', { action: 'delete', page_id: social, confirm: 'true' });
  ok(!r.isError && !(await page.evaluate((id) => !!Folio.store.get(id), home)), 'delete with confirm removes page and artboards: ' + (r.json && r.json.done));
  r = await call('manage_pages', { action: 'create', name: 'Empty' });
  r = await call('manage_pages', { action: 'delete', name: 'Empty' });
  ok(!r.isError, 'empty page deletes without confirm');
  for (const bad of [{}, { action: 'explode' }, { action: 42 }, { action: 'switch' }, { action: 'rename', page_id: 'p_zzz', name: 'x' }, { action: 'create', name: 'x'.repeat(5000) }]) {
    r = await call('manage_pages', bad);
    const len = bad.action === 'create' ? await page.evaluate(() => Folio.store.pages().slice(-1)[0].name.length) : 0;
    ok(bad.action === 'create' ? !r.isError && len <= 60 : r.isError, 'hostile manage_pages ' + JSON.stringify(bad).slice(0, 60) + ' → ' + r.content.slice(0, 90));
  }
  // last page
  await page.evaluate(() => Folio.store.newDoc());
  if (mode === 'stub') await page.evaluate(`(${stub})()`);
  r = await call('manage_pages', { action: 'delete', page_id: await page.evaluate(() => Folio.store.currentPage().id) });
  ok(r.isError && /only page/.test(r.content), 'last page cannot be deleted');

  console.log(logs.length ? 'page logs:\n' + logs.join('\n') : 'no page errors');
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
