/* Node test for the pages model in src/state.js (+ components across pages). run: node .dev/pages-test.js */
const path = require('path');
const ROOT = path.join(__dirname, '..');
global.window = globalThis;
const mem = {};
global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => (mem[k] = String(v)), removeItem: (k) => delete mem[k] };
global.document = { getElementById: () => null };
window.addEventListener = () => {};
require(path.join(ROOT, 'src/state.js'));
require(path.join(ROOT, 'src/brand.js'));
require(path.join(ROOT, 'src/components.js'));
const toasts = [];
Folio.ui = { toast: (m) => toasts.push(m) };
const s = Folio.store, K = Folio.components;
let fails = 0;
const ok = (c, msg, extra) => { console.log((c ? '  ok   ' : '  FAIL ') + msg + (c || extra === undefined ? '' : ' ' + JSON.stringify(extra).slice(0, 300))); if (!c) fails++; };
const inv = () => s.doc.roots === s.currentPage().roots && s.doc.page === s.currentPage().id;
const names = () => s.pages().map((p) => p.name).join(',');
const events = [];
['page', 'change'].forEach((e) => s.on(e, () => events.push(e)));

// ---- migration ----
s.load({ version: 1, name: 'old', nodes: { a: { ...Folio.util.defaultNode('frame'), id: 'a' }, b: { ...Folio.util.defaultNode('frame'), id: 'b' } }, roots: ['a', 'b', 'ghost'] });
ok(s.pages().length === 1 && s.pages()[0].name === 'Page 1' && s.pages()[0].roots.join() === 'a,b' && inv(), 'old doc migrates to one "Page 1" (unknown ids dropped)');
s.newDoc();
ok(s.pages().length === 1 && s.pages()[0].name === 'Page 1' && inv(), 'newDoc starts with Page 1');
s.load(null);
ok(s.pages().length === 1 && inv(), 'load(null) gives a valid doc');
K.init();
Folio.brand.init();

// ---- add / rename / switch ----
const p1 = s.currentPage();
const a1 = s.buildFromTree({ type: 'frame', name: 'A1', x: 0, y: 0, width: 100, height: 100 });
s.commit('a1');
const p2 = s.addPage();
ok(p2.name === 'Page 2' && s.currentPage() === p1 && inv(), 'addPage defaults to "Page N", does not switch');
const p0 = s.addPage('Intro', { index: 0 });
ok(names() === 'Intro,Page 1,Page 2', 'addPage at index');
ok(s.renamePage(p2.id, '  Social ') && p2.name === 'Social' && !s.renamePage(p2.id, '   '), 'renamePage trims, refuses empty');
s.select([a1.id]);
s.setViewport({ x: 11, y: 22, zoom: 0.5 });
events.length = 0;
s.switchPage(p2.id);
ok(inv() && s.doc.roots === p2.roots && s.selection.length === 0, 'switchPage rebinds roots, clears selection');
ok(events.indexOf('page') >= 0 && events.indexOf('page') < events.lastIndexOf('change'), "switchPage emits 'page' then 'change'");
ok(p1.viewport && p1.viewport.zoom === 0.5 && p1.viewport.x === 11, 'viewport remembered on the page left');
const b1 = s.buildFromTree({ type: 'frame', name: 'B1', x: 0, y: 0, width: 200, height: 100 });
ok(p2.roots.includes(b1.id) && !p1.roots.includes(b1.id), 'new artboards land on the current page');
ok(s.pageOf(b1.id) === p2 && s.pageOf(a1.id) === p1 && s.pageOf('nope') === null, 'pageOf');
const child = s.createNode('text', {}, b1.id);
ok(s.pageOf(child.id) === p2, 'pageOf a nested layer');
s.commit('b1');

// ---- serialize → load keeps the invariant + page ----
const json = s.serialize();
s.load(JSON.parse(json));
ok(inv() && s.currentPage().name === 'Social' && s.pages().length === 3, 'serialize → load: invariant + current page kept');
ok(s.currentPage().roots.includes(b1.id), 'roots of current page after load');
s.load(JSON.parse(json.replace(/"roots": \[\s*"[^"]*"\s*\],\s*"pages"/, '"roots": [], "pages"')));
ok(inv(), 'load with a stale doc.roots copy still binds to the page');

// ---- undo / redo keep the current page ----
s.load(JSON.parse(json));
const P = (n) => s.pages().find((p) => p.name === n);
s.switchPage(P('Page 1').id);
s.buildFromTree({ type: 'frame', name: 'A2', x: 300, y: 0, width: 100, height: 100 });
s.commit('a2');
s.switchPage(P('Social').id);
const h = s.historyIndex;
s.commit('noop after switch');
ok(s.historyIndex === h, 'switching pages is not an undo step (no-op commit after switch)');
s.undo();
ok(inv() && s.currentPage().name === 'Social', 'undo keeps the page the user is viewing');
ok(!Object.values(s.doc.nodes).some((n) => n.name === 'A2'), 'undo undid the change on the other page');
s.redo();
ok(inv() && s.currentPage().name === 'Social' && Object.values(s.doc.nodes).some((n) => n.name === 'A2'), 'redo too');
s.createNode('frame', { name: 'S2' });
ok(s.currentPage().roots.includes(Object.values(s.doc.nodes).find((n) => n.name === 'S2').id), 'createNode after undo/redo uses the live page');
s.commit('s2');
// undo of an addPage+switch falls back to the page visited before
s.switchPage(P('Intro').id);
const np = s.addPage('Temp', { activate: true });
s.commit('add temp');
s.undo();
ok(inv() && s.currentPage().name === 'Intro' && !s.pages().some((p) => p.name === 'Temp'), 'undo of addPage → back to the previous page');
s.redo();
ok(inv() && s.currentPage().name === 'Intro', 'redo of addPage stays put');
s.switchPage(s.pages().find((p) => p.name === 'Temp').id);
const vpBefore = { ...s.viewport };
s.undo();
ok(inv() && s.currentPage().name === 'Intro', 'undo while on the page that undo removes');
ok(s.page(P('Intro').id), 'page() lookup');
s.redo();

// ---- withPage ----
const social = P('Social'), intro = P('Intro');
const cur = s.currentPage();
let inside;
const made = s.withPage(intro.id, (pg) => { inside = s.doc.roots === intro.roots; return s.buildFromTree({ type: 'frame', name: 'Built in Intro' }).id; });
ok(inside && intro.roots.includes(made) && s.currentPage() === cur && inv(), 'withPage binds temporarily, restores');
let nestOk = false;
s.withPage(intro.id, () => {
  s.withPage(social.id, () => s.buildFromTree({ type: 'frame', name: 'Nested' }));
  nestOk = s.doc.roots === intro.roots;
  s.buildFromTree({ type: 'frame', name: 'After nested' });
});
const nn = (n) => Object.values(s.doc.nodes).find((x) => x.name === n);
ok(nestOk && social.roots.includes(nn('Nested').id) && intro.roots.includes(nn('After nested').id) && inv(), 'nested withPage restores the outer binding');
try { s.withPage(intro.id, () => { throw new Error('boom'); }); } catch (e) {}
ok(inv(), 'withPage restores after a throw');
let threw = false;
try { s.withPage('p_nope', () => {}); } catch (e) { threw = true; }
ok(threw && inv(), 'withPage refuses an unknown page');

// ---- ensurePage ----
const n0 = s.pages().length;
const comps = s.ensurePage('Components');
ok(s.pages().length === n0 + 1 && s.pages()[n0] === comps && s.currentPage() === cur, 'ensurePage creates at the end without switching');
ok(s.ensurePage('Components') === comps && s.pages().length === n0 + 1, 'ensurePage finds it the second time');

// ---- moveToPage ----
s.switchPage(P('Page 1').id);
const a2 = nn('A2');
const target = P('Social');
const right = Math.max(...target.roots.map((id) => s.get(id).x + s.get(id).width));
s.select([a2.id]);
const moved = s.moveToPage([a2.id, child.id], target.id);
ok(moved.join() === a2.id && target.roots.includes(a2.id) && !P('Page 1').roots.includes(a2.id) && inv(), 'moveToPage moves roots only');
ok(a2.x === right + 100, 'placed to the right of the target page artboards', { x: a2.x, right });
ok(s.selection.length === 0, 'moved artboards leave the selection');
ok(s.moveToPage([a2.id], target.id).length === 0, 'moving to its own page is a no-op');
s.commit('move');
s.undo();
ok(P('Page 1').roots.includes(a2.id) && inv(), 'undo moveToPage');
s.redo();

// ---- movePage / duplicatePage ----
const ids0 = s.pages().map((p) => p.id);
s.movePage(ids0[0], 2);
ok(s.pages()[2].id === ids0[0] && inv(), 'movePage');
const src = P('Social');
const dup = s.duplicatePage(src.id);
ok(dup.name === 'Social copy' && s.pages().indexOf(dup) === s.pages().indexOf(src) + 1 && dup.roots.length === src.roots.length, 'duplicatePage copies artboards after it');
ok(dup.roots.every((id) => !src.roots.includes(id)) && s.get(dup.roots[0]).children.length === s.get(src.roots[0]).children.length, 'duplicate has new ids + children');
ok(s.currentPage() !== dup && inv(), 'duplicatePage does not switch');

// ---- removePage ----
const dupNodes = dup.roots.flatMap((r) => [r, ...s.descendants(r)]);
s.switchPage(dup.id);
ok(s.removePage(dup.id) && !s.page(dup.id) && dupNodes.every((id) => !s.get(id)) && inv(), 'removePage deletes its nodes and leaves to a neighbour');
s.load({ version: 1, name: 'one', nodes: {}, roots: [] });
ok(!s.removePage(s.currentPage().id) && s.pages().length === 1, 'removePage refuses the last page');

// ---- components across pages ----
s.load({ version: 1, name: 'k', nodes: {}, roots: [] });
const home = s.currentPage();
s.buildFromTree({ type: 'frame', name: 'Home', x: 0, y: 0, width: 800, height: 600 });
const kit = K.addStarterKit();
const kp = s.pages().find((p) => p.name === 'Components');
const btn = K.list().find((c) => c.name === 'Button');
ok(kit.length > 5 && kp && s.pageOf(btn.mainId) === kp && s.currentPage() === home && inv(), 'starter kit lands on the Components page without switching');
ok(home.roots.length === 1, 'nothing added to the current page');
K.addStarterKit();
ok(s.pages().filter((p) => p.name === 'Components').length === 1 && kp.roots.length === 1, 'kit again: same page, same board');
const inst = K.createInstance(btn.id, { parentId: home.roots[0], x: 10, y: 10 });
s.commit('inst');
const label = s.descendants(btn.mainId).map((id) => s.get(id)).find((n) => n.type === 'text');
s.update(label.id, { text: { size: 33 } });
K.flush();
const ilabel = s.descendants(inst).map((id) => s.get(id)).find((n) => n.sourceId === label.id);
ok(ilabel.text.size === 33, 'instance on another page follows its main');
s.commit('size');
// deleting the Components page detaches instances elsewhere
toasts.length = 0;
ok(s.removePage(kp.id), 'remove Components page');
K.flush();
ok(s.get(inst) && !s.get(inst).instance && toasts.some((t) => /now plain layers/.test(t)), 'instances on other pages are detached (toast)');
s.commit('del page');
s.undo();
ok(s.pages().some((p) => p.name === 'Components') && s.get(inst).instance && inv(), 'undo brings page + link back');
// deleting a page that holds instances
s.switchPage(s.pages().find((p) => p.name === 'Components').id);
const instPage = s.addPage('Inst');
const i2 = s.withPage(instPage.id, () => K.createInstance(btn.id, { parentId: null, x: 0, y: 0 }));
ok(instPage.roots.includes(i2) && inv(), 'createInstance inside withPage lands on that page');
s.removePage(instPage.id);
K.flush();
ok(!s.get(i2) && s.get(btn.mainId) && K.get(btn.id), 'deleting a page with instances keeps the main');
// a failing starter kit on a fresh doc doesn't leave an empty Components page
s.load({ version: 1, name: 'k2', nodes: {}, roots: [] });
const orig = s.buildFromTree;
s.buildFromTree = function () { throw new Error('nope'); };
try { K.addStarterKit(); } catch (e) {}
s.buildFromTree = orig;
ok(!s.pages().some((p) => p.name === 'Components') && inv(), 'failed kit leaves no Components page behind');

// ---- autosave carries pages ----
s.saveNow();
const saved = s.loadAutosave();
ok(Array.isArray(saved.pages) && saved.page === s.doc.page, 'autosave stores pages + current page');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
