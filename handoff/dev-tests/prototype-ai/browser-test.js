// set_interactions in the browser. node .dev/prototype-ai/browser-test.js  (serves the repo on PORT)
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '../..');
const PORT = 8473;
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); };
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(cdn\.jsdelivr\.net|esm\.sh|fonts\.)/, (route) => route.abort());
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  const call = (name, args) => page.evaluate(([n, a]) => Folio.aiTools.execute(n, a), [name, args]);
  const json = (r) => { try { return JSON.parse(r.content); } catch (e) { return r.content; } };

  const ids = await page.evaluate(async () => {
    localStorage.clear();
    const s = Folio.store;
    s.newDoc && s.newDoc();
    const mk = (tree) => Folio.aiTools.execute('create_nodes', { parent_id: null, nodes: [tree] });
    const home = JSON.parse((await mk({ type: 'frame', name: 'Home', width: 390, height: 844, children: [
      { type: 'frame', name: 'CTA', children: [{ type: 'text', name: 'Label', text: { content: 'See pricing' } }] },
      { type: 'text', name: 'Menu link', text: { content: 'Menu' } },
      { type: 'frame', name: 'List', width: 390, height: 400 },
    ] })).content);
    const pricing = JSON.parse((await mk({ type: 'frame', name: 'Pricing', width: 390, height: 844, children: [{ type: 'text', name: 'Back', text: { content: 'Back' } }] })).content);
    const menu = JSON.parse((await mk({ type: 'frame', name: 'Menu', width: 300, height: 400 })).content);
    const byName = (nm) => Object.values(s.doc.nodes).find((n) => n.name === nm).id;
    s.commit('setup');
    return { home: byName('Home'), pricing: byName('Pricing'), menu: byName('Menu'), cta: byName('CTA'), label: byName('Label'), menuLink: byName('Menu link'), list: byName('List'), back: byName('Back') };
  });

  // navigate + slide
  let r = await call('set_interactions', { node_id: ids.cta, interactions: [{ action: 'navigate', target: ids.pricing, transition: { type: 'slide', direction: 'left' } }] });
  let o = json(r);
  ok(!r.isError && o.interactions.length === 1 && o.interactions[0].target === ids.pricing && o.interactions[0].transition.type === 'slide', 'navigate stored: ' + r.summary);
  ok(r.changedIds.includes(ids.cta), 'changedIds has the node');
  // overlay by artboard name + back + url
  r = await call('set_interactions', { node_id: ids.menuLink, interactions: [{ action: 'overlay', target: 'Menu' }] });
  o = json(r);
  ok(!r.isError && o.interactions[0].action === 'overlay' && o.interactions[0].target === ids.menu && o.interactions[0].overlay.position === 'center', 'overlay by artboard name: ' + r.summary);
  ok((o.warnings || []).some((w) => /artboard name/.test(w)), 'name → id note');
  r = await call('set_interactions', { node_id: ids.back, interactions: [{ action: 'back' }, { action: 'url', url: 'https://example.com/terms' }] });
  o = json(r);
  ok(!r.isError && o.interactions.map((x) => x.action).join() === 'back,url', 'back + url stored');
  // bad target and javascript: url, mixed with a valid one
  r = await call('set_interactions', { node_id: ids.back, interactions: [{ action: 'navigate', target: 'n_nope' }, { action: 'url', url: 'javascript:alert(1)' }, { action: 'back' }] });
  o = json(r);
  ok(!r.isError && o.interactions.length === 1 && o.interactions[0].action === 'back', 'invalid entries dropped, valid kept');
  ok(o.warnings.some((w) => /n_nope/.test(w)) && o.warnings.some((w) => /javascript/.test(w)) && o.warnings.some((w) => /Artboards on this page/.test(w)), 'warnings for bad target + javascript url + artboard list');
  // all invalid: refused, nothing changed
  r = await call('set_interactions', { node_id: ids.cta, interactions: [{ action: 'url', url: 'javascript:alert(1)' }] });
  ok(r.isError && /nothing was changed/i.test(r.content), 'all-invalid list refused');
  ok(await page.evaluate((id) => Folio.store.get(id).interactions.length === 1, ids.cta), 'previous interactions kept');
  // navigate to own artboard refused by normalize
  r = await call('set_interactions', { node_id: ids.cta, interactions: [{ action: 'navigate', target: ids.home }] });
  ok(r.isError, 'navigate to own screen refused');
  // scroll
  r = await call('set_interactions', { node_id: ids.label, scroll: 'vertical' });
  ok(r.isError && /only frames scroll/.test(r.content), 'scroll on a text node refused');
  r = await call('set_interactions', { node_id: ids.list, scroll: 'sideways' });
  ok(r.isError, 'bad scroll value refused');
  r = await call('set_interactions', { node_id: ids.list, scroll: 'vertical' });
  ok(!r.isError && json(r).scroll === 'vertical', 'scroll stored');
  // start
  r = await call('set_interactions', { node_id: ids.cta, start: true });
  ok(r.isError && /only applies to artboards/.test(r.content), 'start on a layer refused');
  r = await call('set_interactions', { node_id: ids.pricing, start: true });
  ok(!r.isError && /Pricing/.test(json(r).start), 'start set: ' + r.summary);
  ok(await page.evaluate((id) => Folio.store.currentPage().start === id, ids.pricing), 'page.start stored');
  r = await call('set_interactions', { node_id: ids.cta });
  ok(r.isError, 'nothing to set → error');
  // create_nodes / update_nodes drop interactions with a pointer
  r = await call('update_nodes', { updates: [{ id: ids.cta, patch: { interactions: [{ action: 'back' }], name: 'CTA' } }] });
  ok(/set_interactions/.test(r.content), 'update_nodes warns about interactions');
  r = await call('create_nodes', { parent_id: ids.home, nodes: [{ type: 'frame', name: 'X', scroll: 'vertical' }] });
  ok(/set_interactions/.test(r.content), 'create_nodes warns about scroll');
  ok(await page.evaluate((id) => Folio.store.get(id).interactions.length === 1, ids.cta), 'update_nodes did not touch interactions');
  // descriptions
  const tree = JSON.stringify(json(await call('get_tree', { node_id: ids.home })));
  ok(tree.includes('→ Pricing (slide left)') && tree.includes('overlay → Menu') && tree.includes('"scroll":"vertical"'), 'get_tree shows arrows and scroll');
  const back = JSON.stringify(json(await call('get_tree', { node_id: ids.back })));
  ok(back.includes('"back"'), 'get_tree shows back');
  const desc = await page.evaluate((id) => Folio.aiTools.describeNode(id), ids.cta);
  ok(/→ Pricing \(slide left\)/.test(desc), 'describeNode: ' + desc);
  ok(/scroll: vertical/.test(await page.evaluate((id) => Folio.aiTools.describeNode(id), ids.list)), 'describeNode shows scroll');
  const docOut = json(await call('get_document', {}));
  ok(docOut.pages && /Pricing/.test(docOut.pages[0].start) && !/first artboard/.test(docOut.pages[0].start), 'get_document names the start: ' + docOut.pages[0].start);
  // clearing
  r = await call('set_interactions', { node_id: ids.menuLink, interactions: [] });
  ok(!r.isError && json(r).interactions.length === 0 && await page.evaluate((id) => !Folio.store.get(id).interactions, ids.menuLink), '[] clears');
  // undo restores (one commit for the burst, like the AI chat)
  const undone = await page.evaluate((ids) => {
    const s = Folio.store;
    s.commit('AI burst');
    s.undo();
    return { cta: s.get(ids.cta).interactions, list: s.get(ids.list).scroll, start: s.currentPage().start, roots: s.doc.roots === s.currentPage().roots };
  }, ids);
  ok(!undone.cta && !undone.list && !undone.start && undone.roots, 'undo restores interactions, scroll and start: ' + JSON.stringify(undone));
  const redone = await page.evaluate((ids) => { const s = Folio.store; s.redo(); return [s.get(ids.cta).interactions.length, s.currentPage().start === ids.pricing]; }, ids);
  ok(redone[0] === 1 && redone[1], 'redo brings them back');
  ok(!errors.length, 'no page errors ' + errors.join(' | '));
  await browser.close();
  srv.kill();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
