// Components tools test in the real index.html. node .dev/comp/test.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const H2I = path.join(__dirname, '../aitest/vendor/package/dist/html-to-image.js');
const OUT = path.join(__dirname, 'out');
let fails = 0;
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
  page.on('console', (m) => m.type() === 'error' && logs.push('console ' + m.text()));
  await page.route(/^https:\/\/(cdn\.jsdelivr\.net|esm\.sh|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => {
    if (/html-to-image/.test(route.request().url())) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(H2I, 'utf8') });
    return route.abort();
  });
  await page.goto('http://localhost:8133/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready') && window.Folio && Folio.aiTools && Folio.components);
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

  // --- empty list
  let r = await call('list_components', {});
  ok(!r.isError && /No components yet/.test(r.content), 'list_components on empty doc');

  // --- starter kit
  r = await call('add_starter_kit', {});
  ok(!r.isError && r.json.sets.length >= 4, `add_starter_kit: ${r.summary}`);
  const btnSet = r.json.sets.find((s) => s.name === 'Button');
  ok(btnSet && btnSet.variants.length === 9 && btnSet.layers.length, 'Button set has 9 variants and a layer outline: ' + JSON.stringify(btnSet && btnSet.layers));
  const cardEntry = r.json.sets.find((s) => s.name === 'Card') || r.json.components.find((c) => c.name === 'Card');
  console.log('    card:', JSON.stringify(cardEntry).slice(0, 400));
  fs.writeFileSync(path.join(OUT, 'list.json'), JSON.stringify(r.json, null, 1));
  await call('screenshot', { node_id: r.json.artboard.split(' ')[0] }, 'kit');
  r = await call('add_starter_kit', {});
  ok(!r.isError && /already/.test(r.content), 'second add_starter_kit is a no-op');

  // --- landing page section with instances
  r = await call('create_nodes', { parent_id: null, nodes: [{ type: 'frame', name: 'Page', width: 1440, sizing: { h: 'hug' }, style: { fills: [{ type: 'solid', color: '#f4f3ef' }] }, children: [
    { type: 'frame', name: 'Hero', sizing: { w: 'fill' }, layout: { gap: 32, padding: [120, 80, 64, 80] }, children: [
      { type: 'text', name: 'Headline', sizing: { w: 'fill' }, text: { content: 'Repairs booked in\nunder a minute', font: 'Bricolage Grotesque', size: 80, weight: 500, lineHeight: 1, letterSpacing: -0.035, color: '#16181d' } },
      { type: 'text', name: 'Supporting line', sizing: { w: 'fill' }, text: { content: 'Halden Cycles fixes city bikes in Leith. Pick a slot, drop the bike off before work, collect it the same evening.', size: 20, lineHeight: 1.5, color: '#55585f' } },
      { type: 'frame', name: 'Actions', layout: { direction: 'row', gap: 16, align: 'center' } },
    ] },
    { type: 'frame', name: 'Services', sizing: { w: 'fill' }, layout: { direction: 'row', gap: 24, align: 'stretch', padding: [64, 80, 120, 80] } },
  ] }] });
  ok(!r.isError, 'created page');
  const byPath = (p) => Object.keys(r.json.created).find((id) => r.json.created[id] === p);
  const ids = { page: byPath('Page'), actions: byPath('Page/Hero/Actions'), services: byPath('Page/Services') };
  r = await call('create_instances', { items: [
    { component: 'Button', variant: { Style: 'Primary', Size: 'L' }, parent_id: ids.actions, overrides: { Label: { text: { content: 'Book a repair' } } } },
    { component: 'button', variant: { style: 'ghost', size: 'L' }, parent_id: ids.actions, overrides: { Label: { text: { content: 'See prices' } } } },
    ...['Puncture', 'Full service', 'Wheel true'].map((t, i) => ({ component: 'Card', parent_id: ids.services, sizing: { w: 'fill' }, overrides: { Title: { text: { content: t } } } })),
  ] });
  console.log('    ', r.content.slice(0, 900));
  ok(!r.isError && r.json.created.length === 5, 'create_instances placed 5 instances');
  const cardPaths = await page.evaluate(() => Object.keys(Folio.components.list().filter((c) => c.name === 'Card').map((c) => c.mainId).reduce((a, id) => a, {})));
  // overrides for nested button in cards
  const firstCard = await page.evaluate((sid) => Folio.store.get(sid).children[0], ids.services);
  r = await call('get_tree', { node_id: ids.page });
  const tree = r.json.tree;
  const hasInstanceMarkCollapsed = JSON.stringify(tree).includes('"instance"') && !JSON.stringify(tree).includes('"sourceId"');
  ok(hasInstanceMarkCollapsed, 'get_tree marks instances');
  const actions = tree.children[0].children[2].children[0];
  ok(actions.instance && actions.childCount && !actions.children, 'instance internals collapsed in page tree: ' + JSON.stringify(actions));
  r = await call('get_tree', { node_id: firstCard });
  ok(r.json.tree.children && r.json.tree.instance, 'get_tree on the instance shows internals');
  console.log('     card instance tree:', JSON.stringify(r.json.tree).slice(0, 700));
  r = await call('get_document', {});
  ok(/components/.test(JSON.stringify(r.json)) && r.json.components, 'get_document has components summary: ' + r.json.components);
  await call('screenshot', { node_id: ids.page }, 'page-before');

  // --- edit the main button fill -> instances update
  const prim = await page.evaluate(() => {
    const C = Folio.components;
    const c = C.list().find((x) => x.name === 'Button' && x.variant.Style === 'Primary' && x.variant.Size === 'L');
    return c.mainId;
  });
  r = await call('update_nodes', { updates: [{ id: prim, patch: { style: { fills: [{ type: 'solid', color: '#1f4d3a' }] } } }] });
  ok(!r.isError, 'updated main fill');
  const instFill = await page.evaluate((aid) => { const id = Folio.store.get(aid).children[0]; return Folio.store.get(id).style.fills[0].color; }, ids.actions);
  ok(instFill === '#1f4d3a', 'instance picked up main fill: ' + instFill);
  const instLabel = await page.evaluate((aid) => { const id = Folio.store.get(aid).children[0]; const n = Folio.store.get(id); const walk = (x) => x.type === 'text' ? x : x.children.map((c) => walk(Folio.store.get(c))).find(Boolean); return walk(n).text.content; }, ids.actions);
  ok(instLabel === 'Book a repair', 'override kept after main change: ' + instLabel);

  // --- variant switch
  const ghostId = await page.evaluate((aid) => Folio.store.get(aid).children[1], ids.actions);
  r = await call('update_instances', { items: [{ id: ghostId, variant: { Style: 'Secondary' } }] });
  console.log('    ', r.content.slice(0, 400));
  ok(!r.isError && /Style=Secondary/.test(r.content), 'variant switched');
  const label2 = await page.evaluate((id) => { const n = Folio.store.get(id); const walk = (x) => x.type === 'text' ? x : x.children.map((c) => walk(Folio.store.get(c))).find(Boolean); return walk(n).text.content; }, ghostId);
  ok(label2 === 'See prices', 'override carried across variant switch');
  r = await call('update_instances', { items: [{ id: ghostId, variant: { Style: 'Neon' } }] });
  ok(r.isError && /Values/.test(r.content), 'bad variant value rejected: ' + r.content.slice(0, 200));

  // --- sanitizer: layout inside instance
  const labelId = await page.evaluate((id) => { const walk = (x) => x.type === 'text' ? x : x.children.map((c) => walk(Folio.store.get(c))).find(Boolean); return walk(Folio.store.get(id)).id; }, ghostId);
  r = await call('update_nodes', { updates: [{ id: labelId, patch: { text: { content: 'Price list', size: 40, color: '#1f4d3a' } } }, { id: ghostId, patch: { layout: { padding: 40 }, sizing: { w: 'fixed' }, width: 220 } }] });
  console.log('    ', r.content.slice(0, 700));
  const after = await page.evaluate(([l, g]) => ({ size: Folio.store.get(l).text.size, content: Folio.store.get(l).text.content, color: Folio.store.get(l).text.color, pad: Folio.store.get(g).layout.padding, w: Folio.store.get(g).width }), [labelId, ghostId]);
  ok(after.content === 'Price list' && after.color === '#1f4d3a' && after.size !== 40, 'inner text: content/colour applied, size rejected ' + JSON.stringify(after));
  ok(after.w === 220 && after.pad[0] !== 40, 'root: width applied, layout padding rejected');
  ok(/update_instances/.test(r.content) && /main/.test(r.content), 'warning names update_instances / main');
  // delete inside instance → hide
  r = await call('delete_nodes', { ids: [labelId] });
  ok(!r.isError && r.json.hidden && r.json.hidden[0] === labelId, 'delete inside instance hides: ' + r.content.slice(0, 300));
  ok(await page.evaluate((id) => Folio.store.get(id) && Folio.store.get(id).visible === false, labelId), 'label still exists, hidden');
  r = await call('update_instances', { items: [{ id: ghostId, reset: true }] });
  ok(!r.isError && await page.evaluate((id) => Folio.store.get(id).visible !== false, labelId), 'reset restores visibility');
  // create/move into instance
  r = await call('create_nodes', { parent_id: ghostId, nodes: [{ type: 'text', text: { content: 'x' } }] });
  ok(r.isError && /instance/.test(r.content), 'create_nodes into instance refused');
  r = await call('move_nodes', { moves: [{ id: await page.evaluate(() => Object.values(Folio.store.doc.nodes).find((x) => x.name === 'Headline' && Folio.store.rootOf(x.id) === Folio.store.doc.roots[1]).id), parent_id: ghostId }] });
  ok(r.isError && /instance/.test(r.content), 'move into instance refused: ' + r.content.slice(0, 200));
  r = await call('move_nodes', { moves: [{ id: labelId, parent_id: ids.page }] });
  ok(r.isError && /instance/.test(r.content), 'move out of instance refused');
  // nested button inside card instance: override by path
  const cardPathsList = await page.evaluate((cid) => Object.keys((function pm(rootId) { const out = {}; const walk = (id, p) => { const n = Folio.store.get(id); if (!(p in out)) out[p] = id; n.children.forEach((c) => walk(c, p ? p + '/' + Folio.store.get(c).name : Folio.store.get(c).name)); }; walk(rootId, ''); return out; })(cid)), firstCard);
  console.log('     card paths:', cardPathsList.join(' | '));
  const btnLabelPath = cardPathsList.find((p) => /Label$/.test(p) && p.includes('/'));
  r = await call('update_instances', { items: [{ id: firstCard, overrides: { [btnLabelPath]: { text: { content: 'Book a puncture fix' } }, Title: { text: { size: 99 } }, Nope: { visible: false } } }] });
  console.log('    ', r.content.slice(0, 600));
  ok(!r.isError && /can't be overridden/.test(r.content) && /no layer/.test(r.content), 'override sanitizer warns on size and unknown path');

  r = await call('update_instances', { items: [{ id: firstCard, overrides: { Title: { 'text.content': 'Dotted form' } } }] });
  ok(!r.isError && await page.evaluate((id) => Object.values(Folio.store.doc.nodes).some((n) => n.text && n.text.content === 'Dotted form' && Folio.store.isAncestor(id, n.id)), firstCard), 'dotted override keys accepted');
  // --- create_component with variants from 1 node, and from N nodes
  r = await call('create_nodes', { parent_id: null, nodes: [{ type: 'frame', name: 'Tag', layout: { direction: 'row', padding: [4, 10] }, style: { fills: [{ type: 'solid', color: '#efede6' }], radius: 9999 }, children: [{ type: 'text', name: 'Label', text: { content: 'Open', size: 13, weight: 500, color: '#3a3833' } }] }] });
  const tagId = Object.keys(r.json.created)[0];
  r = await call('create_component', { node_ids: [tagId], name: 'Tag', variants: { Tone: ['Neutral', 'Good', 'Bad'], Size: ['S', 'M'] } });
  console.log('    ', r.content.slice(0, 500));
  ok(!r.isError && r.json.sets[0] && r.json.sets[0].variants.length === 6 && JSON.stringify(r.json.sets[0].props) === JSON.stringify({ Tone: ['Neutral', 'Good', 'Bad'], Size: ['S', 'M'] }), 'create_component with variants builds a 6-variant set');
  const vs = r.json.sets[0].variants.map((v) => varTxt(v.variant));
  function varTxt(v) { return Object.keys(v).map((k) => k + '=' + v[k]).join(','); }
  ok(vs[0] === 'Tone=Neutral,Size=S' && vs[5] === 'Tone=Bad,Size=M', 'variant order ' + vs.join(' | '));
  r = await call('create_nodes', { parent_id: null, nodes: ['Primary', 'Quiet'].map((s) => ({ type: 'frame', name: 'Pill ' + s, layout: { padding: [8, 14] }, style: { fills: [{ type: 'solid', color: s === 'Primary' ? '#16181d' : '#ffffff' }], radius: 8 }, children: [{ type: 'text', name: 'Label', text: { content: s, color: s === 'Primary' ? '#ffffff' : '#16181d' } }] })) });
  const pills = r.json.artboards.map((a) => a.split(' ')[0]);
  r = await call('create_component', { node_ids: pills, name: 'Pill', variants: { Kind: ['Primary', 'Quiet'] } });
  ok(!r.isError && r.json.sets[0].variants.length === 2 && r.json.sets[0].variants[1].variant.Kind === 'Quiet', 'create_component from 2 nodes → 2 variants');
  r = await call('create_component', { node_ids: [labelId], name: 'X' });
  ok(r.isError && /instance/.test(r.content), 'create_component refuses layer inside instance: ' + r.content.slice(0, 150));
  r = await call('create_instances', { items: [{ component: 'Tag', variant: { Tone: 'Good' }, parent_id: ids.actions }] });
  ok(!r.isError && /Tone=Good, Size=S/.test(r.content), 'instance of new set with partial variant: ' + r.content.slice(0, 200));
  r = await call('create_instances', { items: [{ component: 'Nope', parent_id: null }] });
  ok(r.isError && /Components:/.test(r.content), 'unknown component lists names');
  // detach
  r = await call('update_instances', { items: [{ id: ghostId, detach: true }] });
  ok(!r.isError && await page.evaluate((id) => !Folio.store.get(id).instance, ghostId), 'detach');
  // a single plain component
  r = await call('list_components', {});
  ok(!r.isError && r.json.sets.length >= 6, 'list_components after all: ' + r.summary);
  fs.writeFileSync(path.join(OUT, 'list2.json'), JSON.stringify(r.json, null, 1));
  // undo works as one commit
  await page.evaluate(() => Folio.store.commit('AI test'));
  await call('screenshot', { node_id: ids.page }, 'page-after');
  // context
  const ctx = await page.evaluate(() => { Folio.store.select([Object.values(Folio.store.doc.nodes).find((n) => n.instance).id]); return Folio.aiPrompt.contextFor(); });
  ok(/Components: \d+/.test(ctx) && /"instance"/.test(ctx), 'contextFor mentions components and instance');
  console.log(logs.length ? 'LOGS:\n' + logs.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'all passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
