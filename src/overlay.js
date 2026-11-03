/*
 * overlay.js — selection UI drawn in SCREEN space on top of the canvas.
 *
 *   Folio.overlay.init()       find #canvas-overlay, subscribe to the store
 *   Folio.overlay.update()     redraw now (render.js calls this after every render)
 *   Folio.overlay.schedule()   redraw on the next animation frame
 *   Folio.overlay.setGuides(patch)  transient gesture visuals, set by canvas.js:
 *       marquee:    {x,y,width,height} in screen px (relative to #canvas-viewport) | null
 *       dropTarget: frame id to highlight | null
 *       dropLine:   {x1,y1,x2,y2} insertion line, world coords | null
 *       move:       {ids:Set, dx, dy} world offset of nodes being dragged | null
 *       hideHover, hideHandles: booleans
 *
 * Everything here stays a constant size on screen regardless of zoom.
 */
window.Folio = window.Folio || {};

(function () {
  const store = Folio.store;
  let root = null;
  let vp = null;
  let raf = 0;
  const guides = {
    marquee: null,
    dropTarget: null,
    dropLine: null,
    move: null,
    hideHover: false,
    hideHandles: false,
  };

  const HANDLES = [
    ['nw', -1, -1],
    ['n', 0, -1],
    ['ne', 1, -1],
    ['e', 1, 0],
    ['se', 1, 1],
    ['s', 0, 1],
    ['sw', -1, 1],
    ['w', -1, 0],
  ];
  const CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

  // ---------- element pools (reuse DOM between frames) ----------
  const pools = {};
  function begin() {
    for (const k in pools) pools[k].used = 0;
  }
  function take(kind) {
    const p = pools[kind] || (pools[kind] = { els: [], used: 0 });
    let el = p.els[p.used];
    if (!el) {
      el = document.createElement('div');
      root.appendChild(el);
      p.els.push(el);
    }
    p.used++;
    el.className = 'f-ov-' + kind;
    el.style.display = '';
    return el;
  }
  function end() {
    for (const k in pools) {
      const p = pools[k];
      for (let i = p.used; i < p.els.length; i++) p.els[i].style.display = 'none';
    }
  }

  function init() {
    if (root) return;
    root = document.getElementById('canvas-overlay');
    vp = document.getElementById('canvas-viewport');
    if (!root) return;
    ['selection', 'hover', 'tool', 'history', 'doc', 'components'].forEach((evt) => store.on(evt, schedule));
    window.addEventListener('resize', schedule);
    if (window.ResizeObserver && vp) new ResizeObserver(schedule).observe(vp);
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', schedule);
    update();
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(update);
  }

  function setGuides(patch) {
    Object.assign(guides, patch);
    schedule();
  }

  // ---------- geometry helpers ----------
  const dpr = () => window.devicePixelRatio || 1;
  const snap = (v) => Math.round(v * dpr()) / dpr();

  function lockedDeep(id) {
    let n = store.get(id);
    while (n) {
      if (n.locked) return true;
      n = n.parent ? store.get(n.parent) : null;
    }
    return false;
  }

  /** Screen-space box of a node: unrotated box + rotation, and its axis-aligned bounds. */
  function screenBox(id) {
    const b = Folio.render.layoutBox(id);
    if (!b) return null;
    const v = store.viewport;
    const z = v.zoom;
    const mv = guides.move;
    let ox = 0;
    let oy = 0;
    if (mv && (mv.ids.has(id) || store.ancestors(id).some((a) => mv.ids.has(a)))) {
      ox = mv.dx;
      oy = mv.dy;
    }
    const x = (b.x + ox) * z + v.x;
    const y = (b.y + oy) * z + v.y;
    const w = b.width * z;
    const h = b.height * z;
    const rot = b.rotation || 0;
    let aabb = { x, y, width: w, height: h };
    if (rot) {
      const a = (rot * Math.PI) / 180;
      const c = Math.abs(Math.cos(a));
      const s = Math.abs(Math.sin(a));
      const bw = w * c + h * s;
      const bh = w * s + h * c;
      aabb = { x: x + w / 2 - bw / 2, y: y + h / 2 - bh / 2, width: bw, height: bh };
    }
    return { x, y, width: w, height: h, rotation: rot, aabb, world: b };
  }

  function place(el, sb) {
    if (!sb.rotation) {
      const x0 = snap(sb.x);
      const y0 = snap(sb.y);
      el.style.width = Math.max(0, snap(sb.x + sb.width) - x0) + 'px';
      el.style.height = Math.max(0, snap(sb.y + sb.height) - y0) + 'px';
      el.style.transform = `translate(${x0}px, ${y0}px)`;
    } else {
      el.style.width = sb.width + 'px';
      el.style.height = sb.height + 'px';
      el.style.transform = `translate(${sb.x}px, ${sb.y}px) rotate(${sb.rotation}deg)`;
    }
  }

  /** The node's corner radius scaled to screen px, so hover outlines hug rounded shapes. */
  function radiusCss(n, z, b) {
    let r = n && n.style && n.style.radius;
    if (typeof r === 'string' && Folio.brand && Folio.brand.resolveRadius) r = Folio.brand.resolveRadius(r);
    if (!r) return '';
    const max = Math.min(b.width, b.height) / 2;
    const one = (v) => Math.min(max, (Number(v) || 0) * z) + 'px';
    return Array.isArray(r) ? r.map(one).join(' ') : one(r);
  }

  /** 'main' | 'set' | 'instance' (incl. layers inside one) | null — drawn in the component purple. */
  function compRole(id) {
    const K = Folio.components;
    const n = store.get(id);
    if (!K || !n) return null;
    if (n.component && K.componentOf(id)) return 'main';
    if (Folio.componentsPanel && Folio.componentsPanel.isSetFrame(id)) return 'set';
    if (K.instanceRootOf(id)) return 'instance';
    return null;
  }

  const fmt = (v) => {
    const r = Math.round(v * 100) / 100;
    return String(r);
  };

  // ---------- draw ----------
  function update() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (!root || !Folio.render) return;
    Folio.render.sync && Folio.render.sync();

    const v = store.viewport;
    const z = v.zoom;
    const sel = store.selection.filter((id) => store.get(id));
    const selSet = new Set(sel);
    const editing = store.editingTextId;
    const boxCache = new Map();
    const sbox = (id) => {
      if (!boxCache.has(id)) boxCache.set(id, screenBox(id));
      return boxCache.get(id);
    };

    begin();

    // drop target highlight (under everything else)
    if (guides.dropTarget && store.get(guides.dropTarget)) {
      const b = sbox(guides.dropTarget);
      if (b) place(take('target'), b);
    }

    // hover outline
    const hov = store.hoverId;
    if (hov && !guides.hideHover && !selSet.has(hov) && store.get(hov)) {
      const b = sbox(hov);
      if (b) {
        const el = take('hover');
        place(el, b);
        if (compRole(hov)) el.classList.add('is-comp');
        el.style.borderRadius = radiusCss(store.get(hov), z, b);
      }
    }

    // artboard labels, plus a purple label above every main component and component set
    const K = Folio.components;
    const labelled = store.doc.roots.slice();
    if (K) {
      // inner labels need the gap between variants (24px) to be at least a label tall, unless hovered/selected
      const roomy = z >= 0.75;
      const want = (id) => store.get(id) && !store.isRoot(id) && (roomy || selSet.has(id) || hov === id);
      K.list().forEach((c) => want(c.mainId) && labelled.push(c.mainId));
      K.sets().forEach((st) => want(st.frameId) && labelled.push(st.frameId));
    }
    labelled.forEach((id) => {
      const n = store.get(id);
      if (!n || n.visible === false) return;
      const inner = !store.isRoot(id);
      if (inner && store.ancestors(id).some((a) => store.get(a).visible === false)) return;
      const b = sbox(id);
      if (!b) return;
      const el = take('label');
      const a = b.aabb;
      if (el.textContent !== n.name) el.textContent = n.name || 'Untitled';
      el.dataset.root = id;
      el.style.maxWidth = Math.max(0, a.width) + 'px';
      el.style.transform = `translate(${snap(a.x)}px, ${snap(a.y - (inner ? 17 : 20))}px)`;
      const role = compRole(id);
      if (role === 'main' || role === 'set') el.classList.add('is-comp', 'is-' + role);
      if (inner) el.classList.add('is-inner');
      if (selSet.has(id)) el.classList.add('is-selected');
      if (hov === id && !guides.hideHover) el.classList.add('is-hover');
      if (n.locked) el.classList.add('is-locked');
      if (a.width < (inner ? 40 : 12) || (inner && a.height < 12)) el.style.display = 'none';
    });

    // selection outlines
    let union = null;
    sel.forEach((id) => {
      const b = sbox(id);
      if (!b) return;
      const el = take('sel');
      if (id === editing) el.classList.add('is-editing');
      if (compRole(id)) el.classList.add('is-comp');
      place(el, b);
      const a = b.aabb;
      union = union
        ? {
            x1: Math.min(union.x1, a.x),
            y1: Math.min(union.y1, a.y),
            x2: Math.max(union.x2, a.x + a.width),
            y2: Math.max(union.y2, a.y + a.height),
          }
        : { x1: a.x, y1: a.y, x2: a.x + a.width, y2: a.y + a.height };
    });

    // resize handles (single selection only)
    const innerSel = sel.length === 1 && Folio.componentsPanel && Folio.componentsPanel.inInstance(sel[0]);
    if (sel.length === 1 && !editing && !guides.hideHandles && !lockedDeep(sel[0]) && !innerSel) {
      const purple = !!compRole(sel[0]);
      const b = sbox(sel[0]);
      if (b) {
        const rad = (b.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        HANDLES.forEach(([name, hx, hy]) => {
          const lx = (hx * b.width) / 2;
          const ly = (hy * b.height) / 2;
          const px = cx + lx * cos - ly * sin;
          const py = cy + lx * sin + ly * cos;
          const el = take('handle');
          el.dataset.handle = name;
          if (purple) el.classList.add('is-comp');
          el.style.transform =
            `translate(${snap(px) - 4}px, ${snap(py) - 4}px)` + (b.rotation ? ` rotate(${b.rotation}deg)` : '');
          // cursor follows the handle direction, rotated with the node
          const ang = (Math.atan2(hy, hx) * 180) / Math.PI + b.rotation;
          const bucket = (((Math.round(ang / 45) % 4) + 4) % 4);
          el.style.cursor = CURSORS[bucket];
        });
      }
    }

    // size badge
    if (union && !guides.marquee && !editing) {
      let w;
      let h;
      if (sel.length === 1) {
        const b = sbox(sel[0]);
        w = b.world.width;
        h = b.world.height;
      } else {
        w = (union.x2 - union.x1) / z;
        h = (union.y2 - union.y1) / z;
      }
      const el = take('badge');
      if (sel.length === 1 && compRole(sel[0])) el.classList.add('is-comp');
      const txt = `${fmt(w)} × ${fmt(h)}`;
      if (el.textContent !== txt) el.textContent = txt;
      el.style.transform = `translate(${snap((union.x1 + union.x2) / 2)}px, ${snap(union.y2 + 8)}px) translateX(-50%)`;
    }

    // flex insertion line
    if (guides.dropLine) {
      const L = guides.dropLine;
      const x1 = L.x1 * z + v.x;
      const y1 = L.y1 * z + v.y;
      const x2 = L.x2 * z + v.x;
      const y2 = L.y2 * z + v.y;
      const el = take('line');
      const horizontal = Math.abs(y2 - y1) < Math.abs(x2 - x1);
      if (horizontal) {
        el.style.width = Math.max(2, Math.abs(x2 - x1)) + 'px';
        el.style.height = '2px';
        el.style.transform = `translate(${snap(Math.min(x1, x2))}px, ${snap(y1) - 1}px)`;
      } else {
        el.style.width = '2px';
        el.style.height = Math.max(2, Math.abs(y2 - y1)) + 'px';
        el.style.transform = `translate(${snap(x1) - 1}px, ${snap(Math.min(y1, y2))}px)`;
      }
    }

    // marquee
    if (guides.marquee) {
      const m = guides.marquee;
      place(take('marquee'), { x: m.x, y: m.y, width: m.width, height: m.height, rotation: 0 });
    }

    end();
  }

  Folio.overlay = { init, update, schedule, setGuides, guides };
})();
