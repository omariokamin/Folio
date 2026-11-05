/*
 * prototype.js — clickable prototypes (SPEC "Prototyping (v0.11)").
 *
 *   Folio.prototype
 *     normalize(nodeId, list) -> { interactions, warnings }   THE validator for node.interactions
 *     bundleFor(pageId?)      -> { name, start, screens, interactions, hovers }  (never touches the document)
 *     fileFor(pageId?)        -> one self-contained HTML file with an inline player
 *     play(startId?) / stop() / isPlaying() / startOf(pageId?)
 */
window.Folio = window.Folio || {};

(function () {
  const store = Folio.store;

  // ---------- validation ----------
  const ACTIONS = ['navigate', 'back', 'url', 'overlay', 'close'];
  const TRANSITIONS = ['instant', 'dissolve', 'slide'];
  const DIRECTIONS = ['left', 'right', 'up', 'down'];
  const POSITIONS = ['center', 'top', 'bottom', 'left', 'right'];
  const BACKDROP = '#0f172a66';
  const URL_RE = /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+|tel:\+?[0-9][0-9 ().-]*)$/i;

  const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/+-]+\)|transparent)$/i;
  const safeUrl = (u) => typeof u === 'string' && URL_RE.test(u.trim());

  function transitionOf(t) {
    t = t && typeof t === 'object' ? t : {};
    const type = TRANSITIONS.includes(t.type) ? t.type : 'instant';
    const d = Number(t.duration);
    const out = { type, duration: Number.isFinite(d) ? Math.round(Math.max(0, Math.min(2000, d))) : 300 };
    if (type === 'slide') out.direction = DIRECTIONS.includes(t.direction) ? t.direction : 'left';
    return out;
  }

  /**
   * Validate and complete a node's interactions. Drops unknown actions, targets that are not
   * artboards on the node's page (or the node's own artboard for navigate) and unsafe URLs;
   * fills defaults. Returns { interactions, warnings } (warnings: plain-language strings).
   */
  function normalize(nodeId, list) {
    const warnings = [];
    const node = store.get(nodeId);
    if (!node) return { interactions: [], warnings: ['No layer with id "' + nodeId + '".'] };
    if (list != null && !Array.isArray(list)) {
      list = [list];
    }
    const page = store.pageOf(nodeId);
    const roots = page ? page.roots : [];
    const own = store.rootOf(nodeId);
    const out = [];
    (list || []).forEach((raw, i) => {
      const at = 'Interaction ' + (i + 1);
      if (!raw || typeof raw !== 'object') return warnings.push(at + ' is not an object; dropped.');
      if (raw.trigger != null && raw.trigger !== 'click') return warnings.push(`${at}: only "click" triggers are supported (got "${raw.trigger}"); dropped.`);
      if (!ACTIONS.includes(raw.action)) return warnings.push(`${at}: unknown action "${raw.action}"; dropped.`);
      const it = { trigger: 'click', action: raw.action };
      if (raw.action === 'navigate' || raw.action === 'overlay') {
        const t = raw.target;
        if (!t || !roots.includes(t)) return warnings.push(`${at}: target "${t}" is not an artboard on this page; dropped.`);
        if (raw.action === 'navigate' && t === own) return warnings.push(`${at}: can't navigate to the screen the layer is already on; dropped.`);
        it.target = t;
        it.transition = transitionOf(raw.transition);
        if (raw.action === 'overlay') {
          const o = raw.overlay && typeof raw.overlay === 'object' ? raw.overlay : {};
          it.overlay = {
            position: POSITIONS.includes(o.position) ? o.position : 'center',
            closeOnOutside: o.closeOnOutside !== false,
            backdrop: typeof o.backdrop === 'string' && COLOR_RE.test(o.backdrop.trim()) ? o.backdrop.trim() : BACKDROP,
          };
        }
      } else if (raw.action === 'url') {
        if (!safeUrl(raw.url)) return warnings.push(`${at}: "${raw.url}" is not an http(s), mailto or tel link; dropped.`);
        it.url = raw.url.trim();
      }
      out.push(it);
    });
    return { interactions: out, warnings };
  }

  // ---------- bundle ----------
  const X = () => Folio.exporter;
  const VAR_RE = /var\(\s*(--(?:color|font|radius)-[\w-]+)\s*\)/g;
  const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pageById = (pageId) => (pageId && store.page(pageId)) || store.currentPage();

  /** The start screen of a page: page.start when it is still one of its artboards, else the first artboard. */
  function startOf(pageId) {
    const p = pageById(pageId);
    if (!p) return null;
    return p.start && p.roots.includes(p.start) ? p.start : p.roots[0] || null;
  }

  /** One artboard as player markup: export HTML + data-fid, export CSS scoped to the screen. */
  function screenOf(id) {
    const n = store.get(id);
    const { tree, list } = X().plan(id);
    const scope = `[data-screen=${JSON.stringify(id)}]`;
    const html = X().printHtml(tree, (it) => ` class="${it.cls}" data-fid="${escAttr(it.id)}"`);
    const rules = list.map((it) => `${scope} .${it.cls} {\n${Folio.css.toCssBlock(X().stylesOf(it))}\n}`).join('\n');
    const root = X().rootBlockFor(id);
    return { name: n.name || 'Screen', width: n.width, height: n.height, html, css: root ? root + '\n' + rules : rules };
  }

  /** Run fn on a throwaway copy of the document with events muted; the real doc, selection and history are untouched. */
  function offDocument(fn) {
    if (Folio.components && Folio.components.flush) Folio.components.flush(); // pending propagation belongs to the real doc
    const real = store.doc;
    const emit = store.emit;
    const sel = store.selection;
    const copy = JSON.parse(JSON.stringify(real));
    copy.roots = (copy.pages.find((p) => p.id === copy.page) || copy.pages[0]).roots;
    store.doc = copy;
    store.selection = [];
    store.emit = () => {};
    try {
      return fn();
    } finally {
      store.doc = real;
      store.emit = emit;
      store.selection = sel;
    }
  }

  const sameVariant = (a, b) => Object.keys({ ...a, ...b }).every((k) => a[k] === b[k]);

  /** { instanceId: { prop, value } } for direct instances whose set has a matching Hover variant. */
  function hoverTargets(ids) {
    const C = Folio.components;
    const out = {};
    if (!C) return out;
    ids.forEach((id) => {
      const n = store.get(id);
      if (!n || !n.instance || !C.isDirectInstance(id)) return;
      const comp = C.get(n.instance.componentId);
      const set = comp && comp.setId && C.getSet(comp.setId);
      if (!set) return;
      for (const prop of Object.keys(set.props || {})) {
        const value = (set.props[prop] || []).find((v) => /^hover$/i.test(v));
        if (!value || comp.variant[prop] === value) continue;
        const want = { ...comp.variant, [prop]: value };
        if (C.variantsOf(comp.id).some((c) => sameVariant(c.variant, want))) return (out[id] = { prop, value });
      }
    });
    return out;
  }

  /**
   * Everything the player needs for one page (default: the current page). Never modifies the document
   * or history: hover variants are rendered on a muted copy of the document.
   */
  function bundleFor(pageId, opts = {}) {
    const p = pageById(pageId);
    const roots = p.roots.filter((id) => store.get(id));
    const screens = {};
    const interactions = {};
    const fonts = new Set();
    const ids = [];
    roots.forEach((id) => {
      screens[id] = screenOf(id);
      X().fontsUsed(id).forEach((f) => fonts.add(f));
      X().plan(id).list.forEach((it) => ids.push(it.id));
    });
    const addInteractions = (id) => {
      const n = store.get(id);
      if (!n || !Array.isArray(n.interactions) || !n.interactions.length) return;
      const list = normalize(id, n.interactions).interactions; // dangling targets are dropped here
      if (list.length) interactions[id] = list;
    };
    ids.forEach(addInteractions);

    const hovers = {};
    const targets = hoverTargets(ids);
    if (Object.keys(targets).length) {
      const vars = X().brandVars(null);
      const lit = (v) => String(v).replace(VAR_RE, (m, k) => (vars[k] != null ? String(vars[k]) : m));
      offDocument(() =>
        Object.keys(targets).forEach((id) => {
          try {
            Folio.components.setVariant(id, { [targets[id].prop]: targets[id].value });
            const { tree, list } = X().plan(id);
            const styleOf = (it) => {
              const css = Folio.css.nodeStyles(it.node, { mode: 'play' });
              Object.keys(css).forEach((k) => (css[k] = lit(css[k])));
              return Folio.css.toCssText(css);
            };
            hovers[id] = { html: X().printHtml(tree, (it) => ` data-fid="${escAttr(it.id)}" style="${escAttr(styleOf(it))}"`) };
            list.forEach((it) => addInteractions(it.id));
            X().fontsUsed(id).forEach((f) => fonts.add(f));
          } catch (e) {
            console.warn('[Folio] hover variant skipped for', id, e);
          }
        })
      );
    }
    const start = opts.start && screens[opts.start] ? opts.start : startOf(p.id);
    return { name: p.name, start, screens, interactions, hovers, fonts: [...fonts] };
  }

  // ---------- the player (runs inside the exported file; must stay self-contained) ----------
  const PLAYER_CSS = `*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body { background: #e9e9ec; -webkit-font-smoothing: antialiased; overflow: hidden; }
h1, h2, h3, p { margin: 0; }
img { display: block; max-width: none; }
#fp-stage { position: fixed; inset: 0; overflow: auto; display: grid; }
#fp-stage > .fp-wrap { grid-area: 1 / 1; margin: auto; }
.fp-wrap { position: relative; flex-shrink: 0; outline: none; }
.fp-screen { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.fp-layer { position: fixed; inset: 0; display: flex; overflow: auto; }
[data-fp-click] { cursor: pointer; }
[data-fp-click]:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
.fp-hint [data-fp-click] { outline: 2px solid rgba(37, 99, 235, 0.6); outline-offset: 1px; background-color: rgba(37, 99, 235, 0.12); }
.fp-empty { margin: auto; font: 14px/1.5 system-ui, sans-serif; color: #555; text-align: center; padding: 24px; }`;

  /* eslint-disable no-var */
  function player() {
    var B = JSON.parse(document.getElementById('folio-bundle').textContent);
    var stage = document.getElementById('fp-stage');
    var URL_OK = /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+|tel:\+?[0-9][0-9 ().-]*)$/i;
    var embedded = window.parent !== window;
    var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var cur = null;
    var curWrap = null;
    var hist = [];
    var overlays = [];
    var hov = null;
    var hintTimer = 0;
    var style = document.createElement('style');
    style.textContent = Object.keys(B.screens).map(function (k) { return B.screens[k].css; }).join('\n');
    document.head.appendChild(style);

    function tell(type, extra) {
      if (!embedded) return;
      var m = { folio: 'player', type: type };
      for (var k in extra || {}) m[k] = extra[k];
      window.parent.postMessage(m, '*');
    }
    function decorate(root) {
      var els = [root].concat([].slice.call(root.querySelectorAll('[data-fid]')));
      els.forEach(function (el) {
        var list = el.getAttribute && B.interactions[el.getAttribute('data-fid')];
        if (!list) return;
        el.setAttribute('data-fp-click', '');
        el.setAttribute('role', list.some(function (i) { return i.action === 'url'; }) ? 'link' : 'button');
        el.tabIndex = 0;
      });
    }
    function mount(id) {
      var wrap = document.createElement('div');
      wrap.className = 'fp-wrap';
      wrap.tabIndex = -1;
      var sc = document.createElement('div');
      sc.className = 'fp-screen';
      sc.setAttribute('data-screen', id);
      sc.innerHTML = B.screens[id].html;
      wrap.appendChild(sc);
      decorate(sc);
      return wrap;
    }
    // scale down to fit the width; taller than the window at that scale = scroll (overlays always fit)
    function fit(wrap, overlay) {
      var sc = wrap.firstChild;
      var el = sc.firstElementChild;
      if (!el) return;
      var w = el.offsetWidth || 1;
      var h = el.offsetHeight || 1;
      var box = overlay ? wrap.parentNode : null;
      var s = Math.min(1, (box ? box.clientWidth : window.innerWidth) / w);
      if (box) s = Math.min(s, box.clientHeight / h);
      wrap.style.width = w * s + 'px';
      wrap.style.height = h * s + 'px';
      sc.style.transform = s < 1 ? 'scale(' + s + ')' : '';
    }
    // overlays sit on the visible part of the current screen, like a sheet inside a phone
    // shortcut: placed when opened and on resize, not while the stage scrolls (the overlay is modal anyway)
    function place(layer) {
      var r = curWrap ? curWrap.getBoundingClientRect() : { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
      var t = Math.max(0, r.top), l = Math.max(0, r.left);
      layer.style.inset = 'auto';
      layer.style.top = t + 'px';
      layer.style.left = l + 'px';
      layer.style.width = Math.max(0, Math.min(window.innerWidth, r.right) - l) + 'px';
      layer.style.height = Math.max(0, Math.min(window.innerHeight, r.bottom) - t) + 'px';
    }
    function refit() {
      if (curWrap) fit(curWrap);
      overlays.forEach(function (o) { place(o.layer); fit(o.wrap, true); });
    }
    // slide 'left' = the new screen moves left (enters from the right); back plays the opposite direction
    var OFF = { left: ['100vw', '0'], right: ['-100vw', '0'], up: ['0', '100vh'], down: ['0', '-100vh'] };
    var FLIP = { left: 'right', right: 'left', up: 'down', down: 'up' };
    function animate(el, tr, phase, reverse) {
      if (!tr || tr.type === 'instant' || !tr.duration || (reduce && reduce.matches) || !el.animate) return null;
      var k;
      if (tr.type === 'dissolve') k = [{ opacity: 0 }, { opacity: 1 }];
      else {
        var d = OFF[tr.direction] ? tr.direction : 'left';
        // the new screen enters from OFF[d]; the old one leaves towards the opposite side
        var t = 'translate(' + (phase === 'out' ? OFF[FLIP[d]] : OFF[d]).join(', ') + ')';
        k = phase === 'out' ? [{ transform: 'none' }, { transform: t }] : [{ transform: t }, { transform: 'none' }];
      }
      return el.animate(k, { duration: tr.duration, easing: 'ease-out', fill: 'both', direction: reverse ? 'reverse' : 'normal' });
    }
    function flip(tr) {
      if (!tr || tr.type !== 'slide') return tr;
      return { type: tr.type, duration: tr.duration, direction: FLIP[tr.direction] || 'right' };
    }
    function show(id, tr) {
      if (!B.screens[id]) return;
      unhover();
      var old = curWrap;
      var wrap = mount(id);
      stage.appendChild(wrap);
      fit(wrap);
      stage.scrollTop = 0;
      stage.scrollLeft = 0;
      var a = animate(wrap, tr, 'in');
      if (old) {
        if (a) {
          if (tr.type === 'slide') animate(old, tr, 'out');
          a.onfinish = function () {
            old.remove();
            a.cancel();
          };
        } else old.remove();
      }
      cur = id;
      curWrap = wrap;
      wrap.focus({ preventScroll: true });
      document.title = B.screens[id].name + ' · ' + B.name;
      tell('screen', { id: id });
    }
    function openOverlay(it, opener) {
      if (!B.screens[it.target]) return;
      unhover();
      var o = it.overlay || {};
      var pos = o.position || 'center';
      var layer = document.createElement('div');
      layer.className = 'fp-layer';
      layer.setAttribute('role', 'dialog');
      layer.setAttribute('aria-modal', 'true');
      layer.setAttribute('aria-label', B.screens[it.target].name);
      layer.style.background = o.backdrop || 'transparent';
      layer.style.justifyContent = pos === 'left' ? 'flex-start' : pos === 'right' ? 'flex-end' : 'center';
      layer.style.alignItems = pos === 'top' ? 'flex-start' : pos === 'bottom' ? 'flex-end' : 'center';
      var wrap = mount(it.target);
      layer.appendChild(wrap);
      document.body.appendChild(layer);
      place(layer);
      fit(wrap, true);
      var tr = it.transition;
      if (tr && tr.type !== 'instant') animate(layer, { type: 'dissolve', duration: tr.duration }, 'in');
      animate(wrap, tr, 'in');
      overlays.push({ layer: layer, wrap: wrap, it: it, opener: opener });
      wrap.focus({ preventScroll: true });
    }
    function closeTop(now) {
      var o = overlays.pop();
      if (!o) return;
      unhover();
      var tr = o.it.transition;
      var a = !now && tr && tr.type !== 'instant' ? animate(o.layer, { type: 'dissolve', duration: tr.duration }, 'in', true) : null;
      if (a) {
        animate(o.wrap, tr, 'in', true);
        a.onfinish = function () { o.layer.remove(); };
      } else o.layer.remove();
      var back = o.opener && o.opener.isConnected ? o.opener : overlays.length ? overlays[overlays.length - 1].wrap : curWrap;
      if (back) back.focus({ preventScroll: true });
    }
    function back() {
      if (overlays.length) return closeTop();
      var h = hist.pop();
      if (h) show(h.id, flip(h.tr));
    }
    function navigate(it) {
      if (!B.screens[it.target]) return;
      while (overlays.length) closeTop(true);
      if (it.target === cur) return;
      hist.push({ id: cur, tr: it.transition });
      show(it.target, it.transition);
    }
    function run(el) {
      var list = B.interactions[el.getAttribute('data-fid')] || [];
      list.forEach(function (it) {
        if (it.action === 'navigate') navigate(it);
        else if (it.action === 'back') back();
        else if (it.action === 'overlay') openOverlay(it, el);
        else if (it.action === 'close') closeTop();
        else if (it.action === 'url' && URL_OK.test(it.url)) window.open(it.url, '_blank', 'noopener');
      });
    }
    function hint() {
      var b = document.body;
      b.classList.add('fp-hint');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(function () { b.classList.remove('fp-hint'); }, 700);
    }
    function reset(id) {
      while (overlays.length) closeTop(true);
      hist = [];
      show(B.screens[id] ? id : B.start, null);
    }
    // hover states: swap a direct instance for its Hover variant while a (non-touch) pointer is over it
    function unhover() {
      if (!hov) return;
      var had = document.activeElement === hov.el;
      if (hov.el.parentNode) hov.el.replaceWith(hov.orig);
      if (had) hov.orig.focus({ preventScroll: true });
      hov = null;
    }
    document.addEventListener('pointerover', function (e) {
      if (e.pointerType === 'touch') return;
      if (hov && hov.el.contains(e.target)) return;
      unhover();
      var el = e.target;
      while (el && el.getAttribute && !B.hovers[el.getAttribute('data-fid')]) el = el.parentElement;
      if (!el || !el.getAttribute) return;
      var t = document.createElement('template');
      t.innerHTML = B.hovers[el.getAttribute('data-fid')].html;
      var hv = t.content.firstElementChild;
      if (!hv) return;
      decorate(hv);
      var had = document.activeElement === el;
      el.replaceWith(hv);
      if (had) hv.focus({ preventScroll: true });
      hov = { el: hv, orig: el };
    });
    document.documentElement.addEventListener('pointerleave', unhover);
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-fp-click]') : null;
      if (el) return run(el);
      var top = overlays[overlays.length - 1];
      if (top && !top.wrap.contains(e.target)) {
        if (top.it.overlay && top.it.overlay.closeOnOutside !== false) closeTop();
        return;
      }
      hint();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (overlays.length) closeTop();
        else tell('exit');
        return;
      }
      var el = document.activeElement;
      if ((e.key === 'Enter' || e.key === ' ') && el && el.hasAttribute && el.hasAttribute('data-fp-click')) {
        e.preventDefault();
        run(el);
      }
      if (embedded && e.altKey && (e.metaKey || e.ctrlKey) && e.key === 'Enter') tell('exit');
    });
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || d.folio !== 'host') return;
      if (d.type === 'goto' || d.type === 'restart') reset(d.type === 'goto' ? d.id : B.start);
    });
    window.addEventListener('resize', refit);
    if (!B.start || !B.screens[B.start]) {
      stage.innerHTML = '<p class="fp-empty">This page has no screens yet.</p>';
      return;
    }
    show(B.start, null);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
  }
  /* eslint-enable no-var */

  /** The whole prototype as one HTML file: fonts link, bundle JSON, inline player (no external JS). */
  function fileFromBundle(b) {
    const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const href = Folio.fonts && Folio.fonts.googleHref(b.fonts || []);
    const fonts = href
      ? `  <link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n  <link rel="stylesheet" href="${escAttr(href)}">\n`
      : '';
    const json = JSON.stringify(b).replace(/</g, '\\u003c'); // no </script> inside the JSON block
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(b.name || 'Prototype')}</title>
${fonts}  <style>
/* Prototype exported from Folio */
${PLAYER_CSS}
  </style>
</head>
<body>
<main id="fp-stage"></main>
<script type="application/json" id="folio-bundle">${json}</script>
<script>
(${player.toString()})();
</script>
</body>
</html>
`;
  }

  function fileFor(pageId, opts) {
    return fileFromBundle(bundleFor(pageId, opts));
  }

  function downloadFile(pageId) {
    const p = pageById(pageId);
    if (!p.roots.length) return Folio.ui.toast('This page has no artboards to export yet.', 'error');
    const name = String(p.name || 'Prototype').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'Prototype';
    X().download(name + '.prototype.html', fileFor(p.id), 'text/html');
    Folio.ui.toast(`Exported ${name}.prototype.html`, 'success');
  }

  // ---------- in-app player ----------
  let playing = null; // { root, frame, bundle, select, prevFocus }

  function onHostKey(e) {
    if (!playing) return;
    if (e.key === 'Escape' || (e.altKey && (e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
      e.preventDefault();
      stop();
    }
    e.stopPropagation(); // the editor's shortcuts stay off while playing
  }
  function onHostMessage(e) {
    if (!playing || e.source !== playing.frame.contentWindow || !e.data || e.data.folio !== 'player') return;
    if (e.data.type === 'exit') stop();
    if (e.data.type === 'screen') playing.select.value = e.data.id;
  }
  const post = (msg) => playing && playing.frame.contentWindow && playing.frame.contentWindow.postMessage({ folio: 'host', ...msg }, '*');

  /** Start screen for play(): the selected artboard (or the one holding the selection), else page.start, else the first. */
  function playStart(startId) {
    if (startId && store.isRoot(startId)) return startId;
    const p = store.primary();
    return p ? store.rootOf(p.id) : startOf();
  }

  function play(startId) {
    if (playing) stop();
    const page = store.currentPage();
    if (!page || !page.roots.length) {
      Folio.ui.toast('Add an artboard to this page first, then press Play.', 'error');
      return false;
    }
    const { h } = Folio.ui;
    const icon = (n, s) => Folio.icons.el(n, s);
    const bundle = bundleFor(page.id, { start: playStart(startId) });
    const frame = h('iframe', {
      title: 'Prototype: ' + page.name,
      sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox',
      style: { flex: '1', width: '100%', border: '0', background: '#e9e9ec' },
    });
    frame.srcdoc = fileFromBundle(bundle);
    const select = h(
      'select',
      { class: 'f-select', 'aria-label': 'Screen', style: { width: 'auto', maxWidth: '260px' }, onchange: () => post({ type: 'goto', id: select.value }) },
      Object.keys(bundle.screens).map((id) => h('option', { value: id }, bundle.screens[id].name))
    );
    select.value = bundle.start;
    const bar = h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '8px', height: '44px', padding: '0 10px', background: 'var(--panel)', borderBottom: '1px solid var(--line)', color: 'var(--text)', flexShrink: '0' } },
      icon('play', 14),
      h('span', { style: { color: 'var(--text-2)', whiteSpace: 'nowrap' } }, page.name),
      select,
      h('span', { style: { flex: '1' } }),
      h('button', { type: 'button', class: 'f-btn f-btn--ghost', onclick: () => post({ type: 'restart' }) }, icon('undo', 14), h('span', {}, 'Restart')),
      h('button', { type: 'button', class: 'f-btn f-btn--ghost f-btn--icon', 'aria-label': 'Close prototype (Esc)', title: 'Close (Esc)', onclick: () => stop() }, icon('x', 14))
    );
    const root = h(
      'div',
      { id: 'play-root', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Prototype player', style: { position: 'fixed', inset: '0', zIndex: '2000', display: 'flex', flexDirection: 'column', background: 'var(--bg)' } },
      bar,
      frame
    );
    playing = { root, frame, bundle, select, prevFocus: document.activeElement };
    window.addEventListener('keydown', onHostKey, true);
    window.addEventListener('message', onHostMessage);
    document.body.appendChild(root);
    frame.addEventListener('load', () => frame.focus(), { once: true });
    store.emit('play', true);
    return true;
  }

  function stop() {
    if (!playing) return;
    const { root, prevFocus } = playing;
    playing = null;
    window.removeEventListener('keydown', onHostKey, true);
    window.removeEventListener('message', onHostMessage);
    root.remove();
    if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus();
    store.emit('play', false);
  }

  Folio.prototype = {
    init() {},
    normalize,
    safeUrl,
    startOf,
    bundleFor,
    fileFor,
    downloadFile,
    play,
    stop,
    isPlaying: () => !!playing,
  };
})();
