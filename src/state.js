/*
 * state.js — the "brain" of Folio.
 *
 * Holds the document (every layer you draw), the selection, the current tool,
 * the viewport (pan/zoom), undo/redo history and autosave.
 *
 * Every other file reads from and writes to `Folio.store`.
 * Mutating helpers change the document and emit 'change' immediately (so the
 * canvas updates live while you drag). Call `store.commit()` when a gesture is
 * finished to record one undo step and autosave.
 */
window.Folio = window.Folio || {};

(function () {
  const STORAGE_KEY = 'folio:autosave:v1';
  const MAX_HISTORY = 150;

  // ---------- small utilities ----------
  const uid = () => 'n_' + Math.random().toString(36).slice(2, 9);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

  /** Deep-merge `patch` into `target`. Arrays are replaced, not merged. */
  function deepMerge(target, patch) {
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (isObj(v) && isObj(target[k])) deepMerge(target[k], v);
      else target[k] = isObj(v) ? clone(v) : Array.isArray(v) ? clone(v) : v;
    }
    return target;
  }

  // ---------- node defaults ----------
  function defaultNode(type) {
    const base = {
      id: uid(),
      type,
      name: type === 'frame' ? 'Frame' : type === 'text' ? 'Text' : 'Image',
      parent: null,
      children: [],
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      sizing: { w: 'fixed', h: 'fixed' },
      visible: true,
      locked: false,
      style: {
        fills: [],
        radius: 0,
        border: { width: 0, color: '#000000', style: 'solid' },
        shadows: [],
        opacity: 1,
        blur: 0,
        backdropBlur: 0,
        blend: 'normal',
        clip: false,
        rotation: 0,
      },
    };
    if (type === 'frame') {
      base.width = 200;
      base.height = 200;
      base.style.fills = [{ type: 'solid', color: '#ffffff', visible: true }];
      base.layout = {
        mode: 'none', // 'none' = freeform (children placed by x/y), 'flex' = auto layout
        direction: 'column',
        wrap: false,
        gap: 0,
        justify: 'flex-start', // flex-start | center | flex-end | space-between
        align: 'flex-start', // flex-start | center | flex-end | stretch
        padding: [0, 0, 0, 0], // top, right, bottom, left
      };
    }
    if (type === 'text') {
      base.name = 'Text';
      base.sizing = { w: 'hug', h: 'hug' };
      base.width = 200;
      base.height = 24;
      base.text = {
        content: 'Text',
        font: 'Inter',
        size: 16,
        weight: 400,
        lineHeight: 1.4,
        letterSpacing: 0, // in em
        color: '#111111',
        align: 'left',
        transform: 'none',
        italic: false,
        decoration: 'none',
      };
    }
    if (type === 'image') {
      base.width = 240;
      base.height = 160;
      base.image = { src: '', fit: 'cover' };
    }
    return base;
  }

  // Artboard presets — sizes for common screens and social formats.
  const presets = [
    { group: 'Web', name: 'Desktop', width: 1440, height: 900 },
    { group: 'Web', name: 'Laptop', width: 1280, height: 800 },
    { group: 'Web', name: 'Tablet', width: 768, height: 1024 },
    { group: 'Web', name: 'Mobile', width: 390, height: 844 },
    { group: 'Social', name: 'Instagram Post', width: 1080, height: 1080 },
    { group: 'Social', name: 'Instagram Portrait', width: 1080, height: 1350 },
    { group: 'Social', name: 'Story / Reel', width: 1080, height: 1920 },
    { group: 'Social', name: 'Facebook / Link Ad', width: 1200, height: 628 },
    { group: 'Social', name: 'LinkedIn Banner', width: 1584, height: 396 },
    { group: 'Social', name: 'X / Twitter Post', width: 1600, height: 900 },
    { group: 'Social', name: 'YouTube Thumbnail', width: 1280, height: 720 },
  ];

  function emptyDoc() {
    return { version: 1, name: 'Untitled', nodes: {}, roots: [] };
  }

  // ---------- the store ----------
  const listeners = {};
  const store = {
    doc: emptyDoc(),
    selection: [], // array of node ids; last one is the "primary" selection
    tool: 'select', // select | hand | frame | rect | ellipse | text | image
    viewport: { x: 0, y: 0, zoom: 1 }, // world -> screen: screen = world * zoom + (x, y)
    hoverId: null,
    editingTextId: null,
    clipboard: null,
    history: [],
    historyIndex: -1,

    // ----- events -----
    on(evt, fn) {
      (listeners[evt] = listeners[evt] || []).push(fn);
      return () => (listeners[evt] = listeners[evt].filter((f) => f !== fn));
    },
    emit(evt, data) {
      (listeners[evt] || []).forEach((fn) => {
        try {
          fn(data);
        } catch (e) {
          console.error('[Folio] listener error for', evt, e);
        }
      });
    },

    // ----- reading -----
    get(id) {
      return this.doc.nodes[id] || null;
    },
    getParent(id) {
      const n = this.get(id);
      return n && n.parent ? this.get(n.parent) : null;
    },
    /** Siblings array (ids) that contains `id` — either parent.children or doc.roots. */
    siblingsOf(id) {
      const p = this.getParent(id);
      return p ? p.children : this.doc.roots;
    },
    /** Ancestors from the root down to (not including) the node. */
    ancestors(id) {
      const out = [];
      let n = this.getParent(id);
      while (n) {
        out.unshift(n.id);
        n = this.getParent(n.id);
      }
      return out;
    },
    isAncestor(ancestorId, id) {
      return this.ancestors(id).includes(ancestorId);
    },
    descendants(id) {
      const out = [];
      const walk = (nid) => {
        const n = this.get(nid);
        if (!n) return;
        n.children.forEach((c) => {
          out.push(c);
          walk(c);
        });
      };
      walk(id);
      return out;
    },
    /** The top-level artboard that contains `id` (or `id` itself if it is a root). */
    rootOf(id) {
      const anc = this.ancestors(id);
      return anc.length ? anc[0] : id;
    },
    isRoot(id) {
      return this.doc.roots.includes(id);
    },
    primary() {
      return this.selection.length ? this.get(this.selection[this.selection.length - 1]) : null;
    },
    selectedNodes() {
      return this.selection.map((id) => this.get(id)).filter(Boolean);
    },

    // ----- creating & mutating (emit 'change'; remember to commit()) -----
    /**
     * Create a node. `props` is deep-merged over the defaults.
     * parentId null => top-level artboard. index undefined => append (on top).
     */
    createNode(type, props = {}, parentId = null, index) {
      const node = defaultNode(type);
      deepMerge(node, props);
      node.id = props.id && !this.doc.nodes[props.id] ? props.id : node.id;
      node.children = [];
      node.parent = parentId;
      this.doc.nodes[node.id] = node;
      const list = parentId ? this.get(parentId).children : this.doc.roots;
      if (index === undefined || index < 0 || index > list.length) list.push(node.id);
      else list.splice(index, 0, node.id);
      this.emit('change');
      return node;
    },

    /**
     * Build nodes from a nested plain-object tree. Great for templates, the demo
     * document, and (later) AI-generated designs.
     *   { type:'frame', name:'Card', width:300, ..., children:[ {type:'text', text:{content:'Hi'}} ] }
     * Returns the created root node.
     */
    buildFromTree(tree, parentId = null, index) {
      const { children = [], type = 'frame', ...props } = tree;
      const node = this.createNode(type, props, parentId, index);
      children.forEach((c) => this.buildFromTree(c, node.id));
      return node;
    },

    /** Deep-merge a patch into one node. */
    update(id, patch) {
      const n = this.get(id);
      if (!n) return;
      deepMerge(n, patch);
      this.emit('change');
    },

    /** Apply a patch (object or function(node) => object) to many nodes. */
    updateMany(ids, patch) {
      ids.forEach((id) => {
        const n = this.get(id);
        if (!n) return;
        deepMerge(n, typeof patch === 'function' ? patch(n) || {} : patch);
      });
      this.emit('change');
    },

    remove(ids) {
      ids = [].concat(ids);
      ids.forEach((id) => {
        const n = this.get(id);
        if (!n) return;
        const sib = this.siblingsOf(id);
        const i = sib.indexOf(id);
        if (i >= 0) sib.splice(i, 1);
        [id, ...this.descendants(id)].forEach((d) => delete this.doc.nodes[d]);
      });
      this.selection = this.selection.filter((id) => this.doc.nodes[id]);
      this.emit('change');
      this.emit('selection');
    },

    /** Move node into newParentId (null = canvas) at index. Refuses to move into itself. */
    move(id, newParentId, index) {
      const n = this.get(id);
      if (!n) return false;
      if (newParentId && (newParentId === id || this.isAncestor(id, newParentId))) return false;
      if (newParentId && this.get(newParentId).type !== 'frame') return false;
      const oldList = this.siblingsOf(id);
      const oldIndex = oldList.indexOf(id);
      oldList.splice(oldIndex, 1);
      n.parent = newParentId || null;
      const list = newParentId ? this.get(newParentId).children : this.doc.roots;
      if (list === oldList && index !== undefined && index > oldIndex) index -= 1;
      if (index === undefined || index < 0 || index > list.length) list.push(id);
      else list.splice(index, 0, id);
      this.emit('change');
      return true;
    },

    /** Move a node up (+1) or down (-1) in z-order among its siblings. 'front'/'back' also allowed. */
    reorder(id, delta) {
      const sib = this.siblingsOf(id);
      const i = sib.indexOf(id);
      if (i < 0) return;
      let j = delta === 'front' ? sib.length - 1 : delta === 'back' ? 0 : i + delta;
      j = Math.max(0, Math.min(sib.length - 1, j));
      if (i === j) return;
      sib.splice(i, 1);
      sib.splice(j, 0, id);
      this.emit('change');
    },

    /** Serialize a node and its subtree into a tree object (inverse of buildFromTree). */
    toTree(id) {
      const n = this.get(id);
      if (!n) return null;
      const { id: _id, parent, children, ...rest } = clone(n);
      return { ...rest, children: n.children.map((c) => this.toTree(c)) };
    },

    duplicate(ids, offset = 20) {
      const created = [];
      ids.forEach((id) => {
        const n = this.get(id);
        if (!n) return;
        const tree = this.toTree(id);
        const sib = this.siblingsOf(id);
        const parent = this.getParent(id);
        const freeform = !parent || parent.layout.mode !== 'flex';
        if (freeform) {
          tree.x += offset;
          tree.y += offset;
        }
        const copy = this.buildFromTree(tree, n.parent, sib.indexOf(id) + 1);
        created.push(copy.id);
      });
      return created;
    },

    copy(ids) {
      this.clipboard = ids.map((id) => this.toTree(id)).filter(Boolean);
    },

    /** Paste into the primary selected frame (or its parent), else onto the canvas. */
    paste() {
      if (!this.clipboard || !this.clipboard.length) return [];
      const p = this.primary();
      let target = null;
      if (p) target = p.type === 'frame' ? p.id : p.parent;
      const created = this.clipboard.map((tree) => {
        const t = clone(tree);
        if (!target) {
          t.x += 40;
          t.y += 40;
        }
        return this.buildFromTree(t, target).id;
      });
      return created;
    },

    /** Wrap the selected siblings in a new auto-layout (flex) frame. Returns the frame. */
    wrapInFrame(ids, { flex = true } = {}) {
      ids = ids.filter((id) => this.get(id));
      if (!ids.length) return null;
      const parentId = this.get(ids[0]).parent;
      ids = ids.filter((id) => this.get(id).parent === parentId);
      const sib = this.siblingsOf(ids[0]);
      ids.sort((a, b) => sib.indexOf(a) - sib.indexOf(b));
      const index = sib.indexOf(ids[0]);
      const parent = parentId ? this.get(parentId) : null;
      const freeform = !parent || parent.layout.mode !== 'flex';
      const minX = Math.min(...ids.map((id) => this.get(id).x));
      const minY = Math.min(...ids.map((id) => this.get(id).y));
      const frame = this.createNode(
        'frame',
        {
          name: flex ? 'Auto layout' : 'Group',
          x: freeform ? minX : 0,
          y: freeform ? minY : 0,
          sizing: { w: 'hug', h: 'hug' },
          style: { fills: [] },
          layout: flex ? { mode: 'flex', direction: 'column', gap: 16 } : {},
        },
        parentId,
        index
      );
      ids.forEach((id) => {
        const n = this.get(id);
        n.x -= minX;
        n.y -= minY;
        this.move(id, frame.id);
      });
      if (!flex) {
        // freeform group: size to content
        frame.sizing = { w: 'fixed', h: 'fixed' };
        frame.width = Math.max(...ids.map((id) => this.get(id).x + this.get(id).width));
        frame.height = Math.max(...ids.map((id) => this.get(id).y + this.get(id).height));
      }
      this.emit('change');
      return frame;
    },

    // ----- selection / tool / viewport -----
    select(ids) {
      ids = [].concat(ids || []).filter((id) => this.get(id));
      this.selection = ids;
      this.emit('selection');
    },
    toggleSelect(id) {
      if (this.selection.includes(id)) this.selection = this.selection.filter((s) => s !== id);
      else this.selection = [...this.selection, id];
      this.emit('selection');
    },
    setTool(tool) {
      this.tool = tool;
      this.emit('tool', tool);
    },
    setHover(id) {
      if (this.hoverId === id) return;
      this.hoverId = id;
      this.emit('hover', id);
    },
    setViewport(v) {
      Object.assign(this.viewport, v);
      this.emit('viewport', this.viewport);
    },

    // ----- history -----
    /** Record an undo step (call at the END of a gesture) and autosave. */
    commit(label = '') {
      const snap = JSON.stringify(this.doc);
      if (this.history[this.historyIndex] === snap) return;
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(snap);
      if (this.history.length > MAX_HISTORY) this.history.shift();
      this.historyIndex = this.history.length - 1;
      this.emit('history', label);
      this.scheduleSave();
    },
    canUndo() {
      return this.historyIndex > 0;
    },
    canRedo() {
      return this.historyIndex < this.history.length - 1;
    },
    undo() {
      if (!this.canUndo()) return;
      this.historyIndex--;
      this._restore();
    },
    redo() {
      if (!this.canRedo()) return;
      this.historyIndex++;
      this._restore();
    },
    _restore() {
      this.doc = JSON.parse(this.history[this.historyIndex]);
      this.selection = this.selection.filter((id) => this.doc.nodes[id]);
      this.editingTextId = null;
      this.emit('change');
      this.emit('selection');
      this.emit('history');
      this.scheduleSave();
    },

    // ----- documents & saving -----
    load(doc) {
      this.doc = doc && doc.nodes && doc.roots ? doc : emptyDoc();
      this.selection = [];
      this.history = [JSON.stringify(this.doc)];
      this.historyIndex = 0;
      this.emit('change');
      this.emit('selection');
      this.emit('history');
      this.emit('doc');
    },
    newDoc() {
      this.load(emptyDoc());
      this.scheduleSave();
    },
    serialize() {
      return JSON.stringify(this.doc, null, 2);
    },
    rename(name) {
      this.doc.name = name || 'Untitled';
      this.emit('doc');
      this.commit('rename document');
    },
    _saveTimer: null,
    scheduleSave() {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.saveNow(), 400);
    },
    saveNow() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.doc));
        this.emit('saved', true);
      } catch (e) {
        this.emit('saved', false);
        if (Folio.ui) Folio.ui.toast('Autosave failed (file too large — large images?). Use File → Save to file.', 'error');
      }
    },
    loadAutosave() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
  };

  Folio.store = store;
  Folio.presets = presets;
  Folio.util = { uid, clone, deepMerge, defaultNode };
})();
