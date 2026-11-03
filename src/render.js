/*
 * render.js — turns the document into real DOM inside #canvas-world.
 *
 *   Folio.render.init()          find #canvas-world, subscribe to the store, first render
 *   Folio.render.el(id)          the DOM element for a node (or null)
 *   Folio.render.rerender()      synchronous full render (doc + viewport + overlay)
 *   Folio.render.sync()          flush a pending render right now (no-op when up to date)
 *   Folio.render.layoutBox(id)   world-space, *unrotated* layout box {x,y,width,height,rotation}
 *   Folio.render.bounds(id)      world-space axis-aligned bounding box (includes rotation)
 *   Folio.render.resolveSrc(src) `brand-logo:<id>` -> the brand logo's src (other srcs unchanged)
 *   Folio.render.peek(ids, fn)   run fn (sync or async) with those layers' off-page artboards laid out
 *
 * It is a small keyed reconciler: one element per node (data-id), styled with
 * exactly the CSS produced by Folio.css.nodeStyles — what you see is the code.
 * Renders are batched with requestAnimationFrame on store 'change'.
 */
window.Folio = window.Folio || {};

(function () {
  const store = Folio.store;

  let world = null;
  let viewportEl = null;
  const els = new Map(); // id -> element
  const lastCss = new WeakMap(); // element -> last cssText we applied
  const lastSrc = new WeakMap(); // img element -> last src we applied
  let docDirty = true;
  let vpDirty = true;
  let raf = 0;
  let active = new Set(); // artboards of the current page
  const peeking = new Map(); // off-page artboard id -> peek() depth

  const PLACEHOLDER =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='160' viewBox='0 0 240 160' preserveAspectRatio='xMidYMid slice'>` +
        `<rect width='240' height='160' fill='#dcdce2'/>` +
        `<g fill='none' stroke='#a3a3ad' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'>` +
        `<rect x='96' y='58' width='48' height='40' rx='5'/><circle cx='110' cy='72' r='4'/><path d='M144 88l-12-12-26 22'/></g></svg>`
    );

  function init() {
    world = document.getElementById('canvas-world');
    viewportEl = document.getElementById('canvas-viewport');
    if (!world) return;
    store.on('change', () => {
      docDirty = true;
      schedule();
    });
    store.on('viewport', () => {
      vpDirty = true;
      schedule();
    });
    // brand kit edits (logo replaced, font family changed, …): colours/radii update through the
    // CSS variables on #canvas-world, but logo srcs and web fonts need a fresh pass
    store.on('brand', () => {
      docDirty = true;
      schedule();
    });
    rerender();
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(flush);
  }

  function flush() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (!world) return;
    if (docDirty) reconcile();
    if (vpDirty) applyViewport();
    if (Folio.overlay && Folio.overlay.update) Folio.overlay.update();
  }

  /** Synchronous full render. */
  function rerender() {
    docDirty = true;
    vpDirty = true;
    flush();
  }

  /** Flush pending work now so the DOM can be measured. */
  function sync() {
    if (docDirty || vpDirty) flush();
  }

  function applyViewport() {
    vpDirty = false;
    const v = store.viewport;
    world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
  }

  // ---------- reconciler ----------
  function reconcile() {
    docDirty = false;
    const doc = store.doc;
    const seen = new Set();
    // every page's artboards are rendered; other pages' are display:none (and their subtrees are
    // only re-synced when shown/peeked or when an element is missing, so many pages stay cheap)
    const cur = (store.currentPage && store.currentPage()) || null;
    active = new Set(cur ? cur.roots : doc.roots);
    const all = doc.pages ? doc.pages.flatMap((p) => p.roots) : doc.roots;
    placeChildren(world, all, null, seen, doc);
    for (const [id, el] of els) {
      if (!seen.has(id)) {
        el.remove();
        els.delete(id);
      }
    }
  }

  function placeChildren(parentEl, ids, parentNode, seen, doc) {
    let i = 0;
    for (const id of ids || []) {
      const node = doc.nodes[id];
      if (!node || seen.has(id)) continue;
      seen.add(id);
      const el = ensureEl(node);
      updateEl(el, node, parentNode);
      const ref = parentEl.children[i];
      if (ref !== el) parentEl.insertBefore(el, ref || null);
      i++;
      if (node.type !== 'frame') continue;
      if (!parentNode && !active.has(id) && !peeking.has(id) && intact(node, el, seen, doc)) continue;
      placeChildren(el, node.children, node, seen, doc);
    }
    // leftovers that were deleted (moved ones get picked up by their new parent;
    // non-node helpers such as drag ghosts have no data-id and are left alone)
    for (let j = parentEl.children.length - 1; j >= i; j--) {
      const c = parentEl.children[j];
      const cid = c.dataset && c.dataset.id;
      if (cid && !doc.nodes[cid]) {
        c.remove();
        els.delete(cid);
      }
    }
  }

  /** An off-page subtree whose elements all exist under the right parents: mark it seen, skip the work. */
  function intact(node, el, seen, doc) {
    const ids = [];
    const ok = (function walk(n, e) {
      for (const c of n.children) {
        const cn = doc.nodes[c];
        const ce = els.get(c);
        if (!cn || !ce || ce.parentNode !== e || seen.has(c)) return false;
        ids.push(c);
        if (cn.type === 'frame' && !walk(cn, ce)) return false;
      }
      return true;
    })(node, el);
    if (ok) ids.forEach((c) => seen.add(c));
    return ok;
  }

  /**
   * Run fn while the artboards holding `ids` are laid out even if they sit on another page
   * (clipped away and click-through, so nothing flashes): measuring, thumbnails, PNG export.
   * fn may return a promise; the artboards hide again when it settles.
   */
  function peek(ids, fn) {
    const roots = [...new Set([].concat(ids || []).filter((id) => store.get(id)).map((id) => store.rootOf(id)))];
    const cur = store.currentPage ? store.currentPage().roots : store.doc.roots;
    const off = roots.filter((r) => !cur.includes(r));
    const fresh = off.some((r) => !peeking.has(r));
    off.forEach((r) => peeking.set(r, (peeking.get(r) || 0) + 1));
    if (fresh && world) reconcile();
    const done = () => {
      let hide = false;
      off.forEach((r) => (peeking.get(r) > 1 ? peeking.set(r, peeking.get(r) - 1) : (peeking.delete(r), (hide = true))));
      if (hide) {
        docDirty = true;
        schedule();
      }
    };
    let out;
    try {
      out = fn();
    } catch (e) {
      done();
      throw e;
    }
    if (out && typeof out.then === 'function') return out.finally(done);
    done();
    return out;
  }

  function ensureEl(node) {
    const tag = node.type === 'image' ? 'IMG' : 'DIV';
    let el = els.get(node.id);
    if (el && el.tagName !== tag) {
      const old = el;
      el = createEl(node, tag);
      if (old.parentNode) old.parentNode.replaceChild(el, old);
      return el;
    }
    return el || createEl(node, tag);
  }

  function createEl(node, tag) {
    const el = document.createElement(tag);
    el.dataset.id = node.id;
    el.classList.add('f-node');
    if (tag === 'IMG') {
      el.draggable = false;
      el.alt = '';
      el.decoding = 'async';
    }
    els.set(node.id, el);
    return el;
  }

  function updateEl(el, node, parentNode) {
    let css = Folio.css.toCssText(Folio.css.nodeStyles(node, { mode: 'canvas', parent: parentNode || null }));
    if (node.visible === false) css += ' display: none;';
    else if (!parentNode && !active.has(node.id)) css += peeking.has(node.id) ? ' clip-path: inset(50%); pointer-events: none;' : ' display: none;';
    if (lastCss.get(el) !== css) {
      el.style.cssText = css;
      lastCss.set(el, css);
    }
    const cl = el.classList;
    cl.toggle('f-node--frame', node.type === 'frame');
    cl.toggle('f-node--text', node.type === 'text');
    cl.toggle('f-node--image', node.type === 'image');
    cl.toggle('f-node--root', !parentNode);
    if (node.locked) el.dataset.locked = 'true';
    else if (el.dataset.locked) delete el.dataset.locked;

    if (node.type === 'text') {
      const t = node.text || {};
      if (Folio.fonts && t.font) Folio.fonts.ensure(t.font);
      if (store.editingTextId !== node.id) {
        const content = t.content == null ? '' : String(t.content);
        if (el.textContent !== content || el.childNodes.length > 1) el.textContent = content;
      }
    } else if (node.type === 'image') {
      const src = resolveSrc(node.image && node.image.src) || PLACEHOLDER;
      if (lastSrc.get(el) !== src) {
        el.src = src;
        lastSrc.set(el, src);
      }
    } else if (el.firstChild && el.firstChild.nodeType === 3) {
      // a frame never holds text directly
      Array.from(el.childNodes).forEach((c) => c.nodeType === 3 && c.remove());
    }
  }

  /** `brand-logo:<id>` -> the logo's data URL / URL (empty when the logo is gone). */
  function resolveSrc(src) {
    if (src && typeof src === 'string' && src.startsWith('brand-logo:')) {
      return Folio.brand && Folio.brand.resolveSrc ? Folio.brand.resolveSrc(src) || '' : '';
    }
    return src;
  }

  // ---------- geometry (world space) ----------
  function el(id) {
    return els.get(id) || null;
  }

  function measurable(e) {
    return e && e.isConnected && e.getClientRects().length > 0;
  }

  /** Axis-aligned bounding box in world coordinates (rotation included). */
  function bounds(id) {
    sync();
    const e = els.get(id);
    if (!measurable(e)) return null;
    const r = e.getBoundingClientRect();
    const vr = viewportEl.getBoundingClientRect();
    const v = store.viewport;
    return {
      x: (r.left - vr.left - v.x) / v.zoom,
      y: (r.top - vr.top - v.y) / v.zoom,
      width: r.width / v.zoom,
      height: r.height / v.zoom,
    };
  }

  /** Unrotated layout box (where the node's CSS box sits before its own rotation), world coords. */
  function layoutBox(id) {
    const b = bounds(id);
    if (!b) return null;
    const n = store.get(id);
    const rot = (n && n.style && Number(n.style.rotation)) || 0;
    if (!rot) return { x: b.x, y: b.y, width: b.width, height: b.height, rotation: 0 };
    const cs = getComputedStyle(els.get(id));
    const w = parseFloat(cs.width) || 0;
    const h = parseFloat(cs.height) || 0;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    return { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rotation: rot };
  }

  Folio.render = { init, el, rerender, sync, schedule, bounds, layoutBox, resolveSrc, peek, PLACEHOLDER };
})();
