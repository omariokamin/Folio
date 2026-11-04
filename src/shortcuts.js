/*
 * shortcuts.js — keyboard shortcuts, plus the shared editing actions they trigger.
 *
 *   Folio.actions   -> remove, duplicate, copy, paste, cut, nudge, wrapAutoLayout, group, ungroup,
 *                      bringForward, sendBackward, bringToFront, sendToBack, selectParent, selectChild,
 *                      selectAll, zoomFit, zoomToSelection, zoom100, zoomIn, zoomOut, …
 *   Folio.shortcuts -> init(), showHelp(), hideHelp(), list (used by the help modal)
 *
 * Shortcuts are ignored while you type in an input or edit text on the canvas.
 */
window.Folio = window.Folio || {};

(function () {
  const store = Folio.store;
  const { h } = Folio.ui;
  const C = () => Folio.canvas;

  /** Selected ids without those whose ancestor is also selected. */
  function topLevel(ids = store.selection) {
    return ids.filter((id) => store.get(id) && !ids.some((o) => o !== id && store.isAncestor(o, id)));
  }
  const KP = () => Folio.componentsPanel;
  const inInstance = (id) => !!(KP() && KP().inInstance(id));
  /** Structure inside an instance follows its main: refuse (with a hint) edits that would change it. */
  function lockedByInstance(ids) {
    if (!ids.some(inInstance)) return false;
    Folio.ui.toast('Edit the main component to change this');
    return true;
  }
  /** The outermost instance that `id` is (or sits inside), or null. */
  function outerInstance(id) {
    const K = Folio.components;
    let r = K && store.get(id) ? K.instanceRootOf(id) : null;
    while (r && !K.isDirectInstance(r)) {
      const p = store.get(r).parent;
      r = p ? K.instanceRootOf(p) : null;
    }
    return r || null;
  }
  const isFlexChild = (id) => {
    const p = store.getParent(id);
    return !!(p && p.layout && p.layout.mode === 'flex');
  };

  /** Show the previous (-1) / next (+1) page; switching pages is not an undo step. */
  function stepPage(d) {
    const ps = store.pages();
    const i = ps.indexOf(store.currentPage());
    if (ps[i + d]) store.switchPage(ps[i + d].id);
  }

  // ---------- system clipboard (so ⌘V can tell Folio layers from HTML copied elsewhere) ----------
  // ownClip: the text Folio last put on the system clipboard; false = writing it failed; null = none yet
  let ownClip = null;
  function markClipboard(ids) {
    const text = 'Folio layers: ' + ids.map((id) => store.get(id).name).join(', ');
    ownClip = false;
    try {
      navigator.clipboard.writeText(text).then(() => (ownClip = text), () => (ownClip = false));
    } catch (e) {
      ownClip = false;
    }
  }
  document.addEventListener('copy', () => (ownClip = String(window.getSelection ? window.getSelection() : ''))); // text copied from Folio's own UI

  // ⌘V / ⇧⌘V let the browser fire 'paste' (it carries the clipboard); onPaste chooses. If no paste event
  // follows (some browsers, automation), the fallback runs Folio's paste / reads the clipboard API.
  let pendingPaste = null;
  function armPaste(shift) {
    const token = (pendingPaste = { shift });
    setTimeout(() => {
      if (pendingPaste !== token) return;
      pendingPaste = null;
      if (shift) Folio.importer && Folio.importer.pasteHtml('');
      else actions.paste();
    }, 0);
  }
  function onPaste(e) {
    if (Folio.ui.isTyping() || store.editingTextId || document.querySelector('.f-modal-backdrop')) return;
    const shift = !!(pendingPaste && pendingPaste.shift);
    pendingPaste = null;
    const cd = e.clipboardData;
    const html = (cd && cd.getData('text/html')) || '';
    const text = (cd && cd.getData('text/plain')) || '';
    const fromFolio = (ownClip && text === ownClip) || (ownClip === false && store.clipboard && store.clipboard.length);
    e.preventDefault();
    if (Folio.importer && (shift || (html && !fromFolio))) return Folio.importer.pasteHtml(html, { text });
    actions.paste();
  }

  // ---------- actions (each one commits its own undo step) ----------
  const actions = {
    remove() {
      const ids = topLevel();
      if (!ids.length) return;
      // layers inside an instance can't be deleted (they follow the main): hide them instead
      const hide = ids.filter(inInstance);
      if (hide.length) store.updateMany(hide, { visible: false });
      const del = ids.filter((id) => !hide.includes(id));
      if (del.length) store.remove(del);
      if (hide.length) store.select([]);
      store.commit('Delete');
    },
    duplicate() {
      const ids = topLevel();
      if (!ids.length || lockedByInstance(ids)) return;
      const created = store.duplicate(ids);
      store.select(created);
      store.commit('Duplicate');
    },
    copy() {
      const ids = topLevel();
      if (!ids.length) return;
      store.copy(ids);
      markClipboard(ids);
      Folio.ui.toast(`Copied ${ids.length} layer${ids.length > 1 ? 's' : ''}`);
    },
    cut() {
      const ids = topLevel();
      if (!ids.length || lockedByInstance(ids)) return;
      store.copy(ids);
      markClipboard(ids);
      store.remove(ids);
      store.commit('Cut');
    },
    paste() {
      const p = store.primary();
      const inst = p && (inInstance(p.id) ? outerInstance(p.id) : p.instance ? p.id : null);
      if (inst) store.select(store.get(inst).parent ? [store.get(inst).parent] : []); // paste beside the instance, never inside it
      const created = store.paste();
      if (!created.length) return;
      store.select(created);
      store.commit('Paste');
    },
    undo: () => store.undo(),
    redo: () => store.redo(),

    /** Arrow keys: move freeform layers; reorder auto-layout children along their axis. */
    nudge(dx, dy) {
      const ids = topLevel().filter((id) => !store.get(id).locked);
      if (!ids.length || lockedByInstance(ids)) return;
      const free = ids.filter((id) => !isFlexChild(id));
      const flex = ids.filter((id) => isFlexChild(id));
      if (free.length) store.updateMany(free, (n) => ({ x: Math.round(n.x + dx), y: Math.round(n.y + dy) }));
      flex.forEach((id) => {
        const p = store.getParent(id);
        const row = p.layout.direction === 'row';
        const d = row ? Math.sign(dx) : Math.sign(dy);
        if (d) store.reorder(id, d);
      });
      store.commit('Nudge');
    },

    /** ⇧A — wrap the selection in an auto-layout frame (direction guessed from positions). */
    wrapAutoLayout() {
      const ids = topLevel();
      if (!ids.length || lockedByInstance(ids)) return;
      const nodes = ids.map((id) => store.get(id));
      const parentId = nodes[0].parent;
      const sameParent = nodes.filter((n) => n.parent === parentId);
      let direction = 'column';
      const freeform = !isFlexChild(sameParent[0].id);
      if (freeform && sameParent.length > 1) {
        const xs = sameParent.map((n) => n.x);
        const ys = sameParent.map((n) => n.y);
        direction = Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys) ? 'row' : 'column';
      } else if (!freeform) {
        const p = store.getParent(sameParent[0].id);
        direction = p.layout.direction;
      }
      const frame = store.wrapInFrame(sameParent.map((n) => n.id), { flex: true });
      if (!frame) return;
      store.update(frame.id, { layout: { direction } });
      if (freeform && sameParent.length > 1) {
        // flex order follows array order → sort children by their old position
        const key = direction === 'row' ? 'x' : 'y';
        const sorted = frame.children.slice().sort((a, b) => store.get(a)[key] - store.get(b)[key]);
        sorted.forEach((id, i) => store.move(id, frame.id, i));
      }
      store.select(frame.id);
      store.commit('Wrap in auto layout');
    },

    /** ⌘G — group into a freeform frame. */
    group() {
      const ids = topLevel();
      if (!ids.length || lockedByInstance(ids)) return;
      const frame = store.wrapInFrame(ids, { flex: false });
      if (!frame) return;
      store.select(frame.id);
      store.commit('Group');
    },

    /** ⇧⌘G — move the children out of a frame and delete the frame. */
    ungroup() {
      const p = store.primary();
      if (!p || p.type !== 'frame' || !p.children.length || lockedByInstance([p.id]) || (p.instance && lockedByInstance(p.children))) return;
      const parentId = p.parent;
      const parentFree = !parentId || store.get(parentId).layout.mode !== 'flex';
      const selfFree = p.layout.mode !== 'flex';
      let index = store.siblingsOf(p.id).indexOf(p.id);
      const kids = p.children.slice();
      let rects = null;
      if (parentFree && !selfFree && C() && C().nodeRect) {
        try {
          rects = kids.map((id) => C().nodeRect(id));
        } catch (e) {
          rects = null;
        }
      }
      const parentRect = parentId && rects && C().nodeRect(parentId);
      kids.forEach((id, i) => {
        const n = store.get(id);
        if (parentFree) {
          if (rects && rects[i]) {
            const ox = parentRect ? parentRect.x : 0;
            const oy = parentRect ? parentRect.y : 0;
            store.update(id, { x: Math.round(rects[i].x - ox), y: Math.round(rects[i].y - oy) });
          } else {
            store.update(id, { x: n.x + p.x, y: n.y + p.y });
          }
        }
        store.move(id, parentId, index + i + 1);
      });
      store.remove(p.id);
      store.select(kids);
      store.commit('Ungroup');
    },

    reorder(delta) {
      const ids = topLevel();
      if (!ids.length || lockedByInstance(ids)) return;
      // move in an order that keeps relative stacking
      const sorted = ids.slice().sort((a, b) => store.siblingsOf(a).indexOf(a) - store.siblingsOf(b).indexOf(b));
      if (delta === 1 || delta === 'front') sorted.reverse();
      sorted.forEach((id) => store.reorder(id, delta));
      store.commit('Reorder');
    },
    bringForward: () => actions.reorder(1),
    sendBackward: () => actions.reorder(-1),
    bringToFront: () => actions.reorder('front'),
    sendToBack: () => actions.reorder('back'),

    selectParent() {
      const p = store.primary();
      if (!p) return;
      store.select(p.parent ? [p.parent] : []);
    },
    selectChild() {
      const p = store.primary();
      if (!p) return;
      if (p.type === 'text') {
        if (C() && C().startTextEdit && !p.locked) C().startTextEdit(p.id);
        return;
      }
      if (p.type !== 'frame' || !p.children.length) return;
      const kids = p.children.filter((id) => store.get(id).visible !== false);
      if (!kids.length) return;
      // auto layout: first in reading order; freeform: the top-most layer (first in the layers list)
      store.select(p.layout.mode === 'flex' ? kids[0] : kids[kids.length - 1]);
    },
    selectAll() {
      const p = store.primary();
      const ids = p ? store.siblingsOf(p.id) : store.doc.roots;
      store.select(ids.filter((id) => store.get(id).visible !== false));
    },
    toggleVisible() {
      const ids = topLevel();
      if (!ids.length) return;
      const show = ids.some((id) => store.get(id).visible === false);
      store.updateMany(ids, { visible: show });
      store.commit(show ? 'Show' : 'Hide');
    },
    toggleLock() {
      const ids = topLevel();
      if (!ids.length) return;
      const lock = ids.some((id) => !store.get(id).locked);
      store.updateMany(ids, { locked: lock });
      store.commit(lock ? 'Lock' : 'Unlock');
    },

    /** ⌥⌘K — turn the selection into a main component. */
    createComponent() {
      const K = Folio.components;
      const ids = topLevel();
      if (!K || !ids.length) return Folio.ui.toast('Select a frame (or a few layers) to turn into a component.');
      if (ids.length === 1 && K.componentOf(ids[0])) return Folio.ui.toast('That is already a main component.');
      if (lockedByInstance(ids) || ids.some((id) => store.get(id).instance)) return;
      let comp = null;
      try {
        comp = K.create(ids, {});
      } catch (e) {
        return Folio.ui.toast(e.message || 'Could not create a component from this.', 'error');
      }
      if (!comp) return;
      store.select([comp.mainId]);
      store.commit('Create component');
      Folio.ui.toast(`“${comp.name}” is now a component — find it in the Components tab.`, 'success');
    },
    /** ⌥⌘B — turn the selected instances back into plain layers. */
    detachInstance() {
      const K = Folio.components;
      const ids = [...new Set(store.selection.map(outerInstance).filter(Boolean))];
      if (!K || !ids.length) return;
      ids.forEach((id) => K.detach(id));
      store.select(ids.filter((id) => store.get(id)));
      store.commit('Detach instance');
    },
    resetOverrides() {
      const K = Folio.components;
      const ids = [...new Set(store.selection.map(outerInstance).filter(Boolean))];
      if (!K || !ids.length) return;
      ids.forEach((id) => K.resetOverrides(id));
      store.commit('Reset overrides');
    },
    goToMain() {
      const p = store.primary();
      if (p && KP()) KP().goToMain(p.id);
    },

    zoomFit: () => C() && C().zoomToFit && C().zoomToFit(),
    zoomToSelection: () => C() && C().zoomToSelection && store.selection.length && C().zoomToSelection(),
    zoom100: () => (C() && C().setZoom ? C().setZoom(1) : store.setViewport({ zoom: 1 })),
    zoomIn: () => C() && C().zoomIn && C().zoomIn(),
    zoomOut: () => C() && C().zoomOut && C().zoomOut(),
    save: () => Folio.exporter && Folio.exporter.saveFile(),
    open: () => Folio.exporter && Folio.exporter.openFile(),
    toggleCode: () => store.emit('code:toggle'),
    prevPage: () => stepPage(-1),
    nextPage: () => stepPage(1),
    help: () => showHelp(),
  };
  Folio.actions = actions;

  // ---------- the shortcut list (drives the handler's help modal) ----------
  const list = [
    {
      group: 'Tools',
      items: [
        ['v', 'Move / select'],
        ['f', 'Frame (artboard)'],
        ['r', 'Rectangle'],
        ['o', 'Ellipse'],
        ['t', 'Text'],
        ['i', 'Image'],
        ['h', 'Hand (or hold Space)'],
      ],
    },
    {
      group: 'Edit',
      items: [
        ['mod+z', 'Undo'],
        ['mod+shift+z', 'Redo'],
        ['mod+c', 'Copy'],
        ['mod+x', 'Cut'],
        ['mod+v', 'Paste'],
        ['mod+shift+v', 'Paste HTML as layers'],
        ['mod+d', 'Duplicate'],
        ['del', 'Delete'],
        ['up', 'Nudge 1px (Shift: 10px)'],
      ],
    },
    {
      group: 'Layout',
      items: [
        ['shift+a', 'Wrap in auto layout'],
        ['mod+g', 'Group'],
        ['mod+shift+g', 'Ungroup'],
        ['mod+]', 'Bring forward'],
        ['mod+[', 'Send backward'],
        ['mod+alt+]', 'Bring to front'],
        ['mod+alt+[', 'Send to back'],
      ],
    },
    {
      group: 'Components',
      items: [
        ['mod+alt+k', 'Create component'],
        ['mod+alt+b', 'Detach instance'],
      ],
    },
    {
      group: 'Pages',
      items: [
        ['alt+up', 'Previous page'],
        ['alt+down', 'Next page'],
      ],
    },
    {
      group: 'Selection',
      items: [
        ['esc', 'Select parent'],
        ['enter', 'Select child / edit text'],
        ['mod+a', 'Select all siblings'],
        ['mod+shift+h', 'Show / hide'],
        ['mod+shift+l', 'Lock / unlock'],
      ],
    },
    {
      group: 'View',
      items: [
        ['shift+1', 'Zoom to fit'],
        ['shift+2', 'Zoom to selection'],
        ['mod+0', 'Zoom to 100%'],
        ['mod++', 'Zoom in'],
        ['mod+-', 'Zoom out'],
        ['mod+e', 'Toggle code panel'],
      ],
    },
    {
      group: 'File',
      items: [
        ['mod+s', 'Save to file'],
        ['mod+o', 'Open file'],
        ['?', 'Show shortcuts'],
      ],
    },
  ];

  // ---------- help modal ----------
  let modal = null;
  function showHelp() {
    if (modal) return;
    const fmt = Folio.keys ? Folio.keys.fmt : (s) => s;
    const kbd = (combo) => h('kbd', { class: 'f-kbd' }, combo === '?' ? '?' : fmt(combo));
    const close = h('button', { type: 'button', class: 'f-btn f-btn--ghost f-btn--icon', 'aria-label': 'Close' }, Folio.icons.el('x', 14));
    close.addEventListener('click', hideHelp);
    modal = h(
      'div',
      { class: 'f-modal-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard shortcuts' },
      h(
        'div',
        { class: 'f-modal' },
        h('div', { class: 'f-modal__head' }, h('h2', {}, 'Keyboard shortcuts'), close),
        h(
          'div',
          { class: 'f-modal__body sc-grid' },
          list.map((g) =>
            h(
              'section',
              { class: 'sc-group' },
              h('h3', {}, g.group),
              g.items.map(([combo, label]) => h('div', { class: 'sc-row' }, h('span', {}, label), kbd(combo)))
            )
          )
        ),
        h('div', { class: 'f-modal__foot f-hint' }, 'Tip: double-click a layer to go inside it; double-click text to edit it.')
      )
    );
    modal.addEventListener('pointerdown', (e) => {
      if (e.target === modal) hideHelp();
    });
    document.body.appendChild(modal);
  }
  function hideHelp() {
    if (!modal) return;
    modal.remove();
    modal = null;
  }

  // ---------- the handler ----------
  function textSelectedInPage() {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || !String(sel).length) return false;
    const panel = document.getElementById('code-panel');
    return !!(panel && sel.anchorNode && panel.contains(sel.anchorNode));
  }

  function onKeyDown(e) {
    if (modal) {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        hideHelp();
      }
      return;
    }
    if (e.defaultPrevented) return;
    if (Folio.ui.isTyping() || store.editingTextId) return;
    const a = document.activeElement;
    if (a && (a.tagName === 'BUTTON' || a.tagName === 'A') && (e.key === 'Enter' || e.key === ' ')) return;

    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    const code = e.code;
    const run = (fn) => {
      e.preventDefault();
      fn();
    };

    // ----- with ⌘ / Ctrl -----
    if (mod) {
      if (e.altKey && code === 'KeyK') return run(actions.createComponent);
      if (e.altKey && code === 'KeyB') return run(actions.detachInstance);
      if (code === 'KeyZ' || lower === 'z') return run(e.shiftKey ? actions.redo : actions.undo);
      if (code === 'KeyY' || lower === 'y') return run(actions.redo);
      if (code === 'KeyD' || lower === 'd') return run(actions.duplicate);
      if (code === 'KeyC' || lower === 'c') {
        if (textSelectedInPage()) return; // let the browser copy selected text (e.g. in the code panel)
        return run(actions.copy);
      }
      if (code === 'KeyX' || lower === 'x') return run(actions.cut);
      if (code === 'KeyV' || lower === 'v') return armPaste(e.shiftKey);
      if (code === 'KeyG' || lower === 'g') return run(e.shiftKey ? actions.ungroup : actions.group);
      if (code === 'KeyA' || lower === 'a') return run(actions.selectAll);
      if (code === 'KeyS' || lower === 's') return run(actions.save);
      if (code === 'KeyO' || lower === 'o') return run(actions.open);
      if (code === 'KeyE' || lower === 'e') return run(actions.toggleCode);
      if (e.shiftKey && (code === 'KeyH' || lower === 'h')) return run(actions.toggleVisible);
      if (e.shiftKey && (code === 'KeyL' || lower === 'l')) return run(actions.toggleLock);
      if (code === 'BracketRight' || key === ']') return run(e.altKey || e.shiftKey ? actions.bringToFront : actions.bringForward);
      if (code === 'BracketLeft' || key === '[') return run(e.altKey || e.shiftKey ? actions.sendToBack : actions.sendBackward);
      if (code === 'Digit0' || code === 'Numpad0' || key === '0') return run(actions.zoom100);
      if (key === '=' || key === '+' || code === 'Equal' || code === 'NumpadAdd') return run(actions.zoomIn);
      if (key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract') return run(actions.zoomOut);
      if (key === '/' || code === 'Slash') return run(showHelp);
      return;
    }
    if (e.altKey && !e.shiftKey && (key === 'ArrowUp' || key === 'PageUp')) return run(actions.prevPage);
    if (e.altKey && !e.shiftKey && (key === 'ArrowDown' || key === 'PageDown')) return run(actions.nextPage);
    if (e.altKey) return;

    // ----- shift + digit (zoom) -----
    if (e.shiftKey && code === 'Digit1') return run(actions.zoomFit);
    if (e.shiftKey && code === 'Digit2') return run(actions.zoomToSelection);
    if (e.shiftKey && code === 'Digit0') return run(actions.zoom100);
    if (key === '?') return run(showHelp);

    // ----- arrows -----
    const step = e.shiftKey ? 10 : 1;
    if (key === 'ArrowLeft') return run(() => actions.nudge(-step, 0));
    if (key === 'ArrowRight') return run(() => actions.nudge(step, 0));
    if (key === 'ArrowUp') return run(() => actions.nudge(0, -step));
    if (key === 'ArrowDown') return run(() => actions.nudge(0, step));

    if (key === 'Delete' || key === 'Backspace') return run(actions.remove);
    if (key === 'Escape') {
      if (store.tool !== 'select') return run(() => store.setTool('select'));
      return run(actions.selectParent);
    }
    if (key === 'Enter') return run(e.shiftKey ? actions.selectParent : actions.selectChild);

    if (e.shiftKey && lower === 'a') return run(actions.wrapAutoLayout);
    if (e.shiftKey) return;

    const tools = { v: 'select', h: 'hand', f: 'frame', r: 'rect', o: 'ellipse', t: 'text', i: 'image' };
    if (tools[lower] && !e.repeat) return run(() => store.setTool(tools[lower]));
  }

  function init() {
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('paste', onPaste);
  }

  Folio.shortcuts = { init, showHelp, hideHelp, list, onKeyDown };
})();
