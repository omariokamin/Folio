/*
 * components-panel.js — the "Components" tab in the left panel (#components-panel).
 *
 *   Folio.componentsPanel.init()                 build the panel (the tab itself lives in brand-panel.js)
 *   Folio.componentsPanel.refresh()              re-render now
 *   Folio.componentsPanel.insert(compId, at?)    add an instance: at = {clientX, clientY} drops it there,
 *                                                otherwise inside the selected frame, else at the view centre
 *   Folio.componentsPanel.addStarterKit()
 *   Folio.componentsPanel.inInstance(id)         true for layers INSIDE an instance (they follow the main)
 *   Folio.componentsPanel.dropBlocked(targetId, ids?, compId?)  true when a frame can't receive these layers
 *   Folio.componentsPanel.goToMain(id)           select + show the main (or the main's counterpart of `id`)
 *
 * Tiles show a live thumbnail: a scaled clone of the main's rendered element, with the brand's CSS
 * variables applied so token colours/fonts look right outside #canvas-world.
 * Every action commits once (store.commit).
 */
window.Folio = window.Folio || {};

(function () {
  const { h } = Folio.ui;
  const store = Folio.store;
  const K = () => Folio.components;
  const icon = (name, size = 14) => Folio.icons.el(name, size);
  const toast = (m, k) => Folio.ui.toast(m, k);

  const TW = 104; // thumbnail box (px) — two tiles per row in the 240px panel
  const TH = 64;

  let root, list, search;
  let raf = 0;
  let timer = 0;
  let dirty = true;
  let busy = false; // inline rename / drag in progress: don't rebuild under it
  const collapsed = new Set(); // set ids folded by the person

  // ---------- shared component helpers (used by layers, canvas, inspector, shortcuts) ----------
  /** True for layers inside an instance (not the instance root itself): they follow the main. */
  function inInstance(id) {
    const k = K();
    if (!k || !id || !store.get(id)) return false;
    const r = k.instanceRootOf(id);
    return !!r && !(r === id && k.isDirectInstance(id));
  }
  const isSetFrame = (id) => !!K() && K().sets().some((s) => s.frameId === id);

  /** Does component `a`'s main contain (at any depth) an instance of component `b`? */
  function uses(a, b, seen = new Set()) {
    if (a === b) return true;
    if (seen.has(a)) return false;
    seen.add(a);
    const c = K().get(a);
    if (!c || !store.get(c.mainId)) return false;
    return [c.mainId, ...store.descendants(c.mainId)].some((id) => {
      const n = store.get(id);
      return n && n.instance && uses(n.instance.componentId, b, seen);
    });
  }

  /** Can't drop these layers (or a new instance of compId) into targetId? */
  function dropBlocked(targetId, ids = [], compId = null) {
    const k = K();
    if (!k || !targetId) return false;
    const t = store.get(targetId);
    if (!t) return true;
    if (t.instance || inInstance(targetId)) return true; // instance internals follow the main
    if (isSetFrame(targetId)) {
      // a set holds only its own variants
      const set = k.sets().find((s) => s.frameId === targetId);
      return !(ids.length && ids.every((id) => (k.componentOf(id) || {}).setId === set.id));
    }
    const mainId = k.mainRootOf(targetId);
    const host = mainId && k.componentOf(mainId);
    if (!host) return false;
    // a component may not contain an instance of itself, directly or indirectly
    const used = new Set(compId ? [compId] : []);
    ids.forEach((id) => [id, ...store.descendants(id)].forEach((d) => {
      const n = store.get(d);
      if (n && n.instance) used.add(n.instance.componentId);
    }));
    return [...used].some((c) => uses(c, host.id));
  }

  function goToMain(id) {
    const k = K();
    const n = id && store.get(id);
    if (!k || !n) return;
    const r = k.instanceRootOf(id);
    const comp = r ? k.get(store.get(r).instance.componentId) : k.get(id);
    if (!comp || !store.get(comp.mainId)) return toast('The main component is gone — this copy can only be detached.', 'error');
    const target = n.sourceId && store.get(n.sourceId) && k.mainRootOf(n.sourceId) ? n.sourceId : comp.mainId;
    store.select([target]);
    if (Folio.canvas && Folio.canvas.zoomToFit) Folio.canvas.zoomToFit([target]);
  }

  // ---------- data for the list ----------
  function groups() {
    const k = K();
    if (!k) return [];
    const q = (search && search.value.trim().toLowerCase()) || '';
    const comps = k.list().filter((c) => store.get(c.mainId));
    const match = (c, set) =>
      !q || [c.name, set && set.name, ...Object.values(c.variant || {})].some((s) => s && String(s).toLowerCase().includes(q));
    const out = [];
    k.sets().forEach((s) => {
      const items = comps.filter((c) => c.setId === s.id && match(c, s));
      if (items.length) out.push({ set: s, items });
    });
    const loose = comps.filter((c) => !c.setId || !k.getSet(c.setId)).filter((c) => match(c));
    if (loose.length) out.push({ set: null, items: loose });
    return out;
  }

  const variantLabel = (c) => {
    const v = Object.values(c.variant || {});
    return v.length ? v.join(', ') : c.name;
  };

  // ---------- rendering ----------
  function schedule() {
    dirty = true;
    if (!root || root.hidden) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!raf) raf = requestAnimationFrame(render);
    }, 200);
  }

  function render() {
    raf = 0;
    if (!root) return;
    if (busy) return void (dirty = true);
    dirty = false;
    if (Folio.render && Folio.render.sync) Folio.render.sync();
    const k = K();
    const total = k ? k.list().filter((c) => store.get(c.mainId)).length : 0;
    root.classList.toggle('is-empty', !total);
    if (!total) return list.replaceChildren(emptyState());
    const gs = groups();
    if (!gs.length) return list.replaceChildren(h('p', { class: 'f-hint kp-none' }, `No components match “${search.value.trim()}”.`));
    list.replaceChildren(...gs.map(group));
  }

  function emptyState() {
    return h(
      'div',
      { class: 'bp-empty kp-empty' },
      h('div', { class: 'bp-empty__icon' }, icon('grid', 20)),
      h('h3', { class: 'bp-empty__title' }, 'No components yet'),
      h(
        'p',
        { class: 'bp-empty__text' },
        'A component is a piece you design once — a button, a card — and reuse everywhere. Change the original and every copy updates.'
      ),
      h('button', { type: 'button', class: 'f-btn f-btn--primary kp-empty__kit', onClick: addStarterKit }, icon('sparkle', 14), 'Add starter kit'),
      h('p', { class: 'f-hint' }, `Or select a frame and press ${fmt('mod+alt+k')} to make your own.`, !K() ? ' (Components are still loading.)' : '')
    );
  }

  const fmt = (combo) => (Folio.keys ? Folio.keys.fmt(combo) : combo);

  function group({ set, items }) {
    const isOpen = !set || !collapsed.has(set.id);
    const body = h('div', { class: 'kp-grid' }, isOpen ? items.map(tile) : []);
    if (!set) return h('section', { class: 'kp-group' }, h('div', { class: 'kp-group__head' }, h('span', { class: 'kp-group__name' }, 'Components')), body);
    const name = h('span', { class: 'kp-group__name' }, set.name);
    const head = h(
      'div',
      { class: 'kp-group__head' },
      h(
        'button',
        {
          type: 'button',
          class: 'kp-group__toggle',
          'aria-expanded': String(isOpen),
          onClick: () => {
            collapsed.has(set.id) ? collapsed.delete(set.id) : collapsed.add(set.id);
            render();
          },
        },
        icon(isOpen ? 'chevron-down' : 'chevron-right', 12),
        name,
        h('span', { class: 'kp-group__count' }, String(items.length))
      ),
      moreBtn(`Actions for ${set.name}`, (anchor) => setMenu(anchor, set, name))
    );
    return h('section', { class: 'kp-group' + (isOpen ? '' : ' is-collapsed') }, head, body);
  }

  function moreBtn(label, open) {
    const b = h('button', { type: 'button', class: 'f-btn f-btn--ghost f-btn--icon bp-ibtn kp-more', title: label, 'aria-label': label }, icon('more', 14));
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      open(b);
    });
    return b;
  }

  function tile(c) {
    const label = variantLabel(c);
    const box = layoutBox(c.mainId);
    const wide = box && box.width / Math.max(1, box.height) > 3.2;
    const name = h('span', { class: 'kp-tile__name' }, label);
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'kp-tile__btn',
        title: `${c.name}${c.description ? ' — ' + c.description : ''}\nClick to add, or drag onto the canvas`,
        'aria-label': `Add ${c.setId ? c.name + ' ' + label : c.name}`,
        dataset: { comp: c.id },
      },
      thumb(c, box),
      name
    );
    btn.addEventListener('click', () => {
      if (btn.dataset.dragged) return void delete btn.dataset.dragged;
      insert(c.id);
    });
    btn.addEventListener('pointerdown', (e) => startDrag(e, c, btn));
    const el = h('div', { class: 'kp-tile' + (wide ? ' is-wide' : '') }, btn, moreBtn(`Actions for ${label}`, (anchor) => itemMenu(anchor, c, name)));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      itemMenu({ x: e.clientX, y: e.clientY }, c, name);
    });
    return el;
  }

  const layoutBox = (id) => (Folio.render && Folio.render.layoutBox ? Folio.render.layoutBox(id) : null);

  /** A scaled clone of the main's rendered DOM. */
  function thumb(c, b) {
    const box = h('div', { class: 'kp-thumb', 'aria-hidden': 'true' });
    const src = Folio.render && Folio.render.el ? Folio.render.el(c.mainId) : null;
    if (!src || !b || !b.width || !b.height) {
      box.appendChild(icon('grid', 18));
      return box;
    }
    const wide = b.width / Math.max(1, b.height) > 3.2;
    const tw = wide ? TW * 2 + 8 : TW;
    const k = Math.min((tw - 12) / b.width, (TH - 12) / b.height, 1);
    const clone = src.cloneNode(true);
    const strip = (el) => {
      el.removeAttribute('data-id');
      el.removeAttribute('contenteditable');
      el.classList.remove('f-node', 'is-editing', 'f-drag-source');
    };
    strip(clone);
    clone.querySelectorAll('[data-id]').forEach(strip);
    Object.assign(clone.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      margin: '0px',
      width: b.width + 'px',
      height: b.height + 'px',
      flex: 'none',
      transform: 'none',
    });
    const wrap = h('div', {
      class: 'kp-thumb__in',
      style: { width: b.width + 'px', height: b.height + 'px', transform: `translate(-50%, -50%) scale(${k})` },
    });
    wrap.appendChild(clone);
    box.appendChild(wrap);
    if (Folio.brand && Folio.brand.apply) Folio.brand.apply(box);
    return box;
  }

  // ---------- menus ----------
  function itemMenu(anchor, c, nameEl) {
    if (!Folio.menu) return;
    const inSet = c.setId && K().getSet(c.setId);
    Folio.menu.open(
      anchor,
      [
        { label: 'Add to design', icon: 'plus', action: () => insert(c.id) },
        { label: 'Go to main component', icon: 'arrow-right', action: () => goToMain(c.mainId) },
        inSet ? null : { label: 'Rename', action: () => inlineRename(nameEl, c.name, (v) => renameComp(c, v)) },
        { sep: true },
        { label: inSet ? 'Delete variant' : 'Delete main component', icon: 'trash', action: () => deleteMain(c) },
      ],
      { align: 'right' }
    );
  }

  function setMenu(anchor, set, nameEl) {
    if (!Folio.menu) return;
    Folio.menu.open(
      anchor,
      [
        {
          label: 'Go to component set',
          icon: 'arrow-right',
          action: () => {
            store.select([set.frameId]);
            if (Folio.canvas) Folio.canvas.zoomToFit([set.frameId]);
          },
        },
        { label: 'Rename', action: () => inlineRename(nameEl, set.name, (v) => renameSet(set, v)) },
        { sep: true },
        {
          label: 'Delete component set',
          icon: 'trash',
          action: () => {
            if (!window.confirm(`Delete the component set “${set.name}” and all its variants?\n\nCopies already in your designs become plain layers. You can undo this.`)) return;
            store.remove([set.frameId]);
            store.commit('Delete component set');
          },
        },
      ],
      { align: 'right' }
    );
  }

  function deleteMain(c) {
    const what = c.setId ? `the variant “${variantLabel(c)}” of ${c.name}` : `the main component “${c.name}”`;
    if (!window.confirm(`Delete ${what}?\n\nCopies already in your designs become plain layers. You can undo this.`)) return;
    store.remove([c.mainId]);
    store.commit('Delete component');
  }

  // shortcut: names live on the registry entries (no engine rename API); the main/set frame layer is renamed too
  function renameComp(c, v) {
    store.update(c.mainId, { name: v });
    const live = K().get(c.id);
    if (live) live.name = v;
    store.emit('components');
    store.commit('Rename component');
  }
  function renameSet(set, v) {
    const live = K().getSet(set.id);
    if (live) live.name = v;
    store.update(set.frameId, { name: v });
    K().list().forEach((c) => {
      if (c.setId === set.id) c.name = v;
    });
    store.emit('components');
    store.commit('Rename component set');
  }

  /** Replace `el`'s text with an input; Enter/blur saves, Esc cancels. */
  function inlineRename(el, value, onDone) {
    const input = h('input', { class: 'f-input bp-inline', value: value || '', spellcheck: 'false', 'aria-label': 'New name' });
    const prev = Array.from(el.childNodes);
    el.replaceChildren(input);
    busy = true;
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      busy = false;
      const v = input.value.trim();
      el.replaceChildren(...prev);
      if (ok && v && v !== value) onDone(v);
      else if (dirty) render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    ['click', 'pointerdown'].forEach((t) => input.addEventListener(t, (e) => e.stopPropagation()));
    input.addEventListener('blur', () => finish(true));
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  // ---------- inserting ----------
  const vpEl = () => document.getElementById('canvas-viewport');

  /** Where a drop at a client point lands: { parentId, index, x, y } (x/y relative to the parent's content). */
  function dropAt(cx, cy, compId, size) {
    const C = Folio.canvas;
    const r = vpEl().getBoundingClientRect();
    const w = C.screenToWorld(cx - r.left, cy - r.top);
    let parentId = C.frameAt ? C.frameAt(cx, cy) : null;
    while (parentId && dropBlocked(parentId, [], compId)) parentId = store.get(parentId).parent;
    const pn = parentId && store.get(parentId);
    const out = { parentId: parentId || null, world: w };
    if (pn && pn.layout && pn.layout.mode === 'flex') {
      const fd = C.flexDrop(parentId, w, null);
      out.line = fd.line;
      if (fd.beforeId) out.index = pn.children.indexOf(fd.beforeId);
    } else {
      const o = parentId ? C.contentOrigin(parentId) : { x: 0, y: 0 };
      out.x = Math.round(w.x - size.width / 2 - o.x);
      out.y = Math.round(w.y - size.height / 2 - o.y);
    }
    return out;
  }

  /** Default placement: inside the selected frame (or the selected layer's frame), else centred in the view. */
  function defaultPlace(compId, size) {
    const C = Folio.canvas;
    const p = store.primary();
    let parentId = p ? (p.type === 'frame' ? p.id : p.parent) : null;
    while (parentId && dropBlocked(parentId, [], compId)) parentId = store.get(parentId).parent;
    const out = { parentId: parentId || null };
    const pn = parentId && store.get(parentId);
    if (pn && pn.layout && pn.layout.mode === 'flex') return out;
    if (pn) {
      const pb = layoutBox(parentId);
      const bw = (pn.style && pn.style.border && pn.style.border.width) || 0;
      out.x = Math.max(0, Math.round((pb.width - 2 * bw - size.width) / 2));
      out.y = Math.max(0, Math.round((pb.height - 2 * bw - size.height) / 2));
      return out;
    }
    const v = vpEl();
    const w = C.screenToWorld(v.clientWidth / 2, v.clientHeight / 2);
    out.x = Math.round(w.x - size.width / 2);
    out.y = Math.round(w.y - size.height / 2);
    return out;
  }

  function insert(compId, at) {
    const k = K();
    const c = k && k.get(compId);
    if (!c || !store.get(c.mainId) || !Folio.canvas) return null;
    if (Folio.render) Folio.render.sync();
    const size = layoutBox(c.mainId) || { width: 100, height: 100 };
    const place = at ? dropAt(at.clientX, at.clientY, compId, size) : defaultPlace(compId, size);
    const opts = { parentId: place.parentId };
    if (place.index !== undefined) opts.index = place.index;
    if (place.x !== undefined) Object.assign(opts, { x: place.x, y: place.y });
    let id = null;
    try {
      id = k.createInstance(compId, opts);
    } catch (e) {
      toast(e.message || 'Could not add that component here.', 'error');
      return null;
    }
    if (!id) return null;
    store.select([id]);
    store.commit('Insert ' + c.name);
    return id;
  }

  function addStarterKit() {
    const k = K();
    if (!k) return;
    let ids = [];
    try {
      ids = k.addStarterKit() || [];
    } catch (e) {
      return toast(e.message || 'Could not add the starter kit.', 'error');
    }
    store.commit('Add starter kit');
    const first = ids.map((id) => k.get(id)).find((c) => c && store.get(c.mainId));
    if (first && Folio.canvas) {
      if (Folio.render) Folio.render.rerender();
      Folio.canvas.zoomToFit([store.rootOf(first.mainId)]);
    }
    render();
    toast('Starter kit added — click a component to drop a copy into your design.', 'success');
  }

  // ---------- drag a tile onto the canvas ----------
  let drag = null;
  function startDrag(e, c, btn) {
    if (e.button !== 0 || !Folio.canvas) return;
    drag = { c, btn, sx: e.clientX, sy: e.clientY, active: false, ghost: null, place: null };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
    window.addEventListener('keydown', onDragKey, true);
  }
  function overCanvas(e) {
    const r = vpEl().getBoundingClientRect();
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom && !!hit && vpEl().contains(hit);
  }
  function onDragMove(e) {
    const d = drag;
    if (!d) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
      d.active = true;
      busy = true;
      d.size = layoutBox(d.c.mainId) || { width: 100, height: 100 };
      const th = d.btn.querySelector('.kp-thumb');
      d.ghost = h('div', { class: 'kp-ghost' }, th ? th.cloneNode(true) : null);
      document.body.appendChild(d.ghost);
      document.documentElement.classList.add('kp-dragging');
    }
    d.ghost.style.transform = `translate(${e.clientX - TW / 2}px, ${e.clientY - TH / 2}px)`;
    d.place = overCanvas(e) ? dropAt(e.clientX, e.clientY, d.c.id, d.size) : null;
    d.ghost.classList.toggle('is-over', !!d.place);
    if (Folio.overlay) Folio.overlay.setGuides({ dropTarget: d.place && d.place.parentId, dropLine: (d.place && d.place.line) || null });
  }
  function endDrag() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    window.removeEventListener('keydown', onDragKey, true);
    const d = drag;
    drag = null;
    busy = false;
    if (!d || !d.active) return d;
    d.btn.dataset.dragged = '1'; // swallow the click that follows the drag
    setTimeout(() => delete d.btn.dataset.dragged, 0);
    d.ghost.remove();
    document.documentElement.classList.remove('kp-dragging');
    if (Folio.overlay) Folio.overlay.setGuides({ dropTarget: null, dropLine: null });
    return d;
  }
  function onDragEnd(e) {
    const d = endDrag();
    if (d && d.active && e.type === 'pointerup' && overCanvas(e)) insert(d.c.id, { clientX: e.clientX, clientY: e.clientY });
    if (dirty) schedule();
  }
  function onDragKey(e) {
    if (e.key !== 'Escape' || !drag) return;
    e.preventDefault();
    e.stopPropagation();
    endDrag();
  }

  // ---------- init ----------
  function init() {
    root = document.getElementById('components-panel');
    if (!root) return;
    root.classList.add('kp');
    root.setAttribute('role', 'tabpanel');
    search = h('input', { class: 'f-input kp-search', type: 'search', placeholder: 'Search components', 'aria-label': 'Search components', spellcheck: 'false' });
    search.addEventListener('input', render);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        search.value = '';
        render();
        search.blur();
      }
    });
    const kit = h('button', { type: 'button', class: 'f-btn f-btn--ghost f-btn--icon bp-ibtn', title: 'Add starter kit (buttons, cards, inputs…)', 'aria-label': 'Add starter kit', onClick: addStarterKit }, icon('sparkle', 14));
    list = h('div', { class: 'kp-list' });
    root.replaceChildren(h('div', { class: 'kp-head' }, search, kit), list);
    ['components', 'change', 'doc', 'history', 'brand'].forEach((evt) => store.on(evt, schedule));
    render();
  }

  function refresh() {
    if (root) render();
  }

  Folio.componentsPanel = { init, refresh, insert, addStarterKit, inInstance, dropBlocked, goToMain, isSetFrame };
})();
