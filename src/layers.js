/*
 * layers.js — the layer tree in the left panel.
 *
 * Shows every artboard and its children, top-most layer first (like Figma).
 *   click            select (Shift / Cmd / Ctrl click toggles)
 *   double-click     rename
 *   drag             reorder, or drop onto the middle of a frame to move it inside
 *   eye / lock       show/hide and lock/unlock (appear on hover)
 *   right-click      context menu
 *
 * Above the tree: the Pages list (click switch, double-click rename, + add, drag reorder,
 * right-click Rename / Duplicate / Delete). Right-click an artboard → Move to page ▸.
 */
window.Folio = window.Folio || {};

(function () {
  const { h } = Folio.ui;
  const store = Folio.store;
  const icon = (name, size) => Folio.icons.el(name, size);

  const INDENT = 14;
  const expanded = new Set(); // frame ids whose children are shown
  const seen = new Set(); // roots we've already auto-expanded once

  let root, tree, empty, indicator;
  let pagesList, pagesBody, pagesCaret;
  let pagesOpen = true;
  let pageDrag = null; // page id being dragged
  let pagesKey = '';
  let raf = 0;
  let pending = false;
  let renaming = null; // id being renamed
  let drag = null; // { id, ids, x, y, active, target, pointerId }

  // ---------- helpers ----------
  const KP = () => Folio.componentsPanel;
  const inInstance = (id) => !!(KP() && KP().inInstance(id));
  const DIAMOND = '<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/>';
  const DIAMONDS = '<path d="M12 2.5l4 4-4 4-4-4zM12 13.5l4 4-4 4-4-4zM6.5 8l4 4-4 4-4-4zM17.5 8l4 4-4 4-4-4z"/>';
  function compIcon(body, filled) {
    const t = document.createElement('template');
    t.innerHTML = `<svg class="f-icon${filled ? ' is-filled' : ''}" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
    return t.content.firstChild;
  }
  /** Component role of a layer: 'main' | 'set' | 'instance' | 'inner' | null. */
  function compRole(n) {
    const K = Folio.components;
    if (!K) return null;
    if (n.component && K.componentOf(n.id)) return 'main';
    if (KP() && KP().isSetFrame(n.id)) return 'set';
    if (inInstance(n.id)) return 'inner';
    if (n.instance) return 'instance';
    return null;
  }
  function iconFor(n) {
    if (n.type === 'text') return 'text';
    if (n.type === 'image') return 'image';
    const r = n.style && n.style.radius;
    if (/ellipse|circle/i.test(n.name) || (typeof r === 'number' && r >= 9999)) return 'ellipse';
    if (n.layout && n.layout.mode === 'flex') return n.layout.direction === 'row' ? 'arrow-right' : 'arrow-down';
    if (!n.children.length && /^rect/i.test(n.name)) return 'rect';
    return 'frame';
  }

  /** Selected ids without those whose ancestor is also selected. */
  function topLevel(ids) {
    return ids.filter((id) => store.get(id) && !ids.some((o) => o !== id && store.isAncestor(o, id)));
  }

  function rowOf(id) {
    return tree && tree.querySelector(`.ly-row[data-id="${CSS.escape(id)}"]`);
  }

  // ---------- rendering ----------
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(render);
  }

  function render() {
    raf = 0;
    if (!tree) return;
    renderPages();
    if (renaming || (drag && drag.active)) {
      pending = true;
      return;
    }
    pending = false;
    store.doc.roots.forEach((id) => {
      if (!seen.has(id)) {
        seen.add(id);
        expanded.add(id);
      }
    });
    const frag = document.createDocumentFragment();
    const roots = store.doc.roots.slice().reverse();
    roots.forEach((id) => addRow(frag, id, 0, false));
    tree.replaceChildren(frag);
    tree.appendChild(indicator);
    empty.hidden = roots.length > 0;
    syncSelection();
    syncHover();
  }

  function addRow(frag, id, depth, parentHidden) {
    const n = store.get(id);
    if (!n) return;
    const hasKids = n.type === 'frame' && n.children.length > 0;
    const open = hasKids && expanded.has(id);
    const hidden = n.visible === false;
    const cls = ['ly-row'];
    if (depth === 0) cls.push('is-root');
    if (hidden || parentHidden) cls.push('is-hidden');
    if (n.locked) cls.push('is-locked');
    const role = compRole(n);
    if (role === 'main' || role === 'set') cls.push('is-comp');
    if (role === 'instance') cls.push('is-instance');
    if (role === 'inner') cls.push('is-in-instance');

    const eye = h(
      'button',
      { type: 'button', class: 'ly-act' + (hidden ? ' is-on' : ''), dataset: { act: 'eye' }, title: hidden ? 'Show' : 'Hide' },
      icon(hidden ? 'eye-off' : 'eye', 14)
    );
    const lock = h(
      'button',
      { type: 'button', class: 'ly-act' + (n.locked ? ' is-on' : ''), dataset: { act: 'lock' }, title: n.locked ? 'Unlock' : 'Lock' },
      icon(n.locked ? 'lock' : 'unlock', 14)
    );

    const row = h(
      'div',
      {
        class: cls.join(' '),
        role: 'treeitem',
        'aria-level': String(depth + 1),
        'aria-expanded': hasKids ? String(open) : null,
        dataset: { id, depth: String(depth) },
        style: { paddingLeft: 6 + depth * INDENT + 'px' },
      },
      h(
        'span',
        { class: 'ly-row__caret' + (hasKids ? '' : ' is-empty'), dataset: { act: 'caret' } },
        hasKids ? icon(open ? 'chevron-down' : 'chevron-right', 12) : null
      ),
      h(
        'span',
        { class: 'ly-row__icon', title: { main: 'Main component', set: 'Component set', instance: 'Instance' }[role] || null },
        role === 'main' ? compIcon(DIAMOND, true) : role === 'set' ? compIcon(DIAMONDS) : role === 'instance' ? compIcon(DIAMOND) : icon(iconFor(n), 14)
      ),
      h('span', { class: 'ly-row__name' }, n.name || n.type),
      h('span', { class: 'ly-row__actions' }, lock, eye)
    );
    frag.appendChild(row);
    if (open) n.children.slice().reverse().forEach((c) => addRow(frag, c, depth + 1, hidden || parentHidden));
  }

  function syncSelection() {
    if (!tree) return;
    const sel = new Set(store.selection);
    tree.querySelectorAll('.ly-row').forEach((row) => {
      const id = row.dataset.id;
      const isSel = sel.has(id);
      row.classList.toggle('is-selected', isSel);
      row.setAttribute('aria-selected', isSel ? 'true' : 'false');
      row.classList.toggle('is-in-selected', !isSel && store.ancestors(id).some((a) => sel.has(a)));
    });
  }

  function syncHover() {
    if (!tree) return;
    const hid = store.hoverId;
    tree.querySelectorAll('.ly-row.is-hover').forEach((r) => r.classList.remove('is-hover'));
    if (hid) {
      const r = rowOf(hid);
      if (r) r.classList.add('is-hover');
    }
  }

  function onSelection() {
    // auto-expand the ancestors of the selection so it is visible
    let changed = false;
    store.selection.forEach((id) =>
      store.ancestors(id).forEach((a) => {
        if (!expanded.has(a)) {
          expanded.add(a);
          changed = true;
        }
      })
    );
    if (changed) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      render();
    } else syncSelection();
    const p = store.selection[store.selection.length - 1];
    if (p) scrollIntoView(p);
  }

  function scrollIntoView(id) {
    const row = rowOf(id);
    const scroller = document.getElementById('left-panel');
    if (!row || !scroller) return;
    const head = root.querySelector('.ly__head');
    const headH = head ? head.offsetHeight : 0;
    const rr = row.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    if (rr.top < sr.top + headH) scroller.scrollTop -= sr.top + headH - rr.top + 4;
    else if (rr.bottom > sr.bottom) scroller.scrollTop += rr.bottom - sr.bottom + 4;
  }

  // ---------- actions ----------
  function toggleExpanded(id, deep) {
    const open = !expanded.has(id);
    const ids = deep ? [id, ...store.descendants(id)] : [id];
    ids.forEach((i) => (open ? expanded.add(i) : expanded.delete(i)));
    render();
  }

  function toggleVisible(id) {
    const n = store.get(id);
    if (!n) return;
    store.update(id, { visible: n.visible === false });
    store.commit(n.visible ? 'Show layer' : 'Hide layer');
  }

  function toggleLock(id) {
    const n = store.get(id);
    if (!n) return;
    store.update(id, { locked: !n.locked });
    store.commit(n.locked ? 'Lock layer' : 'Unlock layer');
  }

  function startRename(id) {
    const row = rowOf(id);
    const n = store.get(id);
    if (!row || !n) return;
    if (inInstance(id)) return Folio.ui.toast('Edit the main component to change this');
    const nameEl = row.querySelector('.ly-row__name');
    renaming = id;
    const input = h('input', { class: 'ly-rename', value: n.name, spellcheck: false });
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      renaming = null;
      const v = input.value.trim();
      if (save && v && v !== n.name && store.get(id)) {
        store.update(id, { name: v });
        store.commit('Rename layer');
      }
      render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  function contextMenu(id, x, y) {
    if (!Folio.menu) return;
    if (!store.selection.includes(id)) store.select(id);
    const n = store.get(id);
    const A = Folio.actions || {};
    const k = Folio.keys ? Folio.keys.fmt : (s) => s;
    const run = (fn) => () => fn && fn();
    const role = compRole(n);
    const inst = role === 'instance' || role === 'inner';
    const comp = [
      role === null && n.type === 'frame' && Folio.components ? { label: 'Create component', shortcut: k('mod+alt+k'), action: run(A.createComponent) } : null,
      inst ? { label: 'Go to main component', action: () => KP() && KP().goToMain(id) } : null,
      role === 'instance' ? { label: 'Reset overrides', action: run(A.resetOverrides) } : null,
      inst ? { label: 'Detach instance', shortcut: k('mod+alt+b'), action: run(A.detachInstance) } : null,
    ].filter(Boolean);
    Folio.menu.open({ x, y }, [
      ...comp,
      comp.length ? { sep: true } : null,
      { label: 'Rename', action: () => startRename(id), disabled: role === 'inner' },
      !n.parent && store.pages().length > 1 ? { label: 'Move to page ▸', action: () => moveToPageMenu(x, y) } : null,
      { label: 'Duplicate', shortcut: k('mod+d'), action: run(A.duplicate) },
      { label: 'Delete', shortcut: k('del'), action: run(A.remove) },
      { sep: true },
      { label: 'Wrap in auto layout', shortcut: k('shift+a'), action: run(A.wrapAutoLayout) },
      { label: 'Group', shortcut: k('mod+g'), action: run(A.group) },
      n.type === 'frame' && n.children.length ? { label: 'Ungroup', shortcut: k('mod+shift+g'), action: run(A.ungroup) } : null,
      { sep: true },
      { label: 'Bring to front', shortcut: k('mod+alt+]'), action: run(A.bringToFront) },
      { label: 'Send to back', shortcut: k('mod+alt+['), action: run(A.sendToBack) },
      { sep: true },
      { label: n.visible === false ? 'Show' : 'Hide', action: () => toggleVisible(id) },
      { label: n.locked ? 'Unlock' : 'Lock', action: () => toggleLock(id) },
      { sep: true },
      { label: 'Zoom to layer', shortcut: k('shift+2'), action: run(A.zoomToSelection) },
      { label: 'View code', shortcut: k('mod+e'), action: () => Folio.codePanel && Folio.codePanel.toggle(true) },
    ]);
  }

  /** Second menu at the same spot: the other pages. Moves the selected artboards. */
  function moveToPageMenu(x, y) {
    const cur = store.doc.page;
    Folio.menu.open({ x, y }, [
      { header: 'Move to page' },
      ...store
        .pages()
        .filter((p) => p.id !== cur)
        .map((p) => ({ label: p.name, action: () => moveToPage(p) })),
    ]);
  }
  function moveToPage(p) {
    const ids = topLevel(store.selection).filter((id) => !store.get(id).parent);
    if (!store.moveToPage(ids, p.id).length) return;
    store.commit('Move to page');
    Folio.ui.toast(`Moved ${ids.length === 1 ? '“' + store.get(ids[0]).name + '”' : ids.length + ' artboards'} to “${p.name}”`);
  }

  // ---------- pages ----------
  function renderPages() {
    if (!pagesList) return;
    if (pagesList.querySelector('.ly-rename')) return; // don't rebuild under an inline rename
    const cur = store.doc.page;
    const key = JSON.stringify(store.pages().map((p) => [p.id, p.name, p.roots.length]));
    if (key === pagesKey) {
      // same list: only move the highlight (keeps the rows, so a double-click survives the switch)
      pagesList.querySelectorAll('.ly-page').forEach((r) => {
        r.classList.toggle('is-current', r.dataset.page === cur);
        r.setAttribute('aria-selected', String(r.dataset.page === cur));
      });
      return;
    }
    pagesKey = key;
    pagesList.replaceChildren(
      ...store.pages().map((p) =>
        h(
          'div',
          {
            class: 'ly-page' + (p.id === cur ? ' is-current' : ''),
            role: 'option',
            'aria-selected': String(p.id === cur),
            draggable: 'true',
            dataset: { page: p.id },
          },
          h('span', { class: 'ly-row__icon' }, icon('file', 14)),
          h('span', { class: 'ly-row__name' }, p.name),
          h('span', { class: 'ly-page__count', title: `${p.roots.length} artboard${p.roots.length === 1 ? '' : 's'}` }, p.roots.length ? String(p.roots.length) : '')
        )
      )
    );
  }

  function addPage() {
    const p = store.addPage(undefined, { activate: true });
    store.commit('Add page');
    renderPages();
    startPageRename(p.id);
  }

  function startPageRename(id) {
    const row = pagesList.querySelector(`.ly-page[data-page="${CSS.escape(id)}"]`);
    const p = store.page(id);
    if (!row || !p) return;
    const input = h('input', { class: 'ly-rename', value: p.name, spellcheck: false, 'aria-label': 'Page name' });
    row.querySelector('.ly-row__name').replaceWith(input);
    row.draggable = false;
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      input.remove();
      pagesKey = '';
      if (save && store.renamePage(id, input.value)) store.commit('Rename page');
      renderPages();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  function deletePage(p) {
    const k = p.roots.length;
    if (k && !window.confirm(`Delete the page “${p.name}” and its ${k} artboard${k === 1 ? '' : 's'}?\n\nYou can undo this.`)) return;
    if (store.removePage(p.id)) store.commit('Delete page');
  }

  function pageMenu(id, x, y) {
    const p = store.page(id);
    if (!p || !Folio.menu) return;
    Folio.menu.open({ x, y }, [
      { label: 'Rename', action: () => startPageRename(id) },
      {
        label: 'Duplicate',
        action: () => {
          const c = store.duplicatePage(id);
          store.switchPage(c.id);
          store.commit('Duplicate page');
        },
      },
      { sep: true },
      { label: 'Delete', icon: 'trash', disabled: store.pages().length < 2, action: () => deletePage(p) },
    ]);
  }

  function togglePages(open = !pagesOpen) {
    pagesOpen = open;
    pagesBody.hidden = !open;
    pagesCaret.replaceChildren(icon(open ? 'chevron-down' : 'chevron-right', 12));
    pagesCaret.setAttribute('aria-expanded', String(open));
  }

  function buildPages() {
    const add = h('button', { type: 'button', class: 'f-btn f-btn--ghost f-btn--icon ly__add', title: 'Add page', 'aria-label': 'Add page' }, icon('plus', 14));
    add.addEventListener('mousedown', (e) => e.preventDefault());
    add.addEventListener('click', addPage);
    pagesCaret = h('button', { type: 'button', class: 'ly-pages__toggle', 'aria-expanded': 'true', onClick: () => togglePages() });
    const head = h('div', { class: 'ly-pages__head' }, h('span', { class: 'ly-pages__title', onClick: () => togglePages() }, pagesCaret, 'Pages'), add);
    pagesList = h('div', { class: 'ly-pages__list', role: 'listbox', 'aria-label': 'Pages' });
    pagesBody = h('div', {}, pagesList);
    const rowOfPage = (e) => e.target.closest && e.target.closest('.ly-page');
    pagesList.addEventListener('click', (e) => {
      const row = rowOfPage(e);
      if (row && !e.target.closest('.ly-rename')) store.switchPage(row.dataset.page);
    });
    pagesList.addEventListener('dblclick', (e) => {
      const row = rowOfPage(e);
      if (row && !e.target.closest('.ly-rename')) startPageRename(row.dataset.page);
    });
    pagesList.addEventListener('contextmenu', (e) => {
      const row = rowOfPage(e);
      if (!row) return;
      e.preventDefault();
      pageMenu(row.dataset.page, e.clientX, e.clientY);
    });
    // drag to reorder (native drag & drop: the list is short)
    const clearDrop = () => pagesList.querySelectorAll('.is-drop-before, .is-drop-after').forEach((r) => r.classList.remove('is-drop-before', 'is-drop-after'));
    const after = (row, e) => e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    pagesList.addEventListener('dragstart', (e) => {
      const row = rowOfPage(e);
      if (!row) return;
      pageDrag = row.dataset.page;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.textContent);
    });
    pagesList.addEventListener('dragover', (e) => {
      const row = rowOfPage(e);
      if (!pageDrag || !row) return;
      e.preventDefault();
      clearDrop();
      row.classList.add(after(row, e) ? 'is-drop-after' : 'is-drop-before');
    });
    pagesList.addEventListener('drop', (e) => {
      const row = rowOfPage(e);
      const id = pageDrag;
      clearDrop();
      if (!id || !row) return;
      e.preventDefault();
      const ids = store.pages().map((p) => p.id);
      let index = ids.indexOf(row.dataset.page) + (after(row, e) ? 1 : 0);
      if (index > ids.indexOf(id)) index--;
      if (index !== ids.indexOf(id) && store.movePage(id, index)) store.commit('Move page');
    });
    pagesList.addEventListener('dragend', () => {
      pageDrag = null;
      clearDrop();
    });
    togglePages(true);
    return h('section', { class: 'ly-pages' }, head, pagesBody);
  }

  function addArtboardMenu(anchor) {
    if (!Folio.menu) return;
    const items = [];
    let group = null;
    (Folio.presets || []).forEach((p) => {
      if (p.group !== group) {
        group = p.group;
        items.push({ header: group });
      }
      items.push({ label: `${p.name}`, shortcut: `${p.width}×${p.height}`, action: () => addArtboard(p) });
    });
    Folio.menu.open(anchor, items, { align: 'right' });
  }

  function addArtboard(p) {
    if (Folio.canvas && Folio.canvas.createArtboard) {
      Folio.canvas.createArtboard(p);
      store.commit('Add artboard');
      return;
    }
    // fallback: place it to the right of the existing artboards
    let maxX = 0;
    let minY = Infinity;
    store.doc.roots.forEach((id) => {
      const n = store.get(id);
      maxX = Math.max(maxX, n.x + n.width);
      minY = Math.min(minY, n.y);
    });
    const n = store.createNode('frame', {
      name: p.name,
      x: store.doc.roots.length ? maxX + 120 : 0,
      y: isFinite(minY) ? minY : 0,
      width: p.width,
      height: p.height,
      style: { clip: true },
    });
    store.select(n.id);
    store.commit('Add artboard');
  }

  // ---------- drag & drop ----------
  function dropTarget(cx, cy) {
    const hit = document.elementFromPoint(cx, cy);
    const row = hit && hit.closest ? hit.closest('.ly-row') : null;
    if (!row || !tree.contains(row)) {
      // below the last row → bottom of the canvas stack
      const rows = tree.querySelectorAll('.ly-row');
      const last = rows[rows.length - 1];
      const tr = tree.getBoundingClientRect();
      if (last && cy > last.getBoundingClientRect().bottom && cy < tr.bottom + 200 && cx > tr.left && cx < tr.right) {
        const bottomRoot = store.doc.roots[0];
        if (bottomRoot && !drag.ids.includes(bottomRoot)) return { id: bottomRoot, zone: 'below', row: rowOf(bottomRoot), depth: 0 };
      }
      return null;
    }
    const id = row.dataset.id;
    const n = store.get(id);
    if (!n) return null;
    if (drag.ids.some((d) => d === id || store.isAncestor(d, id))) return null;
    const r = row.getBoundingClientRect();
    const rel = (cy - r.top) / r.height;
    let zone;
    if (n.type === 'frame') zone = rel < 0.28 ? 'above' : rel > 0.72 ? 'below' : 'inside';
    else zone = rel < 0.5 ? 'above' : 'below';
    if (zone === 'below' && n.type === 'frame' && expanded.has(id) && n.children.length) zone = 'inside-top';
    // instance internals follow their main: nothing can be dropped into or between them
    const into = zone === 'inside' || zone === 'inside-top' ? id : n.parent;
    if (into && KP() && KP().dropBlocked(into, drag.ids)) return null;
    return { id, zone, row, depth: Number(row.dataset.depth) };
  }

  function showIndicator(t) {
    if (!t) {
      indicator.hidden = true;
      return;
    }
    const tr = tree.getBoundingClientRect();
    const rr = t.row.getBoundingClientRect();
    const top = rr.top - tr.top + tree.scrollTop;
    indicator.hidden = false;
    indicator.className = 'ly-drop ly-drop--' + (t.zone === 'inside' ? 'inside' : 'line');
    if (t.zone === 'inside') {
      Object.assign(indicator.style, { top: top + 'px', height: rr.height + 'px', left: '2px', right: '2px' });
    } else {
      const depth = t.zone === 'inside-top' ? t.depth + 1 : t.depth;
      const y = t.zone === 'above' ? top : top + rr.height;
      Object.assign(indicator.style, { top: y - 1 + 'px', height: '2px', left: 6 + depth * INDENT + 14 + 'px', right: '4px' });
    }
  }

  /** Keep a layer's on-canvas position when it moves into a freeform frame (or onto the canvas). */
  function keepPosition(id, newParentId) {
    const n = store.get(id);
    if (!n || n.parent === newParentId) return;
    const np = newParentId ? store.get(newParentId) : null;
    if (np && np.layout && np.layout.mode === 'flex') return;
    const C = Folio.canvas;
    if (!C || !C.nodeRect) return;
    try {
      const r = C.nodeRect(id);
      const pr = np ? C.nodeRect(np.id) : { x: 0, y: 0 };
      if (!r || !pr) return;
      const bw = np && np.style && np.style.border ? np.style.border.width || 0 : 0;
      store.update(id, { x: Math.round(r.x - pr.x - bw), y: Math.round(r.y - pr.y - bw) });
    } catch (e) {
      /* canvas not ready — keep x/y as they are */
    }
  }

  function performDrop(t) {
    const order = [...tree.querySelectorAll('.ly-row')].map((r) => r.dataset.id); // top-most first
    const ids = drag.ids.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)); // top → bottom
    const target = store.get(t.id);
    if (!target) return;
    let moved = false;
    if (t.zone === 'inside' || t.zone === 'inside-top') {
      // append = on top; add bottom-most first so the stack order is preserved
      ids
        .slice()
        .reverse()
        .forEach((id) => {
          keepPosition(id, t.id);
          moved = store.move(id, t.id) || moved;
        });
      expanded.add(t.id);
    } else {
      const parentId = target.parent;
      const list = ids.slice();
      if (t.zone === 'below') list.reverse(); // bottom-most first
      list.forEach((id) => {
        keepPosition(id, parentId);
        const sib = store.siblingsOf(t.id);
        const idx = sib.indexOf(t.id) + (t.zone === 'above' ? 1 : 0);
        moved = store.move(id, parentId, idx) || moved;
      });
    }
    if (moved) {
      store.select(ids);
      store.commit('Move layers');
    }
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const row = e.target.closest('.ly-row');
    if (!row || e.target.closest('.ly-rename')) return;
    const id = row.dataset.id;
    const act = e.target.closest('[data-act]');
    if (act) {
      e.preventDefault();
      if (act.dataset.act === 'caret') toggleExpanded(id, e.altKey);
      else if (act.dataset.act === 'eye') toggleVisible(id);
      else if (act.dataset.act === 'lock') toggleLock(id);
      return;
    }
    e.preventDefault(); // keep keyboard focus where it is (so shortcuts work)
    if (document.activeElement && document.activeElement.blur && Folio.ui.isTyping()) document.activeElement.blur();
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      store.toggleSelect(id);
      return;
    }
    const wasSelected = store.selection.includes(id);
    if (!wasSelected) store.select(id);
    const ids = topLevel(store.selection.includes(id) ? store.selection : [id]);
    if (ids.some(inInstance)) return; // layers inside an instance can't be moved (they follow the main)
    drag = { id, ids, x: e.clientX, y: e.clientY, active: false, target: null, wasSelected };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  let scrollTimer = 0;
  function autoScroll(cy) {
    const scroller = document.getElementById('left-panel');
    if (!scroller) return;
    const r = scroller.getBoundingClientRect();
    clearInterval(scrollTimer);
    const dir = cy < r.top + 48 ? -1 : cy > r.bottom - 24 ? 1 : 0;
    if (dir) scrollTimer = setInterval(() => (scroller.scrollTop += dir * 8), 16);
  }

  function onPointerMove(e) {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      drag.active = true;
      tree.classList.add('is-dragging');
      drag.ids.forEach((id) => {
        const r = rowOf(id);
        if (r) r.classList.add('is-drag-source');
      });
    }
    drag.target = dropTarget(e.clientX, e.clientY);
    showIndicator(drag.target);
    autoScroll(e.clientY);
  }

  function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    clearInterval(scrollTimer);
    const d = drag;
    drag = null;
    if (!d) return;
    tree.classList.remove('is-dragging');
    indicator.hidden = true;
    if (d.active) {
      if (d.target) {
        drag = d; // performDrop reads drag.ids
        drag.active = false;
        performDrop(d.target);
        drag = null;
      }
      render();
    } else if (d.wasSelected && store.selection.length > 1) {
      store.select(d.id); // plain click on a multi-selection → select just this one
    }
    if (pending) render();
  }

  // ---------- init ----------
  function init() {
    root = document.getElementById('layers');
    if (!root) return;
    root.innerHTML = '';
    root.classList.add('ly');
    const addBtn = h(
      'button',
      { type: 'button', class: 'f-btn f-btn--ghost f-btn--icon ly__add', title: 'Add artboard', 'aria-label': 'Add artboard' },
      icon('plus', 14)
    );
    addBtn.addEventListener('mousedown', (e) => e.preventDefault());
    addBtn.addEventListener('click', (e) => addArtboardMenu(e.currentTarget));
    const head = h('div', { class: 'ly__head' }, h('span', { class: 'ly__title' }, 'Layers'), addBtn);
    tree = h('div', { class: 'ly__tree', role: 'tree', 'aria-label': 'Layers', 'aria-multiselectable': 'true' });
    indicator = h('div', { class: 'ly-drop', hidden: true });
    empty = h(
      'div',
      { class: 'ly__empty', hidden: true },
      h('div', { class: 'ly__empty-icon' }, icon('layers', 20)),
      h('p', {}, 'No layers yet'),
      h(
        'p',
        { class: 'f-hint' },
        'Press F and drag on the canvas to draw an artboard, use + above for a preset size, or choose File → Load demo.'
      )
    );
    root.append(buildPages(), head, tree, empty);

    tree.addEventListener('pointerdown', onPointerDown);
    tree.addEventListener('dblclick', (e) => {
      const row = e.target.closest('.ly-row');
      if (!row || e.target.closest('[data-act]') || e.target.closest('.ly-rename')) return;
      startRename(row.dataset.id);
    });
    tree.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.ly-row');
      if (!row) return;
      e.preventDefault();
      contextMenu(row.dataset.id, e.clientX, e.clientY);
    });
    tree.addEventListener('mouseover', (e) => {
      if (drag && drag.active) return;
      const row = e.target.closest('.ly-row');
      store.setHover(row ? row.dataset.id : null);
    });
    tree.addEventListener('mouseleave', () => store.setHover(null));

    store.on('change', schedule);
    store.on('components', schedule);
    store.on('doc', () => {
      seen.clear();
      expanded.clear();
      schedule();
    });
    store.on('selection', onSelection);
    store.on('hover', syncHover);
    render();
    renderPages();
  }

  Folio.layers = { init, refresh: render, startRename, contextMenu, expand: (id) => (expanded.add(id), schedule()) };
})();
