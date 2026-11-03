/*
 * inspector.js — the right-hand properties panel.
 *
 * Shows document settings when nothing is selected, and every editable
 * property of the selection otherwise (position, size, auto layout, fills,
 * text, border, shadows, effects) plus a live read-only CSS view.
 *
 * Edits apply to ALL selected nodes; the panel shows the values of the
 * primary (last selected) node. Live feedback goes through store.updateMany
 * on every input event; store.commit() is called once an edit finishes.
 *
 * Rendering strategy: the panel is rebuilt only when its *structure* changes
 * (selection, visible sections, list lengths, expanded editors). Any other
 * 'change' just updates field values in place, skipping the focused field,
 * so typing is never interrupted.
 *
 *   Folio.inspector.init()     mount into #inspector and subscribe to the store
 *   Folio.inspector.refresh()  force a full rebuild
 */
window.Folio = window.Folio || {};

(function () {
  const store = Folio.store;
  const h = (...a) => Folio.ui.h(...a);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  let root = null; // #inspector
  let bindings = []; // { el, update() }
  let lastKey = null;
  let rafId = 0;

  // UI state that lives only in memory (not in the document).
  const ui = {
    open: { effects: false }, // section id -> bool (default open)
    expandedFill: null, // "nodeId:index"
    selectedStop: 0,
    padSides: false, // edit 4 paddings independently
    customFont: false,
    meshPresets: false,
    selKey: '',
  };

  // ------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------
  const P = () => store.primary();
  const selIds = () => store.selection.filter((id) => store.get(id));

  function fmt(v, prec = 0) {
    if (v == null || v === '' || !isFinite(v)) return '';
    const m = Math.pow(10, prec);
    return String(Math.round(Number(v) * m) / m);
  }

  /** Evaluate simple math typed into a number field: "100/2", "24 + 8", "50%". */
  function evalNum(str) {
    let s = String(str == null ? '' : str).trim().replace(/[a-z°%]+$/i, '').trim();
    if (!s) return null;
    if (/^-?\d*\.?\d+$/.test(s)) return parseFloat(s);
    if (!/^[-+*/().\d\s]+$/.test(s)) return null;
    try {
      // eslint-disable-next-line no-new-func
      const v = Function('"use strict"; return (' + s + ');')();
      return typeof v === 'number' && isFinite(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  function commit(label) {
    store.commit(label || 'Edit');
  }

  /** Apply a patch (object or fn(node) => patch) to all selected nodes matching `filter`. */
  function patchSel(patch, filter) {
    const ids = selIds().filter((id) => !filter || filter(store.get(id)));
    if (ids.length) store.updateMany(ids, patch);
  }

  /** Mutate a style list (fills / shadows) of every selected node. mut(arr, node) may return false to skip. */
  function listOp(key, mut) {
    store.updateMany(selIds(), (n) => {
      const arr = clone((n.style && n.style[key]) || []);
      if (mut(arr, n) === false) return {};
      return { style: { [key]: arr } };
    });
  }

  /** Rendered size/offset of a node (falls back to the stored values). */
  function measure(n) {
    const el = n && Folio.render && Folio.render.el ? Folio.render.el(n.id) : null;
    if (el && el.isConnected && (el.offsetWidth || el.offsetHeight)) {
      return { w: el.offsetWidth, h: el.offsetHeight, x: el.offsetLeft, y: el.offsetTop, cw: el.clientWidth, ch: el.clientHeight };
    }
    const bw = (n.style && n.style.border && n.style.border.width) || 0;
    return { w: n.width, h: n.height, x: n.x, y: n.y, cw: n.width - 2 * bw, ch: n.height - 2 * bw };
  }

  const isFreeformChild = (n) => {
    const p = store.getParent(n.id);
    return !!p && (!p.layout || p.layout.mode !== 'flex');
  };
  const hasXY = (n) => !n.parent || isFreeformChild(n);

  // ---------- colors ----------
  const cctx = (() => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      return c.getContext('2d', { willReadFrequently: true });
    } catch (e) {
      return null;
    }
  })();
  const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  const colorCache = new Map();

  /** Normalize any CSS colour string to #rrggbb / #rrggbbaa. Returns null if invalid. */
  function parseColor(str) {
    if (str == null) return null;
    let s = String(str).trim();
    if (!s) return null;
    if (/^[0-9a-f]+$/i.test(s) && [3, 4, 6, 8].includes(s.length)) s = '#' + s;
    if (colorCache.has(s)) return colorCache.get(s);
    let out = null;
    if (/^#[0-9a-f]{6}$/i.test(s)) out = s.toLowerCase();
    else if (/^#[0-9a-f]{8}$/i.test(s)) out = s.slice(7).toLowerCase() === 'ff' ? s.slice(0, 7).toLowerCase() : s.toLowerCase();
    else if (cctx) {
      cctx.fillStyle = '#000000';
      cctx.fillStyle = s;
      const a = cctx.fillStyle;
      cctx.fillStyle = '#ffffff';
      cctx.fillStyle = s;
      const b = cctx.fillStyle;
      if (a === b) {
        if (/^#[0-9a-f]{6}$/i.test(a)) out = a.toLowerCase();
        else {
          const m = a.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/);
          if (m) {
            const al = m[4] == null ? 1 : parseFloat(m[4]);
            out = '#' + hex2(+m[1]) + hex2(+m[2]) + hex2(+m[3]) + (al < 1 ? hex2(al * 255) : '');
          } else {
            // e.g. oklch()/color(): rasterise one pixel and read it back
            cctx.clearRect(0, 0, 1, 1);
            cctx.fillStyle = s;
            cctx.fillRect(0, 0, 1, 1);
            const d = cctx.getImageData(0, 0, 1, 1).data;
            out = '#' + hex2(d[0]) + hex2(d[1]) + hex2(d[2]) + (d[3] < 255 ? hex2(d[3]) : '');
          }
        }
      }
    }
    if (colorCache.size > 500) colorCache.clear();
    colorCache.set(s, out);
    return out;
  }
  function splitColor(c) {
    const n = parseColor(c) || '#000000';
    return { hex: n.slice(0, 7), alpha: n.length === 9 ? parseInt(n.slice(7), 16) / 255 : 1 };
  }
  function joinColor(hex, alpha) {
    const a = Math.max(0, Math.min(1, alpha));
    return a >= 0.999 ? hex : hex + hex2(a * 255);
  }

  // ---------- extra icons (beyond Folio.icons) ----------
  const EXTRA = {
    justify: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
    'al-left': '<path d="M4 3v18"/><rect x="8" y="6" width="12" height="4" rx="1"/><rect x="8" y="14" width="7" height="4" rx="1"/>',
    'al-hcenter': '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
    'al-right': '<path d="M20 3v18"/><rect x="4" y="6" width="12" height="4" rx="1"/><rect x="9" y="14" width="7" height="4" rx="1"/>',
    'al-top': '<path d="M3 4h18"/><rect x="6" y="8" width="4" height="12" rx="1"/><rect x="14" y="8" width="4" height="7" rx="1"/>',
    'al-vcenter': '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>',
    'al-bottom': '<path d="M3 20h18"/><rect x="6" y="4" width="4" height="12" rx="1"/><rect x="14" y="9" width="4" height="7" rx="1"/>',
    corners: '<path d="M4 9V7a3 3 0 013-3h2M15 4h2a3 3 0 013 3v2M20 15v2a3 3 0 01-3 3h-2M9 20H7a3 3 0 01-3-3v-2"/>',
    sides: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="2 3"/><path d="M9 4h6M9 20h6M4 9v6M20 9v6"/>',
    italic: '<path d="M10 4h8M6 20h8M14 4l-4 16"/>',
    rotate: '<path d="M20 11a8 8 0 10-2.3 6.2M20 4v7h-7"/>',
    radius: '<path d="M5 20v-8a7 7 0 017-7h8"/>',
    'chevron-up': '<path d="M6 15l6-6 6 6"/>',
    shuffle: '<path d="M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3"/>',
    between: '<path d="M4 4v16M20 4v16"/><rect x="7" y="8" width="3" height="8" rx="1"/><rect x="14" y="8" width="3" height="8" rx="1"/>',
    stretch: '<path d="M4 4h16M4 20h16"/><rect x="7" y="7" width="3" height="10" rx="1"/><rect x="14" y="7" width="3" height="10" rx="1"/>',
    opacity: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M12 4a8 8 0 010 16" fill="currentColor" stroke="none" opacity=".5"/>',
    blend: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
    clip: '<path d="M7 3v14h14M3 7h14v14"/>',
    swap: '<path d="M7 20V4M4 7l3-3 3 3M17 4v16M14 17l3 3 3-3"/>',
    'gap-h': '<rect x="3" y="5" width="6" height="14" rx="1"/><rect x="15" y="5" width="6" height="14" rx="1"/><path d="M12 9v6"/>',
    'gap-v': '<rect x="5" y="3" width="14" height="6" rx="1"/><rect x="5" y="15" width="14" height="6" rx="1"/><path d="M9 12h6"/>',
  };
  function icon(name) {
    if (EXTRA[name]) {
      const t = document.createElement('template');
      t.innerHTML = `<svg class="f-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">${EXTRA[name]}</svg>`;
      return t.content.firstChild;
    }
    return Folio.icons ? Folio.icons.el(name) : h('span', {}, '•');
  }

  // ------------------------------------------------------------------
  // Field components. Each registers a binding so values can be updated
  // in place without rebuilding the DOM.
  // ------------------------------------------------------------------
  let restoringFocus = false;
  /** Select all text when a field gains focus by click/tab (like design tools do). */
  function selectOnFocus(input) {
    let fresh = false;
    input.addEventListener('focus', () => {
      if (restoringFocus) return;
      fresh = true;
      input.select();
    });
    input.addEventListener('mouseup', (e) => {
      if (fresh) e.preventDefault();
      fresh = false;
    });
  }

  function bind(el, update) {
    bindings.push({ el, update });
    update();
  }

  function iconBtn(name, title, onclick, extra = {}) {
    const b = h(
      'button',
      Object.assign({ type: 'button', class: 'f-btn f-btn--ghost f-btn--icon ins-ibtn', title, 'aria-label': title }, extra),
      icon(name)
    );
    b.addEventListener('click', (e) => {
      onclick(e);
      b.blur();
    });
    return b;
  }

  /**
   * Number field with optional scrub label.
   * o: { key, label, title, get() -> number, set(v), min, max, step, precision, suffix, commitLabel, cls }
   */
  function numField(o) {
    const step = o.step || 1;
    const prec = o.precision != null ? o.precision : step < 1 ? 2 : 0;
    const input = h('input', {
      class: 'f-input',
      type: 'text',
      inputmode: 'decimal',
      spellcheck: 'false',
      autocomplete: 'off',
      'data-k': o.key,
      title: o.title || '',
      placeholder: o.placeholder || '',
    });
    let lab = null;
    if (o.label != null) {
      lab = h('span', { class: 'ins-scrub', title: o.title || '' }, typeof o.label === 'string' ? o.label : o.label());
    }
    const wrap = h(
      'div',
      {
        class:
          'f-num ins-num' +
          (lab ? '' : ' ins-num--nolabel') +
          (o.suffix ? ' ins-num--suffix' : '') +
          (o.cls ? ' ' + o.cls : ''),
      },
      lab,
      input,
      o.suffix ? h('em', { class: 'ins-suffix' }, o.suffix) : null
    );
    const clamp = (v) => {
      if (o.min != null) v = Math.max(o.min, v);
      if (o.max != null) v = Math.min(o.max, v);
      const m = Math.pow(10, prec);
      return Math.round(v * m) / m;
    };
    // the text we last wrote into the field; a 'change' with this exact text is not a user edit
    let shown = null;
    const put = (txt) => {
      input.value = shown = txt;
    };
    const show = () => {
      const v = o.get();
      put(typeof v === 'number' ? fmt(v, prec) : v == null ? '' : String(v));
    };
    const finish = () => commit(o.commitLabel || o.title || 'Edit value');

    input.addEventListener('input', () => {
      const v = evalNum(input.value);
      if (v != null) o.set(clamp(v));
    });
    input.addEventListener('change', () => {
      if (input.value === shown) return show();
      const v = evalNum(input.value);
      if (v != null) {
        o.set(clamp(v));
        finish();
      }
      show();
    });
    let focusVal = null;
    input.addEventListener('focus', () => {
      focusVal = o.get();
    });
    input.addEventListener('blur', () => show());
    selectOnFocus(input);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = evalNum(input.value);
        if (v != null) {
          o.set(clamp(v));
          finish();
        }
        show();
        focusVal = o.get();
        input.select();
      } else if (e.key === 'Escape') {
        // revert any live (uncommitted) edit made since focus
        if (focusVal != null && o.get() !== focusVal) o.set(focusVal);
        show();
        input.blur();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = evalNum(input.value);
        const base = cur != null ? cur : Number(o.get()) || 0;
        const v = clamp(base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
        o.set(v);
        put(fmt(v, prec));
        finish();
        focusVal = o.get();
        input.select();
      }
    });

    const attachScrub = (lab) => {
      lab.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const cur = evalNum(input.value);
        const start = cur != null ? cur : Number(o.get()) || 0;
        let lastX = e.clientX;
        let acc = 0;
        let moved = false;
        try {
          lab.setPointerCapture(e.pointerId);
        } catch (err) {}
        const move = (ev) => {
          const dx = ev.clientX - lastX;
          lastX = ev.clientX;
          acc += dx * (ev.shiftKey ? 10 : 1);
          if (!moved && Math.abs(acc) < 2) return;
          if (!moved) {
            moved = true;
            document.body.classList.add('ins-scrubbing');
            if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
          }
          const v = clamp(start + Math.round(acc) * step);
          o.set(v);
          put(fmt(v, prec));
        };
        const up = () => {
          lab.removeEventListener('pointermove', move);
          lab.removeEventListener('pointerup', up);
          lab.removeEventListener('pointercancel', up);
          document.body.classList.remove('ins-scrubbing');
          if (moved) finish();
          else {
            input.focus();
            input.select();
          }
        };
        lab.addEventListener('pointermove', move);
        lab.addEventListener('pointerup', up);
        lab.addEventListener('pointercancel', up);
      });
    };
    if (lab) attachScrub(lab);
    wrap._scrub = attachScrub;
    bind(input, show);
    return wrap;
  }

  /** Labeled property row: "Brightness  [ 100 % ]". The label scrubs too. */
  function propRow(label, field) {
    const row = h('div', { class: 'f-row ins-prop' }, h('span', { class: 'f-label ins-prop__label' }, label), field);
    // the row label scrubs the number field too
    if (field._scrub) {
      row.firstChild.classList.add('is-scrub');
      field._scrub(row.firstChild);
    }
    return row;
  }

  /**
   * Color field: swatch (opens native picker) + hex text + alpha %.
   * o: { key, get() -> css color, set(color), commitLabel, noAlpha, compact }
   */
  function colorField(o) {
    const chip = h('i');
    const native = h('input', { type: 'color', class: 'ins-native', tabindex: '-1', title: 'Pick colour' });
    const sw = h('div', { class: 'f-swatch ins-swatch' }, chip, native);
    const hex = h('input', {
      class: 'f-input ins-hex',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      'data-k': o.key + '.hex',
      title: 'Any CSS colour: hex, rgb(), hsl(), names…',
    });
    const label = o.commitLabel || 'Edit colour';
    const cur = () => splitColor(o.get());

    native.addEventListener('input', () => {
      o.set(joinColor(native.value.toLowerCase(), cur().alpha));
    });
    native.addEventListener('change', () => commit(label));

    const applyHex = () => {
      let s = hex.value.trim();
      const c = parseColor(s);
      if (!c) return false;
      // keep current alpha unless the typed colour carries its own
      const typedAlpha = /^#?[0-9a-f]{8}$/i.test(s) || /^#?[0-9a-f]{4}$/i.test(s) || /rgba|hsla|\/|transparent/i.test(s);
      const { hex: h6, alpha } = splitColor(c);
      o.set(joinColor(h6, typedAlpha ? alpha : cur().alpha));
      return true;
    };
    hex.addEventListener('input', () => applyHex());
    hex.addEventListener('change', () => {
      if (hex.value !== hexShown && applyHex()) commit(label);
      showHex();
    });
    hex.addEventListener('blur', () => showHex());
    selectOnFocus(hex);
    hex.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (applyHex()) commit(label);
        showHex();
        hex.select();
      } else if (e.key === 'Escape') {
        showHex();
        hex.blur();
      }
    });
    let hexShown = null;
    const showHex = () => {
      hex.value = hexShown = cur().hex.slice(1).toUpperCase();
    };
    const showSwatch = () => {
      const c = o.get();
      chip.style.background = c || 'transparent';
      native.value = cur().hex;
    };
    bind(hex, showHex);
    bind(sw, showSwatch);

    const parts = [sw, hex];
    if (!o.noAlpha) {
      parts.push(
        numField({
          key: o.key + '.a',
          get: () => Math.round(cur().alpha * 100),
          set: (v) => o.set(joinColor(cur().hex, v / 100)),
          min: 0,
          max: 100,
          suffix: '%',
          title: 'Opacity',
          commitLabel: label,
          cls: 'ins-alpha',
        })
      );
    }
    return h('div', { class: 'ins-color' + (o.compact ? ' ins-color--compact' : '') }, ...parts);
  }

  /** options: [[value, label]] or [{ group, options: [[v, l]] }] */
  function selectField(o) {
    const sel = h('select', { class: 'f-select' + (o.cls ? ' ' + o.cls : ''), 'data-k': o.key, title: o.title || '' });
    const addOpts = (parent, opts) =>
      opts.forEach(([v, l]) => parent.appendChild(h('option', { value: String(v) }, l)));
    const opts = typeof o.options === 'function' ? o.options() : o.options;
    opts.forEach((it) => {
      if (Array.isArray(it)) addOpts(sel, [it]);
      else {
        const g = h('optgroup', { label: it.group });
        addOpts(g, it.options);
        sel.appendChild(g);
      }
    });
    sel.addEventListener('change', () => {
      o.set(sel.value);
      if (!o.noCommit) commit(o.commitLabel || o.title || 'Edit');
      sel.blur();
    });
    bind(sel, () => {
      const v = o.get();
      sel.value = v == null ? '' : String(v);
    });
    return sel;
  }

  /** Segmented control. o: { key, options: [{ value, label|icon, title }], get, set } */
  function segField(o) {
    const seg = h('div', { class: 'f-seg ins-seg' + (o.cls ? ' ' + o.cls : '') });
    const btns = o.options.map((op) => {
      const b = h(
        'button',
        { type: 'button', title: op.title || op.label || '', 'aria-label': op.title || op.label || '' },
        op.icon ? icon(op.icon) : op.label
      );
      b.addEventListener('click', () => {
        o.set(op.value);
        commit(o.commitLabel || 'Edit');
        b.blur();
      });
      seg.appendChild(b);
      return b;
    });
    bind(seg, () => {
      const v = o.get();
      btns.forEach((b, i) => b.classList.toggle('is-active', o.options[i].value === v));
    });
    return seg;
  }

  /** Toggle button. o: { icon, label, title, get() -> bool, set(bool) } */
  function toggleBtn(o) {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'f-btn ins-toggle' + (o.label ? '' : ' f-btn--icon') + (o.cls ? ' ' + o.cls : ''),
        title: o.title || '',
        'aria-label': o.title || o.label || '',
      },
      o.icon ? icon(o.icon) : null,
      o.label ? h('span', {}, o.label) : null
    );
    b.addEventListener('click', () => {
      o.set(!o.get());
      commit(o.commitLabel || o.title || 'Toggle');
      b.blur();
    });
    bind(b, () => b.setAttribute('aria-pressed', o.get() ? 'true' : 'false'));
    return b;
  }

  /** Text input. o: { key, get, set, placeholder, live } */
  function textField(o) {
    const input = h('input', {
      class: 'f-input' + (o.cls ? ' ' + o.cls : ''),
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      'data-k': o.key,
      placeholder: o.placeholder || '',
      title: o.title || '',
    });
    if (o.live) input.addEventListener('input', () => o.set(input.value, false));
    let shown = null;
    input.addEventListener('change', () => {
      if (input.value === shown) return;
      o.set(input.value, true);
      if (!o.noCommit) commit(o.commitLabel || 'Edit');
    });
    input.addEventListener('blur', () => {
      input.value = shown = o.get() == null ? '' : o.get();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') {
        input.value = o.get() || '';
        input.blur();
      }
    });
    bind(input, () => {
      input.value = shown = o.get() == null ? '' : o.get();
    });
    return input;
  }

  // ------------------------------------------------------------------
  // Sections
  // ------------------------------------------------------------------
  function section(id, title, opts, ...body) {
    const open = ui.open[id] !== undefined ? ui.open[id] : !opts.collapsed;
    const chevron = icon('chevron-down');
    const titleBtn = h('button', { type: 'button', class: 'ins-sec__title', 'aria-expanded': String(open) }, chevron, h('span', {}, title));
    const sec = h(
      'section',
      { class: 'f-section ins-sec' + (open ? '' : ' is-collapsed') + (opts.empty ? ' is-empty' : ''), 'data-sec': id },
      h('div', { class: 'f-section__head ins-sec__head' }, titleBtn, h('div', { class: 'ins-sec__actions' }, ...(opts.actions || []))),
      h('div', { class: 'ins-sec__body' }, ...body)
    );
    titleBtn.addEventListener('click', () => {
      const now = !sec.classList.contains('is-collapsed');
      ui.open[id] = !now;
      sec.classList.toggle('is-collapsed', now);
      titleBtn.setAttribute('aria-expanded', String(!now));
      titleBtn.blur();
    });
    return sec;
  }

  const row = (...c) => h('div', { class: 'f-row' }, ...c);
  const row2 = (...c) => h('div', { class: 'f-row ins-row2' }, ...c);

  // ---------------- no selection ----------------
  function buildEmpty() {
    const frag = [];
    frag.push(
      section(
        'doc',
        'Document',
        {},
        row(
          textField({
            key: 'docname',
            get: () => store.doc.name,
            set: (v, final) => final && store.rename(v.trim() || 'Untitled'),
            noCommit: true,
            placeholder: 'Untitled',
          })
        ),
        h(
          'div',
          { class: 'f-hint ins-doc-meta' },
          (() => {
            const span = h('span');
            bind(span, () => {
              const n = Object.keys(store.doc.nodes).length;
              const a = store.doc.roots.length;
              span.textContent = `${a} artboard${a === 1 ? '' : 's'} · ${n} layer${n === 1 ? '' : 's'}`;
            });
            return span;
          })()
        )
      )
    );

    const groups = {};
    (Folio.presets || []).forEach((p) => (groups[p.group] = groups[p.group] || []).push(p));
    const presetBody = Object.keys(groups).map((g) =>
      h(
        'div',
        { class: 'ins-presets' },
        h('div', { class: 'ins-presets__group' }, g),
        ...groups[g].map((p) => {
          const b = h(
            'button',
            { type: 'button', class: 'ins-preset', title: `New ${p.name} artboard (${p.width}×${p.height})` },
            h('span', { class: 'ins-preset__shape' }, h('i', { style: shapeStyle(p) })),
            h('span', { class: 'ins-preset__name' }, p.name),
            h('span', { class: 'ins-preset__dims' }, `${p.width} × ${p.height}`)
          );
          b.addEventListener('click', () => {
            createArtboard(p);
            b.blur();
          });
          return b;
        })
      )
    );
    frag.push(section('artboards', 'New artboard', {}, ...presetBody));

    const tips = [
      ['V', 'Select'],
      ['F', 'Frame'],
      ['R', 'Rectangle'],
      ['O', 'Ellipse'],
      ['T', 'Text'],
      ['I', 'Image'],
      ['H', 'Hand'],
      ['Space', 'Drag to pan'],
      ['⇧A', 'Auto layout'],
      ['⌘D', 'Duplicate'],
      ['⌘Z', 'Undo'],
      ['⇧⌘Z', 'Redo'],
    ];
    frag.push(
      section(
        'tips',
        'Shortcuts',
        {},
        h(
          'div',
          { class: 'ins-tips' },
          ...tips.map(([k, l]) => h('div', { class: 'ins-tip' }, h('kbd', {}, k), h('span', {}, l)))
        )
      )
    );
    return frag;
  }

  function shapeStyle(p) {
    const r = p.width / p.height;
    const w = r >= 1 ? 14 : Math.max(5, 14 * r);
    const hh = r >= 1 ? Math.max(4, 14 / r) : 14;
    return { width: w + 'px', height: hh + 'px' };
  }

  function createArtboard(p) {
    if (Folio.canvas && Folio.canvas.createArtboard) {
      Folio.canvas.createArtboard(p);
      return;
    }
    let x = 0;
    store.doc.roots.forEach((id) => {
      const n = store.get(id);
      if (n) x = Math.max(x, n.x + n.width + 100);
    });
    const node = store.createNode('frame', { name: p.name, x, y: 0, width: p.width, height: p.height }, null);
    store.select(node.id);
    commit('New artboard');
  }

  // ---------------- header ----------------
  function typeIcon(n) {
    if (n.type === 'text') return 'text';
    if (n.type === 'image') return 'image';
    if (!n.parent) return 'frame';
    if (n.style && n.style.radius === 9999 && !n.children.length) return 'ellipse';
    if (n.layout && n.layout.mode === 'flex') return 'layers';
    return n.children.length ? 'frame' : 'rect';
  }

  function buildHeader(p, count) {
    const label = !p.parent ? 'Artboard' : p.type === 'frame' ? (p.layout.mode === 'flex' ? 'Auto layout' : 'Frame') : p.type === 'text' ? 'Text' : 'Image';
    return h(
      'div',
      { class: 'f-section ins-header' },
      h('div', { class: 'ins-header__icon', title: label }, icon(typeIcon(p))),
      textField({
        key: 'name',
        cls: 'ins-header__name',
        get: () => (P() ? P().name : ''),
        set: (v, final) => {
          if (!P()) return;
          store.update(P().id, { name: final ? v.trim() || P().name : v });
        },
        live: true,
        commitLabel: 'Rename layer',
        title: 'Layer name',
      }),
      count > 1 ? h('span', { class: 'ins-header__count', title: `${count} layers selected — edits apply to all` }, `+${count - 1}`) : null
    );
  }

  // ---------------- position ----------------
  function buildPosition(p) {
    const body = [];
    if (isFreeformChild(p)) {
      const align = (how) => {
        selIds().forEach((id) => {
          const n = store.get(id);
          if (!n || !isFreeformChild(n)) return;
          const pm = measure(store.getParent(id));
          const m = measure(n);
          const patch = {};
          if (how === 'left') patch.x = 0;
          if (how === 'hcenter') patch.x = Math.round((pm.cw - m.w) / 2);
          if (how === 'right') patch.x = Math.round(pm.cw - m.w);
          if (how === 'top') patch.y = 0;
          if (how === 'vcenter') patch.y = Math.round((pm.ch - m.h) / 2);
          if (how === 'bottom') patch.y = Math.round(pm.ch - m.h);
          store.update(id, patch);
        });
        commit('Align');
      };
      body.push(
        h(
          'div',
          { class: 'f-row ins-align' },
          iconBtn('al-left', 'Align left', () => align('left')),
          iconBtn('al-hcenter', 'Align horizontal centers', () => align('hcenter')),
          iconBtn('al-right', 'Align right', () => align('right')),
          h('span', { class: 'ins-sep' }),
          iconBtn('al-top', 'Align top', () => align('top')),
          iconBtn('al-vcenter', 'Align vertical centers', () => align('vcenter')),
          iconBtn('al-bottom', 'Align bottom', () => align('bottom'))
        )
      );
    }
    if (hasXY(p)) {
      const xy = (axis) =>
        numField({
          key: axis,
          label: axis.toUpperCase(),
          title: axis === 'x' ? 'X position' : 'Y position',
          get: () => P()[axis],
          set: (v) => patchSel({ [axis]: v }, hasXY),
          commitLabel: 'Move',
        });
      body.push(row2(xy('x'), xy('y')));
    }
    body.push(
      row2(
        numField({
          key: 'rotation',
          label: () => icon('rotate'),
          title: 'Rotation',
          get: () => P().style.rotation || 0,
          set: (v) => patchSel({ style: { rotation: v } }),
          suffix: '°',
          precision: 1,
          commitLabel: 'Rotate',
        }),
        h('div', { class: 'ins-spacer' })
      )
    );
    return section('position', 'Position', {}, ...body);
  }

  // ---------------- size ----------------
  function sizeModes(n) {
    const out = [['fixed', 'Fixed']];
    if (n.type === 'frame' || n.type === 'text') out.push(['hug', 'Hug']);
    if (n.parent) out.push(['fill', 'Fill']);
    return out;
  }

  function buildSize(p) {
    const dim = (axis) => {
      const prop = axis === 'w' ? 'width' : 'height';
      return numField({
        key: axis,
        label: axis.toUpperCase(),
        title: axis === 'w' ? 'Width' : 'Height',
        get: () => {
          const n = P();
          return n.sizing[axis] === 'fixed' ? n[prop] : Math.round(measure(n)[axis]);
        },
        set: (v) => patchSel({ [prop]: v, sizing: { [axis]: 'fixed' } }),
        min: 0,
        commitLabel: 'Resize',
      });
    };
    const mode = (axis) => {
      const prop = axis === 'w' ? 'width' : 'height';
      let opts = sizeModes(p);
      const cur = p.sizing[axis];
      if (!opts.some((o) => o[0] === cur)) opts = opts.concat([[cur, cur[0].toUpperCase() + cur.slice(1)]]);
      return h(
        'div',
        { class: 'ins-mode' },
        h('span', { class: 'ins-mode__icon', title: axis === 'w' ? 'Horizontal resizing' : 'Vertical resizing' }, axis === 'w' ? '↔' : '↕'),
        selectField({
          key: 'mode.' + axis,
          title: axis === 'w' ? 'Horizontal resizing' : 'Vertical resizing',
          options: opts,
          get: () => P().sizing[axis],
          set: (v) => {
            selIds().forEach((id) => {
              const n = store.get(id);
              if (!sizeModes(n).some((o) => o[0] === v)) return;
              const patch = { sizing: { [axis]: v } };
              // switching to fixed: freeze the current rendered size so nothing jumps
              if (v === 'fixed' && n.sizing[axis] !== 'fixed') patch[prop] = Math.round(measure(n)[axis]);
              store.update(id, patch);
            });
          },
          commitLabel: 'Resizing mode',
        })
      );
    };
    const body = [row2(dim('w'), dim('h')), row2(mode('w'), mode('h'))];
    if (!p.parent) {
      const groups = {};
      (Folio.presets || []).forEach((pr, i) => (groups[pr.group] = groups[pr.group] || []).push([String(i), `${pr.name}  ${pr.width}×${pr.height}`]));
      body.push(
        row(
          selectField({
            key: 'preset',
            title: 'Resize artboard to a preset',
            options: [['', 'Preset size…']].concat(Object.keys(groups).map((g) => ({ group: g, options: groups[g] }))),
            get: () => {
              const n = P();
              const i = (Folio.presets || []).findIndex((pr) => pr.width === n.width && pr.height === n.height && n.sizing.w === 'fixed' && n.sizing.h === 'fixed');
              return i >= 0 ? String(i) : '';
            },
            set: (v) => {
              const pr = (Folio.presets || [])[+v];
              if (!pr) return;
              patchSel({ width: pr.width, height: pr.height, sizing: { w: 'fixed', h: 'fixed' } }, (n) => !n.parent);
            },
            commitLabel: 'Resize artboard',
          }),
          iconBtn('swap', 'Swap width and height (orientation)', () => {
            selIds().forEach((id) => {
              const n = store.get(id);
              const m = measure(n);
              store.update(id, { width: Math.round(m.h), height: Math.round(m.w), sizing: { w: 'fixed', h: 'fixed' } });
            });
            commit('Swap orientation');
          })
        )
      );
    }
    return section('size', 'Size', {}, ...body);
  }

  // ---------------- auto layout ----------------
  function enableAutoLayout(frame) {
    const kids = frame.children.map((id) => store.get(id)).filter(Boolean);
    const L = frame.layout;
    let direction = L.direction || 'column';
    let gap = L.gap || 0;
    let padding = (L.padding || [0, 0, 0, 0]).slice();
    let order = frame.children.slice();
    if (kids.length) {
      const fm = measure(frame);
      const ms = kids.map((k) => {
        const m = measure(k);
        return { id: k.id, x: k.x, y: k.y, w: m.w, h: m.h };
      });
      if (ms.length > 1) {
        const cx = ms.map((m) => m.x + m.w / 2);
        const cy = ms.map((m) => m.y + m.h / 2);
        const dx = Math.max(...cx) - Math.min(...cx);
        const dy = Math.max(...cy) - Math.min(...cy);
        direction = dx > dy ? 'row' : 'column';
      }
      const row = direction === 'row';
      ms.sort((a, b) => (row ? a.x - b.x : a.y - b.y));
      order = ms.map((m) => m.id);
      if (ms.length > 1) {
        let sum = 0;
        for (let i = 1; i < ms.length; i++) {
          const a = ms[i - 1];
          const b = ms[i];
          sum += row ? b.x - (a.x + a.w) : b.y - (a.y + a.h);
        }
        gap = Math.max(0, Math.round(sum / (ms.length - 1)));
      }
      const minX = Math.min(...ms.map((m) => m.x));
      const minY = Math.min(...ms.map((m) => m.y));
      const maxX = Math.max(...ms.map((m) => m.x + m.w));
      const maxY = Math.max(...ms.map((m) => m.y + m.h));
      const fixedW = frame.sizing.w === 'fixed';
      const fixedH = frame.sizing.h === 'fixed';
      padding = [
        Math.max(0, Math.round(minY)),
        fixedW ? Math.max(0, Math.round(fm.cw - maxX)) : Math.max(0, Math.round(minX)),
        fixedH ? Math.max(0, Math.round(fm.ch - maxY)) : Math.max(0, Math.round(minY)),
        Math.max(0, Math.round(minX)),
      ];
      // large artboards: don't invent huge paddings on the far sides
      if (fixedW && padding[1] > padding[3] * 3 + 40) padding[1] = padding[3];
      if (fixedH && padding[2] > padding[0] * 3 + 40) padding[2] = padding[0];
    }
    store.update(frame.id, { layout: { mode: 'flex', direction, gap, padding }, children: order });
  }

  function disableAutoLayout(frame) {
    const fm = measure(frame);
    const patches = frame.children.map((id) => {
      const n = store.get(id);
      const m = measure(n);
      const patch = { x: Math.round(m.x), y: Math.round(m.y) };
      // "fill" makes no sense in a freeform frame -> freeze the rendered size
      if (n.sizing.w === 'fill') Object.assign(patch, { width: Math.round(m.w), sizing: Object.assign({}, patch.sizing, { w: 'fixed' }) });
      if (n.sizing.h === 'fill') Object.assign(patch, { height: Math.round(m.h), sizing: Object.assign({}, patch.sizing, { h: 'fixed' }) });
      if (n.type === 'frame' && n.sizing.w === 'hug' && n.layout.mode !== 'flex') Object.assign(patch, { width: Math.round(m.w), sizing: Object.assign({}, patch.sizing, { w: 'fixed' }) });
      return [id, patch];
    });
    const fpatch = { layout: { mode: 'none' } };
    if (frame.sizing.w === 'hug') Object.assign(fpatch, { width: Math.round(fm.w), sizing: Object.assign({}, fpatch.sizing, { w: 'fixed' }) });
    if (frame.sizing.h === 'hug') Object.assign(fpatch, { height: Math.round(fm.h), sizing: Object.assign({}, fpatch.sizing, { h: 'fixed' }) });
    patches.forEach(([id, patch]) => store.update(id, patch));
    store.update(frame.id, fpatch);
  }

  const ALIGN_VALS = ['flex-start', 'center', 'flex-end'];

  function buildAutoLayout(p) {
    const frames = (n) => n.type === 'frame';
    const on = p.layout.mode === 'flex';
    const setLayout = (patch) => patchSel({ layout: patch }, frames);
    const toggle = iconBtn(on ? 'minus' : 'plus', on ? 'Remove auto layout' : 'Add auto layout (⇧A wraps selection)', () => {
      const ids = selIds().filter((id) => store.get(id).type === 'frame');
      ids.forEach((id) => (on ? disableAutoLayout(store.get(id)) : enableAutoLayout(store.get(id))));
      commit(on ? 'Remove auto layout' : 'Add auto layout');
    });
    if (!on) return section('layout', 'Auto layout', { actions: [toggle], empty: true });

    const L = () => P().layout;
    const body = [];
    body.push(
      row(
        segField({
          key: 'dir',
          options: [
            { value: 'row', icon: 'arrow-right', title: 'Horizontal (row)' },
            { value: 'column', icon: 'arrow-down', title: 'Vertical (column)' },
          ],
          get: () => L().direction,
          set: (v) => setLayout({ direction: v }),
          commitLabel: 'Layout direction',
        }),
        toggleBtn({
          icon: 'wrap',
          title: 'Wrap children onto new lines',
          get: () => !!L().wrap,
          set: (v) => setLayout({ wrap: v }),
        })
      )
    );

    // alignment grid + gap/padding
    const grid = h('div', { class: 'ins-agrid', title: 'Alignment' });
    const cells = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cell = h('button', { type: 'button', class: 'ins-agrid__cell', title: alignTitle(r, c) }, h('i'));
        cell.addEventListener('click', () => {
          const l = L();
          const rowDir = l.direction === 'row';
          const main = rowDir ? c : r;
          const cross = rowDir ? r : c;
          const patch = {};
          if (l.justify !== 'space-between') patch.justify = ALIGN_VALS[main];
          if (l.align !== 'stretch') patch.align = ALIGN_VALS[cross];
          if (l.justify === 'space-between' && l.align === 'stretch') patch.justify = ALIGN_VALS[main];
          setLayout(patch);
          commit('Align children');
          cell.blur();
        });
        cells.push({ cell, r, c });
        grid.appendChild(cell);
      }
    }
    bind(grid, () => {
      const l = L();
      const rowDir = l.direction === 'row';
      const ji = ALIGN_VALS.indexOf(l.justify);
      const ai = ALIGN_VALS.indexOf(l.align);
      grid.classList.toggle('is-row', rowDir);
      cells.forEach(({ cell, r, c }) => {
        const main = rowDir ? c : r;
        const cross = rowDir ? r : c;
        const mOk = l.justify === 'space-between' || main === ji;
        const cOk = l.align === 'stretch' || cross === ai;
        cell.classList.toggle('is-active', mOk && cOk);
      });
    });

    const gapF = numField({
      key: 'gap',
      label: () => icon(p.layout.direction === 'row' ? 'gap-h' : 'gap-v'),
      title: 'Gap between items',
      get: () => L().gap || 0,
      set: (v) => setLayout({ gap: v }),
      min: 0,
      commitLabel: 'Gap',
    });
    const side = h(
      'div',
      { class: 'ins-al-side' },
      gapF,
      h(
        'div',
        { class: 'ins-al-btns' },
        toggleBtn({
          icon: 'between',
          title: 'Space between',
          get: () => L().justify === 'space-between',
          set: (v) => setLayout({ justify: v ? 'space-between' : 'flex-start' }),
          commitLabel: 'Space between',
        }),
        toggleBtn({
          icon: 'stretch',
          title: 'Stretch children on the cross axis',
          get: () => L().align === 'stretch',
          set: (v) => setLayout({ align: v ? 'stretch' : 'flex-start' }),
          commitLabel: 'Stretch',
        })
      )
    );
    body.push(h('div', { class: 'f-row ins-al' }, grid, side));

    // padding
    const pad = (i, label, title) =>
      numField({
        key: 'pad' + i,
        label,
        title,
        get: () => (L().padding || [0, 0, 0, 0])[i],
        set: (v) =>
          patchSel((n) => {
            if (n.type !== 'frame') return {};
            const arr = (n.layout.padding || [0, 0, 0, 0]).slice();
            const idx = ui.padSides ? [i] : i === 1 ? [1, 3] : i === 0 ? [0, 2] : [i];
            idx.forEach((j) => (arr[j] = v));
            return { layout: { padding: arr } };
          }),
        min: 0,
        commitLabel: 'Padding',
      });
    const sidesBtn = h(
      'button',
      {
        type: 'button',
        class: 'f-btn f-btn--icon ins-toggle',
        title: 'Edit each side separately',
        'aria-pressed': ui.padSides ? 'true' : 'false',
      },
      icon('sides')
    );
    sidesBtn.addEventListener('click', () => {
      ui.padSides = !ui.padSides;
      rebuild();
    });
    if (ui.padSides) {
      body.push(h('div', { class: 'f-row ins-pad4' }, pad(0, 'T', 'Padding top'), pad(1, 'R', 'Padding right'), pad(2, 'B', 'Padding bottom'), pad(3, 'L', 'Padding left'), sidesBtn));
    } else {
      body.push(row(h('div', { class: 'ins-pair' }, pad(1, 'H', 'Horizontal padding (left & right)'), pad(0, 'V', 'Vertical padding (top & bottom)')), sidesBtn));
    }
    return section('layout', 'Auto layout', { actions: [toggle] }, ...body);
  }

  function alignTitle(r, c) {
    const v = ['Top', 'Center', 'Bottom'][r];
    const hz = ['left', 'center', 'right'][c];
    return r === 1 && c === 1 ? 'Center' : `${v} ${hz}`;
  }

  // ---------------- appearance ----------------
  const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

  function buildAppearance(p) {
    const body = [];
    const indep = Array.isArray(p.style.radius);
    const radiusToggle = h(
      'button',
      { type: 'button', class: 'f-btn f-btn--icon ins-toggle', title: 'Independent corners', 'aria-pressed': indep ? 'true' : 'false' },
      icon('corners')
    );
    radiusToggle.addEventListener('click', () => {
      patchSel((n) => {
        const r = n.style.radius;
        return { style: { radius: Array.isArray(r) ? r[0] || 0 : [r || 0, r || 0, r || 0, r || 0] } };
      });
      commit('Corner radius');
    });
    body.push(
      row(
        h(
          'div',
          { class: 'ins-pair' },
          numField({
            key: 'opacity',
            label: () => icon('opacity'),
            title: 'Opacity',
            get: () => Math.round((P().style.opacity != null ? P().style.opacity : 1) * 100),
            set: (v) => patchSel({ style: { opacity: v / 100 } }),
            min: 0,
            max: 100,
            suffix: '%',
            commitLabel: 'Opacity',
          }),
          indep
            ? h('div', { class: 'ins-spacer ins-hint-cell' }, h('span', { class: 'f-hint' }, 'Corners'))
            : numField({
                key: 'radius',
                label: () => icon('radius'),
                title: 'Corner radius',
                get: () => (Array.isArray(P().style.radius) ? P().style.radius[0] : P().style.radius || 0),
                set: (v) => patchSel({ style: { radius: v } }),
                min: 0,
                commitLabel: 'Corner radius',
              })
        ),
        radiusToggle
      )
    );
    if (indep) {
      const corner = (i, label, title) =>
        numField({
          key: 'radius' + i,
          label,
          title,
          get: () => {
            const r = P().style.radius;
            return Array.isArray(r) ? r[i] || 0 : r || 0;
          },
          set: (v) =>
            patchSel((n) => {
              const r = n.style.radius;
              const arr = Array.isArray(r) ? r.slice() : [r || 0, r || 0, r || 0, r || 0];
              arr[i] = v;
              return { style: { radius: arr } };
            }),
          min: 0,
          commitLabel: 'Corner radius',
        });
      body.push(h('div', { class: 'f-row ins-quad' }, corner(0, '↖', 'Top left'), corner(1, '↗', 'Top right'), corner(2, '↘', 'Bottom right'), corner(3, '↙', 'Bottom left')));
    }
    body.push(
      row(
        h(
          'div',
          { class: 'ins-blend' },
          h('span', { class: 'ins-blend__icon', title: 'Blend mode' }, icon('blend')),
          selectField({
            key: 'blend',
            title: 'Blend mode',
            options: BLENDS.map((b) => [b, b === 'normal' ? 'Normal' : b.replace(/-/g, ' ').replace(/^./, (m) => m.toUpperCase())]),
            get: () => P().style.blend || 'normal',
            set: (v) => patchSel({ style: { blend: v } }),
            commitLabel: 'Blend mode',
          })
        ),
        p.type === 'frame'
          ? toggleBtn({
              icon: 'clip',
              label: 'Clip',
              title: 'Clip content (overflow: hidden)',
              get: () => !!P().style.clip,
              set: (v) => patchSel({ style: { clip: v } }),
              commitLabel: 'Clip content',
            })
          : null
      )
    );
    return section('appearance', 'Appearance', {}, ...body);
  }

  // ---------------- fills ----------------
  const FILL_TYPES = [
    ['solid', 'Solid'],
    ['linear', 'Linear'],
    ['radial', 'Radial'],
    ['conic', 'Conic'],
    ['mesh', 'Mesh'],
    ['image', 'Image'],
    ['noise', 'Noise'],
  ];
  const MESH_POS = [
    { x: 12, y: 18 },
    { x: 88, y: 12 },
    { x: 82, y: 88 },
    { x: 18, y: 82 },
  ];
  const MESH_PRESETS = [
    { name: 'Aurora', base: '#0b1026', points: ['#6d5efc', '#22d3ee', '#a855f7', '#10b981'] },
    { name: 'Peach', base: '#ffe8dc', points: ['#ff8a65', '#ffd166', '#f472b6', '#fdba74'] },
    { name: 'Lagoon', base: '#e6fbf7', points: ['#14b8a6', '#60a5fa', '#a7f3d0', '#3b82f6'] },
    { name: 'Sunset', base: '#2a0a3d', points: ['#ff6b6b', '#f59e0b', '#ec4899', '#8b5cf6'] },
    { name: 'Pastel', base: '#fdf4ff', points: ['#c4b5fd', '#fde68a', '#93c5fd', '#f9a8d4'] },
  ];
  const meshFrom = (pr, f) => ({
    type: 'mesh',
    base: pr.base,
    spread: (f && f.spread) || 60,
    points: pr.points.map((c, i) => ({ color: c, x: f && f.points && f.points[i] ? f.points[i].x : MESH_POS[i].x, y: f && f.points && f.points[i] ? f.points[i].y : MESH_POS[i].y })),
    visible: f ? f.visible !== false : true,
  });

  function mainColor(f) {
    if (!f) return '#d9d9d9';
    if (f.type === 'solid') return f.color;
    if (f.stops && f.stops.length) return f.stops[0].color;
    if (f.type === 'mesh') return f.base;
    return '#d9d9d9';
  }

  function convertFill(f, type) {
    if (f.type === type) return f;
    const c = mainColor(f);
    const c2 = splitColor(c).hex === '#6d5efc' ? '#ffffff' : '#6d5efc';
    const stops = f.stops && f.stops.length >= 2 ? clone(f.stops) : [{ color: c, pos: 0 }, { color: c2, pos: 100 }];
    const vis = f.visible !== false;
    switch (type) {
      case 'solid':
        return { type, color: c, visible: vis };
      case 'linear':
        return { type, angle: f.angle != null ? f.angle : 180, stops, visible: vis };
      case 'radial':
        return { type, cx: 50, cy: 50, stops, visible: vis };
      case 'conic':
        return { type, angle: f.angle != null ? f.angle : 0, stops, visible: vis };
      case 'mesh':
        return Object.assign(meshFrom(MESH_PRESETS[0]), { visible: vis });
      case 'image':
        return { type, src: '', fit: 'cover', visible: vis };
      case 'noise':
        return { type, opacity: 0.15, visible: vis };
    }
    return f;
  }

  const fillAt = (i) => (P() && P().style.fills ? P().style.fills[i] : null);
  const patchFill = (i, patch) =>
    listOp('fills', (arr) => {
      if (!arr[i]) return false;
      arr[i] = Object.assign(arr[i], typeof patch === 'function' ? patch(arr[i]) : patch);
    });

  function swatchPreview(getFill) {
    const chip = h('i');
    const sw = h('button', { type: 'button', class: 'f-swatch ins-swatch' }, chip);
    bind(sw, () => {
      const f = getFill();
      chip.removeAttribute('style');
      if (!f) return;
      const css = Folio.css.fillsToCss([Object.assign({}, f, { visible: true })]);
      if (f.type === 'image' && !f.src) {
        chip.style.background = 'repeating-linear-gradient(45deg,#3a3a40 0 3px,#2b2b30 3px 6px)';
        return;
      }
      Object.entries(css).forEach(([k, v]) => chip.style.setProperty(k, v));
      if (f.type === 'image' || f.type === 'noise') chip.style.backgroundSize = 'cover';
    });
    return sw;
  }

  function fillQuick(f, i, key) {
    switch (f.type) {
      case 'solid':
        return h(
          'div',
          { class: 'ins-quick' },
          (() => {
            const inp = h('input', { class: 'f-input ins-hex', type: 'text', spellcheck: 'false', 'data-k': key + '.qhex', title: 'Colour' });
            const show = () => {
              const ff = fillAt(i);
              inp.value = ff && ff.color ? splitColor(ff.color).hex.slice(1).toUpperCase() : '';
            };
            const apply = () => {
              const c = parseColor(inp.value);
              if (!c) return false;
              const ff = fillAt(i);
              const typedAlpha = /^#?[0-9a-f]{8}$/i.test(inp.value.trim()) || /rgba|hsla|\/|transparent/i.test(inp.value);
              patchFill(i, { color: typedAlpha ? c : joinColor(splitColor(c).hex, splitColor(ff.color).alpha) });
              return true;
            };
            inp.addEventListener('input', apply);
            inp.addEventListener('change', () => {
              if (apply()) commit('Fill colour');
              show();
            });
            inp.addEventListener('keydown', (e) => e.key === 'Enter' && inp.blur());
            bind(inp, show);
            return inp;
          })(),
          (() => {
            const em = h('em', { class: 'ins-suffix', title: 'Opacity (edit in the fill editor)' });
            bind(em, () => {
              const ff = fillAt(i);
              const a = ff && ff.color ? splitColor(ff.color).alpha : 1;
              em.textContent = a < 0.999 ? Math.round(a * 100) + '%' : '';
            });
            return em;
          })()
        );
      case 'linear':
      case 'conic':
        return numField({
          key: key + '.qangle',
          label: () => icon('rotate'),
          title: 'Angle',
          get: () => (fillAt(i) ? fillAt(i).angle || 0 : 0),
          set: (v) => patchFill(i, { angle: v }),
          suffix: '°',
          commitLabel: 'Gradient angle',
        });
      case 'noise':
        return numField({
          key: key + '.qnoise',
          label: '◍',
          title: 'Grain opacity',
          get: () => Math.round(((fillAt(i) && fillAt(i).opacity) != null ? fillAt(i).opacity : 0.15) * 100),
          set: (v) => patchFill(i, { opacity: v / 100 }),
          min: 0,
          max: 100,
          suffix: '%',
          commitLabel: 'Noise',
        });
      case 'image': {
        const b = h('button', { type: 'button', class: 'f-btn ins-quick-btn', title: 'Upload an image' }, icon('upload'), f.src ? 'Replace' : 'Upload');
        b.addEventListener('click', () => {
          pickImage((src) => {
            patchFill(i, { src });
            commit('Image fill');
          });
          b.blur();
        });
        return b;
      }
      default: {
        const b = h('button', { type: 'button', class: 'f-btn f-btn--ghost ins-quick-btn ins-quick-label', title: 'Edit' }, f.type === 'mesh' ? 'Mesh gradient' : 'Radial');
        b.addEventListener('click', () => toggleFill(i));
        return b;
      }
    }
  }

  function toggleFill(i) {
    const k = P().id + ':' + i;
    ui.expandedFill = ui.expandedFill === k ? null : k;
    ui.selectedStop = 0;
    rebuild();
  }

  function buildFills(p) {
    const fills = p.style.fills || [];
    const isText = p.type === 'text';
    const add = iconBtn('plus', 'Add fill', () => {
      const has = (P().style.fills || []).length;
      listOp('fills', (arr) => {
        arr.push({ type: 'solid', color: has ? '#00000033' : '#d9d9d9', visible: true });
      });
      ui.expandedFill = P().id + ':' + ((P().style.fills || []).length - 1);
      commit('Add fill');
    });
    const presetsBtn = iconBtn('sparkle', 'Mesh gradient presets', () => {
      ui.meshPresets = !ui.meshPresets;
      rebuild();
    });
    if (ui.meshPresets) presetsBtn.classList.add('is-active');
    const body = [];
    if (ui.meshPresets) {
      body.push(
        meshPresetStrip((pr) => {
          listOp('fills', (arr) => {
            arr.push(meshFrom(pr));
          });
          ui.expandedFill = P().id + ':' + ((P().style.fills || []).length - 1);
          ui.meshPresets = false;
          commit('Add mesh gradient');
        }, 'Click to add on top')
      );
    }
    // top-most fill first (like layers)
    for (let i = fills.length - 1; i >= 0; i--) body.push(buildFillRow(p, fills[i], i, fills.length));
    return section('fill', isText ? 'Background' : 'Fill', { actions: [presetsBtn, add], empty: !fills.length && !ui.meshPresets }, ...body);
  }

  function meshPresetStrip(onPick, hint) {
    return h(
      'div',
      { class: 'ins-mesh-presets' },
      ...MESH_PRESETS.map((pr) => {
        const b = h('button', { type: 'button', class: 'ins-mesh-preset', title: `${pr.name} — ${hint}` });
        const css = Folio.css.fillsToCss([meshFrom(pr)]);
        Object.entries(css).forEach(([k, v]) => b.style.setProperty(k, v));
        b.appendChild(h('span', {}, pr.name));
        b.addEventListener('click', () => onPick(pr));
        return b;
      })
    );
  }

  function buildFillRow(p, f, i, count) {
    const key = 'fill' + i;
    const expanded = ui.expandedFill === p.id + ':' + i;
    const sw = swatchPreview(() => fillAt(i));
    sw.title = 'Edit fill';
    sw.addEventListener('click', () => toggleFill(i));
    const eye = h('button', { type: 'button', class: 'f-btn f-btn--ghost f-btn--icon ins-ibtn', title: 'Show / hide fill' });
    eye.addEventListener('click', () => {
      const vis = fillAt(i) && fillAt(i).visible !== false;
      patchFill(i, { visible: !vis });
      commit(vis ? 'Hide fill' : 'Show fill');
      eye.blur();
    });
    bind(eye, () => {
      const ff = fillAt(i);
      const vis = !ff || ff.visible !== false;
      eye.replaceChildren(icon(vis ? 'eye' : 'eye-off'));
      eye.closest && eye.parentNode && eye.parentNode.classList.toggle('is-hidden', !vis);
    });
    const rm = iconBtn('minus', 'Remove fill', () => {
      listOp('fills', (arr) => {
        if (!arr[i]) return false;
        arr.splice(i, 1);
      });
      ui.expandedFill = null;
      commit('Remove fill');
    });
    const head = h(
      'div',
      { class: 'f-row ins-fill' + (f.visible === false ? ' is-hidden' : '') + (expanded ? ' is-open' : '') },
      sw,
      selectField({
        key: key + '.type',
        cls: 'ins-fill__type',
        title: 'Fill type',
        options: FILL_TYPES,
        get: () => (fillAt(i) ? fillAt(i).type : 'solid'),
        set: (v) => {
          listOp('fills', (arr) => {
            if (!arr[i]) return false;
            arr[i] = convertFill(arr[i], v);
          });
          if (v !== 'solid') ui.expandedFill = P().id + ':' + i;
        },
        commitLabel: 'Fill type',
      }),
      fillQuick(f, i, key),
      eye,
      rm
    );
    const wrap = h('div', { class: 'ins-fill-item' }, head);
    if (expanded) wrap.appendChild(buildFillEditor(f, i, count, key));
    return wrap;
  }

  function buildFillEditor(f, i, count, key) {
    const ed = h('div', { class: 'ins-editor' });
    const get = () => fillAt(i) || f;
    switch (f.type) {
      case 'solid':
        ed.appendChild(row(colorField({ key: key + '.color', get: () => get().color, set: (c) => patchFill(i, { color: c }), commitLabel: 'Fill colour' })));
        break;
      case 'linear':
      case 'conic':
      case 'radial': {
        if (f.type === 'radial') {
          ed.appendChild(
            row2(
              numField({ key: key + '.cx', label: 'X', title: 'Centre X', get: () => (get().cx != null ? get().cx : 50), set: (v) => patchFill(i, { cx: v }), suffix: '%', commitLabel: 'Gradient centre' }),
              numField({ key: key + '.cy', label: 'Y', title: 'Centre Y', get: () => (get().cy != null ? get().cy : 50), set: (v) => patchFill(i, { cy: v }), suffix: '%', commitLabel: 'Gradient centre' })
            )
          );
        } else {
          ed.appendChild(
            row2(
              numField({ key: key + '.angle', label: () => icon('rotate'), title: 'Angle', get: () => get().angle || 0, set: (v) => patchFill(i, { angle: v }), suffix: '°', commitLabel: 'Gradient angle' }),
              h(
                'div',
                { class: 'ins-angle-btns' },
                ...[0, 90, 180, 270].map((a) => {
                  const b = h('button', { type: 'button', class: 'f-btn f-btn--ghost ins-mini', title: a + '°' }, ['↑', '→', '↓', '←'][a / 90]);
                  b.addEventListener('click', () => {
                    patchFill(i, { angle: a });
                    commit('Gradient angle');
                    b.blur();
                  });
                  return b;
                })
              )
            )
          );
        }
        ed.appendChild(stopsEditor(f, i, key));
        break;
      }
      case 'mesh': {
        ed.appendChild(meshPresetStrip((pr) => {
          patchFill(i, (cur) => meshFrom(pr, cur));
          commit('Mesh preset');
        }, 'Click to apply'));
        ed.appendChild(propRow('Base', colorField({ key: key + '.base', get: () => get().base, set: (c) => patchFill(i, { base: c }), commitLabel: 'Mesh colour', noAlpha: true })));
        (f.points || []).forEach((pt, j) => {
          ed.appendChild(
            propRow(
              'Point ' + (j + 1),
              colorField({
                key: key + '.p' + j,
                get: () => (get().points && get().points[j] ? get().points[j].color : '#000000'),
                set: (c) =>
                  patchFill(i, (cur) => {
                    const pts = clone(cur.points || []);
                    if (pts[j]) pts[j].color = c;
                    return { points: pts };
                  }),
                commitLabel: 'Mesh colour',
              })
            )
          );
        });
        ed.appendChild(
          row(
            h(
              'div',
              { class: 'ins-grow' },
              numField({ key: key + '.spread', label: 'S', title: 'Spread (blob size)', get: () => (get().spread != null ? get().spread : 55), set: (v) => patchFill(i, { spread: v }), min: 5, max: 150, suffix: '%', commitLabel: 'Mesh spread' })
            ),
            (() => {
              const b = h('button', { type: 'button', class: 'f-btn', title: 'Shuffle point positions' }, icon('shuffle'), 'Shuffle');
              b.addEventListener('click', () => {
                patchFill(i, (cur) => ({
                  points: (cur.points || []).map((pt) => Object.assign({}, pt, { x: Math.round(Math.random() * 100), y: Math.round(Math.random() * 100) })),
                }));
                commit('Shuffle mesh');
                b.blur();
              });
              return b;
            })()
          )
        );
        break;
      }
      case 'image': {
        ed.appendChild(imageControls(key, () => get().src, (src) => patchFill(i, { src }), () => get().fit || 'cover', (v) => patchFill(i, { fit: v }), [['cover', 'Cover'], ['contain', 'Contain'], ['fill', 'Stretch'], ['tile', 'Tile']]));
        break;
      }
      case 'noise':
        ed.appendChild(
          propRow(
            'Grain',
            numField({ key: key + '.noise', label: '◍', title: 'Grain opacity', get: () => Math.round((get().opacity != null ? get().opacity : 0.15) * 100), set: (v) => patchFill(i, { opacity: v / 100 }), min: 0, max: 100, suffix: '%', commitLabel: 'Noise' })
          )
        );
        ed.appendChild(h('div', { class: 'f-hint' }, 'Tip: put noise on top of a gradient for a print-like grain.'));
        break;
    }
    // reorder
    const move = (d) => {
      listOp('fills', (arr) => {
        const j = i + d;
        if (!arr[i] || j < 0 || j >= arr.length) return false;
        const [it] = arr.splice(i, 1);
        arr.splice(j, 0, it);
      });
      ui.expandedFill = P().id + ':' + (i + d);
      commit('Reorder fill');
    };
    ed.appendChild(
      h(
        'div',
        { class: 'f-row ins-editor__foot' },
        h('span', { class: 'f-hint' }, count === 1 ? 'Only fill' : i === count - 1 ? 'Top fill' : i === 0 ? 'Bottom fill' : `Fill ${i + 1} of ${count}`),
        h('span', { class: 'ins-grow' }),
        iconBtn('chevron-up', 'Move fill up (toward top)', () => move(1), { disabled: i >= count - 1 }),
        iconBtn('chevron-down', 'Move fill down', () => move(-1), { disabled: i <= 0 })
      )
    );
    return ed;
  }

  function stopsEditor(f, i, key) {
    const wrap = h('div', { class: 'ins-stops' });
    const get = () => fillAt(i) || f;
    const bar = h('div', { class: 'ins-gbar', title: 'Click to add a stop · drag handles to move' });
    const barFill = h('i');
    bar.appendChild(barFill);
    const handles = (f.stops || []).map((s, j) => {
      const hd = h('span', { class: 'ins-gstop' }, h('i'));
      hd.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        ui.selectedStop = j;
        updateBindings();
        try {
          hd.setPointerCapture(e.pointerId);
        } catch (err) {}
        const rect = bar.getBoundingClientRect();
        let moved = false;
        const mv = (ev) => {
          moved = true;
          const pos = Math.max(0, Math.min(100, Math.round(((ev.clientX - rect.left) / rect.width) * 100)));
          setStop(j, { pos });
        };
        const up = () => {
          hd.removeEventListener('pointermove', mv);
          hd.removeEventListener('pointerup', up);
          hd.removeEventListener('pointercancel', up);
          if (moved) commit('Move gradient stop');
        };
        hd.addEventListener('pointermove', mv);
        hd.addEventListener('pointerup', up);
        hd.addEventListener('pointercancel', up);
      });
      bar.appendChild(hd);
      return hd;
    });
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.ins-gstop')) return;
      const rect = bar.getBoundingClientRect();
      const pos = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
      addStop(pos);
    });
    bind(bar, () => {
      const ff = get();
      const stops = ff.stops || [];
      const sorted = stops.slice().sort((a, b) => a.pos - b.pos);
      barFill.style.background = `linear-gradient(90deg, ${sorted.map((s) => `${s.color} ${s.pos}%`).join(', ')})`;
      handles.forEach((hd, j) => {
        const s = stops[j];
        if (!s) return;
        hd.style.left = s.pos + '%';
        hd.firstChild.style.background = s.color;
        hd.classList.toggle('is-active', j === ui.selectedStop);
      });
    });
    wrap.appendChild(bar);

    const setStop = (j, patch) =>
      patchFill(i, (cur) => {
        const stops = clone(cur.stops || []);
        if (stops[j]) Object.assign(stops[j], patch);
        return { stops };
      });
    const addStop = (pos) => {
      const stops = get().stops || [];
      let near = stops[0];
      stops.forEach((s) => {
        if (Math.abs(s.pos - pos) < Math.abs(near.pos - pos)) near = s;
      });
      patchFill(i, (cur) => ({ stops: clone(cur.stops || []).concat([{ color: near ? near.color : '#888888', pos }]) }));
      ui.selectedStop = stops.length;
      commit('Add gradient stop');
    };

    const head = h(
      'div',
      { class: 'f-row ins-stops__head' },
      h('span', { class: 'f-label' }, 'Stops'),
      h('span', { class: 'ins-grow' }),
      iconBtn('plus', 'Add stop', () => addStop(50))
    );
    wrap.appendChild(head);
    (f.stops || []).forEach((s, j) => {
      const rowEl = h(
        'div',
        { class: 'f-row ins-stop' },
        numField({ key: key + '.s' + j + '.pos', title: 'Position', get: () => (get().stops[j] ? get().stops[j].pos : 0), set: (v) => setStop(j, { pos: v }), min: 0, max: 100, suffix: '%', cls: 'ins-stop__pos', commitLabel: 'Gradient stop' }),
        colorField({ key: key + '.s' + j, get: () => (get().stops[j] ? get().stops[j].color : '#000000'), set: (c) => setStop(j, { color: c }), commitLabel: 'Gradient stop', compact: true }),
        iconBtn(
          'minus',
          'Remove stop',
          () => {
            patchFill(i, (cur) => {
              const stops = clone(cur.stops || []);
              if (stops.length > 2) stops.splice(j, 1);
              return { stops };
            });
            ui.selectedStop = 0;
            commit('Remove gradient stop');
          },
          { disabled: (f.stops || []).length <= 2 }
        )
      );
      rowEl.addEventListener('focusin', () => {
        if (ui.selectedStop !== j) {
          ui.selectedStop = j;
          updateBindings();
        }
      });
      wrap.appendChild(rowEl);
    });
    return wrap;
  }

  // ---------- images ----------
  function pickImage(cb) {
    const inp = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const file = inp.files && inp.files[0];
      inp.remove();
      if (!file) return;
      const r = new FileReader();
      r.onload = () => cb(r.result, file.name);
      r.onerror = () => Folio.ui.toast('Could not read that file', 'error');
      r.readAsDataURL(file);
    });
    inp.click();
    // if the dialog is cancelled the input stays detached-hidden; clean up later
    setTimeout(() => inp.isConnected && !inp.files.length && inp.remove(), 60000);
  }

  function imageControls(key, getSrc, setSrc, getFit, setFit, fitOptions) {
    const box = h('div', { class: 'ins-image' });
    const thumb = h('div', { class: 'ins-thumb' });
    bind(thumb, () => {
      const src = getSrc();
      thumb.style.backgroundImage = src ? `url("${src.replace(/"/g, '%22')}")` : '';
      thumb.classList.toggle('is-empty', !src);
      thumb.textContent = src ? '' : 'No image';
    });
    const upload = h('button', { type: 'button', class: 'f-btn' }, icon('upload'), 'Upload…');
    upload.addEventListener('click', () => {
      pickImage((src) => {
        setSrc(src);
        commit('Replace image');
      });
      upload.blur();
    });
    box.appendChild(thumb);
    box.appendChild(row(upload, selectField({ key: key + '.fit', title: 'Fit', options: fitOptions, get: getFit, set: setFit, commitLabel: 'Image fit' })));
    box.appendChild(
      row(
        textField({
          key: key + '.url',
          placeholder: 'Paste image URL…',
          title: 'Image URL',
          get: () => {
            const s = getSrc() || '';
            return s.startsWith('data:') ? '' : s;
          },
          set: (v, final) => {
            if (!final) return;
            const s = v.trim();
            if (s || !(getSrc() || '').startsWith('data:')) setSrc(s);
          },
          commitLabel: 'Image URL',
        })
      )
    );
    const note = h('div', { class: 'f-hint ins-image__note' });
    bind(note, () => {
      const s = getSrc() || '';
      const kb = (s.length * 0.75) / 1024;
      note.textContent = s.startsWith('data:') ? `Embedded image · ${kb < 1 ? '<1' : Math.round(kb)} KB` : '';
      note.style.display = s.startsWith('data:') ? '' : 'none';
    });
    box.appendChild(note);
    return box;
  }

  function buildImage(p) {
    return section(
      'image',
      'Image',
      {},
      imageControls(
        'img',
        () => (P().image ? P().image.src : ''),
        (src) => patchSel({ image: { src } }, (n) => n.type === 'image'),
        () => (P().image ? P().image.fit : 'cover'),
        (v) => patchSel({ image: { fit: v } }, (n) => n.type === 'image'),
        [['cover', 'Cover'], ['contain', 'Contain'], ['fill', 'Stretch'], ['none', 'Original'], ['scale-down', 'Scale down']]
      )
    );
  }

  // ---------------- text ----------------
  function buildText(p) {
    const isText = (n) => n.type === 'text';
    const T = () => P().text;
    const setT = (patch) => patchSel({ text: patch }, isText);
    const body = [];

    const ta = h('textarea', { class: 'f-input ins-textarea', rows: 2, spellcheck: 'false', 'data-k': 'content', placeholder: 'Text…' });
    ta.addEventListener('input', () => setT({ content: ta.value }));
    ta.addEventListener('change', () => commit('Edit text'));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) ta.blur();
    });
    bind(ta, () => {
      ta.value = T().content;
    });
    body.push(row(ta));

    // font family
    const fonts = Folio.fonts ? Folio.fonts.list : [];
    const inList = fonts.some((f) => f.family === p.text.font);
    if (ui.customFont) {
      const inp = h('input', { class: 'f-input', type: 'text', placeholder: 'Any Google Font, e.g. Syne', spellcheck: 'false', 'data-k': 'customfont', value: inList ? '' : p.text.font });
      const apply = () => {
        const v = inp.value.trim();
        ui.customFont = false;
        if (v) {
          if (Folio.fonts) Folio.fonts.ensure(v);
          setT({ font: v });
          commit('Font');
        }
        rebuild();
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') apply();
        if (e.key === 'Escape') {
          ui.customFont = false;
          rebuild();
        }
      });
      const ok = h('button', { type: 'button', class: 'f-btn f-btn--primary' }, 'Use');
      ok.addEventListener('click', apply);
      const cancel = iconBtn('x', 'Cancel', () => {
        ui.customFont = false;
        rebuild();
      });
      body.push(row(inp, ok, cancel));
      requestAnimationFrame(() => inp.isConnected && document.activeElement !== inp && inp.focus());
    } else {
      const cats = {};
      fonts.forEach((f) => (cats[f.category] = cats[f.category] || []).push([f.family, f.family]));
      const catLabel = (c) => c.replace(/-/g, ' ').replace(/^./, (m) => m.toUpperCase());
      const opts = Object.keys(cats).map((c) => ({ group: catLabel(c), options: cats[c] }));
      if (!inList) opts.unshift({ group: 'Custom', options: [[p.text.font, p.text.font]] });
      opts.push(['__custom', 'Custom Google Font…']);
      body.push(
        row(
          selectField({
            key: 'font',
            cls: 'ins-font',
            title: 'Font family',
            options: opts,
            get: () => T().font,
            set: (v) => {
              if (v === '__custom') {
                ui.customFont = true;
                rebuild();
                return;
              }
              if (Folio.fonts) Folio.fonts.ensure(v);
              const ws = Folio.fonts ? Folio.fonts.weightsOf(v) : [400];
              selIds().forEach((id) => {
                const n = store.get(id);
                if (!isText(n)) return;
                // keep the weight if the new family has it, otherwise pick the closest
                const w = ws.includes(n.text.weight) ? n.text.weight : ws.reduce((a, b) => (Math.abs(b - n.text.weight) < Math.abs(a - n.text.weight) ? b : a), ws[0]);
                store.update(id, { text: { font: v, weight: w } });
              });
            },
            commitLabel: 'Font',
          })
        )
      );
    }

    // weight + size
    const W_NAMES = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black', 1000: 'Extra Black' };
    let weights = Folio.fonts ? Folio.fonts.weightsOf(p.text.font).slice() : [400, 700];
    if (!weights.includes(p.text.weight)) weights = weights.concat([p.text.weight]).sort((a, b) => a - b);
    body.push(
      row2(
        selectField({
          key: 'weight',
          title: 'Font weight',
          options: weights.map((w) => [w, `${W_NAMES[w] || w} · ${w}`]),
          get: () => T().weight,
          set: (v) => setT({ weight: Number(v) }),
          commitLabel: 'Font weight',
        }),
        numField({ key: 'fsize', label: () => icon('text'), title: 'Font size', get: () => T().size, set: (v) => setT({ size: v }), min: 1, precision: 1, commitLabel: 'Font size' })
      )
    );
    body.push(
      row2(
        numField({ key: 'lh', label: '↕', title: 'Line height (× font size)', get: () => T().lineHeight, set: (v) => setT({ lineHeight: v }), min: 0.5, step: 0.05, precision: 2, commitLabel: 'Line height' }),
        numField({ key: 'ls', label: '↔', title: 'Letter spacing (em)', get: () => T().letterSpacing || 0, set: (v) => setT({ letterSpacing: v }), step: 0.01, precision: 3, suffix: 'em', commitLabel: 'Letter spacing' })
      )
    );
    body.push(row(colorField({ key: 'tcolor', get: () => T().color, set: (c) => setT({ color: c }), commitLabel: 'Text colour' })));
    body.push(
      row(
        segField({
          key: 'talign',
          options: [
            { value: 'left', icon: 'align-left', title: 'Align left' },
            { value: 'center', icon: 'align-center', title: 'Align center' },
            { value: 'right', icon: 'align-right', title: 'Align right' },
            { value: 'justify', icon: 'justify', title: 'Justify' },
          ],
          get: () => T().align || 'left',
          set: (v) => setT({ align: v }),
          commitLabel: 'Text align',
        }),
        toggleBtn({ icon: 'italic', title: 'Italic', get: () => !!T().italic, set: (v) => setT({ italic: v }), commitLabel: 'Italic' })
      )
    );
    body.push(
      row2(
        selectField({
          key: 'ttransform',
          title: 'Text transform (case)',
          options: [['none', 'Aa  As typed'], ['uppercase', 'AA  Uppercase'], ['lowercase', 'aa  Lowercase'], ['capitalize', 'Aa  Capitalize']],
          get: () => T().transform || 'none',
          set: (v) => setT({ transform: v }),
          commitLabel: 'Text case',
        }),
        selectField({
          key: 'tdeco',
          title: 'Decoration',
          options: [['none', 'No decoration'], ['underline', 'Underline'], ['line-through', 'Strikethrough'], ['overline', 'Overline']],
          get: () => T().decoration || 'none',
          set: (v) => setT({ decoration: v }),
          commitLabel: 'Text decoration',
        })
      )
    );
    return section('text', 'Text', {}, ...body);
  }

  // ---------------- border ----------------
  function buildBorder(p) {
    const B = () => P().style.border || { width: 0, color: '#000000', style: 'solid' };
    const setB = (patch) => patchSel({ style: { border: patch } });
    return section(
      'border',
      'Border',
      {},
      row2(
        numField({ key: 'bw', label: 'W', title: 'Border width', get: () => B().width || 0, set: (v) => setB({ width: v }), min: 0, precision: 1, commitLabel: 'Border width' }),
        selectField({
          key: 'bstyle',
          title: 'Border style',
          options: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['double', 'Double']],
          get: () => B().style || 'solid',
          set: (v) => setB({ style: v }),
          commitLabel: 'Border style',
        })
      ),
      row(
        colorField({
          key: 'bcolor',
          get: () => B().color,
          set: (c) => {
            // picking a colour on a 0-width border implies you want to see it
            patchSel((n) => ({ style: { border: { color: c, width: (n.style.border && n.style.border.width) || 1 } } }));
          },
          commitLabel: 'Border colour',
        })
      )
    );
  }

  // ---------------- shadows ----------------
  function buildShadows(p) {
    const shadows = p.style.shadows || [];
    const S = (j) => (P().style.shadows || [])[j] || {};
    const setS = (j, patch) =>
      listOp('shadows', (arr) => {
        if (!arr[j]) return false;
        Object.assign(arr[j], patch);
      });
    const add = iconBtn('plus', 'Add shadow', () => {
      listOp('shadows', (arr) => {
        arr.push(arr.length ? { x: 0, y: 24, blur: 48, spread: -12, color: '#00000033', inset: false, visible: true } : { x: 0, y: 4, blur: 16, spread: 0, color: '#00000026', inset: false, visible: true });
      });
      commit('Add shadow');
    });
    const body = shadows.map((s, j) => {
      const key = 'sh' + j;
      const item = h(
        'div',
        { class: 'ins-shadow' + (s.visible === false ? ' is-hidden' : '') },
        h(
          'div',
          { class: 'f-row ins-quad' },
          numField({ key: key + '.x', label: 'X', title: 'Offset X', get: () => S(j).x || 0, set: (v) => setS(j, { x: v }), commitLabel: 'Shadow' }),
          numField({ key: key + '.y', label: 'Y', title: 'Offset Y', get: () => S(j).y || 0, set: (v) => setS(j, { y: v }), commitLabel: 'Shadow' }),
          numField({ key: key + '.b', label: 'B', title: 'Blur', get: () => S(j).blur || 0, set: (v) => setS(j, { blur: v }), min: 0, commitLabel: 'Shadow' }),
          numField({ key: key + '.s', label: 'S', title: p.type === 'text' ? 'Spread (not supported by text-shadow)' : 'Spread', get: () => S(j).spread || 0, set: (v) => setS(j, { spread: v }), commitLabel: 'Shadow' })
        ),
        h(
          'div',
          { class: 'f-row' },
          colorField({ key: key + '.c', get: () => S(j).color || '#00000040', set: (c) => setS(j, { color: c }), commitLabel: 'Shadow colour', compact: true }),
          p.type === 'text' ? null : toggleBtn({ label: 'Inset', title: 'Inner shadow', get: () => !!S(j).inset, set: (v) => setS(j, { inset: v }), commitLabel: 'Inset shadow', cls: 'ins-inset' }),
          (() => {
            const eye = h('button', { type: 'button', class: 'f-btn f-btn--ghost f-btn--icon ins-ibtn', title: 'Show / hide shadow' });
            eye.addEventListener('click', () => {
              const vis = S(j).visible !== false;
              setS(j, { visible: !vis });
              commit('Toggle shadow');
              eye.blur();
            });
            bind(eye, () => {
              const vis = S(j).visible !== false;
              eye.replaceChildren(icon(vis ? 'eye' : 'eye-off'));
              const it = eye.closest('.ins-shadow');
              if (it) it.classList.toggle('is-hidden', !vis);
            });
            return eye;
          })(),
          iconBtn('minus', 'Remove shadow', () => {
            listOp('shadows', (arr) => {
              if (!arr[j]) return false;
              arr.splice(j, 1);
            });
            commit('Remove shadow');
          })
        )
      );
      return item;
    });
    return section('shadows', p.type === 'text' ? 'Text shadow' : 'Shadows', { actions: [add], empty: !shadows.length }, ...body);
  }

  // ---------------- effects ----------------
  function buildEffects(p) {
    const A = (k, d) => {
      const a = P().style.adjust;
      return a && a[k] != null ? a[k] : d;
    };
    const setA = (k) => (v) => patchSel({ style: { adjust: { [k]: v } } });
    const reset = iconBtn('undo', 'Reset adjustments', () => {
      patchSel((n) => ({ style: { adjust: { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, hue: 0 } } }));
      commit('Reset adjustments');
    });
    return section(
      'effects',
      'Effects',
      { collapsed: true },
      propRow('Blur', numField({ key: 'blur', title: 'Layer blur (filter: blur)', get: () => P().style.blur || 0, set: (v) => patchSel({ style: { blur: v } }), min: 0, precision: 1, suffix: 'px', commitLabel: 'Blur' })),
      propRow('Backdrop blur', numField({ key: 'bblur', title: 'Backdrop blur (frosted glass)', get: () => P().style.backdropBlur || 0, set: (v) => patchSel({ style: { backdropBlur: v } }), min: 0, precision: 1, suffix: 'px', commitLabel: 'Backdrop blur' })),
      h('div', { class: 'f-row ins-subhead' }, h('span', { class: 'f-label' }, 'Adjustments'), h('span', { class: 'ins-grow' }), reset),
      propRow('Brightness', numField({ key: 'adj.b', title: 'Brightness', get: () => A('brightness', 100), set: setA('brightness'), min: 0, max: 300, suffix: '%', commitLabel: 'Brightness' })),
      propRow('Contrast', numField({ key: 'adj.c', title: 'Contrast', get: () => A('contrast', 100), set: setA('contrast'), min: 0, max: 300, suffix: '%', commitLabel: 'Contrast' })),
      propRow('Saturation', numField({ key: 'adj.s', title: 'Saturation', get: () => A('saturate', 100), set: setA('saturate'), min: 0, max: 300, suffix: '%', commitLabel: 'Saturation' })),
      propRow('Grayscale', numField({ key: 'adj.g', title: 'Grayscale', get: () => A('grayscale', 0), set: setA('grayscale'), min: 0, max: 100, suffix: '%', commitLabel: 'Grayscale' })),
      propRow('Hue rotate', numField({ key: 'adj.h', title: 'Hue rotate', get: () => A('hue', 0), set: setA('hue'), min: -360, max: 360, suffix: '°', commitLabel: 'Hue' }))
    );
  }

  // ---------------- CSS view ----------------
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const slug = (s) =>
    String(s || 'layer')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'layer';

  function cssFor(n) {
    const styles = Folio.css.nodeStyles(n, { mode: 'export' });
    return `.${slug(n.name)} {\n${Folio.css.toCssBlock(styles)}\n}`;
  }

  function shortenUrls(v) {
    return v.replace(/url\("(data:[^;,]+)[^"]*"\)/g, (m, head) => `url("${head}…")`).replace(/url\("([^"]{60})[^"]+"\)/g, 'url("$1…")');
  }

  function highlightValue(v) {
    // tokenise: urls, colours, numbers with units, keywords
    let out = '';
    const re = /(url\("[^"]*"\))|(#[0-9a-fA-F]{3,8}\b)|(rgba?\([^)]*\))|(-?\d*\.?\d+)(px|%|deg|em|s)?|([a-zA-Z-]+(?=\())|([^#\d(u-]+|.)/g;
    let m;
    while ((m = re.exec(v))) {
      if (m[1]) out += `<span class="tk-url">${esc(m[1])}</span>`;
      else if (m[2] || m[3]) {
        const c = m[2] || m[3];
        out += `<span class="tk-swatch" style="background:${esc(c)}"></span><span class="tk-color">${esc(c)}</span>`;
      } else if (m[4] != null) out += `<span class="tk-num">${esc(m[4])}${m[5] ? `<span class="tk-unit">${m[5]}</span>` : ''}</span>`;
      else if (m[6]) out += `<span class="tk-fn">${esc(m[6])}</span>`;
      else out += esc(m[7]);
    }
    return out;
  }

  function highlightCss(text) {
    return text
      .split('\n')
      .map((line) => {
        const m = line.match(/^(\s*)([-\w]+)(:\s*)(.*?)(;)$/);
        if (m) return `${m[1]}<span class="tk-prop">${m[2]}</span><span class="tk-punc">${m[3]}</span>${highlightValue(shortenUrls(m[4]))}<span class="tk-punc">;</span>`;
        if (/\{$/.test(line)) return `<span class="tk-sel">${esc(line.slice(0, -1))}</span><span class="tk-punc">{</span>`;
        return `<span class="tk-punc">${esc(line)}</span>`;
      })
      .join('\n');
  }

  function buildCss(p) {
    const pre = h('pre', { class: 'ins-code' });
    let last = '';
    bind(pre, () => {
      const n = P();
      if (!n) return;
      const txt = cssFor(n);
      if (txt === last) return;
      last = txt;
      pre.innerHTML = highlightCss(txt);
    });
    const copy = h('button', { type: 'button', class: 'f-btn f-btn--ghost ins-copy', title: 'Copy CSS' }, icon('copy'), h('span', {}, 'Copy'));
    copy.addEventListener('click', () => {
      const txt = cssFor(P());
      const done = () => {
        Folio.ui.toast('CSS copied to clipboard', 'success');
        copy.querySelector('span').textContent = 'Copied';
        setTimeout(() => copy.isConnected && (copy.querySelector('span').textContent = 'Copy'), 1200);
      };
      const fallback = () => {
        const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          done();
        } catch (e) {
          Folio.ui.toast('Copy failed', 'error');
        }
        ta.remove();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback);
      else fallback();
      copy.blur();
    });
    const codeBtn = Folio.codePanel
      ? iconBtn('code', 'Open code panel (HTML + CSS)', () => store.emit('code:toggle', true))
      : null;
    return section(
      'css',
      'CSS',
      { actions: [copy, codeBtn] },
      pre,
      h('div', { class: 'f-hint ins-code__hint' }, 'The exact CSS this layer renders with. Edit anything above and watch it change.')
    );
  }

  // ------------------------------------------------------------------
  // Build / update
  // ------------------------------------------------------------------
  function structureKey() {
    const ids = selIds();
    const uiKey = [ui.expandedFill, ui.padSides, ui.customFont, ui.meshPresets].join('|');
    if (!ids.length) return 'none|' + uiKey;
    const p = store.get(ids[ids.length - 1]);
    const parent = store.getParent(p.id);
    const st = p.style || {};
    const parts = [
      ids.join(','),
      p.type,
      parent ? parent.id + ':' + (parent.layout && parent.layout.mode) : 'root',
      p.layout ? p.layout.mode : '',
      (st.fills || []).map((f) => f.type + ':' + (f.stops ? f.stops.length : '') + ':' + (f.points ? f.points.length : '') + ':' + (f.type === 'image' ? !!f.src : '')).join(','),
      (st.shadows || []).length,
      Array.isArray(st.radius),
      p.text ? p.text.font + ':' + p.text.weight : '',
      uiKey,
    ];
    return parts.join('|');
  }

  function rebuild() {
    if (!root) return;
    const panel = root.parentElement;
    const scroll = panel ? panel.scrollTop : 0;
    const ae = document.activeElement;
    const focusKey = ae && root.contains(ae) && ae.dataset ? ae.dataset.k : null;
    let selStart = null;
    let selEnd = null;
    if (focusKey) {
      try {
        selStart = ae.selectionStart;
        selEnd = ae.selectionEnd;
      } catch (e) {}
    }

    // reset per-selection UI state when the selection changes
    const sk = selIds().join(',');
    if (sk !== ui.selKey) {
      ui.selKey = sk;
      ui.customFont = false;
      const p = P();
      if (!p || !ui.expandedFill || !ui.expandedFill.startsWith(p.id + ':')) ui.expandedFill = null;
    }

    bindings = [];
    const frag = document.createDocumentFragment();
    const ids = selIds();
    if (!ids.length) {
      buildEmpty().forEach((s) => frag.appendChild(s));
      root.dataset.mode = 'empty';
    } else {
      const p = store.get(ids[ids.length - 1]);
      root.dataset.mode = p.type;
      frag.appendChild(buildHeader(p, ids.length));
      frag.appendChild(buildPosition(p));
      frag.appendChild(buildSize(p));
      if (p.type === 'frame') frag.appendChild(buildAutoLayout(p));
      if (p.type === 'text') frag.appendChild(buildText(p));
      if (p.type === 'image') frag.appendChild(buildImage(p));
      frag.appendChild(buildAppearance(p));
      frag.appendChild(buildFills(p));
      frag.appendChild(buildBorder(p));
      frag.appendChild(buildShadows(p));
      frag.appendChild(buildEffects(p));
      frag.appendChild(buildCss(p));
    }
    root.replaceChildren(frag);
    lastKey = structureKey();
    if (panel) panel.scrollTop = scroll;

    if (focusKey) {
      const el = root.querySelector(`[data-k="${CSS.escape(focusKey)}"]`);
      if (el) {
        restoringFocus = true;
        el.focus({ preventScroll: true });
        restoringFocus = false;
        try {
          if (selStart != null) el.setSelectionRange(selStart, selEnd);
        } catch (e) {}
      }
    }
  }

  function updateBindings() {
    const ae = document.activeElement;
    bindings.forEach((b) => {
      if (b.el === ae) return; // never touch the field the user is typing in
      try {
        b.update();
      } catch (e) {
        console.error('[Folio inspector] binding error', e);
      }
    });
  }

  function run() {
    rafId = 0;
    if (!root) return;
    if (structureKey() !== lastKey) rebuild();
    else updateBindings();
  }

  function schedule() {
    if (!rafId) rafId = requestAnimationFrame(run);
  }

  function init() {
    root = document.getElementById('inspector');
    if (!root) return;
    root.classList.add('ins');
    ['change', 'selection', 'doc', 'history'].forEach((e) => store.on(e, schedule));
    rebuild();
  }

  function refresh() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    rebuild();
  }

  Folio.inspector = { init, refresh, util: { parseColor, evalNum, splitColor, joinColor }, meshPresets: MESH_PRESETS };
})();
