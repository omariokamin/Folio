/*
 * components.js — components & variants engine (SPEC "Components & variants (v0.4)").
 *
 * A MAIN component is an ordinary frame on the canvas marked `node.component = compId`.
 * An INSTANCE is an ordinary subtree whose root has `node.instance = {componentId}` and whose
 * nodes all carry `sourceId` (their counterpart in the main). The registry lives in the document
 * (`doc.components`, `doc.componentSets`), so saved files and undo/redo carry everything.
 *
 * Propagation is diff-based: each component keeps a `snapshot` of its main at the last
 * propagation. An instance field that differs from the snapshot is an override and is kept;
 * everything else takes the main's current value. `flush()` runs it synchronously; it also runs
 * ~100 ms after any 'change', and right before every store.commit() (wrapped in init()).
 *
 *   Folio.components.init() / flush()
 *   list() sets() get(id) getSet(id) componentOf(nodeId) mainRootOf(nodeId) instanceRootOf(nodeId)
 *   isDirectInstance(nodeId) isOverridable(field, isRoot) overridesOf(instId) pathOf(nodeId, rootId?) variantsOf(compId)
 *   create(nodeIds, {name}) createInstance(compId, {parentId, index, x, y, overrides})
 *   setOverrides(instId, overrides) resetOverrides(instId, path?) detach(instId) update(compOrSetId, {name, description})
 *   addVariant(compId, props?) combineAsVariants(compIds, {name, prop}) setSetProps(setId, props)
 *   setVariantOf(compId, variant) setVariant(instId, patch) addStarterKit()
 *
 * Mutations throw an Error (document untouched) on bad input, emit 'change' + 'components',
 * and never commit — callers commit.
 */
window.Folio = window.Folio || {};

(function () {
  const OVR = ['text.content', 'text.color', 'style.fills', 'style.border.color', 'image.src', 'image.fit', 'visible'];
  // `locked` is owned too, so locking an instance doesn't get undone by the next propagation
  const ROOT_OWN = ['x', 'y', 'width', 'height', 'sizing', 'name', 'locked'];
  const FILL_TYPES = ['solid', 'linear', 'radial', 'conic', 'mesh', 'image', 'noise'];
  const SET_FRAME = {
    sizing: { w: 'hug', h: 'hug' },
    layout: { mode: 'flex', direction: 'row', wrap: true, gap: 24, justify: 'flex-start', align: 'flex-start', padding: [24, 24, 24, 24] },
    style: { fills: [], radius: 8, border: { width: 1, color: '#8b5cf6', style: 'dashed' } },
  };
  const DEBOUNCE = 100;

  const S = () => Folio.store;
  const D = () => Folio.store.doc;
  const nodes = () => Folio.store.doc.nodes;
  const node = (id) => (id && Folio.store.doc.nodes[id]) || null;
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const uid = () => (Folio.util && Folio.util.uid ? Folio.util.uid() : 'n_' + Math.random().toString(36).slice(2, 9));
  const rid = (p) => p + Math.random().toString(36).slice(2, 8);
  const toast = (msg, kind) => (Folio.ui && Folio.ui.toast ? Folio.ui.toast(msg, kind) : console.log('[Folio]', msg));
  const compsMap = () => (isObj(D().components) ? D().components : {});
  const setsMap = () => (isObj(D().componentSets) ? D().componentSets : {});
  function registry() {
    const d = D();
    if (!isObj(d.components)) d.components = {};
    if (!isObj(d.componentSets)) d.componentSets = {};
    return d;
  }

  // ---------- small helpers ----------
  function eq(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
      return true;
    }
    if (Array.isArray(b)) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) if (!(k in b) || !eq(a[k], b[k])) return false;
    return true;
  }
  function getPath(o, path) {
    for (const k of path.split('.')) {
      if (!o || typeof o !== 'object') return undefined;
      o = o[k];
    }
    return o;
  }
  function setPath(o, path, v) {
    const ks = path.split('.');
    for (let i = 0; i < ks.length - 1; i++) o = isObj(o[ks[i]]) ? o[ks[i]] : (o[ks[i]] = {});
    o[ks[ks.length - 1]] = v;
  }
  function delPath(o, path) {
    const ks = path.split('.');
    for (let i = 0; i < ks.length - 1; i++) if (!isObj((o = o[ks[i]]))) return;
    delete o[ks[ks.length - 1]];
  }
  /** setPath that copies objects along the path instead of mutating them (they belong to the main). */
  function cowSet(o, path, v) {
    const ks = path.split('.');
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] = isObj(o[ks[i]]) ? { ...o[ks[i]] } : {};
    o[ks[ks.length - 1]] = v;
  }
  const subtree = (id) => [id, ...S().descendants(id)];

  /** The main's tree as stored in `comp.snapshot` (like store.toTree, but ids kept so sourceIds resolve). */
  function snap(id) {
    const n = node(id);
    if (!n) return null;
    const { parent, children, ...rest } = n;
    const o = clone(rest);
    o.children = children.map(snap).filter(Boolean);
    return o;
  }
  function indexSnap(tree, out = {}) {
    if (tree) {
      out[tree.id] = tree;
      (tree.children || []).forEach((c) => indexSnap(c, out));
    }
    return out;
  }

  // ---------- queries ----------
  const list = () => Object.values(compsMap());
  const sets = () => Object.values(setsMap());
  const get = (id) => compsMap()[id] || null;
  const getSet = (id) => setsMap()[id] || null;
  function componentOf(nodeId) {
    const n = node(nodeId);
    const c = n && n.component ? get(n.component) : null;
    return c && c.mainId === nodeId ? c : null;
  }
  function mainRootOf(nodeId) {
    for (let n = node(nodeId); n; n = node(n.parent)) if (componentOf(n.id)) return n.id;
    return null;
  }
  function instanceRootOf(nodeId) {
    for (let n = node(nodeId); n; n = node(n.parent)) if (n.instance) return n.id;
    return null;
  }
  /** Outermost instance root above-or-at the node (the one that is propagated directly). */
  function outerInstanceOf(nodeId) {
    let out = null;
    for (let n = node(nodeId); n; n = node(n.parent)) if (n.instance) out = n.id;
    return out;
  }
  function isDirectInstance(nodeId) {
    const n = node(nodeId);
    return !!(n && n.instance) && !instanceRootOf(n.parent);
  }
  function isOverridable(field, isRoot) {
    const f = String(field || '');
    const hit = (p) => f === p || f.startsWith(p + '.');
    return OVR.some(hit) || (!!isRoot && ROOT_OWN.some(hit));
  }
  /** { path: nodeId } for a subtree; root is '' and paths join layer names with '/'. First name wins. */
  function pathMap(rootId) {
    const out = {};
    const walk = (id, p) => {
      const n = node(id);
      if (!n) return;
      if (!(p in out)) out[p] = id;
      n.children.forEach((c) => walk(c, p ? p + '/' + node(c).name : node(c).name));
    };
    walk(rootId, '');
    return out;
  }
  function pathOf(nodeId, rootId) {
    if (!node(nodeId)) return null;
    if (!rootId) for (let n = node(nodeId); n && !rootId; n = node(n.parent)) if (n.instance || componentOf(n.id)) rootId = n.id;
    if (!rootId || (rootId !== nodeId && !S().isAncestor(rootId, nodeId))) return null;
    const names = [];
    for (let n = node(nodeId); n && n.id !== rootId; n = node(n.parent)) names.unshift(n.name);
    return names.join('/');
  }
  function overridesOf(instanceId) {
    const r = node(instanceId);
    if (!r || !r.instance) return {};
    const outer = node(outerInstanceOf(instanceId));
    const comp = get(outer.instance.componentId);
    if (!comp) return {};
    const sIdx = indexSnap(comp.snapshot);
    const out = {};
    const pm = pathMap(instanceId);
    Object.keys(pm).forEach((path) => {
      const n = node(pm[path]);
      const sn = sIdx[n.sourceId];
      if (!sn) return;
      OVR.forEach((p) => {
        const v = getPath(n, p);
        if (v !== undefined && !eq(v, getPath(sn, p))) (out[path] = out[path] || {})[p] = clone(v);
      });
    });
    return out;
  }
  function variantsOf(compId) {
    const c = get(compId);
    if (!c) return [];
    if (!c.setId || !getSet(c.setId)) return [c];
    const set = getSet(c.setId);
    const frame = node(set.frameId);
    const order = frame ? frame.children : [];
    return list()
      .filter((x) => x.setId === c.setId)
      .sort((a, b) => order.indexOf(a.mainId) - order.indexOf(b.mainId));
  }

  // ---------- dependency graph (which component's main holds direct instances of which) ----------
  function hostsOf(nodeId) {
    const out = [];
    for (let n = node(nodeId); n; n = node(n.parent)) if (componentOf(n.id)) out.push(n.component);
    return out;
  }
  function depsGraph() {
    const g = {};
    Object.values(nodes()).forEach((n) => {
      if (!n.instance || !get(n.instance.componentId) || !isDirectInstance(n.id)) return;
      hostsOf(n.parent).forEach((h) => (g[h] = g[h] || new Set()).add(n.instance.componentId));
    });
    return g;
  }
  function reaches(g, from, to, seen = new Set()) {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return [...(g[from] || [])].some((d) => reaches(g, d, to, seen));
  }
  /** Would placing an instance of compId inside parentId make a component contain itself? */
  function cycleAt(parentId, compId, g = depsGraph()) {
    const host = hostsOf(parentId).find((h) => reaches(g, compId, h));
    return host ? get(host) : null;
  }

  // ---------- propagation ----------
  /** The node an instance node should become: main values + kept overrides (+ root-owned fields). */
  function merged(M, I, sn, isRoot, comp) {
    const out = {};
    for (const k in M) if (k !== 'parent' && k !== 'children' && k !== 'component' && k !== 'id') out[k] = M[k];
    out.sourceId = M.id;
    if (I) {
      if (sn)
        for (const p of OVR) {
          const iv = getPath(I, p);
          if (iv !== undefined && !eq(iv, getPath(sn, p))) cowSet(out, p, iv);
        }
      if (isRoot) for (const k of ROOT_OWN) if (I[k] !== undefined) out[k] = I[k];
    }
    if (isRoot) out.instance = I && isObj(I.instance) ? I.instance : { componentId: comp.id };
    return out;
  }
  /** Bring one direct instance in line with its main. sIdx = index of the snapshot overrides are judged against. */
  function syncInstance(rootId, comp, sIdx) {
    const all = nodes();
    const root = all[rootId];
    const main = all[comp.mainId];
    if (!root || !main) return false;
    const ids = subtree(rootId);
    const bySource = {};
    ids.forEach((id) => {
      const s = all[id].sourceId;
      if (s && id !== rootId && !(s in bySource)) bySource[s] = id;
    });
    bySource[main.id] = rootId;
    const used = new Set();
    let changed = false;
    const visit = (mId, parentId, isRoot) => {
      const M = all[mId];
      let iid = bySource[mId];
      let I = iid ? all[iid] : null;
      if (I && !isRoot && (I.type !== M.type || used.has(iid))) I = null;
      if (!I) iid = uid();
      used.add(iid);
      const out = merged(M, I, sIdx[mId], isRoot, comp);
      out.id = iid;
      out.parent = isRoot ? root.parent : parentId;
      out.children = M.children.map((c) => visit(c, iid, false));
      if (!I) {
        all[iid] = clone(out);
        changed = true;
      } else if (!eq(I, out)) {
        const data = clone(out);
        Object.keys(I).forEach((k) => delete I[k]);
        Object.assign(I, data);
        changed = true;
      }
      return iid;
    };
    visit(main.id, null, true);
    ids.forEach((id) => {
      if (!used.has(id)) {
        delete all[id];
        changed = true;
      }
    });
    return changed;
  }

  /** Make an instance a plain layer. Nested instances inside it become direct (sourceIds re-pointed through `lookup`). */
  function detachNode(rootId, lookup) {
    const root = node(rootId);
    const walk = (id, nested) => {
      const n = node(id);
      if (!n) return;
      if (id !== rootId) {
        nested = nested || !!n.instance;
        const src = nested && n.sourceId ? lookup(n.sourceId) : null;
        if (src && src.sourceId) n.sourceId = src.sourceId;
        else delete n.sourceId;
      }
      n.children.forEach((c) => walk(c, nested));
    };
    walk(rootId, false);
    delete root.instance;
    delete root.sourceId;
  }

  /** Point every sourceId in a direct instance at its own component's main (after copy/paste or detaching an outer instance). */
  function repoint(rootId, comp) {
    const inMain = new Set(subtree(comp.mainId));
    subtree(rootId).forEach((id) => {
      const n = node(id);
      let s = n.sourceId;
      for (let guard = 0; s && !inMain.has(s) && guard < 32; guard++) s = node(s) ? node(s).sourceId : null;
      if (s && inMain.has(s)) n.sourceId = s;
      else delete n.sourceId;
    });
    node(rootId).sourceId = comp.mainId;
  }

  /** One full pass. Returns {changed, reg}. */
  function run() {
    const s = S();
    const d = s && s.doc;
    if (!d || !d.nodes) return { changed: false, reg: false };
    const all = d.nodes;
    const C = compsMap();
    const SETS = setsMap();
    let changed = false;
    let reg = false;

    // 1. components whose main is gone → detach their instances (toast), drop from the registry
    const removed = {};
    Object.keys(C).forEach((id) => {
      const c = C[id];
      if (isObj(c) && c.id === id && node(c.mainId) && (!node(c.mainId).component || node(c.mainId).component === id)) return;
      if (isObj(c)) removed[id] = c;
      delete C[id];
      reg = true;
    });
    list().forEach((c) => {
      if (all[c.mainId].component !== c.id) {
        all[c.mainId].component = c.id;
        changed = true;
      }
    });
    const goneIdx = {};
    Object.values(removed).forEach((c) => indexSnap(c.snapshot, goneIdx));
    const lookup = (id) => all[id] || goneIdx[id] || null;
    const detachedOf = {};
    for (let pass = 0; pass < 5; pass++) {
      let again = false;
      Object.keys(all).forEach((id) => {
        const n = all[id];
        if (!n) return;
        if (n.component && componentOf(id) === null) {
          delete n.component; // a pasted/duplicated copy of a main is a plain frame
          changed = true;
        }
        if (n.instance && !(isObj(n.instance) && C[n.instance.componentId]) && isDirectInstance(id)) {
          const cid = isObj(n.instance) ? n.instance.componentId : null;
          if (removed[cid]) detachedOf[cid] = (detachedOf[cid] || 0) + 1;
          detachNode(id, lookup);
          changed = again = true;
        }
      });
      // 2. instances inside their own main (directly or through others) → detach, or propagation would never end
      const g = {};
      Object.keys(all).forEach((id) => {
        const n = all[id];
        if (!n || !n.instance || !isDirectInstance(id)) return;
        const target = n.instance.componentId;
        for (const h of hostsOf(n.parent)) {
          if (reaches(g, target, h)) {
            toast(`“${C[target].name}” can’t contain an instance of itself — that instance is now a plain layer.`, 'error');
            detachNode(id, lookup);
            changed = again = true;
            return;
          }
        }
        hostsOf(n.parent).forEach((h) => (g[h] = g[h] || new Set()).add(target));
      });
      if (!again) break;
    }
    Object.keys(detachedOf).forEach((cid) => {
      const k = detachedOf[cid];
      toast(`Main component “${removed[cid].name}” was deleted — ${k} instance${k === 1 ? ' is' : 's are'} now plain layers. Undo to bring it back.`, 'info');
    });

    // 3. stray sourceIds (copies of instance internals pasted elsewhere)
    const instMemo = new Map();
    const inInstance = (id) => {
      if (!id || !all[id]) return false;
      if (instMemo.has(id)) return instMemo.get(id);
      const v = !!all[id].instance || inInstance(all[id].parent);
      instMemo.set(id, v);
      return v;
    };
    Object.keys(all).forEach((id) => {
      if (all[id].sourceId && !inInstance(id)) {
        delete all[id].sourceId;
        changed = true;
      }
    });

    // 4. registry hygiene: names follow the layers (renaming a main or set frame renames the component)
    Object.keys(SETS).forEach((sid) => {
      const set = SETS[sid];
      const members = list().filter((c) => c.setId === sid);
      if (!isObj(set) || !members.length) {
        delete SETS[sid];
        reg = true;
        return;
      }
      const f = node(set.frameId);
      if (f && f.name !== set.name) {
        set.name = f.name;
        reg = true;
      }
      members.forEach((c) => {
        if (c.name !== set.name) {
          c.name = set.name;
          reg = true;
        }
      });
    });
    list().forEach((c) => {
      if (c.setId && !SETS[c.setId]) {
        c.setId = null;
        c.variant = {};
        reg = true;
      }
      if (!c.setId && all[c.mainId].name !== c.name) {
        c.name = all[c.mainId].name;
        reg = true;
      }
    });

    // 5. propagate, inner components first (Button → Card main → Card instances)
    const direct = {};
    Object.keys(all).forEach((id) => {
      const n = all[id];
      if (n.instance && C[n.instance.componentId] && isDirectInstance(id)) (direct[n.instance.componentId] = direct[n.instance.componentId] || []).push(id);
    });
    const g = depsGraph();
    const order = [];
    const seen = new Set();
    const visit = (cid) => {
      if (seen.has(cid)) return;
      seen.add(cid);
      (g[cid] || []).forEach(visit);
      order.push(cid);
    };
    Object.keys(C).forEach(visit);
    order.forEach((cid) => {
      const c = C[cid];
      const now = snap(c.mainId);
      const sIdx = indexSnap(c.snapshot || now);
      (direct[cid] || []).forEach((rootId) => {
        if (all[rootId].sourceId !== c.mainId) repoint(rootId, c);
        if (syncInstance(rootId, c, sIdx)) changed = true;
      });
      if (!eq(now, c.snapshot)) c.snapshot = now;
    });

    if (changed) {
      const before = s.selection.length;
      s.selection = s.selection.filter((id) => all[id]);
      if (s.selection.length !== before) s.emit('selection');
    }
    return { changed, reg };
  }

  let timer = 0;
  let busy = false;
  /** Propagate now (synchronously). Returns true when the document changed. */
  function flush() {
    clearTimeout(timer);
    timer = 0;
    if (busy || !S() || !S().doc) return false;
    busy = true;
    let r = { changed: false, reg: false };
    try {
      r = run();
    } catch (e) {
      console.error('[Folio] component propagation failed', e);
    } finally {
      busy = false;
    }
    if (r.changed) S().emit('change');
    if (r.reg) S().emit('components');
    clearTimeout(timer);
    timer = 0;
    return r.changed || r.reg;
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE);
  }

  /** Wrap a mutation: flush first, suppress re-scheduling while it runs, propagate + emit after. */
  function mutation(fn) {
    return function () {
      flush();
      busy = true;
      let out;
      try {
        out = fn.apply(null, arguments);
      } finally {
        busy = false;
      }
      flush();
      S().emit('change');
      S().emit('components');
      return out;
    };
  }

  // ---------- validation ----------
  const fail = (msg) => {
    throw new Error(msg);
  };
  const needComp = (id) => get(id) || fail(`Unknown component "${id}".`);
  const fin = (v) => typeof v === 'number' && isFinite(v);
  const colorish = (v) => typeof v === 'string' && v.length <= 200 && /^(#[0-9a-f]{3,8}|[a-z-]+\(.*\)|[a-z]+)$/i.test(v.trim());
  const CHECK = {
    'text.content': (v) => typeof v === 'string' && v.length <= 100000,
    'text.color': colorish,
    'style.border.color': colorish,
    'style.fills': (v) => Array.isArray(v) && v.length <= 32 && v.every((f) => isObj(f) && FILL_TYPES.includes(f.type)),
    'image.src': (v) => typeof v === 'string' && v.length <= 8e6,
    'image.fit': (v) => ['cover', 'contain', 'fill'].includes(v),
    visible: (v) => typeof v === 'boolean',
    x: (v) => fin(v) && Math.abs(v) <= 1e6,
    y: (v) => fin(v) && Math.abs(v) <= 1e6,
    width: (v) => fin(v) && v >= 0 && v <= 100000,
    height: (v) => fin(v) && v >= 0 && v <= 100000,
    sizing: (v) => isObj(v) && Object.keys(v).every((k) => (k === 'w' || k === 'h') && ['fixed', 'hug', 'fill'].includes(v[k])),
    name: (v) => typeof v === 'string' && !!v.trim() && v.length <= 200,
    locked: (v) => typeof v === 'boolean',
  };
  /** Override patch ({text:{content}} or {'text.content': …}) → [[field, value]]; throws on anything not overridable. */
  function flatten(patch, isRoot, where) {
    if (!isObj(patch)) fail(`Overrides for "${where || '(root)'}" must be an object like { text: { content: "Buy now" } }.`);
    const out = [];
    const add = (field, v) => {
      if (!(OVR.includes(field) || (isRoot && ROOT_OWN.includes(field))))
        fail(`"${field}" can’t be overridden on "${where || '(root)'}" — edit the main component instead. Overridable: ${OVR.join(', ')}${isRoot ? ', ' + ROOT_OWN.join(', ') : ''}.`);
      if (!CHECK[field](v)) fail(`Invalid value for ${field} on "${where || '(root)'}": ${JSON.stringify(v).slice(0, 80)}`);
      out.push([field, v]);
    };
    Object.keys(patch).forEach((k) => {
      const v = patch[k];
      if (k.includes('.') || !isObj(v) || k === 'sizing') return add(k, v);
      Object.keys(v).forEach((k2) => {
        if (k === 'style' && k2 === 'border' && isObj(v[k2])) Object.keys(v[k2]).forEach((k3) => add(`style.border.${k3}`, v[k2][k3]));
        else add(`${k}.${k2}`, v[k2]);
      });
    });
    return out;
  }
  /** Validate overrides keyed by name path against a subtree → [[nodeId, field, value]]. */
  function resolveOverrides(rootId, overrides, rootOwns) {
    if (overrides == null) return [];
    if (!isObj(overrides)) fail('overrides must be an object keyed by layer path, e.g. { "Label": { text: { content: "Buy now" } } }.');
    const pm = pathMap(rootId);
    const out = [];
    Object.keys(overrides).forEach((path) => {
      if (!(path in pm)) fail(`No layer "${path}" in this component. Paths: ${Object.keys(pm).filter(Boolean).slice(0, 30).join(', ') || '(none)'}.`);
      flatten(overrides[path], rootOwns && path === '', path).forEach(([f, v]) => out.push([path, f, v]));
    });
    return out;
  }
  function applyFlat(rootId, flat, lenient) {
    const pm = pathMap(rootId);
    flat.forEach(([path, field, v]) => {
      const n = node(pm[path]);
      if (!n) return;
      if (lenient && field.includes('.') && !isObj(n[field.split('.')[0]])) return; // e.g. text override on a layer that is now a frame
      if (field === 'sizing') n.sizing = { ...n.sizing, ...v };
      else setPath(n, field, clone(v));
    });
  }
  const validName = (s) => typeof s === 'string' && !!s.trim() && s.trim().length <= 60 && !/[=,]/.test(s);
  function checkVariant(v, what) {
    if (!isObj(v)) fail(`${what} must be an object like { Size: "L" }.`);
    Object.keys(v).forEach((k) => {
      if (!validName(k)) fail(`Property name "${k}" must be 1–60 characters without "=" or ",".`);
      if (!validName(v[k])) fail(`Value "${v[k]}" for ${k} must be 1–60 characters without "=" or ",".`);
    });
    const o = {};
    Object.keys(v).forEach((k) => (o[k.trim()] = v[k].trim()));
    return o;
  }

  // ---------- variant helpers ----------
  const membersOf = (setId) => list().filter((c) => c.setId === setId);
  function variantName(variant, props) {
    const keys = [...Object.keys(props || {}), ...Object.keys(variant).filter((k) => !(k in (props || {})))];
    return keys.filter((k) => variant[k] != null).map((k) => `${k}=${variant[k]}`).join(', ');
  }
  function renameMains(set) {
    membersOf(set.id).forEach((c) => {
      const m = node(c.mainId);
      if (m) m.name = variantName(c.variant, set.props) || set.name;
      c.name = set.name;
    });
  }
  function sameVariant(a, b) {
    const ka = Object.keys(a).filter((k) => a[k] != null);
    return ka.length === Object.keys(b).filter((k) => b[k] != null).length && ka.every((k) => a[k] === b[k]);
  }
  /** Create a set frame where the first main sits and move the mains into it. */
  function makeSet(name, members) {
    const first = node(members[0].mainId);
    const sib = S().siblingsOf(first.id);
    const frame = S().createNode('frame', { ...clone(SET_FRAME), name, x: first.x, y: first.y }, first.parent, sib.indexOf(first.id));
    members.forEach((c) => S().move(c.mainId, frame.id));
    const set = { id: rid('s_'), name, frameId: frame.id, props: {} };
    registry().componentSets[set.id] = set;
    members.forEach((c) => {
      c.setId = set.id;
      Object.keys(c.variant).forEach((k) => {
        const vals = (set.props[k] = set.props[k] || []);
        if (!vals.includes(c.variant[k])) vals.push(c.variant[k]);
      });
    });
    renameMains(set);
    return set;
  }
  function register(mainId, { name, setId = null, variant = {}, description = '' }) {
    const comp = { id: rid('k_'), name, mainId, setId, variant, description, snapshot: null };
    registry().components[comp.id] = comp;
    const m = node(mainId);
    m.component = comp.id;
    if (!setId) m.name = name;
    comp.snapshot = snap(mainId);
    return comp;
  }

  // ---------- instances ----------
  /** Build an instance (no validation). Returns the root id. */
  function instantiate(comp, parentId, index, rootProps, flat) {
    const main = node(comp.mainId);
    const { parent, children, component, ...rest } = main;
    const id = uid();
    const root = { ...clone(rest), id, parent: parentId || null, children: [], sourceId: main.id, instance: { componentId: comp.id }, name: comp.name, ...rootProps };
    if (!parentId && root.sizing) ['w', 'h'].forEach((ax) => root.sizing[ax] === 'fill' && (root.sizing[ax] = 'fixed'));
    nodes()[id] = root;
    const lst = parentId ? node(parentId).children : D().roots;
    if (index === undefined || index === null || index < 0 || index > lst.length) lst.push(id);
    else lst.splice(index, 0, id);
    syncInstance(id, comp, indexSnap(comp.snapshot));
    if (flat && flat.length) applyFlat(id, flat);
    return id;
  }
  function checkParent(parentId, compId) {
    const p = node(parentId) || fail(`Unknown parent layer "${parentId}".`);
    if (p.type !== 'frame') fail(`"${p.name}" is not a frame — instances can only go inside frames.`);
    if (instanceRootOf(parentId)) fail(`"${p.name}" is part of an instance — layers can’t be added inside instances. Edit the main component instead.`);
    const host = cycleAt(parentId, compId);
    if (host) fail(`Can’t put “${get(compId).name}” inside “${host.name}”: a component can’t contain an instance of itself.`);
    return p;
  }
  function freeSpotRightOf(mainId) {
    const st = S();
    const art = node(st.rootOf(mainId));
    const rect = (id) => (Folio.canvas && Folio.canvas.nodeRect ? Folio.canvas.nodeRect(id) : null);
    const ar = rect(art.id) || { x: art.x, y: art.y, width: art.width, height: art.height };
    const mr = rect(mainId) || ar;
    const x = Math.round(ar.x + ar.width + 80);
    let y = Math.round(mr.y);
    const h = Math.max(20, Math.round(mr.height || node(mainId).height || 100));
    for (let i = 0; i < 200 && D().roots.some((r) => node(r).x === x && node(r).y === y); i++) y += h + 24;
    return { x, y };
  }

  const createInstance = mutation(function (compId, opts = {}) {
    const comp = needComp(compId);
    if (!isObj(opts)) fail('createInstance options must be an object.');
    const flat = resolveOverrides(comp.mainId, opts.overrides, true);
    ['x', 'y'].forEach((k) => opts[k] != null && !CHECK[k](opts[k]) && fail(`${k} must be a number.`));
    let parentId = opts.parentId;
    if (parentId === undefined) {
      const p = S().primary();
      const cand = p && p.type === 'frame' ? p.id : null;
      parentId = null;
      if (cand) {
        try {
          checkParent(cand, compId);
          parentId = cand;
        } catch (e) {
          parentId = null;
        }
      }
    } else if (parentId !== null) checkParent(parentId, compId);
    const props = {};
    if (!parentId) Object.assign(props, opts.x != null && opts.y != null ? { x: opts.x, y: opts.y } : freeSpotRightOf(comp.mainId));
    else if (node(parentId).layout.mode !== 'flex') Object.assign(props, { x: opts.x || 0, y: opts.y || 0 });
    return instantiate(comp, parentId, opts.index, props, flat);
  });

  function needInstance(id) {
    const n = node(id) || fail(`Unknown layer "${id}".`);
    if (!n.instance) fail(`"${n.name}" is not an instance.`);
    return n;
  }
  const setOverrides = mutation(function (instanceId, overrides) {
    needInstance(instanceId);
    applyFlat(instanceId, resolveOverrides(instanceId, overrides, isDirectInstance(instanceId)));
  });
  const resetOverrides = mutation(function (instanceId, path) {
    needInstance(instanceId);
    const pm = pathMap(instanceId);
    if (path !== undefined && path !== null && !(path in pm)) fail(`No layer "${path}" in this instance.`);
    const ids = path === undefined || path === null ? Object.values(pm) : [pm[path]];
    ids.forEach((id) => {
      const n = node(id);
      const m = node(n.sourceId);
      if (!m) return;
      OVR.forEach((p) => {
        const mv = getPath(m, p);
        if (mv === undefined) delPath(n, p);
        else setPath(n, p, clone(mv));
      });
    });
  });
  const detach = mutation(function (instanceId) {
    const n = needInstance(instanceId);
    if (!isDirectInstance(instanceId)) fail(`“${n.name}” is part of another instance — detach the outer instance first.`);
    detachNode(instanceId, node);
    return instanceId;
  });

  // ---------- creating components ----------
  const create = mutation(function (nodeIds, opts = {}) {
    const ids = [...new Set([].concat(nodeIds || []))];
    if (!ids.length) fail('Select at least one layer to make a component.');
    ids.forEach((id) => {
      const n = node(id) || fail(`Unknown layer "${id}".`);
      const ir = instanceRootOf(id);
      if (ir && ir !== id) fail(`“${n.name}” is inside an instance — detach the instance first, or edit its main component.`);
    });
    if (ids.length > 1 && ids.some((id) => node(id).parent !== node(ids[0]).parent)) fail('Layers must share the same parent to become one component.');
    const name = opts && opts.name != null ? String(opts.name).trim() : '';
    if (opts && opts.name != null && (!name || name.length > 200)) fail('Component name must be 1–200 characters.');
    const one = ids.length === 1 ? node(ids[0]) : null;
    if (one && componentOf(one.id)) fail(`“${one.name}” is already a main component.`);
    let mainId;
    if (one && one.type === 'frame' && !one.instance) mainId = one.id;
    else mainId = S().wrapInFrame(ids, { flex: true }).id;
    return register(mainId, { name: name || (one ? one.name : 'Component') });
  });

  const update = mutation(function (id, patch) {
    if (!isObj(patch)) fail('update(id, { name, description }) needs a patch object.');
    const c = get(id);
    const set = getSet(id);
    if (!c && !set) fail(`Unknown component or set "${id}".`);
    if (patch.name != null) {
      const name = String(patch.name).trim();
      if (!name || name.length > 200) fail('Name must be 1–200 characters.');
      if (set || (c && c.setId)) {
        const st = set || getSet(c.setId);
        st.name = name;
        if (node(st.frameId)) node(st.frameId).name = name;
        renameMains(st);
      } else {
        c.name = name;
        node(c.mainId).name = name;
      }
    }
    if (patch.description != null) {
      if (!c) fail('Only components have a description.');
      c.description = String(patch.description).slice(0, 2000);
    }
  });

  // ---------- variants ----------
  const addVariant = mutation(function (compId, variantProps) {
    const comp = needComp(compId);
    let set = comp.setId ? getSet(comp.setId) : null;
    const given = variantProps == null ? null : checkVariant(variantProps, 'Variant properties');
    // work out the new variant before touching the document
    const baseVar = set ? { ...comp.variant } : {};
    if (!set) (given && Object.keys(given).length ? Object.keys(given) : ['Property 1']).forEach((k) => (baseVar[k] = 'Default'));
    let v;
    if (given && Object.keys(given).length) v = { ...baseVar, ...given };
    else {
      const p = set ? Object.keys(set.props)[0] || 'Property 1' : Object.keys(baseVar)[0];
      const vals = set ? set.props[p] || [] : ['Default'];
      let n = vals.length + 1;
      while (vals.includes('Variant ' + n)) n++;
      v = { ...baseVar, [p]: 'Variant ' + n };
    }
    const others = set ? membersOf(set.id) : [];
    if (sameVariant(v, baseVar) || others.some((c) => sameVariant(c.variant, v))) fail(`A variant ${variantName(v)} already exists.`);

    if (!set) {
      comp.variant = baseVar;
      set = makeSet(comp.name, [comp]);
    }
    const newKeys = Object.keys(v).filter((k) => !(k in set.props));
    newKeys.forEach((k) => {
      set.props[k] = ['Default'];
      membersOf(set.id).forEach((c) => (c.variant[k] = 'Default'));
    });
    Object.keys(v).forEach((k) => !set.props[k].includes(v[k]) && set.props[k].push(v[k]));
    const main = node(comp.mainId);
    const tree = S().toTree(main.id);
    delete tree.component;
    const parent = main.parent ? node(main.parent) : null;
    if (!parent || parent.layout.mode !== 'flex') tree.x = main.x + main.width + 24;
    const copy = S().buildFromTree(tree, main.parent, S().siblingsOf(main.id).indexOf(main.id) + 1);
    const nc = register(copy.id, { name: set.name, setId: set.id, variant: v, description: comp.description });
    renameMains(set);
    nc.snapshot = snap(copy.id);
    return nc;
  });

  const combineAsVariants = mutation(function (compIds, opts = {}) {
    const ids = [...new Set([].concat(compIds || []))];
    if (ids.length < 2) fail('Pick at least two components to combine as variants.');
    const cs = ids.map(needComp);
    cs.forEach((c) => c.setId && fail(`“${c.name}” is already part of a variant set.`));
    cs.forEach((a) => cs.forEach((b) => a !== b && S().isAncestor(a.mainId, b.mainId) && fail(`“${b.name}” is inside “${a.name}” — variants can’t be nested inside each other.`)));
    const prop = opts.prop == null ? 'Property 1' : opts.prop;
    if (!validName(prop)) fail('prop must be 1–60 characters without "=" or ",".');
    // "Button / Primary", "Button / Ghost" → set "Button", values "Primary", "Ghost"
    const parts = cs.map((c) => c.name.split('/').map((x) => x.trim()));
    const shared = parts.every((p) => p.length > 1 && p[0] === parts[0][0]) ? parts[0][0] : null;
    const name = opts.name != null ? String(opts.name).trim() : shared || cs[0].name;
    if (!name || name.length > 200) fail('Set name must be 1–200 characters.');
    const used = new Set();
    cs.forEach((c, i) => {
      let val = (shared ? parts[i].slice(1).join(' ') : c.name).replace(/[=,]/g, ' ').trim().slice(0, 60) || 'Variant';
      for (let n = 2; used.has(val); n++) val = `${val.replace(/ \d+$/, '')} ${n}`;
      used.add(val);
      c.variant = { [prop.trim()]: val };
    });
    return makeSet(name, cs);
  });

  const setSetProps = mutation(function (setId, props) {
    const set = getSet(setId) || fail(`Unknown variant set "${setId}".`);
    if (!isObj(props) || !Object.keys(props).length) fail('props must be an object like { Size: ["S", "M", "L"] }.');
    const next = {};
    Object.keys(props).forEach((k) => {
      if (!validName(k)) fail(`Property name "${k}" must be 1–60 characters without "=" or ",".`);
      const vals = props[k];
      if (!Array.isArray(vals) || !vals.length) fail(`${k} needs at least one value.`);
      vals.forEach((v) => validName(v) || fail(`Value "${v}" for ${k} must be 1–60 characters without "=" or ",".`));
      const tv = vals.map((v) => v.trim());
      if (new Set(tv).size !== tv.length) fail(`${k} has duplicate values.`);
      next[k.trim()] = tv;
    });
    // remap each variant by position, so renaming a property or value carries over
    const oldKeys = Object.keys(set.props);
    const newKeys = Object.keys(next);
    membersOf(setId).forEach((c) => {
      const v = {};
      newKeys.forEach((k, i) => {
        const ok = k in set.props ? k : oldKeys[i];
        const old = ok != null ? c.variant[ok] : undefined;
        const j = ok != null && set.props[ok] ? set.props[ok].indexOf(old) : -1;
        v[k] = next[k].includes(old) ? old : j >= 0 && j < next[k].length ? next[k][j] : next[k][0];
      });
      c.variant = v;
    });
    set.props = next;
    renameMains(set);
    return set;
  });

  const setVariantOf = mutation(function (compId, variant) {
    const comp = needComp(compId);
    const set = (comp.setId && getSet(comp.setId)) || fail(`“${comp.name}” is not part of a variant set — use addVariant first.`);
    const v = checkVariant(variant, 'variant');
    Object.keys(v).forEach((k) => k in set.props || fail(`Unknown property "${k}" — add it with setSetProps first. Properties: ${Object.keys(set.props).join(', ')}.`));
    const next = { ...comp.variant, ...v };
    if (membersOf(set.id).some((c) => c !== comp && sameVariant(c.variant, next))) fail(`A variant ${variantName(next, set.props)} already exists.`);
    Object.keys(v).forEach((k) => !set.props[k].includes(v[k]) && set.props[k].push(v[k]));
    comp.variant = next;
    renameMains(set);
    return comp;
  });

  const setVariant = mutation(function (instanceId, patch) {
    const root = needInstance(instanceId);
    if (!isDirectInstance(instanceId)) fail('Variants can’t be switched on an instance nested inside another instance (v0.4) — change it in the main component.');
    const comp = needComp(root.instance.componentId);
    const set = (comp.setId && getSet(comp.setId)) || fail(`“${comp.name}” has no variants.`);
    const p = checkVariant(patch, 'variant');
    Object.keys(p).forEach((k) => {
      if (!(k in set.props)) fail(`Unknown property "${k}". Properties: ${Object.keys(set.props).join(', ')}.`);
      if (!set.props[k].includes(p[k])) fail(`Unknown value "${p[k]}" for ${k}. Values: ${set.props[k].join(', ')}.`);
    });
    const want = { ...comp.variant, ...p };
    const members = membersOf(set.id);
    const score = (c) => Object.keys(want).filter((k) => c.variant[k] === want[k]).length;
    const target =
      members.find((c) => sameVariant(c.variant, want)) ||
      members.filter((c) => Object.keys(p).every((k) => c.variant[k] === p[k])).sort((a, b) => score(b) - score(a))[0] ||
      fail(`No variant matches ${variantName(p, set.props)}.`);
    if (target === comp) return instanceId;
    if (root.parent) {
      const host = cycleAt(root.parent, target.id);
      if (host) fail(`Can’t switch to that variant: “${host.name}” would contain an instance of itself.`);
    }
    // carry overrides by name path; keep ids of layers that exist (by path) in the new variant
    const carried = [];
    const ov = overridesOf(instanceId);
    Object.keys(ov).forEach((path) => Object.keys(ov[path]).forEach((f) => carried.push([path, f, ov[path][f]])));
    const oldRoot = comp.snapshot || {};
    const pmNew = pathMap(target.mainId);
    const pathById = {};
    const pmInst = pathMap(instanceId);
    Object.keys(pmInst).forEach((k) => (pathById[pmInst[k]] = k));
    subtree(instanceId).forEach((id) => {
      const n = node(id);
      if (id !== instanceId) {
        const m = id in pathById ? pmNew[pathById[id]] : null;
        if (m && node(m).type === n.type) n.sourceId = m;
        else delete n.sourceId;
      }
      OVR.forEach((f) => delPath(n, f));
    });
    ['width', 'height', 'sizing'].forEach((k) => eq(root[k], oldRoot[k]) && delete root[k]);
    root.instance = { componentId: target.id };
    root.sourceId = target.mainId;
    syncInstance(instanceId, target, indexSnap(target.snapshot));
    applyFlat(instanceId, carried, true);
    return instanceId;
  });

  // =====================================================================
  //  Starter kit — design data. Edit freely: everything visual lives in this block.
  //  `t` comes from kitTokens(): brand tokens when a brand is active, literals otherwise.
  //  4px grid · M Button and M Input are 40px · each component uses a border OR a shadow.
  // =====================================================================
  const KIT_LITERALS = {
    page: '#fafafa', // Components artboard
    surface: '#ffffff', // cards, nav, fields
    subtle: '#f4f4f5', // secondary button, media placeholder
    ink: '#18181b',
    muted: '#52525b', // body copy, links (7.7:1 on white)
    hint: '#71717a', // placeholders and hints (4.8:1 on white)
    field: '#8a8a93', // input border (3.4:1 on white)
    primary: '#2563eb',
    onPrimary: '#ffffff', // 5.2:1 on #2563eb
    ring: '#2563eb40',
    danger: '#dc2626', // error border + message (4.8:1 on white)
    success: '#16a34a', // status dot
    tints: { neutral: ['#f4f4f5', '#3f3f46'], accent: ['#dbeafe', '#1e40af'], success: ['#dcfce7', '#166534'], avatar: ['#dbeafe', '#1e3a8a'] },
    font: 'Inter',
    heading: 'Inter',
    radius: 8, // buttons, inputs
    radiusSm: 6, // badges
    radiusLg: 12, // cards
    radiusMedia: 8, // image placeholders (never pill)
  };

  const solid = (color) => ({ type: 'solid', color, visible: true });
  const shadow = (y, blur, spread, color, x = 0) => ({ x, y, blur, spread, color, inset: false, visible: true });
  const edge = (color, width = 1) => ({ width, color, style: 'solid' });
  const NO_EDGE = edge('#00000000', 0);
  function F(name, o, children = []) {
    return {
      type: 'frame',
      name,
      width: o.w || 100,
      height: o.h || 100,
      sizing: { w: o.sw || (o.w ? 'fixed' : 'hug'), h: o.sh || (o.h ? 'fixed' : 'hug') },
      layout: { mode: 'flex', direction: o.dir || 'column', wrap: false, gap: o.gap || 0, justify: o.justify || 'flex-start', align: o.align || 'flex-start', padding: o.pad || [0, 0, 0, 0] },
      style: { fills: o.fill ? [solid(o.fill)] : [], radius: o.radius || 0, border: o.border || NO_EDGE, shadows: o.shadows || [], clip: !!o.clip },
      children,
    };
  }
  function T(name, content, t, o = {}) {
    return {
      type: 'text',
      name,
      width: o.w || 200,
      height: 24,
      sizing: { w: o.sw || 'hug', h: 'hug' },
      text: { content, font: o.font || t.font, size: o.size || 14, weight: o.weight || 400, lineHeight: o.lh || 1.4, letterSpacing: o.ls || 0, color: o.color || t.ink, align: o.align || 'left', transform: 'none', italic: false, decoration: 'none' },
    };
  }
  const BUTTON_SIZES = { S: { h: 32, px: 12, size: 14 }, M: { h: 40, px: 16, size: 14 }, L: { h: 48, px: 24, size: 16 } };
  const AVATAR_SIZES = { S: 24, M: 40, L: 64 };

  const KIT = [
    {
      name: 'Button',
      props: { Style: ['Primary', 'Secondary', 'Ghost'], Size: ['S', 'M', 'L'] },
      setWidth: 520, // wraps into a 3 × 3 grid: one row per Style
      main: (v, t) => {
        const s = BUTTON_SIZES[v.Size];
        const look = {
          Primary: { fill: t.primary, color: t.onPrimary },
          Secondary: { fill: t.subtle, color: t.ink },
          Ghost: { fill: null, color: t.ink },
        }[v.Style];
        return F('Button', { dir: 'row', h: s.h, sw: 'hug', pad: [0, s.px, 0, s.px], gap: 8, align: 'center', justify: 'center', radius: t.radius, fill: look.fill }, [
          T('Label', 'Save changes', t, { size: s.size, weight: 600, lh: 1.25, color: look.color }),
        ]);
      },
    },
    {
      name: 'Badge',
      props: { Tone: ['Neutral', 'Accent', 'Success'] },
      main: (v, t) => {
        const [bg, fg] = t.tints[v.Tone.toLowerCase()];
        const dot = v.Tone === 'Success' ? [F('Dot', { w: 6, h: 6, radius: 9999, fill: t.success })] : [];
        return F('Badge', { dir: 'row', h: 24, sw: 'hug', pad: [4, 8, 4, 8], gap: 6, align: 'center', radius: t.radiusSm, fill: bg }, [
          ...dot,
          T('Label', { Neutral: 'Draft', Accent: 'New', Success: 'Paid' }[v.Tone], t, { size: 12, weight: 500, lh: 1.34, color: fg }),
        ]);
      },
    },
    {
      name: 'Avatar',
      props: { Size: ['S', 'M', 'L'] },
      main: (v, t) => {
        const d = AVATAR_SIZES[v.Size];
        return F('Avatar', { w: d, h: d, align: 'center', justify: 'center', radius: 9999, fill: t.tints.avatar[0], clip: true }, [
          T('Initials', 'AL', t, { size: Math.round(d * 0.4), weight: 600, lh: 1, color: t.tints.avatar[1] }),
        ]);
      },
    },
    {
      name: 'Input',
      props: { State: ['Default', 'Focus', 'Error'] },
      main: (v, t) => {
        const border = v.State === 'Focus' ? edge(t.primary) : v.State === 'Error' ? edge(t.danger) : edge(t.field);
        const ring = v.State === 'Focus' ? [shadow(0, 0, 3, t.ring)] : [];
        const hint = v.State === 'Error' ? 'Enter an email address like name@example.com.' : 'We only use this to send your receipt.';
        return F('Input', { w: 320, gap: 6 }, [
          T('Label', 'Email address', t, { size: 14, weight: 500, color: t.ink }),
          F('Field', { dir: 'row', sw: 'fill', h: 40, pad: [0, 12, 0, 12], align: 'center', radius: t.radius, fill: t.surface, border, shadows: ring }, [
            T('Value', 'name@example.com', t, { size: 14, sw: 'fill', color: t.hint }),
          ]),
          T('Hint', hint, t, { size: 12, sw: 'fill', color: v.State === 'Error' ? t.danger : t.hint }),
        ]);
      },
    },
    {
      name: 'Card',
      main: (t) =>
        // border OR shadow: a brand with shadow "none" gets a hairline border instead
        F('Card', { w: 320, pad: [24, 24, 24, 24], gap: 12, radius: t.radiusLg, fill: t.surface, ...(t.shadowStyle === 'none' ? { border: edge(t.subtle) } : { shadows: [shadow(1, 2, 0, '#0000000d'), shadow(4, 12, -2, t.shadowStyle === 'bold' ? '#00000029' : '#00000014')] }) }, [
          F('Media', { sw: 'fill', h: 144, radius: t.radiusMedia, fill: t.tints.avatar[0] }),
          T('Title', 'Quarterly report', t, { size: 18, weight: 600, lh: 1.3, sw: 'fill', font: t.heading }),
          T('Body', 'Revenue, churn and pipeline for the last three months, with notes from the finance team.', t, { size: 14, lh: 1.5, sw: 'fill', color: t.muted }),
          F('Actions', { dir: 'row', gap: 8, pad: [4, 0, 0, 0] }),
        ]),
      nested: [{ at: 'Actions', component: 'Button', variant: { Style: 'Primary', Size: 'M' }, overrides: { Label: { text: { content: 'View report' } } } }],
    },
    {
      name: 'Nav bar',
      props: { Layout: ['Desktop', 'Mobile'] },
      main: (v, t) => {
        const desktop = v.Layout === 'Desktop';
        const links = ['Services', 'Work', 'About', 'Journal'].map((l, i) => T(l, l, t, { size: 14, weight: i ? 400 : 600, color: i ? t.muted : t.ink }));
        return F('Nav bar', { dir: 'row', w: desktop ? 1040 : 390, h: 64, gap: 16, pad: [0, desktop ? 32 : 16, 0, desktop ? 32 : 16], align: 'center', justify: 'space-between', fill: t.surface, shadows: [shadow(1, 0, 0, '#0000001a')] }, [
          // on mobile the logo takes the leftover width and clips, so long brand names never collide with "Menu"
          F('Logo', { dir: 'row', gap: 8, align: 'center', ...(desktop ? {} : { sw: 'fill', clip: true }) }, [F('Mark', { w: 24, h: 24, radius: 6, fill: t.primary }), T('Name', t.brandName || 'Northwind', t, { size: 16, weight: 700, font: t.heading })]),
          desktop ? F('Links', { dir: 'row', gap: 32, align: 'center' }, links) : T('Menu', 'Menu', t, { size: 14, weight: 500 }),
          F('Action', { dir: 'row' }),
        ]);
      },
      nested: [{ at: 'Action', component: 'Button', variant: { Style: 'Primary', Size: 'S' }, overrides: { Label: { text: { content: 'Contact us' } } } }],
    },
  ];
  const KIT_BOARD = (t) => F('Components', { gap: 56, pad: [64, 64, 64, 64], fill: t.page });
  const KIT_SECTION = (name, t) => F(name, { gap: 16 }, [T('Title', name, t, { size: 13, weight: 600, color: t.muted, ls: 0.02 })]);

  // ---- colour maths for brand-aware literals (labels that must pass contrast, pale tints) ----
  function rgbOf(c) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(c || '').trim());
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, (x) => x + x) : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const hex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, w) => hex(a.map((v, i) => v * (1 - w) + b[i] * w));
  function lum(rgb) {
    const [r, g, b] = rgb.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  /** First candidate with ≥ 4.5:1 against bg, else the best one. Candidates: [value, rgb]. */
  function readableOn(bg, cands) {
    const ok = cands.find(([, rgb]) => rgb && contrast(bg, rgb) >= 4.5);
    return (ok || cands.filter(([, rgb]) => rgb).sort((p, q) => contrast(bg, q[1]) - contrast(bg, p[1]))[0])[0];
  }
  /** [pale tint, same-hue text that reads ≥ 4.5:1 on it] from one colour, tinted toward `base` (the page). */
  function tintPair(rgb, base = [255, 255, 255]) {
    const bg = rgbOf(mix(rgb, base, 0.8));
    let fg = rgb;
    for (let i = 0; i < 20 && contrast(bg, fg) < 4.5; i++) fg = rgbOf(mix(fg, [0, 0, 0], 0.15));
    return [hex(bg), hex(fg)];
  }

  function kitTokens() {
    const b = Folio.brand && Folio.brand.active ? Folio.brand.active() : null;
    if (!b) return KIT_LITERALS;
    const L = KIT_LITERALS;
    const lit = (id, fallback) => rgbOf(Folio.brand.resolveColor(`var(--color-${id})`)) || rgbOf(fallback);
    const primary = lit('primary', L.primary);
    const background = lit('background', '#ffffff');
    const surface = lit('surface', L.surface);
    const button = (b.style && b.style.button) || 'rounded';
    const text = lit('text', L.ink);
    const subtle = mix(surface, text, 0.06);
    return {
      ...L,
      brandName: b.name,
      shadowStyle: (b.style && b.style.shadow) || 'soft',
      page: 'var(--color-background)',
      surface: 'var(--color-surface)',
      subtle,
      ink: 'var(--color-text)',
      muted: 'var(--color-muted)',
      hint: 'var(--color-muted)',
      field: 'var(--color-muted)',
      primary: 'var(--color-primary)',
      onPrimary: 'var(--color-on-primary)',
      ring: hex(primary) + '40',
      danger: 'var(--color-danger)',
      success: 'var(--color-success)',
      tints: { neutral: [subtle, 'var(--color-text)'], accent: tintPair(lit('accent', '#f59e0b'), background), success: tintPair(lit('success', L.success), background), avatar: tintPair(primary, background) },
      font: 'var(--font-body)',
      heading: 'var(--font-heading)',
      radius: button === 'pill' ? 9999 : button === 'square' ? 4 : 'var(--radius-md)',
      radiusSm: button === 'pill' ? 9999 : button === 'square' ? 4 : 'var(--radius-sm)',
      radiusLg: button === 'square' ? 4 : 'var(--radius-lg)',
      radiusMedia: button === 'square' ? 4 : 'var(--radius-md)',
    };
  }

  function combos(props) {
    return Object.keys(props).reduce((acc, k) => acc.flatMap((v) => props[k].map((val) => ({ ...v, [k]: val }))), [{}]);
  }

  /** The kit lives on the "Components" page (or wherever an existing kit board already is). */
  const addStarterKit = mutation(function () {
    const st = S();
    if (!st.withPage) return buildKit();
    const isBoard = (id) => {
      const n = node(id);
      return n && n.type === 'frame' && n.name === 'Components' && !n.parent && !n.instance && !n.component;
    };
    const had = st.pages().find((p) => p.roots.some(isBoard)) || st.pages().find((p) => p.name === 'Components');
    const page = had || st.ensurePage('Components');
    try {
      return st.withPage(page.id, buildKit);
    } catch (e) {
      if (!had) st.removePage(page.id); // the page was made for this call: don't leave it (or a half-built kit) behind
      throw e;
    }
  });
  function buildKit() {
    const st = S();
    const t = kitTokens();
    const created = [];
    let board = D().roots.map(node).find((n) => n.type === 'frame' && n.name === 'Components' && !n.instance && !n.component);
    if (!board) {
      const rect = (id) => (Folio.canvas && Folio.canvas.nodeRect ? Folio.canvas.nodeRect(id) : null) || node(id);
      const rs = D().roots.map(rect);
      const x = rs.length ? Math.max(...rs.map((r) => r.x + r.width)) + 160 : 0;
      const y = rs.length ? Math.min(...rs.map((r) => r.y)) : 0;
      board = st.buildFromTree({ ...KIT_BOARD(t), x, y });
    }
    const existing = (name) => sets().find((s) => s.name === name) || list().find((c) => !c.setId && c.name === name);
    KIT.forEach((def) => {
      if (existing(def.name)) return;
      const section = st.buildFromTree(KIT_SECTION(def.name, t), board.id);
      const mains = [];
      if (def.props) {
        const look = clone(SET_FRAME);
        if (def.setWidth) Object.assign(look, { width: def.setWidth, sizing: { w: 'fixed', h: 'hug' } });
        const frame = st.createNode('frame', { ...look, name: def.name }, section.id);
        const set = { id: rid('s_'), name: def.name, frameId: frame.id, props: clone(def.props) };
        registry().componentSets[set.id] = set;
        combos(def.props).forEach((v) => mains.push(register(st.buildFromTree(def.main(v, t), frame.id).id, { name: def.name, setId: set.id, variant: v })));
        renameMains(set);
      } else mains.push(register(st.buildFromTree(def.main(t), section.id).id, { name: def.name }));
      (def.nested || []).forEach((n) => {
        const src = existing(n.component);
        if (!src) return;
        const pool = src.frameId ? membersOf(src.id) : [src];
        const comp = pool.find((c) => sameVariant(c.variant, n.variant)) || pool[0];
        mains.forEach((m) => {
          const host = pathMap(m.mainId)[n.at];
          if (host && comp && !cycleAt(host, comp.id)) instantiate(comp, host, undefined, {}, resolveOverrides(comp.mainId, n.overrides, false));
        });
      });
      mains.forEach((m) => {
        m.snapshot = snap(m.mainId);
        created.push(m.id);
      });
    });
    return created;
  }

  // ---------- init ----------
  let inited = false;
  /** After undo/redo/load: the snapshots are in the doc, so only fill in what a hand-made file may lack. */
  function afterRestore() {
    clearTimeout(timer);
    timer = 0;
    const s = S();
    let fixed = false;
    list().forEach((c) => {
      if (isObj(c) && !c.snapshot && node(c.mainId)) {
        c.snapshot = snap(c.mainId);
        fixed = true;
      }
    });
    if (fixed && s.history && s.history[s.historyIndex] != null) s.history[s.historyIndex] = JSON.stringify(s.doc);
    s.emit('components');
  }
  function init() {
    const s = S();
    if (!s) return;
    if (!inited) {
      inited = true;
      s.on('change', () => !busy && schedule());
      s.on('history', (label) => label === undefined && afterRestore());
      s.on('doc', afterRestore);
      const commit = s.commit;
      s.commit = function () {
        flush();
        return commit.apply(this, arguments);
      };
    }
    afterRestore();
  }

  Folio.components = {
    init,
    flush,
    // queries
    list,
    sets,
    get,
    getSet,
    componentOf,
    mainRootOf,
    instanceRootOf,
    isDirectInstance,
    isOverridable,
    overridesOf,
    pathOf,
    variantsOf,
    // mutations (never commit)
    create,
    createInstance,
    setOverrides,
    resetOverrides,
    detach,
    update,
    addVariant,
    combineAsVariants,
    setSetProps,
    setVariantOf,
    setVariant,
    addStarterKit,
    OVERRIDABLE: OVR.slice(),
    ROOT_FIELDS: ROOT_OWN.slice(),
  };
})();
