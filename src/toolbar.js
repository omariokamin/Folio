/*
 * toolbar.js — the bar across the top of the app.
 *
 *   left:   logo · File menu · document name · autosave status
 *   center: drawing tools (select, frame, rect, ellipse, text, image, hand)
 *   right:  undo/redo · zoom menu · Code toggle · Export menu
 *
 * Also provides two small helpers other panels use:
 *   Folio.menu.open(anchorElOrPoint, items, opts)  -> a dropdown / context menu
 *   Folio.keys.fmt('mod+shift+z')                  -> "⇧⌘Z" on Mac, "Ctrl+Shift+Z" elsewhere
 */
window.Folio = window.Folio || {};

(function () {
  const { h } = Folio.ui;
  const icon = (name, size) => Folio.icons.el(name, size);

  // ---------- keyboard labels ----------
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const KEY_NAMES = {
    mac: { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃', del: '⌫', enter: '↵', esc: 'Esc', up: '↑', down: '↓', left: '←', right: '→' },
    pc: { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl', del: 'Del', enter: 'Enter', esc: 'Esc', up: '↑', down: '↓', left: '←', right: '→' },
  };
  /** 'mod+shift+z' -> '⇧⌘Z' (Mac) / 'Ctrl+Shift+Z' (Windows/Linux). */
  function fmt(combo) {
    const names = isMac ? KEY_NAMES.mac : KEY_NAMES.pc;
    const parts = String(combo).split('+').map((p) => p.trim().toLowerCase());
    const order = ['ctrl', 'alt', 'shift', 'mod'];
    const mods = order.filter((m) => parts.includes(m));
    const key = parts.filter((p) => !order.includes(p)).join('+');
    const keyLabel = names[key] || (key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1));
    if (isMac) return mods.map((m) => names[m]).join('') + keyLabel;
    return [...mods.map((m) => names[m]), keyLabel].join('+');
  }
  Folio.keys = { isMac, fmt };

  // ---------- dropdown menus (shared .f-menu) ----------
  const menu = (() => {
    let current = null; // { el, anchor, onClose }

    function close() {
      if (!current) return;
      const c = current;
      current = null;
      c.el.remove();
      if (c.anchor instanceof Element) c.anchor.classList.remove('is-open');
      if (c.onClose) c.onClose();
    }

    /**
     * items: [{ label, icon, shortcut, action, disabled, checked } | { sep:true } | { header:'Text' }]
     * anchor: an element (menu opens below it) or a point {x, y} (context menu).
     * opts.align: 'left' | 'right' | 'center'
     */
    function open(anchor, items, opts = {}) {
      const same = current && anchor instanceof Element && current.anchor === anchor;
      close();
      if (same && opts.toggle !== false) return; // clicking the same button again closes it

      const el = h('div', { class: 'f-menu' + (opts.className ? ' ' + opts.className : ''), role: 'menu' });
      items.filter(Boolean).forEach((it) => {
        if (it.sep) return el.appendChild(h('div', { class: 'f-menu__sep' }));
        if (it.header) return el.appendChild(h('div', { class: 'f-menu__head' }, it.header));
        const btn = h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            class: 'f-menu__item' + (it.checked ? ' is-checked' : ''),
            disabled: !!it.disabled,
            dataset: it.id ? { menuId: it.id } : undefined,
          },
          h('span', { class: 'f-menu__ico' }, it.icon ? icon(it.icon, 14) : null),
          h('span', { class: 'f-menu__label' }, it.label),
          it.shortcut ? h('span', { class: 'f-menu__kbd' }, it.shortcut) : null
        );
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          close();
          if (it.action) it.action();
        });
        el.appendChild(btn);
      });
      document.body.appendChild(el);

      // position (clamped to the window)
      const mw = el.offsetWidth;
      const mh = el.offsetHeight;
      let x, y;
      if (anchor instanceof Element) {
        const r = anchor.getBoundingClientRect();
        x = opts.align === 'right' ? r.right - mw : opts.align === 'center' ? r.left + r.width / 2 - mw / 2 : r.left;
        y = r.bottom + 4;
        anchor.classList.add('is-open');
      } else {
        x = anchor.x;
        y = anchor.y;
      }
      x = Math.max(4, Math.min(window.innerWidth - mw - 4, x));
      if (y + mh > window.innerHeight - 4) y = Math.max(4, window.innerHeight - mh - 4);
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      current = { el, anchor, onClose: opts.onClose };
      return el;
    }

    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!current) return;
        if (current.el.contains(e.target)) return;
        if (current.anchor instanceof Element && current.anchor.contains(e.target)) return;
        close();
      },
      true
    );
    window.addEventListener(
      'keydown',
      (e) => {
        if (!current) return;
        const items = [...current.el.querySelectorAll('.f-menu__item:not([disabled])')];
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          const i = items.indexOf(document.activeElement);
          const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
          if (items[next]) items[next].focus();
        } else if (e.key === 'Enter' && current.el.contains(document.activeElement)) {
          e.stopPropagation(); // let the focused button handle it
        } else {
          // any other key: close the menu and let the shortcut run
          close();
        }
      },
      true
    );
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);

    return { open, close, isOpen: () => !!current };
  })();
  Folio.menu = menu;

  // ---------- toolbar ----------
  const TOOLS = [
    { id: 'select', label: 'Move', key: 'V', icon: 'select' },
    { id: 'frame', label: 'Frame', key: 'F', icon: 'frame' },
    { id: 'rect', label: 'Rectangle', key: 'R', icon: 'rect' },
    { id: 'ellipse', label: 'Ellipse', key: 'O', icon: 'ellipse' },
    { id: 'text', label: 'Text', key: 'T', icon: 'text' },
    { id: 'image', label: 'Image', key: 'I', icon: 'image' },
    { id: 'hand', label: 'Hand', key: 'H', icon: 'hand' },
  ];

  let el = {};
  const store = () => Folio.store;
  const exporter = () => Folio.exporter;
  const canvas = () => Folio.canvas;

  /** Prevent toolbar buttons from stealing keyboard focus (so shortcuts keep working). */
  const noFocus = (e) => e.preventDefault();

  function btn(attrs, ...children) {
    const b = h('button', { type: 'button', ...attrs }, ...children);
    b.addEventListener('mousedown', noFocus);
    return b;
  }

  function logo() {
    const span = document.createElement('span');
    span.className = 'tb-logo';
    span.innerHTML =
      '<svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true"><defs><linearGradient id="tbLogoG" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#8b7fff"/><stop offset="1" stop-color="#5a46f5"/></linearGradient></defs>' +
      '<rect width="32" height="32" rx="8" fill="url(#tbLogoG)"/><path d="M10 9h12v4H14v3h7v4h-7v5h-4z" fill="#fff"/></svg>';
    return span;
  }

  function confirmReplace(what) {
    const s = store();
    if (!s.doc.roots.length) return true;
    return window.confirm(`${what}? This replaces the current document (it is not undoable). Save it to a file first if you want to keep it.`);
  }

  // ----- actions shared by File and Export menus -----
  const act = {
    newDoc() {
      if (!confirmReplace('Start a new document')) return;
      store().newDoc();
      Folio.ui.toast('New document');
    },
    loadDemo() {
      if (!confirmReplace('Load the demo document')) return;
      if (Folio.demo) Folio.demo.build();
      requestAnimationFrame(() => canvas() && canvas().zoomToFit && canvas().zoomToFit());
    },
    open: () => exporter() && exporter().openFile(),
    save: () => exporter() && exporter().saveFile(),
    png: (scale) => exporter() && exporter().exportPng(null, scale),
    page: () => exporter() && exporter().downloadPage(),
    copy: () => exporter() && exporter().copyCode(),
    code: () => store().emit('code:toggle'),
    help: () => Folio.shortcuts && Folio.shortcuts.showHelp && Folio.shortcuts.showHelp(),
  };

  function exportTargetLabel() {
    const ex = exporter();
    const id = ex && ex.targetId ? ex.targetId({ quiet: true }) : null;
    const n = id && store().get(id);
    return n ? 'Export “' + n.name + '”' : 'Nothing to export';
  }

  function fileMenu(anchor) {
    const k = fmt;
    menu.open(anchor, [
      { label: 'New document', icon: 'file', action: act.newDoc },
      { label: 'Open file…', icon: 'folder', shortcut: k('mod+o'), action: act.open },
      { label: 'Save to file', icon: 'download', shortcut: k('mod+s'), action: act.save },
      { sep: true },
      { label: 'Load demo', icon: 'sparkle', action: act.loadDemo },
      { sep: true },
      { header: exportTargetLabel() },
      { label: 'Export PNG (1x)', icon: 'image', action: () => act.png(1) },
      { label: 'Export PNG (2x)', icon: 'image', action: () => act.png(2) },
      { label: 'Export HTML page', icon: 'code', action: act.page },
      { label: 'Copy code (HTML + CSS)', icon: 'copy', action: act.copy },
      { sep: true },
      { label: 'Keyboard shortcuts', icon: 'grid', shortcut: '?', action: act.help },
    ]);
  }

  function exportMenu(anchor) {
    menu.open(
      anchor,
      [
        { header: exportTargetLabel() },
        { label: 'PNG (1x)', icon: 'image', action: () => act.png(1) },
        { label: 'PNG (2x)', icon: 'image', action: () => act.png(2) },
        { label: 'PNG (3x)', icon: 'image', action: () => act.png(3) },
        { sep: true },
        { label: 'HTML page (.html)', icon: 'download', action: act.page },
        { label: 'Copy HTML + CSS', icon: 'copy', action: act.copy },
        { label: 'View code', icon: 'code', shortcut: fmt('mod+e'), action: act.code },
      ],
      { align: 'right' }
    );
  }

  function setZoom(z) {
    const c = canvas();
    if (c && c.setZoom) c.setZoom(z);
    else store().setViewport({ zoom: z });
  }

  function zoomMenu(anchor) {
    const c = canvas();
    const has = (fn) => !!(c && c[fn]);
    const z = store().viewport.zoom;
    menu.open(
      anchor,
      [
        { label: 'Zoom in', shortcut: fmt('mod++'), disabled: !has('zoomIn'), action: () => c.zoomIn() },
        { label: 'Zoom out', shortcut: fmt('mod+-'), disabled: !has('zoomOut'), action: () => c.zoomOut() },
        { label: 'Zoom to fit', shortcut: fmt('shift+1'), disabled: !has('zoomToFit'), action: () => c.zoomToFit() },
        {
          label: 'Zoom to selection',
          shortcut: fmt('shift+2'),
          disabled: !has('zoomToSelection') || !store().selection.length,
          action: () => c.zoomToSelection(),
        },
        { sep: true },
        { label: '50%', checked: Math.abs(z - 0.5) < 0.001, action: () => setZoom(0.5) },
        { label: '100%', shortcut: fmt('mod+0'), checked: Math.abs(z - 1) < 0.001, action: () => setZoom(1) },
        { label: '200%', checked: Math.abs(z - 2) < 0.001, action: () => setZoom(2) },
      ],
      { align: 'right' }
    );
  }

  function build(root) {
    root.innerHTML = '';
    root.classList.add('tb');

    // ----- left -----
    el.fileBtn = btn(
      { class: 'tb-file', 'aria-label': 'File menu', 'data-tip': 'Menu', onclick: (e) => fileMenu(e.currentTarget) },
      logo(),
      icon('chevron-down', 12)
    );
    el.name = h('input', {
      class: 'tb-docname',
      value: store().doc.name,
      spellcheck: false,
      'aria-label': 'Document name',
    });
    el.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.name.blur();
      if (e.key === 'Escape') {
        el.name.value = store().doc.name;
        el.name.blur();
      }
    });
    el.name.addEventListener('input', sizeName);
    el.name.addEventListener('change', () => {
      const v = el.name.value.trim() || 'Untitled';
      if (v !== store().doc.name) store().rename(v);
      el.name.value = store().doc.name;
      sizeName();
    });
    el.saved = h('span', { class: 'tb-saved', title: 'Autosaved in this browser' }, h('i'), h('span', {}, 'Saved'));
    const left = h('div', { class: 'tb__left' }, el.fileBtn, h('span', { class: 'tb-sep' }), el.name, el.saved);

    // ----- center -----
    el.tools = {};
    const center = h(
      'div',
      { class: 'tb__center', role: 'toolbar', 'aria-label': 'Tools' },
      TOOLS.flatMap((t, i) => {
        const b = btn(
          {
            class: 'tb-tool',
            'aria-label': t.label,
            'data-tip': `${t.label}  ${t.key}`,
            dataset: { tool: t.id },
            onclick: () => store().setTool(t.id),
          },
          icon(t.icon, 18)
        );
        el.tools[t.id] = b;
        return i === TOOLS.length - 1 ? [h('span', { class: 'tb-sep' }), b] : b;
      })
    );

    // ----- right -----
    el.undo = btn({ class: 'tb-icon', 'aria-label': 'Undo', 'data-tip': `Undo  ${fmt('mod+z')}`, onclick: () => store().undo() }, icon('undo'));
    el.redo = btn({ class: 'tb-icon', 'aria-label': 'Redo', 'data-tip': `Redo  ${fmt('mod+shift+z')}`, onclick: () => store().redo() }, icon('redo'));
    el.zoom = btn(
      { class: 'tb-zoom', 'aria-label': 'Zoom', 'data-tip': 'Zoom', onclick: (e) => zoomMenu(e.currentTarget) },
      h('span', { class: 'tb-zoom__val' }, '100%'),
      icon('chevron-down', 12)
    );
    el.code = btn(
      { class: 'tb-code', 'aria-pressed': 'false', 'data-tip': `Code panel  ${fmt('mod+e')}`, onclick: act.code },
      icon('code'),
      h('span', {}, 'Code')
    );
    el.exportBtn = btn(
      { class: 'f-btn f-btn--primary tb-export', 'data-tip': 'Export PNG / HTML', onclick: (e) => exportMenu(e.currentTarget) },
      h('span', {}, 'Export'),
      icon('chevron-down', 12)
    );
    const right = h(
      'div',
      { class: 'tb__right' },
      el.undo,
      el.redo,
      h('span', { class: 'tb-sep' }),
      el.zoom,
      el.code,
      el.exportBtn
    );

    root.append(left, center, right);
  }

  function sizeName() {
    el.name.style.width = Math.min(260, Math.max(60, measure(el.name.value || " ") + 26)) + 'px';
  }
  let measureCtx = null;
  function measure(text) {
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    measureCtx.font = '500 13px Inter, system-ui, sans-serif';
    return measureCtx.measureText(text).width;
  }

  // ----- sync with the store -----
  function syncTool() {
    const t = store().tool;
    Object.entries(el.tools).forEach(([id, b]) => {
      b.classList.toggle('is-active', id === t);
      b.setAttribute('aria-pressed', id === t ? 'true' : 'false');
    });
  }
  function syncHistory() {
    el.undo.disabled = !store().canUndo();
    el.redo.disabled = !store().canRedo();
  }
  function syncZoom() {
    el.zoom.querySelector('.tb-zoom__val').textContent = Math.round(store().viewport.zoom * 100) + '%';
  }
  function syncName() {
    if (document.activeElement !== el.name) el.name.value = store().doc.name;
    sizeName();
  }
  function setSaved(state) {
    el.saved.dataset.state = state;
    el.saved.lastChild.textContent = state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved' : 'Not saved';
    el.saved.title =
      state === 'saved'
        ? 'Autosaved in this browser'
        : state === 'error'
          ? 'Autosave failed — use File → Save to file'
          : 'Changes will autosave in a moment';
  }

  function init() {
    const root = document.getElementById('toolbar');
    if (!root) return;
    build(root);
    const s = store();
    s.on('tool', syncTool);
    s.on('history', syncHistory);
    s.on('change', () => {
      syncHistory();
      setSaved('dirty');
    });
    s.on('viewport', syncZoom);
    s.on('doc', syncName);
    s.on('saved', (ok) => setSaved(ok ? 'saved' : 'error'));
    s.on('code:visible', (on) => {
      el.code.classList.toggle('is-active', !!on);
      el.code.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    refresh();
    setSaved('saved');
  }

  function refresh() {
    if (!el.name) return;
    syncTool();
    syncHistory();
    syncZoom();
    syncName();
  }

  Folio.toolbar = { init, refresh, actions: act, tools: TOOLS };
})();
