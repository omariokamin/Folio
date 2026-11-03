/*
 * canvas.js — the infinite canvas: pan, zoom, select, move, resize, draw, edit text.
 *
 *   Folio.canvas.init()
 *   Folio.canvas.zoomToFit(ids?) / zoomToSelection() / setZoom(z, screenPoint?) / zoomIn() / zoomOut()
 *   Folio.canvas.screenToWorld(x, y) / worldToScreen(x, y)     (screen = px relative to #canvas-viewport)
 *   Folio.canvas.centerOn(id) / nodeRect(id) -> world {x,y,width,height}
 *   Folio.canvas.startTextEdit(id) / endTextEdit()
 *   Folio.canvas.placeImage(src, name) -> Promise<node>
 *   Folio.canvas.createArtboard(preset) -> node
 *   Folio.canvas.frameAt(clientX, clientY) / flexDrop(frameId, worldPt) / contentOrigin(frameId)   (drop helpers)
 *
 * Every gesture mutates the store live (or shows a transient preview) and calls
 * store.commit() exactly once when it ends.
 */
window.Folio = window.Folio || {};

(function () {
  const store = Folio.store;
  const MIN_ZOOM = 0.02;
  const MAX_ZOOM = 32;
  const DRAG_THRESHOLD = 3;
  const ZOOM_STEPS = [0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
  const DRAW_TOOLS = ['frame', 'rect', 'ellipse', 'text', 'image'];
  const SHAPE_FILL = '#d9d9de';

  let vp = null;
  let world = null;
  let inited = false;
  let spaceHeld = false;
  let gesture = null;
  let editing = null; // { id, el, handlers }
  let lastPointer = null; // { clientX, clientY }
  let autoFitArmed = false;
  let lastDoc = null;

  const R = () => Folio.render;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round2 = (v) => Math.round(v * 100) / 100;
  const solid = (color) => [{ type: 'solid', color, visible: true }];

  // ---------- coordinates ----------
  const vpRect = () => vp.getBoundingClientRect();
  function screenToWorld(x, y) {
    const v = store.viewport;
    return { x: (x - v.x) / v.zoom, y: (y - v.y) / v.zoom };
  }
  function worldToScreen(x, y) {
    const v = store.viewport;
    return { x: x * v.zoom + v.x, y: y * v.zoom + v.y };
  }
  function clientToWorld(cx, cy) {
    const r = vpRect();
    return screenToWorld(cx - r.left, cy - r.top);
  }
  function clientToScreen(cx, cy) {
    const r = vpRect();
    return { x: cx - r.left, y: cy - r.top };
  }

  // ---------- tree helpers ----------
  function lockedDeep(id) {
    let n = store.get(id);
    while (n) {
      if (n.locked) return true;
      n = n.parent ? store.get(n.parent) : null;
    }
    return false;
  }
  function hiddenDeep(id) {
    let n = store.get(id);
    while (n) {
      if (n.visible === false) return true;
      n = n.parent ? store.get(n.parent) : null;
    }
    return false;
  }
  const isFlex = (n) => !!(n && n.type === 'frame' && n.layout && n.layout.mode === 'flex');
  const KP = () => Folio.componentsPanel;
  const inInstance = (id) => !!(KP() && KP().inInstance(id));
  const borderW = (n) => (n && n.style && n.style.border && Number(n.style.border.width)) || 0;

  /** Document (pre-)order index of every node, for stable ordering of multi-node operations. */
  function docOrder() {
    const order = new Map();
    let i = 0;
    const walk = (ids) =>
      ids.forEach((id) => {
        const n = store.get(id);
        if (!n) return;
        order.set(id, i++);
        walk(n.children || []);
      });
    walk(store.doc.roots);
    return order;
  }

  /** Selected nodes that can be moved: unlocked, visible, and not inside another selected node. */
  function movable(ids) {
    const set = new Set(ids);
    const order = docOrder();
    return ids
      .filter((id) => store.get(id) && !lockedDeep(id) && !hiddenDeep(id) && !inInstance(id))
      .filter((id) => !store.ancestors(id).some((a) => set.has(a)))
      .sort((a, b) => order.get(a) - order.get(b));
  }

  // ---------- geometry ----------
  /** World-space box computed from data only (fallback for hidden nodes). */
  function dataBox(id) {
    const n = store.get(id);
    if (!n) return null;
    if (!n.parent) return { x: n.x, y: n.y, width: n.width, height: n.height, rotation: 0 };
    const p = store.get(n.parent);
    const pb = layoutBox(n.parent) || { x: 0, y: 0 };
    const bw = borderW(p);
    if (isFlex(p)) return { x: pb.x + bw, y: pb.y + bw, width: n.width, height: n.height, rotation: 0 };
    return { x: pb.x + bw + n.x, y: pb.y + bw + n.y, width: n.width, height: n.height, rotation: 0 };
  }
  function layoutBox(id) {
    return (R() && R().layoutBox(id)) || dataBox(id);
  }
  /** World-space bounding rect of a node (rotation included). */
  function nodeRect(id) {
    const b = (R() && R().bounds(id)) || dataBox(id);
    return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
  }
  /** World position of a frame's content origin (where CSS left:0/top:0 of a child lands). */
  function contentOrigin(frameId) {
    if (!frameId) return { x: 0, y: 0 };
    const b = layoutBox(frameId) || { x: 0, y: 0 };
    const bw = borderW(store.get(frameId));
    return { x: b.x + bw, y: b.y + bw };
  }

  // ---------- hit testing ----------
  /** Node ids under a client point, topmost first. Locked (incl. inherited) nodes are see-through. */
  function hitNodes(cx, cy, exclude) {
    const out = [];
    const r = vpRect();
    if (cx < r.left || cy < r.top || cx > r.right || cy > r.bottom) return out;
    for (const el of document.elementsFromPoint(cx, cy)) {
      if (!el.classList || !el.classList.contains('f-node')) continue;
      const id = el.dataset.id;
      if (!id || !store.get(id)) continue;
      if (exclude && exclude.has(id)) continue;
      if (lockedDeep(id)) continue;
      out.push(id);
    }
    return out;
  }
  /** root → deepest node under the point, or null. */
  function hitPath(cx, cy) {
    const hit = hitNodes(cx, cy)[0];
    return hit ? [...store.ancestors(hit), hit] : null;
  }
  /**
   * Can this frame receive dropped / drawn children? Rectangles and ellipses are frames too,
   * so a childless freeform frame counts as a leaf shape — unless it is an artboard, an
   * auto-layout frame, or still carries a container name ("Frame", "Group", ...).
   */
  function isContainer(n, exclude) {
    if (!n || n.type !== 'frame') return false;
    if (!n.parent || isFlex(n)) return true;
    if ((n.children || []).some((c) => !(exclude && exclude.has(c)))) return true;
    return /^(frame|group|auto layout|container|section|artboard)\b/i.test(n.name || '');
  }
  /** The deepest container frame under a point (non-containers resolve to their parent). Instance
   *  internals and component sets are skipped (see componentsPanel.dropBlocked); `ids` = layers being moved. */
  function frameAt(cx, cy, exclude, ids) {
    const hit = hitNodes(cx, cy, exclude)[0];
    let n = hit ? store.get(hit) : null;
    while (n && (!isContainer(n, exclude) || (KP() && KP().dropBlocked(n.id, ids || [])))) n = n.parent ? store.get(n.parent) : null;
    return n ? n.id : null;
  }
  /** Which node a click on `path` selects. */
  function clickTarget(path, deep) {
    if (!path || !path.length) return null;
    if (deep) return path[path.length - 1];
    const sel = store.selection.slice().reverse(); // primary first
    for (const sid of sel) {
      const n = store.get(sid);
      if (!n || !n.parent) continue;
      const pi = path.indexOf(n.parent);
      if (pi >= 0 && path[pi + 1]) return path[pi + 1];
    }
    const t = path[1] || path[0];
    // an instance on the canvas is picked as a whole (double-click goes inside, like a frame)
    return inInstance(t) ? path.find((id) => store.get(id).instance) || t : t;
  }

  // ---------- viewport ----------
  function vpSize() {
    return { w: vp.clientWidth, h: vp.clientHeight };
  }
  function setZoom(z, screenPoint) {
    const v = store.viewport;
    z = clamp(Number(z) || 1, MIN_ZOOM, MAX_ZOOM);
    const s = vpSize();
    const p = screenPoint || { x: s.w / 2, y: s.h / 2 };
    const w = screenToWorld(p.x, p.y);
    autoFitArmed = false;
    store.setViewport({ zoom: z, x: p.x - w.x * z, y: p.y - w.y * z });
  }
  function zoomIn() {
    const z = store.viewport.zoom;
    setZoom(ZOOM_STEPS.find((s) => s > z * 1.001) || MAX_ZOOM);
  }
  function zoomOut() {
    const z = store.viewport.zoom;
    setZoom([...ZOOM_STEPS].reverse().find((s) => s < z / 1.001) || MIN_ZOOM);
  }
  function fitRect(rect, maxZoom) {
    const s = vpSize();
    if (!rect || !s.w || !s.h) return;
    const pad = Math.min(64, s.w * 0.08, s.h * 0.08);
    const z = clamp(
      Math.min((s.w - pad * 2) / Math.max(rect.width, 1), (s.h - pad * 2) / Math.max(rect.height, 1), maxZoom),
      MIN_ZOOM,
      MAX_ZOOM
    );
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    autoFitArmed = false;
    store.setViewport({ zoom: z, x: s.w / 2 - cx * z, y: s.h / 2 - cy * z });
  }
  function unionRect(ids) {
    let u = null;
    ids.forEach((id) => {
      const r = nodeRect(id);
      if (!r) return;
      u = u
        ? { x1: Math.min(u.x1, r.x), y1: Math.min(u.y1, r.y), x2: Math.max(u.x2, r.x + r.width), y2: Math.max(u.y2, r.y + r.height) }
        : { x1: r.x, y1: r.y, x2: r.x + r.width, y2: r.y + r.height };
    });
    return u && { x: u.x1, y: u.y1, width: u.x2 - u.x1, height: u.y2 - u.y1 };
  }
  function zoomToFit(ids) {
    if (!vp) return;
    R() && R().sync();
    const list = ids && ids.length ? [].concat(ids) : store.doc.roots.filter((id) => !hiddenDeep(id));
    const rect = unionRect(list.filter((id) => store.get(id)));
    if (!rect) {
      const s = vpSize();
      store.setViewport({ zoom: 1, x: Math.round(s.w / 2), y: Math.round(s.h / 2) });
      return;
    }
    fitRect(rect, 1);
  }
  function zoomToSelection() {
    if (!store.selection.length) return zoomToFit();
    R() && R().sync();
    fitRect(unionRect(store.selection), 8);
  }
  function centerOn(id) {
    const r = nodeRect(id);
    if (!r) return;
    const s = vpSize();
    const z = store.viewport.zoom;
    store.setViewport({ x: s.w / 2 - (r.x + r.width / 2) * z, y: s.h / 2 - (r.y + r.height / 2) * z });
  }

  function onWheel(e) {
    e.preventDefault();
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 16;
      dy *= 16;
    } else if (e.deltaMode === 2) {
      dx *= vp.clientWidth;
      dy *= vp.clientHeight;
    }
    autoFitArmed = false;
    if (e.ctrlKey || e.metaKey) {
      // pinch-zoom arrives as ctrl+wheel with small deltas (scale ≈ exp(-deltaY/100));
      // a mouse-wheel notch sends ~100, which we cap to one comfortable ~28% step
      const factor = Math.exp(-clamp(dy, -25, 25) * 0.01);
      setZoom(store.viewport.zoom * factor, clientToScreen(e.clientX, e.clientY));
    } else {
      if (e.shiftKey && !dx) {
        dx = dy;
        dy = 0;
      }
      const v = store.viewport;
      store.setViewport({ x: v.x - dx, y: v.y - dy });
    }
    if (gesture) refreshGesture(e);
  }

  // ---------- cursor ----------
  function updateCursor() {
    if (!vp) return;
    vp.dataset.tool = store.tool;
    vp.classList.toggle('is-space', spaceHeld);
  }
  function lockCursor(c) {
    const h = document.documentElement;
    if (c) {
      h.style.setProperty('--f-cursor', c);
      h.classList.add('f-cursor-lock');
    } else {
      h.classList.remove('f-cursor-lock');
      h.style.removeProperty('--f-cursor');
    }
  }

  // ---------- pointer entry point ----------
  function blurForeignFocus() {
    const a = document.activeElement;
    if (a && a !== document.body && !(editing && a === editing.el) && typeof a.blur === 'function') a.blur();
  }

  function onPointerDown(e) {
    if (gesture) return;
    if (e.button !== 0 && e.button !== 1) return;
    const t = e.target;
    if (editing) {
      if (editing.el.contains(t)) return; // caret placement / text selection inside the editor
      endTextEdit();
    }
    blurForeignFocus();
    e.preventDefault();
    autoFitArmed = false;
    lastPointer = { clientX: e.clientX, clientY: e.clientY };
    try {
      vp.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }

    if (e.button === 1 || spaceHeld || store.tool === 'hand') return startPan(e);

    const handle = t.closest && t.closest('.f-ov-handle');
    if (handle) return startResize(e, handle.dataset.handle);

    const label = t.closest && t.closest('.f-ov-label');
    if (label && label.dataset.root && store.get(label.dataset.root)) return pressNode(e, label.dataset.root);

    if (DRAW_TOOLS.includes(store.tool)) return startDraw(e);

    // ---- select tool ----
    const path = hitPath(e.clientX, e.clientY);
    if (!path) {
      if (!e.shiftKey) store.select([]);
      return startMarquee(e, null, null);
    }
    const deep = e.metaKey || e.ctrlKey;
    const target = clickTarget(path, deep);
    const n = store.get(target);
    if (!deep && store.isRoot(target) && n.type === 'frame' && n.children.length && !n.instance && !store.selection.includes(target)) {
      // pressing an artboard's empty area: click selects it, drag marquee-selects inside it
      return startMarquee(e, target, target);
    }
    pressNode(e, target);
  }

  function onPointerMove(e) {
    if (!gesture) return;
    lastPointer = { clientX: e.clientX, clientY: e.clientY };
    const g = gesture;
    if (g.type === 'pan') return movePan(e);
    if (g.type === 'press') {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_THRESHOLD) return;
      if (!beginMove(e)) {
        gesture = null;
        return;
      }
    }
    if (g.type === 'move') return moveMove(e);
    if (g.type === 'resize') return moveResize(e);
    if (g.type === 'draw') return moveDraw(e);
    if (g.type === 'marquee') return moveMarquee(e);
  }

  function onPointerUp(e) {
    if (!gesture) return;
    const g = gesture;
    if (e.type === 'pointercancel') return cancelGesture();
    if (g.type === 'pan') endPan();
    else if (g.type === 'press') endPress(e);
    else if (g.type === 'move') endMove(e);
    else if (g.type === 'resize') endResize();
    else if (g.type === 'draw') endDraw(e);
    else if (g.type === 'marquee') endMarquee(e);
    gesture = null;
    lockCursor(null);
  }

  function cancelGesture() {
    const g = gesture;
    gesture = null;
    lockCursor(null);
    if (!g) return;
    if (g.type === 'move') cleanupMove(g);
    if (g.type === 'pan') vp.classList.remove('is-panning');
    if (g.type === 'resize' || g.type === 'draw') store.commit(g.type === 'resize' ? 'Resize' : 'Draw');
    if (g.type === 'marquee') Folio.overlay.setGuides({ marquee: null });
    Folio.overlay.setGuides({ hideHover: false, hideHandles: false, marquee: null, dropTarget: null, dropLine: null, move: null });
  }

  /** Re-run the active gesture (after a modifier key change or a wheel pan mid-drag). */
  function refreshGesture(mods) {
    if (!gesture || !lastPointer) return;
    const fake = {
      clientX: lastPointer.clientX,
      clientY: lastPointer.clientY,
      shiftKey: !!mods.shiftKey,
      altKey: !!mods.altKey,
      metaKey: !!mods.metaKey,
      ctrlKey: !!mods.ctrlKey,
    };
    if (gesture.type === 'move') moveMove(fake);
    else if (gesture.type === 'resize') moveResize(fake);
    else if (gesture.type === 'draw') moveDraw(fake);
    else if (gesture.type === 'marquee') moveMarquee(fake);
  }

  // ---------- hover ----------
  function onHoverMove(e) {
    if (gesture) return;
    if (store.tool !== 'select' || spaceHeld || editing) return store.setHover(null);
    const label = e.target.closest && e.target.closest('.f-ov-label');
    if (label) return store.setHover(label.dataset.root || null);
    if (e.target.closest && e.target.closest('.f-ov-handle')) return;
    const path = hitPath(e.clientX, e.clientY);
    store.setHover(path ? clickTarget(path, e.metaKey || e.ctrlKey) : null);
  }

  // ---------- pan ----------
  function startPan(e) {
    const v = store.viewport;
    gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
    vp.classList.add('is-panning');
    lockCursor('grabbing');
    store.setHover(null);
    autoFitArmed = false;
  }
  function movePan(e) {
    const g = gesture;
    store.setViewport({ x: g.vx + (e.clientX - g.sx), y: g.vy + (e.clientY - g.sy) });
  }
  function endPan() {
    vp.classList.remove('is-panning');
  }

  // ---------- press → click or move ----------
  function pressNode(e, id) {
    const sel = store.selection;
    let clickAction = null;
    if (e.shiftKey) {
      if (sel.includes(id)) clickAction = 'toggle-off';
      else store.toggleSelect(id);
    } else if (!sel.includes(id)) {
      store.select([id]);
    } else if (sel.length > 1) {
      clickAction = 'only';
    }
    const w = clientToWorld(e.clientX, e.clientY);
    gesture = { type: 'press', id, sx: e.clientX, sy: e.clientY, wx: w.x, wy: w.y, clickAction };
  }
  function endPress() {
    const g = gesture;
    if (g.clickAction === 'only') store.select([g.id]);
    else if (g.clickAction === 'toggle-off') store.toggleSelect(g.id);
  }

  // ---------- move ----------
  function beginMove(e) {
    const g = gesture;
    const ids = movable(store.selection);
    if (!ids.length) return false;
    R().sync();
    const starts = {};
    const ghosts = {};
    const excluded = new Set();
    ids.forEach((id) => {
      starts[id] = layoutBox(id);
      excluded.add(id);
      store.descendants(id).forEach((d) => excluded.add(d));
    });
    ids.forEach((id) => (ghosts[id] = makeGhost(id, starts[id])));
    Object.assign(g, { type: 'move', ids, starts, ghosts, excluded, dx: 0, dy: 0, alt: false, drop: null });
    gesture = g;
    store.setHover(null);
    Folio.overlay.setGuides({ hideHover: true, hideHandles: true });
    return true;
  }

  function makeGhost(id, box) {
    const src = R().el(id);
    const n = store.get(id);
    if (!src || !box) return null;
    const g = src.cloneNode(true);
    const strip = (el) => {
      el.removeAttribute('data-id');
      el.removeAttribute('contenteditable');
      el.classList.remove('f-node', 'is-editing', 'f-drag-source');
    };
    strip(g);
    g.querySelectorAll('[data-id]').forEach(strip);
    g.classList.add('f-ghost');
    const s = g.style;
    s.position = 'absolute';
    s.left = box.x + 'px';
    s.top = box.y + 'px';
    s.margin = '0px';
    s.flex = 'none';
    s.alignSelf = 'auto';
    // keep hug text at max-content (avoids sub-pixel re-wrapping); pin everything else
    if (!(n.type === 'text' && n.sizing && n.sizing.w === 'hug')) s.width = box.width + 'px';
    s.height = box.height + 'px';
    s.minWidth = '0px';
    s.minHeight = '0px';
    s.pointerEvents = 'none';
    g.dataset.rot = box.rotation || 0;
    s.transform = box.rotation ? `rotate(${box.rotation}deg)` : 'none';
    world.appendChild(g);
    src.classList.add('f-drag-source');
    return g;
  }

  function moveMove(e) {
    const g = gesture;
    const w = clientToWorld(e.clientX, e.clientY);
    let dx = w.x - g.wx;
    let dy = w.y - g.wy;
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    g.dx = dx;
    g.dy = dy;
    g.alt = !!e.altKey;
    g.ids.forEach((id) => {
      const gh = g.ghosts[id];
      const src = R().el(id);
      if (gh) {
        const rot = Number(gh.dataset.rot) || 0;
        gh.style.transform = `translate(${dx}px, ${dy}px)` + (rot ? ` rotate(${rot}deg)` : '');
      }
      if (src) src.classList.toggle('f-drag-source', !g.alt);
    });
    lockCursor(g.alt ? 'copy' : 'default');

    // drop target
    let target = frameAt(e.clientX, e.clientY, g.excluded, g.ids);
    if (target && g.ids.every((id) => store.isRoot(id))) {
      // artboards only nest when dropped entirely inside another frame
      const tb = layoutBox(target);
      const inside = g.ids.every((id) => {
        const b = g.starts[id];
        return tb && b.x + dx >= tb.x && b.y + dy >= tb.y && b.x + dx + b.width <= tb.x + tb.width && b.y + dy + b.height <= tb.y + tb.height;
      });
      if (!inside) target = null;
    }
    const tn = target ? store.get(target) : null;
    const guides = { move: { ids: new Set(g.ids), dx, dy }, dropTarget: null, dropLine: null };
    let beforeId = null;
    if (tn && isFlex(tn)) {
      const fd = flexDrop(target, w, g.excluded);
      beforeId = fd.beforeId;
      guides.dropLine = fd.line;
      guides.dropTarget = target;
    } else if (target && g.ids.some((id) => (store.get(id).parent || null) !== target)) {
      guides.dropTarget = target;
    }
    g.drop = { target, beforeId };
    Folio.overlay.setGuides(guides);
  }

  /** Where a node dropped at world point `wp` lands among a flex frame's children. */
  function flexDrop(targetId, wp, excluded) {
    const t = store.get(targetId);
    const L = t.layout;
    const row = L.direction === 'row';
    const vis = [];
    t.children.forEach((c) => {
      if (excluded && excluded.has(c)) return;
      const cn = store.get(c);
      if (!cn || cn.visible === false) return;
      const b = R().layoutBox(c);
      if (b) vis.push({ id: c, b });
    });
    const main = (b) => (row ? [b.x, b.x + b.width] : [b.y, b.y + b.height]);
    const cross = (b) => (row ? [b.y, b.y + b.height] : [b.x, b.x + b.width]);
    const pm = row ? wp.x : wp.y;
    const pc = row ? wp.y : wp.x;
    let k = vis.length;
    for (let i = 0; i < vis.length; i++) {
      const [m0, m1] = main(vis[i].b);
      const mid = (m0 + m1) / 2;
      if (L.wrap) {
        const [c0, c1] = cross(vis[i].b);
        if (pc < c0 || (pc <= c1 && pm < mid)) {
          k = i;
          break;
        }
      } else if (pm < mid) {
        k = i;
        break;
      }
    }
    const beforeId = k < vis.length ? vis[k].id : null;

    // insertion line (world coords)
    const tb = layoutBox(targetId);
    const bw = borderW(t);
    const pad = L.padding || [0, 0, 0, 0];
    const content = {
      x1: tb.x + bw + (pad[3] || 0),
      y1: tb.y + bw + (pad[0] || 0),
      x2: tb.x + tb.width - bw - (pad[1] || 0),
      y2: tb.y + tb.height - bw - (pad[2] || 0),
    };
    const prev = vis[k - 1] && vis[k - 1].b;
    const next = vis[k] && vis[k].b;
    let pos;
    let ref = next || prev;
    if (!vis.length) pos = row ? content.x1 : content.y1;
    else if (prev && next) {
      const sameLine = !L.wrap || cross(prev)[0] < cross(next)[1] && cross(next)[0] < cross(prev)[1];
      pos = sameLine ? (main(prev)[1] + main(next)[0]) / 2 : main(next)[0];
      if (!sameLine) ref = next;
    } else if (next) pos = main(next)[0];
    else pos = main(prev)[1];
    let c0 = row ? content.y1 : content.x1;
    let c1 = row ? content.y2 : content.x2;
    if (L.wrap && ref) [c0, c1] = cross(ref);
    const line = row ? { x1: pos, y1: c0, x2: pos, y2: c1 } : { x1: c0, y1: pos, x2: c1, y2: pos };
    return { beforeId, line };
  }

  function cleanupMove(g) {
    g.ids.forEach((id) => {
      const gh = g.ghosts[id];
      if (gh) gh.remove();
      const src = R().el(id);
      if (src) src.classList.remove('f-drag-source');
    });
    world.querySelectorAll('.f-ghost').forEach((el) => el.remove());
    Folio.overlay.setGuides({ move: null, dropTarget: null, dropLine: null, hideHover: false, hideHandles: false });
  }

  function endMove(e) {
    const g = gesture;
    moveMove(e); // final position with the final modifiers
    const { target, beforeId } = g.drop || { target: null, beforeId: null };
    const tn = target ? store.get(target) : null;
    const flex = isFlex(tn);
    const origin = target && !flex ? contentOrigin(target) : { x: 0, y: 0 };
    let ids = g.ids;
    const starts = g.starts;

    if (g.alt) {
      const copies = store.duplicate(ids, 0);
      copies.forEach((c, i) => (starts[c] = starts[ids[i]]));
      ids = copies;
    }

    ids.forEach((id) => {
      const n = store.get(id);
      const st = starts[id];
      if (!n || !st) return;
      const oldParent = n.parent || null;
      const reparent = oldParent !== (target || null);
      const patch = {};
      if (reparent) {
        // keep the rendered size when leaving a context where hug/fill meant something else
        const sizing = {};
        ['w', 'h'].forEach((ax) => {
          const mode = n.sizing && n.sizing[ax];
          if (mode && mode !== 'fixed') {
            patch[ax === 'w' ? 'width' : 'height'] = Math.round(ax === 'w' ? st.width : st.height);
            if (mode === 'fill' && !flex) sizing[ax] = 'fixed';
          }
        });
        if (Object.keys(sizing).length) patch.sizing = sizing;
      }
      if (flex) {
        const list = tn.children;
        store.move(id, target, beforeId && list.includes(beforeId) ? list.indexOf(beforeId) : undefined);
      } else {
        if (reparent) store.move(id, target || null);
        patch.x = Math.round(st.x + g.dx - origin.x);
        patch.y = Math.round(st.y + g.dy - origin.y);
      }
      if (Object.keys(patch).length) store.update(id, patch);
    });

    store.select(ids);
    R().rerender(); // render the new layout before removing the ghosts (no flash)
    cleanupMove(g);
    store.commit(g.alt ? 'Duplicate' : 'Move');
  }

  // ---------- resize ----------
  function startResize(e, handle) {
    if (store.selection.length !== 1) return;
    const id = store.selection[0];
    const n = store.get(id);
    if (!n || lockedDeep(id) || inInstance(id)) return;
    R().sync();
    const box = layoutBox(id);
    if (!box) return;
    const parent = store.getParent(id);
    const w = clientToWorld(e.clientX, e.clientY);
    gesture = {
      type: 'resize',
      id,
      hx: handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0,
      hy: handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0,
      wx: w.x,
      wy: w.y,
      w0: box.width,
      h0: box.height,
      x0: n.x,
      y0: n.y,
      rot: box.rotation || 0,
      flexChild: isFlex(parent),
      changed: false,
    };
    const el = e.target;
    lockCursor((el && el.style.cursor) || 'default');
    store.setHover(null);
    Folio.overlay.setGuides({ hideHover: true });
  }

  function moveResize(e) {
    const g = gesture;
    const p = clientToWorld(e.clientX, e.clientY);
    const rad = (g.rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dxw = p.x - g.wx;
    const dyw = p.y - g.wy;
    // pointer delta in the node's local (unrotated) axes
    const lx = dxw * cos + dyw * sin;
    const ly = -dxw * sin + dyw * cos;
    const fromCenter = !!e.altKey;
    const mul = fromCenter ? 2 : 1;
    let w = g.w0;
    let h = g.h0;
    if (g.hx) w = g.w0 + g.hx * lx * mul;
    if (g.hy) h = g.h0 + g.hy * ly * mul;
    const keepRatio = e.shiftKey && g.w0 > 0 && g.h0 > 0;
    if (keepRatio) {
      const ratio = g.w0 / g.h0;
      if (g.hx && g.hy) {
        if (Math.abs(w / g.w0) >= Math.abs(h / g.h0)) h = w / ratio;
        else w = h * ratio;
      } else if (g.hx) h = w / ratio;
      else w = h * ratio;
    }
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    const touchW = !!g.hx || (keepRatio && !!g.hy);
    const touchH = !!g.hy || (keepRatio && !!g.hx);

    const patch = {};
    const sizing = {};
    if (touchW) {
      patch.width = w;
      sizing.w = 'fixed';
    } else w = g.w0;
    if (touchH) {
      patch.height = h;
      sizing.h = 'fixed';
    } else h = g.h0;
    patch.sizing = sizing;

    if (!g.flexChild) {
      // keep the opposite edge/corner (or the centre with Alt) fixed, in the parent's space
      const ax = fromCenter ? 0 : -g.hx;
      const ay = fromCenter ? 0 : -g.hy;
      const c0x = g.x0 + g.w0 / 2;
      const c0y = g.y0 + g.h0 / 2;
      const rx = (vx, vy) => [vx * cos - vy * sin, vx * sin + vy * cos];
      const [aox, aoy] = rx((ax * g.w0) / 2, (ay * g.h0) / 2);
      const [anx, any] = rx((ax * w) / 2, (ay * h) / 2);
      const cx = c0x + aox - anx;
      const cy = c0y + aoy - any;
      patch.x = round2(cx - w / 2);
      patch.y = round2(cy - h / 2);
    }
    g.changed = true;
    store.update(g.id, patch);
  }

  function endResize() {
    Folio.overlay.setGuides({ hideHover: false });
    if (gesture.changed) store.commit('Resize');
  }

  // ---------- draw ----------
  function startDraw(e) {
    const tool = store.tool;
    const p = clientToWorld(e.clientX, e.clientY);
    const parent = frameAt(e.clientX, e.clientY);
    gesture = {
      type: 'draw',
      tool,
      sx: e.clientX,
      sy: e.clientY,
      wx: Math.round(p.x),
      wy: Math.round(p.y),
      parent,
      origin: contentOrigin(parent),
      index: undefined,
      nodeId: null,
      moved: false,
      box: null,
    };
    const pn = parent && store.get(parent);
    if (isFlex(pn)) {
      const fd = flexDrop(parent, p, null);
      gesture.index = fd.beforeId ? pn.children.indexOf(fd.beforeId) : undefined;
    }
    store.setHover(null);
  }

  function drawBox(g, e) {
    const p = clientToWorld(e.clientX, e.clientY);
    let x1 = Math.round(p.x);
    let y1 = Math.round(p.y);
    let w = x1 - g.wx;
    let h = y1 - g.wy;
    if (e.shiftKey) {
      const s = Math.max(Math.abs(w), Math.abs(h));
      w = (w < 0 ? -1 : 1) * s;
      h = (h < 0 ? -1 : 1) * s;
    }
    if (e.altKey) {
      return { x: g.wx - Math.abs(w), y: g.wy - Math.abs(h), width: Math.max(1, Math.abs(w) * 2), height: Math.max(1, Math.abs(h) * 2) };
    }
    return {
      x: w < 0 ? g.wx + w : g.wx,
      y: h < 0 ? g.wy + h : g.wy,
      width: Math.max(1, Math.abs(w)),
      height: Math.max(1, Math.abs(h)),
    };
  }

  function shapeProps(tool, box, isRoot) {
    const base = { x: 0, y: 0, width: box.width, height: box.height };
    if (tool === 'frame') return { ...base, name: 'Frame', style: { fills: solid('#ffffff'), clip: !!isRoot } };
    if (tool === 'ellipse') return { ...base, name: 'Ellipse', style: { fills: solid(SHAPE_FILL), radius: 9999 } };
    return { ...base, name: 'Rectangle', style: { fills: solid(SHAPE_FILL) } };
  }

  function relPos(g, box) {
    const pn = g.parent && store.get(g.parent);
    if (isFlex(pn)) return { x: 0, y: 0 };
    return { x: Math.round(box.x - g.origin.x), y: Math.round(box.y - g.origin.y) };
  }

  function moveDraw(e) {
    const g = gesture;
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_THRESHOLD) return;
    g.moved = true;
    const box = drawBox(g, e);
    g.box = box;
    if (g.tool === 'frame' || g.tool === 'rect' || g.tool === 'ellipse') {
      const pos = relPos(g, box);
      if (!g.nodeId) {
        const props = shapeProps(g.tool, box, !g.parent);
        Object.assign(props, pos);
        g.nodeId = store.createNode('frame', props, g.parent, g.index).id;
        store.select([g.nodeId]);
      } else {
        store.update(g.nodeId, { ...pos, width: box.width, height: box.height });
      }
    } else {
      const a = worldToScreen(box.x, box.y);
      const z = store.viewport.zoom;
      Folio.overlay.setGuides({ marquee: { x: a.x, y: a.y, width: box.width * z, height: box.height * z } });
    }
  }

  function endDraw(e) {
    const g = gesture;
    Folio.overlay.setGuides({ marquee: null });
    const tool = g.tool;
    if (tool === 'text') {
      createText(g, g.moved ? g.box : null);
      return;
    }
    if (tool === 'image') {
      const box = g.moved ? g.box : null;
      const ctx = { parent: g.parent, origin: g.origin, index: g.index, point: { x: g.wx, y: g.wy } };
      pickImage((src, name) => {
        if (src) placeImageAt(src, name, ctx, box);
        else store.setTool('select');
      });
      return;
    }
    if (!g.nodeId) {
      const size = 100;
      const box = { x: g.wx, y: g.wy, width: size, height: size };
      const props = shapeProps(tool, box, !g.parent);
      Object.assign(props, relPos(g, box));
      g.nodeId = store.createNode('frame', props, g.parent, g.index).id;
    }
    store.select([g.nodeId]);
    store.commit('Add ' + (tool === 'rect' ? 'rectangle' : tool));
    store.setTool('select');
  }

  function createText(g, box) {
    const size = 16;
    const lh = 1.4;
    const wb = box || { x: g.wx, y: Math.round(g.wy - (size * lh) / 2), width: 200, height: size * lh };
    const pos = relPos(g, wb);
    const props = {
      name: 'Text',
      ...pos,
      width: Math.max(8, wb.width),
      height: Math.round(size * lh),
      sizing: { w: box ? 'fixed' : 'hug', h: 'hug' },
      text: { content: '', size, lineHeight: lh },
    };
    const node = store.createNode('text', props, g.parent, g.index);
    store.select([node.id]);
    store.setTool('select');
    R().rerender();
    startTextEdit(node.id);
  }

  // ---------- marquee ----------
  function startMarquee(e, scope, clickSelect) {
    const w = clientToWorld(e.clientX, e.clientY);
    gesture = {
      type: 'marquee',
      sx: e.clientX,
      sy: e.clientY,
      wx: w.x,
      wy: w.y,
      scope,
      clickSelect,
      base: e.shiftKey ? store.selection.slice() : [],
      moved: false,
    };
  }
  function moveMarquee(e) {
    const g = gesture;
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_THRESHOLD) return;
    if (!g.moved) {
      g.moved = true;
      store.setHover(null);
      Folio.overlay.setGuides({ hideHover: true });
    }
    const p = clientToWorld(e.clientX, e.clientY);
    const r = { x1: Math.min(g.wx, p.x), y1: Math.min(g.wy, p.y), x2: Math.max(g.wx, p.x), y2: Math.max(g.wy, p.y) };
    const candidates = g.scope ? (store.get(g.scope) || { children: [] }).children : store.doc.roots;
    const hits = candidates.filter((id) => {
      if (lockedDeep(id) || hiddenDeep(id)) return false;
      const b = nodeRect(id);
      return b && b.x <= r.x2 && b.x + b.width >= r.x1 && b.y <= r.y2 && b.y + b.height >= r.y1;
    });
    const next = g.base.concat(hits.filter((id) => !g.base.includes(id)));
    if (next.join() !== store.selection.join()) store.select(next);
    const a = worldToScreen(r.x1, r.y1);
    const z = store.viewport.zoom;
    Folio.overlay.setGuides({ marquee: { x: a.x, y: a.y, width: (r.x2 - r.x1) * z, height: (r.y2 - r.y1) * z } });
  }
  function endMarquee(e) {
    const g = gesture;
    Folio.overlay.setGuides({ marquee: null, hideHover: false });
    if (!g.moved && g.clickSelect) {
      if (e.shiftKey) store.toggleSelect(g.clickSelect);
      else store.select([g.clickSelect]);
    }
  }

  // ---------- double click ----------
  function onDblClick(e) {
    if (store.tool !== 'select' || editing || spaceHeld) return;
    if (e.target.closest && e.target.closest('.f-ov-label, .f-ov-handle')) return;
    const path = hitPath(e.clientX, e.clientY);
    if (!path) return;
    const prim = store.primary();
    let i = prim ? path.indexOf(prim.id) : -1;
    if (i < 0) i = path.indexOf(clickTarget(path, false));
    const cur = store.get(path[i]);
    const point = { x: e.clientX, y: e.clientY };
    if (cur && cur.type === 'text') return startTextEdit(cur.id, point);
    const next = path[i + 1];
    if (!next) return;
    store.select([next]);
    if (store.get(next).type === 'text' && next === path[path.length - 1]) startTextEdit(next, point);
  }

  // ---------- text editing ----------
  function readText(el) {
    let t = el.innerText;
    if (t == null) t = el.textContent;
    // contentEditable keeps a trailing <br> as a placeholder line
    if (t.endsWith('\n') && !(el.textContent || '').endsWith('\n')) t = t.slice(0, -1);
    return t.replace(/\r\n?/g, '\n');
  }

  function startTextEdit(id, point) {
    const n = store.get(id);
    if (!n || n.type !== 'text' || lockedDeep(id)) return;
    if (editing) endTextEdit();
    if (gesture) cancelGesture();
    R().sync();
    const el = R().el(id);
    if (!el) return;
    store.editingTextId = id;
    if (store.selection.length !== 1 || store.selection[0] !== id) store.select([id]);
    store.setHover(null);
    el.contentEditable = 'plaintext-only';
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.spellcheck = false;
    el.classList.add('is-editing');
    el.focus({ preventScroll: true });

    const sel = window.getSelection();
    let placed = false;
    if (point && document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(point.x, point.y);
      if (r && el.contains(r.startContainer)) {
        sel.removeAllRanges();
        sel.addRange(r);
        placed = true;
      }
    }
    if (!placed) {
      const r = document.createRange();
      r.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(r);
    }

    const onInput = () => {
      if (!store.get(id)) return;
      store.update(id, { text: { content: readText(el) } });
    };
    const onKey = (ev) => {
      ev.stopPropagation(); // editing is modal: app shortcuts must not fire
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey))) {
        ev.preventDefault();
        endTextEdit();
      }
    };
    const onBlur = () => endTextEdit();
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
    editing = { id, el, onInput, onKey, onBlur };
    Folio.overlay.schedule();
  }

  function teardownEditor(ed) {
    const { el } = ed;
    el.removeEventListener('input', ed.onInput);
    el.removeEventListener('keydown', ed.onKey);
    el.removeEventListener('blur', ed.onBlur);
    el.removeAttribute('contenteditable');
    el.classList.remove('is-editing');
    const s = window.getSelection();
    if (s && s.rangeCount && el.contains(s.anchorNode)) s.removeAllRanges();
    if (document.activeElement === el) el.blur();
  }

  function endTextEdit() {
    if (!editing) return;
    const ed = editing;
    editing = null;
    const text = readText(ed.el);
    teardownEditor(ed);
    if (store.editingTextId === ed.id) store.editingTextId = null;
    const n = store.get(ed.id);
    if (n) {
      if (!text.trim()) inInstance(ed.id) ? store.update(ed.id, { visible: false }) : store.remove([ed.id]);
      else if (text !== n.text.content) store.update(ed.id, { text: { content: text } });
      else store.emit('change'); // let the renderer normalise the DOM the editor left behind
    }
    store.commit('Edit text');
    Folio.overlay.schedule();
  }

  /** The doc changed underneath the editor (undo, delete): drop the editor without committing. */
  function checkEditorStillValid() {
    if (!editing) return;
    if (store.editingTextId !== editing.id || !store.get(editing.id) || R().el(editing.id) !== editing.el) {
      const ed = editing;
      editing = null;
      teardownEditor(ed);
      if (store.editingTextId === ed.id) store.editingTextId = null;
    }
  }

  // ---------- images ----------
  function pickImage(cb) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;';
    document.body.appendChild(input);
    let done = false;
    const finish = (src, name) => {
      if (done) return;
      done = true;
      input.remove();
      cb(src, name);
    };
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) return finish(null);
      readFile(f).then((src) => finish(src, f.name), () => finish(null));
    });
    input.addEventListener('cancel', () => finish(null));
    input.click();
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  function loadSize(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 240, h: img.naturalHeight || 160 });
      img.onerror = () => resolve({ w: 240, h: 160 });
      img.src = src;
    });
  }

  const cleanName = (name) => (name ? String(name).replace(/\.[a-z0-9]+$/i, '') : 'Image') || 'Image';

  /** Place an image with an explicit context (from the image tool or a file drop). */
  function placeImageAt(src, name, ctx, box) {
    return loadSize(src).then(({ w, h }) => {
      const parent = ctx.parent && store.get(ctx.parent) ? ctx.parent : null;
      const pn = parent && store.get(parent);
      let width = w;
      let height = h;
      let wb = box;
      if (!wb) {
        // fit inside the parent (or the visible canvas) without upscaling
        const s = vpSize();
        const z = store.viewport.zoom;
        let maxW = (s.w / z) * 0.6;
        let maxH = (s.h / z) * 0.6;
        if (pn) {
          const pb = layoutBox(parent);
          if (pb) {
            maxW = Math.min(maxW, pb.width);
            maxH = Math.min(maxH, pb.height);
          }
        }
        const k = Math.min(1, maxW / width, maxH / height);
        width = Math.max(1, Math.round(width * k));
        height = Math.max(1, Math.round(height * k));
        const pt = ctx.point;
        wb = ctx.centered
          ? { x: Math.round(pt.x - width / 2), y: Math.round(pt.y - height / 2), width, height }
          : { x: pt.x, y: pt.y, width, height };
      }
      const origin = parent ? contentOrigin(parent) : { x: 0, y: 0 };
      const flex = isFlex(pn);
      const node = store.createNode(
        'image',
        {
          name: cleanName(name),
          x: flex ? 0 : Math.round(wb.x - origin.x),
          y: flex ? 0 : Math.round(wb.y - origin.y),
          width: Math.round(wb.width),
          height: Math.round(wb.height),
          image: { src, fit: 'cover' },
        },
        parent,
        ctx.index
      );
      store.select([node.id]);
      store.commit('Place image');
      if (store.tool !== 'select') store.setTool('select');
      return node;
    });
  }

  /** Public: place an image (data URL or URL) into the selected frame, or onto the visible canvas. */
  function placeImage(src, name) {
    if (!src) return Promise.resolve(null);
    autoFitArmed = false;
    R() && R().sync();
    const s = vpSize();
    const center = screenToWorld(s.w / 2, s.h / 2);
    let parent = null;
    const prim = store.primary();
    if (prim && !lockedDeep(prim.id)) parent = prim.type === 'frame' ? prim.id : prim.parent;
    if (!parent) {
      const r = vpRect();
      parent = frameAt(r.left + s.w / 2, r.top + s.h / 2);
    }
    let point = center;
    if (parent) {
      const pb = layoutBox(parent);
      const pn = store.get(parent);
      // centre in the parent when the view centre is not inside it
      if (pb && !(center.x >= pb.x && center.x <= pb.x + pb.width && center.y >= pb.y && center.y <= pb.y + pb.height))
        point = { x: pb.x + pb.width / 2, y: pb.y + pb.height / 2 };
      if (isFlex(pn)) point = center;
    }
    return placeImageAt(src, name, { parent, point, centered: true }, null);
  }

  function onDragOver(e) {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }
  function onDrop(e) {
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => /^image\//.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    const p = clientToWorld(e.clientX, e.clientY);
    const parent = frameAt(e.clientX, e.clientY);
    let offset = 0;
    files.forEach((f) =>
      readFile(f).then((src) => {
        const pt = { x: p.x + offset, y: p.y + offset };
        offset += 24;
        const pn = parent && store.get(parent);
        let index;
        if (isFlex(pn)) {
          const fd = flexDrop(parent, p, null);
          index = fd.beforeId ? pn.children.indexOf(fd.beforeId) : undefined;
        }
        placeImageAt(src, f.name, { parent, point: pt, centered: true, index }, null);
      })
    );
  }

  // ---------- artboards ----------
  function createArtboard(preset) {
    let p = preset;
    if (typeof p === 'string') p = (Folio.presets || []).find((x) => x.name === p);
    if (!p) p = (Folio.presets && Folio.presets[0]) || { name: 'Desktop', width: 1440, height: 900 };
    autoFitArmed = false;
    R() && R().sync();
    let x = 0;
    let y = 0;
    const roots = store.doc.roots.filter((id) => store.get(id));
    if (roots.length) {
      let maxRight = -Infinity;
      let minTop = Infinity;
      roots.forEach((id) => {
        const r = nodeRect(id);
        if (!r) return;
        maxRight = Math.max(maxRight, r.x + r.width);
        minTop = Math.min(minTop, r.y);
      });
      if (isFinite(maxRight)) {
        x = Math.round(maxRight + 100);
        y = Math.round(minTop);
      }
    }
    const node = store.createNode('frame', {
      name: p.name || 'Artboard',
      x,
      y,
      width: Number(p.width) || 1440,
      height: Number(p.height) || 900,
      sizing: { w: 'fixed', h: 'fixed' },
      style: { fills: solid('#ffffff'), clip: true },
    });
    store.select([node.id]);
    store.commit('Add artboard');
    R() && R().rerender();
    zoomToFit([node.id]);
    return node;
  }

  // ---------- keyboard (Space = temporary hand only; shortcuts.js owns the rest) ----------
  function onKeyDown(e) {
    if (e.code === 'Space' || e.key === ' ') {
      if (Folio.ui && Folio.ui.isTyping()) return;
      e.preventDefault();
      if (!spaceHeld) {
        spaceHeld = true;
        store.setHover(null);
        updateCursor();
      }
      return;
    }
    if (gesture && (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Control')) refreshGesture(e);
  }
  function onKeyUp(e) {
    if (e.code === 'Space' || e.key === ' ') {
      if (spaceHeld) {
        spaceHeld = false;
        updateCursor();
      }
      return;
    }
    if (gesture && (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Control')) refreshGesture(e);
  }

  // ---------- init ----------
  function init() {
    if (inited) return;
    vp = document.getElementById('canvas-viewport');
    world = document.getElementById('canvas-world');
    if (!vp || !world) return;
    inited = true;
    if (Folio.overlay) Folio.overlay.init();

    vp.addEventListener('pointerdown', onPointerDown);
    vp.addEventListener('pointermove', onHoverMove);
    vp.addEventListener('pointerleave', () => !gesture && store.setHover(null));
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    vp.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault()); // no autoscroll
    vp.addEventListener('wheel', onWheel, { passive: false });
    vp.addEventListener('dblclick', onDblClick);
    vp.addEventListener('dragstart', (e) => e.preventDefault());
    vp.addEventListener('dragover', onDragOver);
    vp.addEventListener('drop', onDrop);
    // an overflow:hidden box can still be scrolled by focus/caret; keep it pinned
    vp.addEventListener('scroll', () => {
      vp.scrollTop = 0;
      vp.scrollLeft = 0;
    });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => {
      spaceHeld = false;
      updateCursor();
      if (gesture) cancelGesture();
    });

    store.on('tool', () => {
      if (editing) endTextEdit();
      updateCursor();
      store.setHover(null);
    });
    store.on('selection', () => {
      if (editing && !store.selection.includes(editing.id)) endTextEdit();
    });
    store.on('change', () => {
      checkEditorStillValid();
      if (autoFitArmed && store.doc.roots.length && !gesture) {
        autoFitArmed = false;
        requestAnimationFrame(() => requestAnimationFrame(() => zoomToFit()));
      }
    });
    store.on('doc', () => {
      if (store.doc === lastDoc) return; // just a rename
      lastDoc = store.doc;
      if (store.doc.roots.length) {
        R() && R().rerender();
        zoomToFit();
      } else autoFitArmed = true;
    });
    store.on('zoom:fit', (ids) => zoomToFit(Array.isArray(ids) ? ids : undefined));
    // another page: back to where the person left it, or fit its artboards
    store.on('page', (page) => {
      if (editing) endTextEdit();
      if (gesture) cancelGesture();
      R() && R().rerender();
      const v = page && page.viewport;
      if (v && isFinite(v.x) && isFinite(v.y) && v.zoom > 0) store.setViewport({ x: v.x, y: v.y, zoom: clamp(v.zoom, MIN_ZOOM, MAX_ZOOM) });
      else if (store.doc.roots.length) zoomToFit();
      else {
        const s = vpSize();
        store.setViewport({ x: Math.round(s.w / 2), y: Math.round(s.h / 2), zoom: 1 });
      }
    });
    // right-click a layer on the canvas: the same menu as in the Layers panel (incl. Move to page)
    vp.addEventListener('contextmenu', (e) => {
      if (!Folio.layers || !Folio.layers.contextMenu) return;
      const label = e.target.closest && e.target.closest('.f-ov-label');
      const path = label && label.dataset.root ? [label.dataset.root] : hitPath(e.clientX, e.clientY);
      const id = path && (store.selection.find((s) => path.includes(s)) || clickTarget(path, e.metaKey || e.ctrlKey));
      if (!id) return;
      e.preventDefault();
      Folio.layers.contextMenu(id, e.clientX, e.clientY);
    });

    updateCursor();
    lastDoc = store.doc;
    if (store.doc.roots.length) zoomToFit();
    else {
      const s = vpSize();
      store.setViewport({ x: Math.round(s.w / 2), y: Math.round(s.h / 2), zoom: 1 });
      autoFitArmed = true;
    }
  }

  function disarmAutoFit() {
    autoFitArmed = false;
  }

  Folio.canvas = {
    init,
    zoomToFit,
    zoomToSelection,
    setZoom,
    zoomIn,
    zoomOut,
    screenToWorld,
    worldToScreen,
    centerOn,
    nodeRect,
    layoutBox,
    startTextEdit,
    endTextEdit,
    isEditing: () => !!editing,
    placeImage,
    createArtboard,
    hitPath,
    frameAt,
    flexDrop,
    contentOrigin,
    disarmAutoFit,
  };
})();
