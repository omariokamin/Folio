/* Node test for src/components.js (run: node .dev/components-test.js) */
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
const throws = (fn, re, msg) => { try { fn(); ok(false, msg + ' (did not throw)'); } catch (e) { ok(re.test(e.message), msg + ' → ' + e.message); } };
const byName = (rootId, p) => s.get(K.pathOf ? Object.entries(pathMapOf(rootId)).find(([k]) => k === p)?.[1] : null);
function pathMapOf(rootId) { const out = {}; [rootId, ...s.descendants(rootId)].forEach((id) => { const p = K.pathOf(id, rootId); if (!(p in out)) out[p] = id; }); return out; }
const consistentDoc = () => {
  const d = s.doc; const errs = [];
  Object.values(d.nodes).forEach((n) => {
    if (n.parent && !d.nodes[n.parent]) errs.push('orphan ' + n.id);
    if (n.parent && !d.nodes[n.parent].children.includes(n.id)) errs.push('not in parent ' + n.id);
    n.children.forEach((c) => (!d.nodes[c] || d.nodes[c].parent !== n.id) && errs.push('bad child ' + c));
    if (!n.parent && !d.roots.includes(n.id)) errs.push('lost root ' + n.id);
  });
  return errs;
};

s.load({ version: 1, name: 't', nodes: {}, roots: [] });
K.init();
Folio.brand.init();

// ---- create component ----
const btn = s.buildFromTree({ type: 'frame', name: 'Button', x: 0, y: 0, sizing: { w: 'hug', h: 'hug' }, layout: { mode: 'flex', direction: 'row', padding: [10, 16, 10, 16] }, style: { fills: [{ type: 'solid', color: '#2563eb' }], radius: 8 },
  children: [{ type: 'text', name: 'Label', text: { content: 'Click', color: '#ffffff' } }, { type: 'frame', name: 'Icon', width: 16, height: 16 }] });
const bc = K.create([btn.id]);
ok(bc && btn.component === bc.id && K.componentOf(btn.id) === bc, 'create: frame becomes main in place');
throws(() => K.create([btn.id]), /already a main/, 'create twice refused');
throws(() => K.create([]), /at least one/, 'create empty refused');
const lone = s.buildFromTree({ type: 'text', name: 'Hello', x: 500, y: 500 });
const lc = K.create([lone.id], { name: 'Heading' });
ok(s.get(lc.mainId).type === 'frame' && s.get(lc.mainId).children[0] === lone.id && lc.name === 'Heading', 'create from a text wraps it in a frame');

// ---- instances ----
const i1 = K.createInstance(bc.id, { parentId: null, x: 400, y: 0 });
const i2 = K.createInstance(bc.id, { parentId: null, x: 400, y: 100, overrides: { Label: { text: { content: 'Buy now' } } } });
const lab = (i) => s.get(pathMapOf(i).Label);
ok(s.get(i1).instance.componentId === bc.id && s.get(i1).sourceId === btn.id && lab(i1).sourceId === btn.children[0], 'instance linked with sourceIds');
ok(lab(i2).text.content === 'Buy now' && lab(i1).text.content === 'Click', 'createInstance applies overrides by name path');
ok(s.get(i1).name === 'Button' && s.get(i1).x === 400, 'instance root owns name and position');
throws(() => K.createInstance(bc.id, { overrides: { Nope: { visible: false } } }), /No layer "Nope"/, 'unknown override path refused');
throws(() => K.createInstance(bc.id, { overrides: { Label: { text: { size: 40 } } } }), /can’t be overridden/, 'non-overridable override refused');
throws(() => K.createInstance('k_nope'), /Unknown component/, 'unknown component refused');
throws(() => K.createInstance(bc.id, { parentId: lab(i1).id }), /not a frame/, 'text parent refused');
throws(() => K.createInstance(bc.id, { parentId: s.get(pathMapOf(i1).Icon).id }), /part of an instance/, 'parent inside instance refused');

// ---- override diff semantics ----
const labelMain = s.get(btn.children[0]);
s.update(labelMain.id, { text: { color: '#ff0000', size: 20 } });
K.flush();
ok(lab(i1).text.color === '#ff0000' && lab(i2).text.color === '#ff0000', 'main edit flows to non-overridden field');
ok(lab(i2).text.content === 'Buy now' && lab(i2).text.size === 20, 'instance override survives main edit of other fields; non-overridable follows');
s.update(lab(i1).id, { text: { size: 99, color: '#00ff00' } });
s.update(i1, { layout: { gap: 50 }, width: 333, x: 410 });
K.flush();
ok(lab(i1).text.size === 20 && s.get(i1).layout.gap === 0, 'non-overridable edits on instances are reset');
ok(lab(i1).text.color === '#00ff00' && s.get(i1).x === 410 && s.get(i1).width === 333, 'overridable + root-owned instance edits kept');
s.update(labelMain.id, { text: { color: '#0000ff' } });
K.flush();
ok(lab(i1).text.color === '#00ff00' && lab(i2).text.color === '#0000ff', 'overridden colour kept, others follow');
ok(JSON.stringify(K.overridesOf(i1)) === JSON.stringify({ Label: { 'text.color': '#00ff00' } }), 'overridesOf', K.overridesOf(i1));
const labId = lab(i1).id;
K.resetOverrides(i1, 'Label');
ok(lab(i1).text.color === '#0000ff' && lab(i1).id === labId && !Object.keys(K.overridesOf(i1)).length, 'resetOverrides(path) restores main value, id stable');
K.setOverrides(i1, { Icon: { visible: false }, '': { style: { fills: [{ type: 'solid', color: '#111111' }] } } });
ok(s.get(pathMapOf(i1).Icon).visible === false && s.get(i1).style.fills[0].color === '#111111', 'setOverrides (nested + root)');
throws(() => K.setOverrides(i1, { Label: { text: { color: 42 } } }), /Invalid value/, 'bad override value refused');
ok(K.isOverridable('text.content') && !K.isOverridable('style.radius') && K.isOverridable('x', true) && !K.isOverridable('x', false), 'isOverridable');

// ---- structure sync ----
const iconMainId = btn.children[1];
const before = { label: lab(i2).id };
const badge = s.createNode('text', { name: 'Count', text: { content: '3' } }, btn.id, 0);
K.flush();
ok(s.get(i2).children.length === 3 && s.get(s.get(i2).children[0]).sourceId === badge.id && lab(i2).id === before.label, 'added child appears at the same index; ids stable');
s.reorder(badge.id, 'front');
K.flush();
ok(s.get(s.get(i2).children[2]).sourceId === badge.id, 'reorder follows main');
s.remove(iconMainId);
K.flush();
ok(s.get(i2).children.length === 2 && !Object.values(s.doc.nodes).some((n) => n.sourceId === iconMainId), 'removed main child removed from instances');
ok(consistentDoc().length === 0, 'doc consistent after structure sync', consistentDoc());

// ---- nested instances (Button inside Card) + cycle refusal ----
const card = s.buildFromTree({ type: 'frame', name: 'Card', x: 0, y: 400, width: 300, sizing: { w: 'fixed', h: 'hug' }, layout: { mode: 'flex', direction: 'column', gap: 12 },
  children: [{ type: 'text', name: 'Title', text: { content: 'Title' } }, { type: 'frame', name: 'Actions', sizing: { w: 'hug', h: 'hug' }, layout: { mode: 'flex', direction: 'row' } }] });
const cc = K.create([card.id]);
const actions = card.children[1];
const nb = K.createInstance(bc.id, { parentId: actions, overrides: { Label: { text: { content: 'Learn more' } } } });
const ci = K.createInstance(cc.id, { parentId: null, x: 800, y: 400 });
const nestedIn = (i) => s.get(s.get(pathMapOf(i).Actions).children[0]);
ok(nestedIn(ci).instance.componentId === bc.id && !K.isDirectInstance(nestedIn(ci).id) && K.isDirectInstance(nb), 'nested instance copied into card instance (not direct)');
ok(lab(nestedIn(ci).id).text.content === 'Learn more', 'nested override carried into card instance');
s.update(btn.id, { style: { radius: 20 } });
K.flush();
ok(s.get(nb).style.radius === 20 && nestedIn(ci).style.radius === 20, 'Button edit → Card main → Card instance in one flush (inner first)');
s.update(lab(nestedIn(ci).id).id, { text: { content: 'Go' } });
s.update(card.children[0], { text: { size: 30 } });
K.flush();
ok(lab(nestedIn(ci).id).text.content === 'Go' && s.get(pathMapOf(ci).Title).text.size === 30, 'override on nested layer inside card instance survives card edit');
ok(K.pathOf(lab(nestedIn(ci).id).id, ci) === 'Actions/Button/Label', 'pathOf relative to outer instance');
throws(() => K.createInstance(cc.id, { parentId: card.id }), /can’t contain an instance of itself/, 'instance of Card inside Card refused');
throws(() => K.createInstance(cc.id, { parentId: btn.id }), /can’t contain an instance of itself/, 'instance of Card inside Button (which Card contains) refused');
throws(() => K.detach(nestedIn(ci).id), /detach the outer/, 'detaching a nested instance refused');
// cycle sneaked in via store.move → detached on flush
const sneak = K.createInstance(cc.id, { parentId: null, x: 0, y: 900 });
s.move(sneak, card.id);
const t0 = Date.now(); K.flush();
ok(!s.get(sneak).instance && Date.now() - t0 < 1000 && toasts.some((t) => /itself/.test(t)), 'cycle via move is detached (terminates)');
s.remove(sneak); K.flush();

// ---- variants ----
const v2 = K.addVariant(bc.id, { Style: 'Ghost' });
const set = K.getSet(bc.setId);
ok(set && v2.setId === set.id && s.get(set.frameId).children.includes(btn.id) && s.get(set.frameId).children.includes(v2.mainId), 'addVariant makes a set and duplicates the main into it');
ok(s.get(btn.id).name === 'Style=Default' && s.get(v2.mainId).name === 'Style=Ghost' && s.get(set.frameId).style.border.style === 'dashed', 'variant naming + set frame styling');
ok(s.get(set.frameId).layout.mode === 'flex' && s.get(set.frameId).layout.gap === 24 && s.get(set.frameId).layout.wrap, 'set frame is flex row wrap gap 24');
throws(() => K.addVariant(bc.id, { Style: 'Ghost' }), /already exists/, 'duplicate variant refused');
s.update(v2.mainId, { style: { fills: [] } });
s.update(s.get(v2.mainId).children[0], { text: { color: '#2563eb' } });
K.flush();
K.setSetProps(set.id, { Style: ['Primary', 'Ghost'], Size: ['M', 'L'] });
ok(bc.variant.Style === 'Primary' && bc.variant.Size === 'M' && s.get(btn.id).name === 'Style=Primary, Size=M', 'setSetProps remaps by position (Default→Primary) and adds props');
const v3 = K.addVariant(bc.id, { Size: 'L' });
K.setVariantOf(v3.id, { Style: 'Ghost' });
ok(s.get(v3.mainId).name === 'Style=Ghost, Size=L', 'setVariantOf renames main');
throws(() => K.setVariantOf(v3.id, { Style: 'Ghost', Size: 'M' }), /already exists/, 'setVariantOf duplicate refused');
throws(() => K.setVariantOf(v3.id, { Color: 'Red' }), /Unknown property/, 'setVariantOf unknown prop refused');
// setVariant carrying overrides
const labBefore = lab(i2).id;
K.setVariant(i2, { Style: 'Ghost' });
ok(s.get(i2).instance.componentId === v2.id && lab(i2).text.content === 'Buy now', 'setVariant swaps main, carries text override');
ok(lab(i2).text.color === '#2563eb' && s.get(i2).style.fills.length === 0, 'setVariant takes the new variant\'s non-overridden values');
ok(lab(i2).id === labBefore && s.get(i2).x === 400, 'setVariant keeps layer ids & position');
throws(() => K.setVariant(i2, { Size: 'XL' }), /Unknown value/, 'setVariant unknown value refused');
K.setVariant(i2, { Style: 'Primary' });
ok(s.get(i2).instance.componentId === bc.id && lab(i2).text.content === 'Buy now', 'setVariant back');
// combine
const a = K.create([s.buildFromTree({ type: 'frame', name: 'Tag / Red', x: 0, y: 1200 }).id]);
const b = K.create([s.buildFromTree({ type: 'frame', name: 'Tag / Blue', x: 300, y: 1200 }).id]);
const cs = K.combineAsVariants([a.id, b.id], { prop: 'Color' });
ok(cs.name === 'Tag' && a.variant.Color === 'Red' && b.variant.Color === 'Blue' && s.get(a.mainId).name === 'Color=Red' && K.variantsOf(a.id).length === 2, 'combineAsVariants');
throws(() => K.combineAsVariants([a.id, b.id]), /already part/, 'combine twice refused');

// ---- detach ----
const d1 = K.createInstance(cc.id, { parentId: null, x: 1200, y: 0 });
const innerBtn = nestedIn(d1).id;
K.detach(d1);
ok(!s.get(d1).instance && !s.get(pathMapOf(d1).Title).sourceId, 'detach makes plain layers');
ok(K.isDirectInstance(innerBtn) && s.get(innerBtn).sourceId === btn.id && lab(innerBtn).text.content === 'Learn more', 'detach: nested Button becomes a direct instance with overrides intact');
s.update(labelMain.id, { text: { size: 22 } }); K.flush();
ok(lab(innerBtn).text.size === 22 && lab(innerBtn).text.content === 'Learn more', 'formerly-nested instance now follows Button directly');

// ---- flush on commit ----
s.commit('setup');
s.update(labelMain.id, { text: { size: 18 } });
s.commit('edit main');
const h = JSON.parse(s.history[s.historyIndex]);
ok(h.nodes[lab(i1).id].text.size === 18, 'commit flushes pending propagation into the same undo step');

// ---- undo / redo ----
const sizeNow = () => lab(i1).text.size;
s.undo();
ok(sizeNow() === 22 && s.get(labelMain.id).text.size === 22, 'undo restores main + instances together');
let flushed = K.flush();
ok(flushed === false, 'no propagation needed after undo');
s.redo();
ok(sizeNow() === 18 && K.flush() === false, 'redo consistent, no propagation needed');

// ---- main deletion ----
toasts.length = 0;
const nInst = Object.values(s.doc.nodes).filter((n) => n.instance && n.instance.componentId === cc.id).length;
s.remove(card.id);
s.commit('delete card');
ok(!K.get(cc.id) && !Object.values(s.doc.nodes).some((n) => n.instance && n.instance.componentId === cc.id) && toasts.some((t) => /was deleted/.test(t)), `main deleted → ${nInst} instance(s) detached + toast`, toasts);
ok(K.isDirectInstance(nestedIn(ci).id) && lab(nestedIn(ci).id).text.content === 'Go', 'deleted Card: nested Buttons inside its instances become direct Button instances, overrides kept');
s.undo();
ok(K.get(cc.id) && s.get(ci).instance.componentId === cc.id && K.flush() === false, 'undo restores the main and its links');
s.redo();

// ---- copy/paste of a main → plain frame; duplicate instance → instance ----
const dupMain = s.duplicate([btn.id])[0];
const dupInst = s.duplicate([i1])[0];
K.flush();
ok(!s.get(dupMain).component && s.get(dupInst).instance.componentId === bc.id, 'duplicated main is a plain copy; duplicated instance stays an instance');

// ---- save / load round-trip ----
const json = s.serialize();
s.load(JSON.parse(json));
ok(K.list().length === Object.keys(JSON.parse(json).components).length && K.flush() === false, 'load: registry kept, no needless propagation');
s.update(labelMain.id, { text: { size: 15 } }); K.flush();
ok(lab(i1).text.size === 15, 'propagation works after load');
ok(consistentDoc().length === 0, 'doc consistent at the end', consistentDoc());

// ---- starter kit (no brand, then brand) ----
s.load({ version: 1, name: 'kit', nodes: {}, roots: [] });
const ids = K.addStarterKit();
const names = K.sets().map((x) => x.name).concat(K.list().filter((c) => !c.setId).map((c) => c.name));
ok(ids.length === 9 + 3 + 3 + 3 + 1 + 2 && ['Button', 'Badge', 'Avatar', 'Input', 'Card', 'Nav bar'].every((n) => names.includes(n)), 'starter kit: ' + ids.length + ' comps: ' + names.join(', '));
const kitCard = K.list().find((c) => c.name === 'Card');
const kitBtn = K.list().find((c) => c.name === 'Button' && c.variant.Style === 'Primary' && c.variant.Size === 'M');
ok(s.get(kitBtn.mainId).name === 'Style=Primary, Size=M' && s.get(kitBtn.mainId).height === 40, 'kit Button M is 40px, named by variant');
const cardBtn = Object.values(s.doc.nodes).find((n) => n.instance && s.isAncestor(kitCard.mainId, n.id));
ok(cardBtn && cardBtn.instance.componentId === kitBtn.id && K.isDirectInstance(cardBtn.id), 'kit Card contains a direct Button instance');
s.update(kitBtn.mainId, { style: { fills: [{ type: 'solid', color: '#000000', visible: true }] } }); K.flush();
ok(cardBtn.style.fills[0].color === '#000000', 'kit Button edit reaches the Card\'s Button');
ok(K.addStarterKit().length === 0, 'starter kit twice adds nothing');
const kitJson = JSON.stringify(s.doc);
ok(!/var\(--/.test(kitJson), 'no brand → literals only');

s.load({ version: 1, name: 'kit2', nodes: {}, roots: [] });
const tpl = Folio.brand.templates()[0];
s.doc.brand = Folio.brand.normalize(tpl);
K.addStarterKit();
const j2 = JSON.stringify(s.doc);
ok(/var\(--color-primary\)/.test(j2) && /var\(--font-body\)/.test(j2) && /var\(--color-danger\)/.test(j2) && /var\(--color-success\)/.test(j2), 'brand → tokens used (primary, font-body, danger, success)');

// ---- performance: 50 instances of a 10-layer component ----
s.load({ version: 1, name: 'perf', nodes: {}, roots: [] });
const tenLayer = { type: 'frame', name: 'Row', layout: { mode: 'flex', direction: 'row' }, children: Array.from({ length: 3 }, (_, i) => ({ type: 'frame', name: 'Group ' + i, layout: { mode: 'flex' }, children: [{ type: 'text', name: 'A' }, { type: 'text', name: 'B' }] })) };
const pm = s.buildFromTree(tenLayer);
const pc = K.create([pm.id]);
ok(s.descendants(pm.id).length + 1 === 10, 'perf component has 10 layers');
for (let i = 0; i < 50; i++) K.createInstance(pc.id, { parentId: null, x: i * 10, y: 500 });
const textInMain = s.descendants(pm.id).map(s.get.bind(s)).find((n) => n.type === 'text');
let worst = 0;
for (let r = 0; r < 5; r++) {
  s.update(textInMain.id, { text: { size: 10 + r } });
  const t = process.hrtime.bigint(); K.flush(); worst = Math.max(worst, Number(process.hrtime.bigint() - t) / 1e6);
}
const t2 = process.hrtime.bigint(); K.flush(); const idle = Number(process.hrtime.bigint() - t2) / 1e6;
ok(worst < 50, `propagation to 50 instances: worst ${worst.toFixed(1)} ms, idle flush ${idle.toFixed(1)} ms`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
