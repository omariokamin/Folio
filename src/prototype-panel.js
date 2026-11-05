/*
 * prototype-panel.js — the Prototype tab of the right panel, and the prototype arrows on the canvas
 * (SPEC "Prototyping (v0.11)" → Editor).
 *
 *   Folio.prototypePanel.init()      create #prototype-panel in #right-panel and the arrow layer in #canvas-overlay
 *   Folio.prototypePanel.refresh()   rebuild now (ai.js setTab calls it whenever the tab changes)
 *   Folio.prototypePanel.isOpen()    true while the Prototype tab is showing
 *   Folio.prototypePanel.draw(sbox)  overlay.js calls it on every overlay update with its screen-box lookup
 *
 * Every edit: Folio.prototype.normalize → store.update → one store.commit(label).
 */
window.Folio = window.Folio || {};

(function () {
  const store = Folio.store;
  const h = (...a) => Folio.ui.h(...a);
  const icon = (name) => Folio.icons.el(name);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const PR = () => Folio.prototype || {};
  const NS = 'http://www.w3.org/2000/svg';

  const ACTIONS = [
    ['navigate', 'Navigate to'],
    ['back', 'Back'],
    ['url', 'Open link'],
    ['overlay', 'Open overlay'],
    ['close', 'Close overlay'],
  ];
  const TRANSITIONS = [
    ['instant', 'Instant'],
    ['dissolve', 'Dissolve'],
    ['slide', 'Slide'],
  ];
  const DIRECTIONS = [
    ['left', 180, 'Slide left'],
    ['right', 0, 'Slide right'],
    ['up', -90, 'Slide up'],
    ['down', 90, 'Slide down'],
  ];
  const POSITIONS = [
    ['center', 'Center'],
    ['top', 'Top'],
    ['bottom', 'Bottom'],
    ['left', 'Left'],
    ['right', 'Right'],
  ];
  const SCROLLS = [
    ['none', 'None'],
    ['vertical', 'Vertical'],
    ['horizontal', 'Horizontal'],
    ['both', 'Both'],
  ];
  const PLAY_SVG = '<svg class="f-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
  const hasTarget = (a) => a === 'navigate' || a === 'overlay';

  let root = null; // #prototype-panel
  let raf = 0;
  let deferred = false; // a rebuild skipped while typing; runs on focusout

  // ------------------------------------------------------------------
  // Document helpers
  // ------------------------------------------------------------------
  const screens = () => store.doc.roots.filter((id) => store.get(id));
  const nameOf = (id) => (store.get(id) && store.get(id).name) || 'Untitled';
  const isOpen = () => !!root && !root.hidden;

  /** The page's start screen: page.start when it is still an artboard here, else the first artboard. */
  function startId() {
    if (PR().startOf) return PR().startOf();
    const pg = store.currentPage();
    const r = screens();
    return pg && r.includes(pg.start) ? pg.start : r[0] || null;
  }

  function setStart(id) {
    const pg = store.currentPage();
    // shortcut: state.js has no page.start helper; mutate + emit like its own page operations, upgrade when one exists
    if (id) pg.start = id;
    else delete pg.start;
    store.emit('change');
    store.commit('Start screen');
  }

  /** Screens an interaction of `id` may point at; navigate skips the layer's own screen. */
  function targetsFor(id, action) {
    const own = store.rootOf(id);
    return screens().filter((r) => action === 'overlay' || r !== own);
  }
  /** The next screen after the layer's own (or the first valid one). */
  function defaultTarget(id, action) {
    const all = screens();
    const at = all.indexOf(store.rootOf(id));
    const c = targetsFor(id, action);
    return c.find((r) => all.indexOf(r) > at) || c[0] || null;
  }

  function save(id, list, label) {
    const res = PR().normalize ? PR().normalize(id, list) : { interactions: list, warnings: [] };
    // an instance root without the key would re-inherit the main's interactions, so it keeps an explicit []
    const empty = store.get(id).instance ? [] : undefined;
    store.update(id, { interactions: res.interactions.length ? res.interactions : empty });
    store.commit(label);
    if (res.warnings.length) Folio.ui.toast(res.warnings[0], 'error');
  }

  /** Change interaction i of node id through fn(item); fn returning false cancels. */
  function edit(id, i, fn, label) {
    const n = store.get(id);
    if (!n || !n.interactions || !n.interactions[i]) return;
    const list = clone(n.interactions);
    if (fn(list[i]) === false) return;
    save(id, list, label);
  }

  function addInteraction(id) {
    const n = store.get(id);
    if (!n) return;
    const list = clone(n.interactions || []);
    const t = defaultTarget(id, 'navigate');
    list.push(t ? { trigger: 'click', action: 'navigate', target: t } : { trigger: 'click', action: 'back' });
    save(id, list, 'Add interaction');
  }

  function changeAction(id, it, action) {
    if (hasTarget(action) && !targetsFor(id, action).includes(it.target)) {
      const t = defaultTarget(id, action);
      if (!t) {
        Folio.ui.toast('Add another artboard to this page first, then you can point to it.', 'error');
        return false;
      }
      it.target = t;
    }
    it.action = action;
    if (!hasTarget(action)) delete it.target, delete it.transition;
    if (action !== 'overlay') delete it.overlay;
    if (action === 'url') it.url = it.url || 'https://example.com';
    else delete it.url;
  }

  /** Short description used by the flow summary. */
  function describe(it) {
    const missing = hasTarget(it.action) && !screens().includes(it.target);
    const t = missing ? 'Missing screen' : nameOf(it.target);
    if (it.action === 'navigate') return { text: '→ ' + t, missing };
    if (it.action === 'overlay') return { text: 'Overlay: ' + t, missing };
    if (it.action === 'back') return { text: '← Back' };
    if (it.action === 'close') return { text: 'Close overlay' };
    if (it.action === 'url') return { text: 'Link: ' + String(it.url || '').replace(/^https?:\/\/(www\.)?/, '') };
    return { text: it.action };
  }

  // ------------------------------------------------------------------
  // Small UI builders (markup mirrors the inspector so .ins styles apply)
  // ------------------------------------------------------------------
  const row = (...c) => h('div', { class: 'f-row' }, ...c);
  const hint = (text) => h('div', { class: 'f-hint pp-hint' }, text);
  const label = (text, forId) => h(forId ? 'label' : 'span', { class: 'f-label pp-label', for: forId || null }, text);
  const svgEl = (markup) => {
    const t = document.createElement('template');
    t.innerHTML = markup;
    return t.content.firstChild;
  };

  function section(title, ...body) {
    return h(
      'section',
      { class: 'f-section ins-sec pp-sec' },
      h('div', { class: 'f-section__head ins-sec__head' }, h('h2', { class: 'pp-sec__title' }, title)),
      h('div', { class: 'ins-sec__body' }, ...body)
    );
  }

  let uid = 0;
  function select(key, aria, options, value, onChange) {
    const el = h('select', { class: 'f-select', 'data-k': key, 'aria-label': aria, id: 'pp-' + ++uid });
    options.forEach(([v, l]) => el.appendChild(h('option', { value: v }, l)));
    el.value = value == null ? '' : value;
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }

  /** Segmented control; buttons are toggle buttons (aria-pressed). */
  function seg(key, aria, options, value, onPick) {
    const wrap = h('div', { class: 'f-seg ins-seg pp-seg', role: 'group', 'aria-label': aria });
    options.forEach(([v, l, extra]) => {
      const b = h('button', { type: 'button', 'data-k': key + ':' + v, 'aria-pressed': String(v === value), class: v === value ? 'is-active' : '' }, l);
      if (extra) b.title = extra;
      b.addEventListener('click', () => v !== value && onPick(v));
      wrap.appendChild(b);
    });
    return wrap;
  }

  function checkbox(key, text, checked, onToggle, disabled) {
    const input = h('input', { type: 'checkbox', class: 'pp-check__box', 'data-k': key, checked: !!checked, disabled: !!disabled });
    input.addEventListener('change', () => onToggle(input.checked));
    return h('label', { class: 'pp-check' + (disabled ? ' is-disabled' : '') }, input, h('span', {}, text));
  }

  /** Text field that applies on Enter / blur and reverts on Esc. apply(value) returns false to reject. */
  function field(key, aria, value, placeholder, apply, cls) {
    const input = h('input', { type: 'text', class: 'f-input' + (cls ? ' ' + cls : ''), 'data-k': key, 'aria-label': aria, placeholder, spellcheck: 'false', autocomplete: 'off' });
    input.value = value == null ? '' : String(value);
    const shown = input.value;
    input.addEventListener('change', () => {
      if (input.value.trim() === shown) return;
      if (apply(input.value.trim()) === false) input.value = shown;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.stopPropagation(); // once blurred, the window shortcuts would treat Enter / Esc as canvas keys
      if (e.key === 'Escape') input.value = shown;
      input.blur();
    });
    return input;
  }

  // ------------------------------------------------------------------
  // Panel: one layer selected
  // ------------------------------------------------------------------
  function header(n) {
    const isScreen = store.isRoot(n.id);
    const ic = n.type === 'text' ? 'text' : n.type === 'image' ? 'image' : isScreen ? 'frame' : 'rect';
    return h(
      'div',
      { class: 'f-section ins-header pp-header' },
      h('div', { class: 'ins-header__icon' }, icon(ic)),
      h('div', { class: 'pp-header__name', title: n.name }, n.name || 'Untitled'),
      isScreen ? h('span', { class: 'ins-header__count' }, 'Screen') : null
    );
  }

  function itemCard(id, it, i) {
    const k = (s) => i + ':' + s;
    const set = (lbl, fn) => edit(id, i, fn, lbl);
    const card = h('div', { class: 'ins-editor pp-item', role: 'group', 'aria-label': 'Interaction ' + (i + 1) });

    const rm = h('button', { type: 'button', class: 'f-btn f-btn--icon f-btn--ghost ins-ibtn f-btn--danger pp-item__rm', 'data-k': k('rm'), title: 'Remove interaction', 'aria-label': 'Remove interaction ' + (i + 1) }, icon('minus'));
    rm.addEventListener('click', () => {
      const list = clone(store.get(id).interactions || []);
      list.splice(i, 1);
      save(id, list, 'Remove interaction');
    });
    card.append(h('div', { class: 'pp-item__head' }, h('span', { class: 'pp-item__on' }, 'On click'), rm));

    const action = select(k('action'), 'Action', ACTIONS, it.action, (v) => set('Interaction action', (x) => changeAction(id, x, v)));
    const top = row(action);
    if (hasTarget(it.action)) {
      const opts = targetsFor(id, it.action).map((r) => [r, nameOf(r)]);
      const missing = !screens().includes(it.target);
      if (missing) opts.unshift([it.target || '', 'Missing screen']);
      const tsel = select(k('target'), it.action === 'overlay' ? 'Overlay screen' : 'Destination screen', opts, it.target, (v) => set('Interaction target', (x) => void (x.target = v)));
      if (missing) tsel.classList.add('is-missing');
      top.classList.add('ins-row2');
      top.append(tsel);
    }
    card.append(top);

    if (it.action === 'url') {
      card.append(
        row(
          field(k('url'), 'Link address', it.url, 'https://…', (v) => {
            if (v && !/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v;
            if (PR().safeUrl && !PR().safeUrl(v)) {
              Folio.ui.toast('Use a web link (https://…), mailto: or tel:', 'error');
              return false;
            }
            set('Link', (x) => void (x.url = v));
          }, 'pp-url')
        )
      );
    }

    if (hasTarget(it.action)) {
      const tr = it.transition || {};
      const type = tr.type || 'instant';
      card.append(row(label('Animation'), seg(k('tr'), 'Animation', TRANSITIONS, type, (v) => set('Animation', (x) => void (x.transition = { ...(x.transition || {}), type: v })))));
      if (type === 'slide') {
        const dirs = DIRECTIONS.map(([v, deg, title]) => {
          const ic = icon('arrow-right');
          ic.style.transform = `rotate(${deg}deg)`;
          return [v, ic, title];
        });
        const dseg = seg(k('dir'), 'Slide direction', dirs, tr.direction || 'left', (v) => set('Slide direction', (x) => void (x.transition = { ...(x.transition || {}), direction: v })));
        dseg.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-label', DIRECTIONS[j][2]));
        card.append(row(label('Direction'), dseg));
      }
      if (type !== 'instant') {
        const dur = field(k('dur'), 'Duration in milliseconds', tr.duration == null ? 300 : tr.duration, '300', (v) => {
          const ms = parseFloat(v);
          if (!isFinite(ms)) return false;
          set('Animation duration', (x) => void (x.transition = { ...(x.transition || {}), duration: ms }));
        });
        dur.inputMode = 'numeric';
        card.append(row(label('Duration'), h('div', { class: 'f-num ins-num ins-num--nolabel ins-num--suffix pp-dur' }, dur, h('i', { class: 'ins-suffix' }, 'ms'))));
      }
    }

    if (it.action === 'overlay') {
      const o = it.overlay || {};
      const pos = select(k('pos'), 'Overlay position', POSITIONS, o.position || 'center', (v) => set('Overlay position', (x) => void (x.overlay = { ...(x.overlay || {}), position: v })));
      card.append(row(label('Position', pos.id), pos));
      card.append(
        row(checkbox(k('outside'), 'Close when clicking outside', o.closeOnOutside !== false, (on) => set('Overlay close on outside click', (x) => void (x.overlay = { ...(x.overlay || {}), closeOnOutside: on }))))
      );
    }
    return card;
  }

  function buildLayer(n) {
    const out = [header(n)];
    const KP = Folio.componentsPanel;
    if (KP && KP.inInstance && KP.inInstance(n.id)) {
      out.push(section('Interactions', hint('This layer is part of an instance and follows its main component. Select the instance itself to give it its own interactions, or edit the main component.')));
      return out;
    }
    const list = n.interactions || [];
    const add = h('button', { type: 'button', class: 'f-btn pp-add', 'data-k': 'add' }, icon('plus'), 'Add interaction');
    add.addEventListener('click', () => addInteraction(n.id));
    out.push(
      section(
        'Interactions',
        ...(list.length ? list.map((it, i) => itemCard(n.id, it, i)) : [hint('Make this layer clickable in Play. Add an interaction, or drag the round handle on its right edge onto another screen.')]),
        add
      )
    );

    if (n.type === 'frame') {
      out.push(
        section(
          'Scroll',
          row(seg('scroll', 'Scroll direction', SCROLLS, n.scroll || 'none', (v) => {
            store.update(n.id, { scroll: v === 'none' ? undefined : v });
            store.commit('Scroll');
          })),
          hint('In Play, this frame scrolls when its content is bigger than the frame.')
        )
      );
    }

    if (store.isRoot(n.id)) {
      const isStart = startId() === n.id;
      const explicit = store.currentPage().start === n.id;
      out.push(
        section(
          'Start screen',
          row(checkbox('start', 'Start screen', isStart, (on) => setStart(on ? n.id : null), isStart && !explicit)),
          hint(isStart ? (explicit ? 'Play begins on this screen.' : 'Play begins here because it is the first artboard on this page.') : 'Play begins on the start screen of this page.')
        )
      );
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Panel: nothing selected → page overview
  // ------------------------------------------------------------------
  function buildPage() {
    const r = screens();
    const s = startId();
    const fmt = Folio.keys && Folio.keys.fmt ? Folio.keys.fmt : null;
    const play = h(
      'button',
      { type: 'button', class: 'f-btn f-btn--primary pp-play', 'data-k': 'play', disabled: !r.length || !PR().play, title: 'Play' + (fmt ? ` (${fmt('mod+alt+enter')})` : '') },
      svgEl(PLAY_SVG),
      'Play'
    );
    play.addEventListener('click', () => PR().play && PR().play(s));

    const top = r.length
      ? [row(Object.assign(label('Start screen', 'pp-start'), { className: 'f-label pp-label pp-label--wide' }), Object.assign(select('start', 'Start screen', r.map((id) => [id, nameOf(id)]), s, (v) => setStart(v)), { id: 'pp-start' })), row(play)]
      : [hint('Add an artboard to this page to start a prototype.'), row(play)];

    // flow summary: per screen, the layers that do something on click
    let count = 0;
    const groups = r
      .map((rid) => {
        const rows = [];
        [rid, ...store.descendants(rid)].forEach((id) => {
          const n = store.get(id);
          (n && n.interactions ? n.interactions : []).forEach((it) => {
            count++;
            const d = describe(it);
            const b = h(
              'button',
              { type: 'button', class: 'pp-flow__row', title: 'Select ' + (n.name || 'layer') },
              h('span', { class: 'pp-flow__src' }, id === rid ? 'Whole screen' : n.name || 'Untitled'),
              h('span', { class: 'pp-flow__dst' + (d.missing ? ' is-missing' : '') }, d.text)
            );
            b.addEventListener('click', () => store.select([id]));
            rows.push(b);
          });
        });
        if (!rows.length) return null;
        return h(
          'div',
          { class: 'pp-flow__group' },
          h('div', { class: 'pp-flow__screen' }, h('span', {}, nameOf(rid)), rid === s ? h('span', { class: 'pp-badge' }, 'Start') : null),
          ...rows
        );
      })
      .filter(Boolean);

    return [
      section('Prototype', ...top),
      section(
        'Flow',
        groups.length
          ? h('div', { class: 'f-hint pp-flow__count' }, `${r.length} screen${r.length === 1 ? '' : 's'} · ${count} interaction${count === 1 ? '' : 's'}`)
          : hint('No interactions yet. Select a layer, then add an interaction or drag its round handle onto another screen.'),
        ...groups
      ),
    ];
  }

  // ------------------------------------------------------------------
  // Build / schedule
  // ------------------------------------------------------------------
  function typingHere() {
    const a = document.activeElement;
    return !!a && root.contains(a) && a.tagName === 'INPUT' && a.type === 'text';
  }

  function build() {
    if (!root) return;
    const a = document.activeElement;
    const focusKey = a && root.contains(a) && a.dataset ? a.dataset.k : null;
    const panel = root.parentElement;
    const scroll = panel ? panel.scrollTop : 0;
    const ids = store.selection.filter((id) => store.get(id));
    let parts;
    if (!ids.length) parts = buildPage();
    else if (ids.length > 1) parts = [section(`${ids.length} layers selected`, hint('Select a single layer to add interactions to it.'))];
    else parts = buildLayer(store.get(ids[0]));
    root.replaceChildren(...parts);
    if (panel) panel.scrollTop = scroll;
    if (focusKey) {
      const el = root.querySelector(`[data-k="${CSS.escape(focusKey)}"]`);
      if (el) el.focus({ preventScroll: true });
    }
  }

  function run() {
    raf = 0;
    deferred = isOpen() && typingHere();
    if (isOpen() && !deferred) build();
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(run);
  }

  function refresh() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (isOpen()) build();
    if (!isOpen() && drag) finishDrag(false);
    if (Folio.overlay && Folio.overlay.schedule) Folio.overlay.schedule();
  }

  // ------------------------------------------------------------------
  // Canvas: arrows, start flag, connect handle (screen coordinates in #canvas-overlay)
  // ------------------------------------------------------------------
  let layer = null; // { svg, flag, handle }
  let drag = null; // { id, x, y, target }
  const f1 = (v) => Math.round(v * 10) / 10;

  function mount() {
    const ov = document.getElementById('canvas-overlay');
    if (!ov || layer) return;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'pp-arrows');
    svg.setAttribute('aria-hidden', 'true');
    const flag = h('div', { class: 'pp-flag' }, svgEl(PLAY_SVG), 'Start');
    const handle = h('div', { class: 'pp-handle', title: 'Drag onto a screen to connect' });
    handle.addEventListener('pointerdown', startDrag);
    handle.addEventListener('pointermove', moveDrag);
    handle.addEventListener('pointerup', () => finishDrag(true));
    handle.addEventListener('pointercancel', () => finishDrag(false));
    handle.addEventListener('lostpointercapture', () => finishDrag(false));
    ov.append(svg, flag, handle);
    layer = { svg, flag, handle };
  }

  /** Cubic arrow from (sx,sy) into (ex,ey) from the left, with a dot at the start and a head at the end.
   *  Arrows that go back to the left arc over the screens instead of cutting straight across them. */
  function curve(sx, sy, ex, ey, cls) {
    const back = ex < sx + 40;
    const dx = back ? 60 : Math.max(40, (ex - sx) / 2);
    const lift = back ? Math.min(160, 40 + (sx - ex) * 0.2) : 0;
    const c1x = sx + dx;
    const c1y = sy - lift;
    const c2x = ex - dx;
    const c2y = ey - lift;
    const ang = Math.atan2(ey - c2y, ex - c2x);
    const tx = ex - 7 * Math.cos(ang);
    const ty = ey - 7 * Math.sin(ang);
    return (
      `<g class="${cls}"><circle cx="${f1(sx)}" cy="${f1(sy)}" r="3"/>` +
      `<path class="pp-line" d="M${f1(sx)} ${f1(sy)}C${f1(c1x)} ${f1(c1y)} ${f1(c2x)} ${f1(c2y)} ${f1(tx)} ${f1(ty)}"/>` +
      `<path class="pp-tip" d="M${f1(ex)} ${f1(ey)}l-8 -4.5v9z" transform="rotate(${f1((ang * 180) / Math.PI)} ${f1(ex)} ${f1(ey)})"/></g>`
    );
  }
  /** Where an arrow meets a screen: its left edge, level with the source when possible. */
  function entry(t, sy) {
    const m = Math.min(24, t.height / 2);
    return { x: t.x, y: Math.max(t.y + m, Math.min(t.y + t.height - m, sy)) };
  }

  function draw(sbox) {
    if (!layer) mount();
    if (!layer) return;
    const { svg, flag, handle } = layer;
    const on = isOpen();
    svg.style.display = on ? '' : 'none';
    flag.style.display = 'none';
    handle.style.display = 'none';
    if (!on) return;

    const box = (id) => {
      const b = sbox(id);
      return b ? b.aabb : null;
    };
    const rootSet = new Set(screens().filter((id) => store.get(id).visible !== false));
    const sel = store.selection.filter((id) => store.get(id));
    const hot = (id) => sel.some((s) => s === id || store.isAncestor(s, id));
    const faint = [];
    const bright = [];

    for (const id in store.doc.nodes) {
      const n = store.doc.nodes[id];
      if (!n.interactions || !n.interactions.length || !rootSet.has(store.rootOf(id))) continue;
      let a;
      for (const it of n.interactions) {
        if (!hasTarget(it.action) || !rootSet.has(it.target)) continue;
        if (a === undefined) a = box(id);
        if (!a) break; // hidden layer
        const t = box(it.target);
        if (!t) continue;
        const isHot = sel.length && hot(id);
        const cls = 'pp-arrow' + (it.action === 'overlay' ? ' is-overlay' : '') + (sel.length ? (isHot ? ' is-hot' : ' is-faint') : '');
        const sx = a.x + a.width;
        const sy = a.y + a.height / 2;
        const e = entry(t, sy);
        (isHot ? bright : faint).push(curve(sx, sy, e.x, e.y, cls));
      }
    }

    let live = '';
    if (drag) {
      const a = box(drag.id);
      const t = drag.target && box(drag.target);
      if (t) live += `<rect class="pp-drop" x="${f1(t.x)}" y="${f1(t.y)}" width="${f1(t.width)}" height="${f1(t.height)}"/>`;
      if (a) {
        const sx = a.x + a.width;
        const sy = a.y + a.height / 2;
        const e = t ? entry(t, sy) : { x: drag.x, y: drag.y };
        live += curve(sx, sy, e.x, e.y, 'pp-arrow is-hot is-live');
      }
    }
    svg.innerHTML = faint.join('') + bright.join('') + live;

    // ▶ Start flag, level with the artboard's name label, just left of the artboard
    const s = startId();
    const sb = s && rootSet.has(s) && box(s);
    if (sb && sb.width >= 12) {
      flag.style.display = '';
      flag.style.transform = `translate(${Math.round(sb.x - 6)}px, ${Math.round(sb.y - 20)}px) translateX(-100%)`;
    }

    // connect handle on the single selected layer's right edge
    const g = (Folio.overlay && Folio.overlay.guides) || {};
    const id = sel.length === 1 ? sel[0] : null;
    const KP = Folio.componentsPanel;
    const blocked = !id || store.tool !== 'select' || store.editingTextId || g.move || g.hideHandles || g.marquee || (KP && KP.inInstance && KP.inInstance(id));
    const hb = !blocked && box(id);
    if (hb || drag) {
      const b = hb || box(drag.id);
      if (!b) return;
      handle.style.display = '';
      handle.classList.toggle('is-dragging', !!drag);
      handle.style.transform = `translate(${Math.round(b.x + b.width + 14)}px, ${Math.round(b.y + b.height / 2)}px) translate(-50%, -50%)`;
    }
  }

  // ---------- drag the handle onto a screen ----------
  function local(e) {
    const r = document.getElementById('canvas-viewport').getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Topmost visible artboard on this page under a screen point, except the layer's own. */
  function screenAt(x, y, own) {
    if (!Folio.canvas) return null;
    const w = Folio.canvas.screenToWorld(x, y);
    const rs = screens();
    for (let i = rs.length - 1; i >= 0; i--) {
      const id = rs[i];
      if (id === own || store.get(id).visible === false) continue;
      const b = Folio.canvas.nodeRect(id);
      if (b && w.x >= b.x && w.x <= b.x + b.width && w.y >= b.y && w.y <= b.y + b.height) return id;
    }
    return null;
  }

  function lockCursor(c) {
    const el = document.documentElement;
    el.classList.toggle('f-cursor-lock', !!c);
    if (c) el.style.setProperty('--f-cursor', c);
    else el.style.removeProperty('--f-cursor');
  }

  function startDrag(e) {
    e.stopPropagation(); // the canvas must not start a selection/move gesture
    e.preventDefault();
    const id = store.selection.length === 1 ? store.selection[0] : null;
    if (e.button !== 0 || !id || drag) return;
    drag = { id, ...local(e), target: null };
    try {
      layer.handle.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    window.addEventListener('keydown', onDragKey, true);
    lockCursor('grabbing');
    Folio.overlay.schedule();
  }

  function moveDrag(e) {
    e.stopPropagation(); // no hover outlines under the pointer while connecting
    if (!drag) return;
    Object.assign(drag, local(e));
    drag.target = screenAt(drag.x, drag.y, store.rootOf(drag.id));
    Folio.overlay.schedule();
  }

  function onDragKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    finishDrag(false);
  }

  function finishDrag(ok) {
    const d = drag;
    if (!d) return;
    drag = null;
    window.removeEventListener('keydown', onDragKey, true);
    lockCursor(null);
    const n = store.get(d.id);
    if (ok && d.target && n) {
      const list = clone(n.interactions || []);
      const i = list.findIndex((it) => it.action === 'navigate');
      if (i >= 0) list[i].target = d.target;
      else list.push({ trigger: 'click', action: 'navigate', target: d.target });
      save(d.id, list, i >= 0 ? 'Change destination' : 'Add interaction');
    }
    Folio.overlay.schedule();
  }

  // ------------------------------------------------------------------
  function init() {
    const panel = document.getElementById('right-panel');
    if (!panel || root) return;
    root = h('div', { id: 'prototype-panel', class: 'ins pp', role: 'tabpanel', 'aria-label': 'Prototype' });
    // ai.js may already have opened the remembered Prototype tab before this panel existed
    root.hidden = !document.querySelector('#right-tabs [data-tab="prototype"][aria-selected="true"]');
    const ins = document.getElementById('inspector');
    if (ins) ins.after(root);
    else panel.appendChild(root);
    root.addEventListener('focusout', () => deferred && setTimeout(schedule, 0));
    ['change', 'selection', 'page', 'history', 'doc'].forEach((evt) => store.on(evt, schedule));
    mount();
    refresh();
  }

  Folio.prototypePanel = { init, refresh, isOpen, draw };
})();
