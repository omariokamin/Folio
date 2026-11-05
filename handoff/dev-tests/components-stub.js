/* Test stub of Folio.components following SPEC v0.4 (used only until src/components.js lands). */
window.Folio = window.Folio || {};
(function () {
  const store = Folio.store;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const rid = (p) => p + '_' + Math.random().toString(36).slice(2, 6);
  const OVR = ['text.content', 'text.color', 'style.fills', 'style.border.color', 'image.src', 'image.fit', 'visible'];
  const getP = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const setP = (o, path, v) => {
    const ks = path.split('.');
    let t = o;
    ks.slice(0, -1).forEach((k) => (t = t[k] = t[k] || {}));
    t[ks[ks.length - 1]] = clone(v);
  };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const reg = () => (store.doc.components = store.doc.components || {});
  const sreg = () => (store.doc.componentSets = store.doc.componentSets || {});
  const emit = () => store.emit('components');

  const list = () => Object.values(reg());
  const sets = () => Object.values(sreg());
  const get = (id) => reg()[id] || null;
  const getSet = (id) => sreg()[id] || null;
  const componentOf = (id) => {
    const n = store.get(id);
    return n && n.component && get(n.component) && get(n.component).mainId === id ? get(n.component) : null;
  };
  const mainRootOf = (id) => [...store.ancestors(id), id].reverse().find((a) => componentOf(a)) || null;
  const instanceRootOf = (id) => (store.get(id) ? [...store.ancestors(id), id].reverse().find((a) => store.get(a).instance) || null : null);
  const isDirectInstance = (id) => !!(store.get(id) && store.get(id).instance && !store.ancestors(id).some((a) => store.get(a).instance));
  const isOverridable = (f, isRoot) => OVR.includes(f) || (isRoot && ['x', 'y', 'width', 'height', 'sizing', 'name'].includes(f));
  function pathOf(id) {
    const r = instanceRootOf(id) || mainRootOf(id);
    if (!r || r === id) return '';
    const anc = store.ancestors(id);
    return anc.slice(anc.indexOf(r) + 1).concat(id).map((a) => store.get(a).name).join('/');
  }
  const subtree = (id) => [id, ...store.descendants(id)];
  function overridesOf(iid) {
    const out = {};
    subtree(iid).forEach((nid) => {
      const n = store.get(nid);
      const m = store.get(n.sourceId);
      if (!m) return;
      OVR.forEach((f) => {
        if (getP(n, f) !== undefined && !eq(getP(n, f), getP(m, f))) (out[pathOf(nid)] = out[pathOf(nid)] || {})[f] = clone(getP(n, f));
      });
    });
    return out;
  }
  const variantsOf = (cid) => {
    const c = get(cid);
    return c && c.setId ? list().filter((x) => x.setId === c.setId) : c ? [c] : [];
  };

  function create(ids, { name } = {}) {
    if (ids.some((id) => instanceRootOf(id))) throw new Error('Layers inside an instance cannot become a component.');
    let id = ids[0];
    if (ids.length > 1 || store.get(id).type !== 'frame') id = store.wrapInFrame(ids, { flex: true }).id;
    const n = store.get(id);
    const c = { id: rid('k'), name: name || n.name, mainId: id, setId: null, variant: {}, description: '', snapshot: null };
    reg()[c.id] = c;
    n.component = c.id;
    c.snapshot = store.toTree(id);
    c._old = snapMap(id);
    store.emit('change');
    emit();
    return c;
  }

  function build(mainId, parentId, index) {
    const map = [];
    const walk = (mid) => ({ ...store.toTree(mid), children: store.get(mid).children.map(walk), _src: mid });
    const tree = walk(mainId);
    const strip = (t) => {
      delete t.component;
      t.sourceId = t._src;
      delete t._src;
      t.children.forEach(strip);
    };
    strip(tree);
    return store.buildFromTree(tree, parentId, index);
  }
  function createInstance(cid, { parentId, index, x, y, overrides } = {}) {
    const c = get(cid);
    if (parentId === undefined) {
      const p = store.primary();
      parentId = p && p.type === 'frame' ? p.id : null;
    }
    const root = build(c.mainId, parentId || null, index);
    root.instance = { componentId: cid };
    root.name = c.setId ? getSet(c.setId).name : c.name;
    if (x !== undefined) Object.assign(root, { x, y });
    else if (!parentId) {
      const r = Folio.canvas.nodeRect(c.mainId);
      Object.assign(root, { x: Math.round(r.x + r.width + 40), y: Math.round(r.y) });
    }
    if (overrides) setOverrides(root.id, overrides);
    store.emit('change');
    return root.id;
  }
  function setOverrides(iid, ovr) {
    subtree(iid).forEach((nid) => {
      const o = ovr[pathOf(nid)];
      if (o) store.update(nid, o);
    });
  }
  function resetOverrides(iid, path) {
    subtree(iid).forEach((nid) => {
      if (path != null && pathOf(nid) !== path) return;
      const n = store.get(nid);
      const m = store.get(n.sourceId);
      if (m) OVR.forEach((f) => getP(m, f) !== undefined && setP(n, f, getP(m, f)));
    });
    store.emit('change');
  }
  function detach(iid) {
    subtree(iid).forEach((nid) => {
      const n = store.get(nid);
      delete n.sourceId;
      if (nid === iid) delete n.instance;
    });
    store.emit('change');
  }
  function snapMap(mid) {
    const out = {};
    subtree(mid).forEach((id) => (out[id] = clone(store.get(id))));
    return out;
  }
  function syncNode(iid, mid, old, isRoot) {
    const n = store.get(iid);
    const m = store.get(mid);
    const o = old[mid];
    const keep = {};
    OVR.forEach((f) => {
      const iv = getP(n, f);
      if (o && iv !== undefined && !eq(iv, getP(o, f))) keep[f] = clone(iv);
    });
    const rootKeep = isRoot ? { x: n.x, y: n.y, width: n.width, height: n.height, sizing: clone(n.sizing), name: n.name, instance: n.instance } : null;
    const { id, parent, children, component, ...rest } = clone(m);
    Object.assign(n, rest);
    delete n.component;
    if (rootKeep) Object.assign(n, rootKeep);
    Object.entries(keep).forEach(([f, v]) => setP(n, f, v));
    n.sourceId = mid;
    const kids = [];
    m.children.forEach((mc) => {
      let ic = n.children.find((c) => store.get(c) && store.get(c).sourceId === mc);
      if (!ic) {
        ic = build(mc, iid).id;
      } else syncNode(ic, mc, old, false);
      kids.push(ic);
    });
    n.children.filter((c) => !kids.includes(c)).forEach((c) => store.remove([c]));
    n.children = kids;
  }
  function propagate(c) {
    const snap = store.toTree(c.mainId);
    if (eq(snap, c.snapshot)) return;
    const old = c._old || snapMap(c.mainId);
    Object.values(store.doc.nodes)
      .filter((n) => n.instance && n.instance.componentId === c.id && isDirectInstance(n.id))
      .forEach((inst) => syncNode(inst.id, c.mainId, old, true));
    c.snapshot = snap;
    c._old = snapMap(c.mainId);
  }
  let t = 0;
  function flush() {
    clearTimeout(t);
    t = 0;
    list().forEach((c) => store.get(c.mainId) && propagate(c));
    // mains deleted → detach
    list().forEach((c) => {
      if (store.get(c.mainId)) return;
      Object.values(store.doc.nodes).filter((n) => n.instance && n.instance.componentId === c.id).forEach((n) => detach(n.id));
      delete reg()[c.id];
      emit();
    });
  }

  function setSetProps(sid, props) {
    getSet(sid).props = clone(props);
    emit();
    store.emit('change');
  }
  function setVariantOf(cid, variant) {
    const c = get(cid);
    c.variant = clone(variant);
    store.get(c.mainId).name = Object.entries(variant).map(([k, v]) => `${k}=${v}`).join(', ');
    emit();
    store.emit('change');
  }
  function setVariant(iid, patch) {
    const inst = store.get(iid);
    const c = get(inst.instance.componentId);
    const want = Object.assign({}, c.variant, patch);
    const target = variantsOf(c.id).find((x) => eq(Object.keys(want).sort().map((k) => x.variant[k]), Object.keys(want).sort().map((k) => want[k])));
    if (!target) throw new Error('No variant with that combination.');
    const ovr = overridesOf(iid);
    const keep = { x: inst.x, y: inst.y, name: inst.name };
    const parent = inst.parent;
    const idx = store.siblingsOf(iid).indexOf(iid);
    store.remove([iid]);
    const r = build(target.mainId, parent, idx);
    r.instance = { componentId: target.id };
    Object.assign(r, keep);
    setOverrides(r.id, ovr);
    store.select([r.id]);
    return r.id;
  }
  function ensureSet(c) {
    if (c.setId) return getSet(c.setId);
    const main = store.get(c.mainId);
    const frame = store.createNode(
      'frame',
      {
        name: c.name,
        x: main.x,
        y: main.y,
        sizing: { w: 'hug', h: 'hug' },
        layout: { mode: 'flex', direction: 'row', wrap: true, gap: 24, padding: [24, 24, 24, 24] },
        style: { fills: [], border: { width: 1, color: '#9747ff', style: 'dashed' }, radius: 8 },
      },
      main.parent,
      store.siblingsOf(main.id).indexOf(main.id)
    );
    store.move(main.id, frame.id);
    const s = { id: rid('s'), name: c.name, frameId: frame.id, props: { 'Property 1': ['Default'] } };
    sreg()[s.id] = s;
    c.setId = s.id;
    setVariantOf(c.id, { 'Property 1': 'Default' });
    return s;
  }
  function addVariant(cid, variant) {
    const c = get(cid);
    const s = ensureSet(c);
    if (!variant || !Object.keys(variant).length) variant = { 'Property 1': 'Variant ' + (variantsOf(cid).length + 1) };
    Object.entries(variant).forEach(([k, v]) => {
      s.props[k] = s.props[k] || [];
      if (!s.props[k].includes(v)) s.props[k].push(v);
    });
    const tree = store.toTree(c.mainId);
    const node = store.buildFromTree(tree, s.frameId);
    const nc = { id: rid('k'), name: c.name, mainId: node.id, setId: s.id, variant: {}, description: '', snapshot: null };
    reg()[nc.id] = nc;
    node.component = nc.id;
    setVariantOf(nc.id, variant);
    nc.snapshot = store.toTree(node.id);
    nc._old = snapMap(node.id);
    emit();
    return nc;
  }

  function addStarterKit() {
    const ab = store.createNode('frame', { name: 'Components', x: -1400, y: 0, width: 1200, height: 900, layout: { mode: 'flex', direction: 'column', gap: 48, padding: [48, 48, 48, 48] }, sizing: { w: 'fixed', h: 'hug' } });
    const made = [];
    const mk = (tree, parent) => {
      const n = store.buildFromTree(tree, parent);
      return n;
    };
    // Button set
    const btnSet = store.createNode('frame', { name: 'Button', sizing: { w: 'hug', h: 'hug' }, layout: { mode: 'flex', direction: 'row', wrap: true, gap: 24, padding: [24, 24, 24, 24] }, style: { fills: [], border: { width: 1, color: '#9747ff', style: 'dashed' }, radius: 8 } }, ab.id);
    const s = { id: rid('s'), name: 'Button', frameId: btnSet.id, props: { Style: ['Primary', 'Secondary', 'Ghost'], Size: ['M'] } };
    sreg()[s.id] = s;
    const styles = { Primary: ['#6d5efc', '#ffffff'], Secondary: ['#ececf1', '#111111'], Ghost: ['#ffffff00', '#6d5efc'] };
    Object.keys(styles).forEach((st) => {
      const n = mk({ type: 'frame', name: `Style=${st}, Size=M`, sizing: { w: 'hug', h: 'hug' }, layout: { mode: 'flex', direction: 'row', gap: 8, padding: [10, 18, 10, 18], align: 'center' }, style: { fills: [{ type: 'solid', color: styles[st][0] }], radius: 8 }, children: [{ type: 'text', name: 'Label', text: { content: 'Button', color: styles[st][1], weight: 600, size: 14 } }] }, btnSet.id);
      const c = { id: rid('k'), name: 'Button', mainId: n.id, setId: s.id, variant: { Style: st, Size: 'M' }, description: '', snapshot: null };
      reg()[c.id] = c;
      n.component = c.id;
      c.snapshot = store.toTree(n.id);
      c._old = snapMap(n.id);
      made.push(c.id);
    });
    // Badge
    const badge = mk({ type: 'frame', name: 'Badge', sizing: { w: 'hug', h: 'hug' }, layout: { mode: 'flex', direction: 'row', padding: [4, 10, 4, 10] }, style: { fills: [{ type: 'solid', color: '#ede9fe' }], radius: 999 }, children: [{ type: 'text', name: 'Label', text: { content: 'New', color: '#5b21b6', size: 12, weight: 600 } }] }, ab.id);
    made.push(create([badge.id]).id);
    // Card with nested button instance
    const card = mk({ type: 'frame', name: 'Card', width: 280, sizing: { w: 'fixed', h: 'hug' }, layout: { mode: 'flex', direction: 'column', gap: 12, padding: [20, 20, 20, 20] }, style: { fills: [{ type: 'solid', color: '#ffffff' }], radius: 12, border: { width: 1, color: '#e4e4e7', style: 'solid' } }, children: [{ type: 'text', name: 'Title', text: { content: 'Card title', size: 18, weight: 700 } }, { type: 'text', name: 'Body', sizing: { w: 'fill', h: 'hug' }, text: { content: 'A short description goes here.', size: 14, color: '#52525b' } }] }, ab.id);
    const cc = create([card.id]);
    createInstance(made[0], { parentId: card.id });
    cc.snapshot = store.toTree(card.id);
    cc._old = snapMap(card.id);
    made.push(cc.id);
    // Nav bar
    const nav = mk({ type: 'frame', name: 'Nav bar', width: 1000, height: 64, sizing: { w: 'fixed', h: 'fixed' }, layout: { mode: 'flex', direction: 'row', justify: 'space-between', align: 'center', padding: [0, 24, 0, 24] }, style: { fills: [{ type: 'solid', color: '#111113' }] }, children: [{ type: 'text', name: 'Logo', text: { content: 'Brand', color: '#ffffff', weight: 700 } }, { type: 'text', name: 'Links', text: { content: 'Home  About  Contact', color: '#a1a1aa' } }] }, ab.id);
    made.push(create([nav.id]).id);
    store.emit('change');
    emit();
    return made;
  }

  function init() {
    store.on('change', () => {
      clearTimeout(t);
      t = setTimeout(flush, 100);
    });
    const c0 = store.commit.bind(store);
    store.commit = (label) => {
      flush();
      c0(label);
    };
  }

  Folio.components = {
    init, flush, list, sets, get, getSet, componentOf, mainRootOf, instanceRootOf, isDirectInstance, isOverridable,
    overridesOf, pathOf, variantsOf, create, createInstance, setOverrides, resetOverrides, detach, addVariant,
    setSetProps, setVariantOf, setVariant, addStarterKit, __stub: true,
  };
})();
