const { open, call } = require('./harness');

let failures = 0;
const check = (cond, msg, extra) => {
  if (!cond) {
    failures++;
    console.log('FAIL:', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : '');
  } else console.log('ok  :', msg);
};
const J = (r) => {
  try {
    return JSON.parse(r.content);
  } catch (e) {
    return r.content;
  }
};

(async () => {
  const { browser, page, logs } = await open();
  await page.evaluate(() => {
    window.__commits = 0;
    const c = Folio.store.commit.bind(Folio.store);
    Folio.store.commit = (...a) => {
      window.__commits++;
      return c(...a);
    };
    window.__aiChanged = [];
    Folio.store.on('ai:changed', (ids) => window.__aiChanged.push(ids.length));
  });

  // ---- base artboard
  let r = await call(page, 'create_nodes', {
    parent_id: null,
    nodes: [{ type: 'frame', name: 'Board', width: 800, sizing: { h: 'hug' }, layout: { gap: 16, padding: 32 }, children: [{ type: 'frame', name: 'Hero', sizing: { w: 'fill' }, layout: { gap: 8 }, children: [{ type: 'text', name: 'Title', text: { content: 'Hello' } }] }] }],
  });
  const created = J(r).created;
  const id = (name) => Object.keys(created).find((k) => created[k].endsWith('/' + name) || created[k] === name);
  const BOARD = id('Board');
  const HERO = id('Hero');
  const TITLE = id('Title');
  check(!r.isError && BOARD && HERO && TITLE, 'base artboard created');

  // ---- colours
  r = await call(page, 'create_nodes', {
    parent_id: HERO,
    nodes: [
      { type: 'frame', name: 'C1', width: 10, height: 10, style: { fills: [{ type: 'solid', color: 'notacolor' }] } },
      { type: 'frame', name: 'C2', width: 10, height: 10, style: { fills: [{ type: 'solid', color: 'rgb(255, 0, 0)' }, 'hsl(120 50% 50% / 0.5)', { color: 'red' }, { type: 'solid', color: 'oklch(0.7 0.15 200)' }, { type: 'solid', color: '#ABC' }, { type: 'solid', color: 123 }] } },
      { type: 'text', name: 'C3', text: { content: 'x', color: 'blurple' } },
    ],
  });
  let t = await page.evaluate((h) => Folio.store.get(h).children.map((c) => Folio.store.get(c)), HERO);
  const c1 = t.find((n) => n.name === 'C1');
  const c2 = t.find((n) => n.name === 'C2');
  const c3 = t.find((n) => n.name === 'C3');
  check(c1.style.fills.length === 0, 'invalid colour fill dropped', c1.style.fills);
  check(c2.style.fills.map((f) => f.color).join(',') === '#ff0000,#40bf4080,#ff0000,' + c2.style.fills[3].color + ',#aabbcc', 'colours normalized', c2.style.fills);
  check(/^#[0-9a-f]{6}$/.test(c2.style.fills[3].color), 'oklch normalized to hex', c2.style.fills[3]);
  check(c3.text.color === '#111111', 'invalid text colour → default');
  check(J(r).warnings && J(r).warnings.some((w) => /notacolor/.test(w)) && J(r).warnings.some((w) => /blurple/.test(w)), 'colour warnings reported', J(r).warnings);

  // update with bad colour keeps previous
  await call(page, 'update_nodes', { updates: [{ id: TITLE, patch: { text: { color: '#ff0000' } } }] });
  r = await call(page, 'update_nodes', { updates: [{ id: TITLE, patch: { text: { color: 'nope', size: 40 } } }] });
  t = await page.evaluate((i) => Folio.store.get(i).text, TITLE);
  check(t.color === '#ff0000' && t.size === 40, 'update: invalid colour keeps previous, other fields apply', t);
  r = await call(page, 'update_nodes', { updates: [{ id: HERO, patch: { style: { fills: [{ type: 'solid', color: 'zzz' }] } } }] });
  t = await page.evaluate((i) => Folio.store.get(i).style.fills, HERO);
  check(Array.isArray(t) && t.length === 0 && /zzz/.test(r.content), 'update: all-invalid fills keep previous fills', { t, c: r.content });

  // ---- numbers
  r = await page.evaluate(
    async ([h]) =>
      Folio.aiTools.execute('create_nodes', {
        parent_id: h,
        nodes: [
          { type: 'frame', name: 'N1', width: NaN, height: Infinity, x: 'abc', style: { radius: '12px', opacity: 50, blur: -5, rotation: 725 } },
          { type: 'frame', name: 'N2', width: 1e9, height: -40, layout: { gap: 'lots', padding: '8px 16px' } },
          { type: 'text', name: 'N3', text: { content: 'big', size: 5000, weight: 'bold' } },
          { type: 'text', name: 'N4', text: { content: 'px', size: 20, lineHeight: 30, letterSpacing: '2px' } },
        ],
      }),
    [HERO]
  );
  t = await page.evaluate((h) => Folio.store.get(h).children.map((c) => Folio.store.get(c)).filter((n) => /^N\d/.test(n.name)), HERO);
  const [n1, n2, n3, n4] = t;
  check(n1.sizing.w === 'hug' && n1.sizing.h === 'hug' && n1.style.radius === 12 && n1.style.opacity === 0.5 && n1.style.blur === 0 && n1.style.rotation === 5, 'NaN width ignored, radius/opacity/blur/rotation coerced', n1);
  check(n2.width === 20000 && n2.height === 0 && n2.layout.padding.join() === '8,16,8,16' && n2.layout.gap === 0, 'huge/negative sizes clamped, padding string parsed', { w: n2.width, h: n2.height, l: n2.layout });
  check(n3.text.size === 1000 && n3.text.weight === 700, 'font size clamped, weight word', n3.text);
  check(n4.text.lineHeight === 1.5 && n4.text.letterSpacing === 0.1, 'px line-height / letter-spacing converted', n4.text);
  check(/not a number/.test(r.content), 'NaN warned', J(r).warnings);

  // ---- unknown keys & types, hoisting
  r = await call(page, 'create_nodes', {
    parent_id: HERO,
    nodes: [
      { type: 'button', name: 'U1', foo: 1, background: '#00ff00', borderRadius: 8, padding: 12, gap: 4, style: { glow: true }, children: [{ type: 'text', content: 'Go', fontSize: 18, fontWeight: 600, color: '#fff' }] },
      { type: 'circle', name: 'U2', width: 40, height: 40, style: { radius: 9999, boxShadow: '0 4px 12px rgba(0,0,0,.2)', border: '1px solid #ccc' } },
      { type: 'frame', name: 'U4', width: 5, height: 5, style: { fills: [{ type: 'pattern' }] } },
      { type: 'frame', name: 'U3', width: 50, height: 50, style: { fills: [{ type: 'linear', angle: 90, stops: [{ color: '#000', offset: 0 }, { color: '#fff', offset: 1 }] }] } },
    ],
  });
  t = await page.evaluate((h) => Folio.store.get(h).children.map((c) => Folio.store.get(c)).filter((n) => /^U[123]/.test(n.name)), HERO);
  const [u1, u2, u3] = t;
  const u1kid = await page.evaluate((i) => Folio.store.get(Folio.store.get(i).children[0]), u1.id);
  check(u1.type === 'frame' && u1.style.fills.length === 1 && u1.style.fills[0].color === '#00ff00' && u1.style.radius === 8 && u1.layout.padding.join() === '12,12,12,12' && u1.layout.gap === 4, 'unknown type → frame, shorthand keys hoisted', { s: u1.style, l: u1.layout });
  check(u1kid.text.content === 'Go' && u1kid.text.size === 18 && u1kid.text.weight === 600 && u1kid.text.color === '#ffffff', 'text shorthand keys hoisted', u1kid.text);
  const warn = J(r).warnings.join('\n');
  check(/foo/.test(warn) && /glow/.test(warn) && /pattern/.test(warn), 'unknown keys / fill type warned', warn);
  check(u2.style.shadows.length === 1 && u2.style.shadows[0].y === 4 && u2.style.shadows[0].blur === 12 && u2.style.shadows[0].color === '#00000033' && u2.style.border.width === 1 && u2.style.border.color === '#cccccc', 'CSS shadow / border strings parsed', u2.style);
  check(u3.style.fills[0].stops.map((s) => s.pos).join() === '0,100', '0–1 stop offsets scaled to %', u3.style.fills[0]);

  // ---- text with children; parent is a text
  r = await call(page, 'create_nodes', { parent_id: HERO, nodes: [{ type: 'text', name: 'T1', text: { content: 'Parent text' }, children: [{ type: 'text', name: 'T2', text: { content: 'kid' } }, { type: 'image', name: 'I1', image: { src: 'javascript:alert(1)' }, children: [{ type: 'text', name: 'T3', text: { content: 'grandkid' } }] }] }] });
  t = await page.evaluate((h) => Folio.store.get(h).children.map((c) => Folio.store.get(c).name), HERO);
  const i1 = await page.evaluate((h) => Object.values(Folio.store.doc.nodes).find((n) => n.name === 'I1'), HERO);
  check(t.slice(-4).join() === 'T1,T2,I1,T3', 'text/image children moved out to siblings', t);
  check(i1 && i1.image.src === '' && /javascript/.test(r.content), 'javascript: URL rejected', i1 && i1.image);
  r = await call(page, 'create_nodes', { parent_id: TITLE, nodes: [{ type: 'text', name: 'AfterTitle', text: { content: 'x' } }] });
  t = await page.evaluate((h) => Folio.store.get(h).children.map((c) => Folio.store.get(c).name), HERO);
  check(!r.isError && t[t.indexOf('Title') + 1] === 'AfterTitle', 'text parent → inserted after it in its frame', { r: r.content, t });

  // ---- missing ids & names
  r = await call(page, 'update_nodes', { updates: [{ id: 'n_doesnotexist', patch: { name: 'x' } }] });
  check(r.isError && /No layer with id/.test(r.content), 'missing id → error', r.content);
  r = await call(page, 'update_nodes', { updates: [{ id: 'Hero', patch: { name: 'Hero section' } }] });
  check(!r.isError && /layer name, not an id/.test(r.content), 'unique name accepted as id with note', r.content);
  r = await call(page, 'get_tree', { node_id: 'Hero sectoin' });
  check(r.isError && /Did you mean/.test(r.content) && r.content.includes(HERO), 'near matches suggested', r.content);
  r = await call(page, 'create_nodes', { parent_id: 'n_nope', nodes: [{ type: 'frame' }] });
  check(r.isError && /Nothing was created/.test(r.content), 'missing parent → nothing created', r.content);

  // ---- forbidden patch keys
  r = await call(page, 'update_nodes', { updates: [{ id: TITLE, patch: { id: 'hack', type: 'frame', children: [], parent: null, text: { content: 'New title' } } }] });
  t = await page.evaluate((i) => Folio.store.get(i), TITLE);
  check(t && t.type === 'text' && t.text.content === 'New title' && /type cannot change/.test(r.content), 'id/type/children/parent not patchable', r.content);
  // width on a hug text → fixed
  await call(page, 'update_nodes', { updates: [{ id: TITLE, patch: { width: 300 } }] });
  t = await page.evaluate((i) => Folio.store.get(i).sizing, TITLE);
  check(t.w === 'fixed', 'width patch fixes the axis', t);

  // ---- cycles
  r = await page.evaluate(async (h) => {
    const a = { type: 'frame', name: 'CycleA', children: [] };
    a.children.push(a);
    return Folio.aiTools.execute('create_nodes', { parent_id: h, nodes: [a] });
  }, HERO);
  check(!r.isError && /cycle/.test(r.content), 'object cycle in input handled', r.content);
  r = await call(page, 'move_nodes', { moves: [{ id: BOARD, parent_id: HERO }] });
  check(r.isError && /inside it/.test(r.content), 'move into own descendant rejected', r.content);
  r = await call(page, 'move_nodes', { moves: [{ id: HERO, parent_id: HERO }] });
  check(r.isError && /into itself/.test(r.content), 'move into itself rejected', r.content);
  r = await call(page, 'move_nodes', { moves: [{ id: c1.id, parent_id: c3.id }] });
  check(r.isError && /only frames/.test(r.content), 'move into text rejected', r.content);

  // ---- move to canvas; reorder
  r = await call(page, 'move_nodes', { moves: [{ id: HERO, parent_id: null }] });
  t = await page.evaluate((i) => ({ n: Folio.store.get(i), roots: Folio.store.doc.roots, b: Folio.store.get(Folio.store.doc.roots[0]) }), HERO);
  check(!r.isError && t.roots.includes(HERO) && t.n.sizing.w === 'fixed' && t.n.x >= 920, 'move to canvas → artboard placed right, fill → fixed', { x: t.n.x, s: t.n.sizing, w: t.n.width });
  await call(page, 'move_nodes', { moves: [{ id: HERO, parent_id: BOARD, index: 0 }] });
  t = await page.evaluate((b) => Folio.store.get(b).children[0], BOARD);
  check(t === HERO, 'move back with index 0');

  // ---- flex → freeform keeps positions
  r = await call(page, 'update_nodes', { updates: [{ id: HERO, patch: { layout: { mode: 'none' } } }] });
  t = await page.evaluate((h) => ({ h: Folio.store.get(h), kids: Folio.store.get(h).children.map((c) => Folio.store.get(c)) }), HERO);
  check(t.h.sizing.w === 'fixed' && t.h.sizing.h === 'fixed' && t.kids.some((k) => k.y > 0), 'flex→none freezes child positions and frame size', { s: t.h.sizing, ys: t.kids.map((k) => k.y) });
  await call(page, 'update_nodes', { updates: [{ id: HERO, patch: { layout: { mode: 'flex' }, sizing: { w: 'fill', h: 'hug' } } }] });

  // ---- fonts
  r = await call(page, 'create_nodes', {
    parent_id: HERO,
    nodes: [
      { type: 'text', name: 'F1', text: { content: 'a', font: 'Comic Neue' } },
      { type: 'text', name: 'F2', text: { content: 'b', font: 'sans-serif' } },
      { type: 'text', name: 'F3', text: { content: 'c', font: '"inter", sans-serif' } },
      { type: 'text', name: 'F4', text: { content: 'd', font: 'Bebas Neue', weight: 700 } },
    ],
  });
  t = await page.evaluate(() => ['F1', 'F2', 'F3', 'F4'].map((n) => Object.values(Folio.store.doc.nodes).find((x) => x.name === n).text));
  const linked = await page.evaluate(() => !!document.querySelector('link[data-font="Comic Neue"]'));
  check(t[0].font === 'Comic Neue' && linked && /Comic Neue/.test(r.content), 'unknown font kept, loaded, warned');
  check(t[1].font === 'Inter' && t[2].font === 'Inter' && t[3].weight === 400, 'generic/stack fonts normalized, weight snapped', t);

  // ---- delete
  r = await call(page, 'delete_nodes', { ids: [HERO, TITLE, 'n_missing'] });
  t = await page.evaluate((i) => !!Folio.store.get(i), HERO);
  check(!r.isError && !t && J(r).deleted.length === 1 && J(r).errors.length === 1, 'delete parent+child+missing', r.content);

  // ---- malformed inputs
  r = await call(page, 'nope_tool', {});
  check(r.isError && /Unknown tool/.test(r.content), 'unknown tool');
  r = await page.evaluate(() => Folio.aiTools.execute('create_nodes', undefined));
  check(r.isError, 'undefined input');
  r = await page.evaluate(() => Folio.aiTools.execute('get_document', '{"x":1}'));
  check(!r.isError, 'string input parsed');
  r = await call(page, 'create_nodes', { parent_id: BOARD, nodes: 'frame' });
  check(r.isError, 'nodes as a string');
  r = await call(page, 'update_nodes', { updates: { [BOARD]: { name: 'Board 2' } } });
  check(!r.isError && /Board 2/.test(r.content), 'updates as an id→patch map');
  r = await call(page, 'screenshot', { node_id: 'n_missing' });
  check(r.isError, 'screenshot missing id');
  await call(page, 'update_nodes', { updates: [{ id: BOARD, patch: { visible: false } }] });
  r = await call(page, 'screenshot', { node_id: BOARD, scale: 'NaN' });
  check(r.isError && /hidden/.test(r.content), 'screenshot of hidden node', r.content);
  await call(page, 'update_nodes', { updates: [{ id: BOARD, patch: { visible: true } }] });
  r = await call(page, 'screenshot', { node_id: BOARD, scale: 'NaN' }, 'hostile-board');
  check(!r.isError, 'screenshot with NaN scale');

  // ---- volume: 2500 nodes, 60 levels deep
  r = await page.evaluate(async (b) => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ type: 'frame', name: 'Dot ' + i, width: 2, height: 2 }));
    let deep = { type: 'text', text: { content: 'bottom' } };
    for (let i = 0; i < 60; i++) deep = { type: 'frame', name: 'L' + i, children: [deep] };
    const t0 = performance.now();
    const a = await Folio.aiTools.execute('create_nodes', { parent_id: b, nodes: [{ type: 'frame', name: 'Many', layout: { direction: 'row', wrap: true }, children: many }] });
    const ms = performance.now() - t0;
    const d = await Folio.aiTools.execute('create_nodes', { parent_id: b, nodes: [deep] });
    a.content += d.content;
    return { a, ms };
  }, BOARD);
  check(!r.a.isError && /only the first 2000/.test(r.a.content) && /deeper than 40/.test(r.a.content), 'node cap and depth cap', r.a.content.match(/warnings.*/g));
  console.log('   2000-node create took', Math.round(r.ms), 'ms');
  r = await call(page, 'get_tree', { node_id: BOARD, depth: 50 });
  check(!r.isError && r.content.length < 120000 && /use get_tree on this layer/.test(r.content), 'get_tree capped at ~400 nodes', r.content.length);

  // ---- internal error never throws
  r = await page.evaluate(async (b) => {
    const orig = Folio.store.update;
    Folio.store.update = () => {
      throw new Error('boom');
    };
    try {
      return await Folio.aiTools.execute('update_nodes', { updates: [{ id: b, patch: { name: 'x' } }] });
    } finally {
      Folio.store.update = orig;
    }
  }, BOARD);
  check(r.isError && /internal error/.test(r.content), 'internal error → isError, no throw');

  // ---- no commits, ai:changed emitted
  const meta = await page.evaluate(() => ({ commits: window.__commits, changed: window.__aiChanged.length }));
  check(meta.commits === 0, 'store.commit never called', meta);
  check(meta.changed > 10, 'ai:changed emitted', meta);
  // describeNode / contextFor
  console.log('   describeNode:', await page.evaluate((b) => Folio.aiTools.describeNode(b), BOARD));
  await page.evaluate(() => Folio.store.select([]));
  console.log('   contextFor (empty selection):\n' + (await page.evaluate(() => Folio.aiPrompt.contextFor())));

  const errs = logs.filter((l) => /pageerror|\[error\]/.test(l) && !/boom|AI tool failed|ERR_FAILED|inlining remote css|cssRules/.test(l));
  check(!errs.length, 'no page errors', errs);
  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASSED');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
