// node .dev/prototype/normalize-test.js — unit test for Folio.prototype.normalize (no browser)
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..', '..');
const ctx = { console, setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem() {} } };
ctx.window = ctx;
vm.createContext(ctx);
['src/state.js', 'src/prototype.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
const { store, prototype: P } = ctx.Folio;
store.newDoc();
const a = store.createNode('frame', { name: 'Home' });
const btn = store.createNode('frame', { name: 'Btn' }, a.id);
const b = store.createNode('frame', { name: 'Pricing' });
const other = store.addPage('Other');
let c;
store.withPage(other.id, () => (c = store.createNode('frame', { name: 'Elsewhere' })));
const J = (v) => JSON.parse(JSON.stringify(v));
const n = (list) => J(P.normalize(btn.id, list));

let r = n([{ action: 'navigate', target: b.id }]);
assert.deepStrictEqual(r.interactions, [{ trigger: 'click', action: 'navigate', target: b.id, transition: { type: 'instant', duration: 300 } }]);
assert.strictEqual(r.warnings.length, 0);
r = n([{ action: 'navigate', target: b.id, transition: { type: 'slide', duration: 9999 } }]);
assert.deepStrictEqual(r.interactions[0].transition, { type: 'slide', duration: 2000, direction: 'left' });
r = n([{ action: 'navigate', target: b.id, transition: { type: 'slide', direction: 'up', duration: -5 } }]);
assert.deepStrictEqual(r.interactions[0].transition, { type: 'slide', duration: 0, direction: 'up' });
r = n([{ action: 'navigate', target: b.id, transition: { type: 'warp' } }]);
assert.strictEqual(r.interactions[0].transition.type, 'instant');
// own artboard, other page, inner layer, missing
for (const t of [a.id, c.id, btn.id, 'nope', undefined]) {
  r = n([{ action: 'navigate', target: t }]);
  assert.strictEqual(r.interactions.length, 0, 'navigate to ' + t);
  assert.strictEqual(r.warnings.length, 1);
}
// overlay may target own artboard? spec only forbids for navigate
r = n([{ action: 'overlay', target: b.id }]);
assert.deepStrictEqual(r.interactions[0].overlay, { position: 'center', closeOnOutside: true, backdrop: '#0f172a66' });
r = n([{ action: 'overlay', target: b.id, overlay: { position: 'bottom', closeOnOutside: false, backdrop: '#00000080' } }]);
assert.deepStrictEqual(r.interactions[0].overlay, { position: 'bottom', closeOnOutside: false, backdrop: '#00000080' });
r = n([{ action: 'overlay', target: c.id }]);
assert.strictEqual(r.interactions.length, 0);
// urls
for (const u of ['https://example.com', 'http://x.io/a?b=1', 'mailto:hi@x.com', 'tel:+1 555 0100']) assert.strictEqual(n([{ action: 'url', url: u }]).interactions[0].url, u);
for (const u of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,hi', 'example.com', 'https://', '', null, ' javascript:x', 'vbscript:x'])
  assert.strictEqual(n([{ action: 'url', url: u }]).interactions.length, 0, 'url ' + u);
// back / close keep only trigger + action
assert.deepStrictEqual(n([{ action: 'back', target: b.id, url: 'x' }, { action: 'close' }]).interactions, [{ trigger: 'click', action: 'back' }, { trigger: 'click', action: 'close' }]);
// unknown action / trigger / junk
r = n([{ action: 'explode' }, { trigger: 'hover', action: 'back' }, null, 5]);
assert.strictEqual(r.interactions.length, 0);
assert.strictEqual(r.warnings.length, 4);
// empty / null / single object
assert.deepStrictEqual(n([]).interactions, []);
assert.deepStrictEqual(n(null).interactions, []);
assert.strictEqual(n({ action: 'back' }).interactions.length, 1);
// unknown node
assert.strictEqual(J(P.normalize('zzz', [{ action: 'back' }])).warnings.length, 1);
// does not mutate input or doc
const input = [{ action: 'navigate', target: b.id }];
const before = store._historyJson();
P.normalize(btn.id, input);
assert.deepStrictEqual(input, [{ action: 'navigate', target: b.id }]);
assert.strictEqual(store._historyJson(), before);
// backdrop must be a colour
for (const bd of ['url(https://x/y.png)', 'red;position:fixed', 'var(--x)', 'expression(1)'])
  assert.strictEqual(n([{ action: 'overlay', target: b.id, overlay: { backdrop: bd } }]).interactions[0].overlay.backdrop, '#0f172a66', bd);
for (const bd of ['#000', '#11223344', 'rgba(0, 0, 0, 0.4)', 'hsl(200 50% 50% / 0.5)', 'transparent'])
  assert.strictEqual(n([{ action: 'overlay', target: b.id, overlay: { backdrop: bd } }]).interactions[0].overlay.backdrop, bd, bd);
// startOf
const pg = store.currentPage();
assert.strictEqual(P.startOf(pg.id), a.id);
pg.start = b.id;
assert.strictEqual(P.startOf(), b.id);
pg.start = c.id; // an artboard of another page = dangling
assert.strictEqual(P.startOf(pg.id), a.id);
assert.strictEqual(P.startOf(other.id), c.id);
// duplicatePage re-points targets + start at the copies
pg.start = b.id;
store.update(btn.id, { interactions: [{ trigger: 'click', action: 'navigate', target: b.id }, { trigger: 'click', action: 'back' }] });
const dup = store.duplicatePage(pg.id);
const btnCopy = store.descendants(dup.roots[0])[0];
assert.strictEqual(dup.start, dup.roots[1]);
assert.strictEqual(store.get(btnCopy).interactions[0].target, dup.roots[1]);
assert.strictEqual(store.get(btn.id).interactions[0].target, b.id);
assert.strictEqual(P.normalize(btnCopy, store.get(btnCopy).interactions).warnings.length, 0);
console.log('normalize: all tests passed');
