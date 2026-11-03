/*
 * ai-tools.js — the tools Claude uses to read and change the canvas.
 *
 *   Folio.aiTools.execute(name, input) -> Promise<{ content, isError, summary, changedIds }>
 *   Folio.aiTools.describeNode(id)     -> one-line description, e.g. 'frame “Hero” (n_ab12cd3) 1440×640 in “Landing”'
 *   Folio.aiTools.serialize(id, {depth, maxNodes}) -> compact JSON tree (defaults stripped, ids kept)
 *   Folio.aiTools.renderedSize(id)     -> [w, h] as laid out on the canvas, or null
 *   Folio.aiTools.normalizeColor(str)  -> '#rrggbb' / '#rrggbbaa' or null
 *
 * Used by both the in-app chat (src/ai.js) and the Claude Code bridge (src/bridge.js).
 * Everything the model sends is sanitized; execute() never throws and never calls store.commit()
 * (the caller records one undo step per AI run). Mutating tools select what they changed and emit
 * store 'ai:changed' with the changed ids.
 */
window.Folio = window.Folio || {};

(function () {
  const S = () => Folio.store;

  // ---------- vocabularies ----------
  const TYPES = ['frame', 'text', 'image'];
  const NODE_KEYS = ['type', 'name', 'x', 'y', 'width', 'height', 'sizing', 'layout', 'style', 'text', 'image', 'visible', 'locked', 'children'];
  const IGNORED_KEYS = ['id', 'parent', 'childCount', 'ref', 'key'];
  const STYLE_KEYS = ['fills', 'radius', 'border', 'shadows', 'opacity', 'blur', 'backdropBlur', 'blend', 'clip', 'rotation', 'adjust'];
  const LAYOUT_KEYS = ['mode', 'direction', 'wrap', 'gap', 'justify', 'align', 'padding'];
  const TEXT_KEYS = ['content', 'font', 'size', 'weight', 'lineHeight', 'letterSpacing', 'color', 'align', 'transform', 'italic', 'decoration'];
  const IMAGE_KEYS = ['src', 'fit'];
  const FILL_TYPES = ['solid', 'linear', 'radial', 'conic', 'mesh', 'image', 'noise'];
  const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
  const SYSTEM_FONTS = ['system-ui', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New'];

  const STYLE_ALIASES = { borderRadius: 'radius', cornerRadius: 'radius', shadow: 'shadows', boxShadow: 'shadows', backdropFilter: 'backdropBlur', mixBlendMode: 'blend', overflow: 'clip', fill: 'fills', background: 'fills', backgroundColor: 'fills', bg: 'fills' };
  const TEXT_ALIASES = { text: 'content', characters: 'content', value: 'content', fontFamily: 'font', family: 'font', fontSize: 'size', fontWeight: 'weight', lineheight: 'lineHeight', tracking: 'letterSpacing', textAlign: 'align', textTransform: 'transform', fontStyle: 'italic', textDecoration: 'decoration' };
  const LAYOUT_ALIASES = { flexDirection: 'direction', justifyContent: 'justify', alignItems: 'align', itemSpacing: 'gap', spacing: 'gap', flexWrap: 'wrap' };

  const MAX_NODES_PER_CALL = 2000;
  const MAX_DEPTH = 40;
  const MAX_WARNINGS = 25;
  const MAX_IMAGE_CHARS = 3500000; // base64 characters

  // ---------- small helpers ----------
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r2 = (v) => Math.round(v * 100) / 100;
  const q = (s) => `“${String(s == null ? '' : s)}”`;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const str = (v) => {
    try {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return s && s.length > 60 ? s.slice(0, 57) + '…' : String(s);
    } catch (e) {
      return String(v);
    }
  };

  /** Warning collector for one tool call. `at` is the current layer path. */
  function makeCtx(mode) {
    const list = [];
    const seen = new Set();
    let extra = 0;
    const ctx = {
      mode, // 'create' | 'update'
      at: '',
      warn(msg) {
        const m = (ctx.at ? ctx.at + ': ' : '') + msg;
        if (seen.has(m)) return;
        seen.add(m);
        if (list.length < MAX_WARNINGS) list.push(m);
        else extra++;
      },
      warnings() {
        return extra ? list.concat(`…and ${extra} more warnings`) : list.slice();
      },
    };
    return ctx;
  }

  /** Coerce to a finite number within [min, max]. Returns undefined (and warns) if impossible. */
  function num(v, ctx, label, min, max, opts = {}) {
    let n = v;
    if (typeof n === 'string') {
      const t = n.trim();
      if (opts.percentToUnit && /%$/.test(t)) n = parseFloat(t) / 100;
      else n = parseFloat(t);
    }
    if (typeof n === 'boolean') n = n ? 1 : 0;
    if (typeof n !== 'number' || !isFinite(n)) {
      ctx.warn(`${label} ${str(v)} is not a number — ignored`);
      return undefined;
    }
    if (n < min || n > max) {
      const c = clamp(n, min, max);
      ctx.warn(`${label} ${r2(n)} is out of range — clamped to ${c}`);
      n = c;
    }
    return opts.int ? Math.round(n) : Math.round(n * 10000) / 10000;
  }

  function bool(v) {
    if (typeof v === 'string') return !/^(false|0|no|off|none|)$/i.test(v.trim());
    return !!v;
  }

  function oneOf(v, allowed, aliases, ctx, label) {
    if (typeof v !== 'string') {
      ctx.warn(`${label} ${str(v)} is not valid — ignored`);
      return undefined;
    }
    const s = v.trim();
    if (allowed.includes(s)) return s;
    const lower = s.toLowerCase();
    if (allowed.includes(lower)) return lower;
    if (aliases && own(aliases, lower)) return aliases[lower];
    ctx.warn(`${label} ${q(s)} is not one of ${allowed.join(' | ')} — ignored`);
    return undefined;
  }

  // ---------- colours ----------
  let colorCtx;
  function getColorCtx() {
    if (colorCtx !== undefined) return colorCtx;
    colorCtx = null;
    try {
      if (typeof document !== 'undefined' && document.createElement) {
        const c = document.createElement('canvas');
        c.width = c.height = 1;
        colorCtx = c.getContext('2d', { willReadFrequently: true }) || null;
      }
    } catch (e) {
      colorCtx = null;
    }
    return colorCtx;
  }
  const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  function toHex(r, g, b, a) {
    const base = '#' + hex2(r) + hex2(g) + hex2(b);
    if (a == null || a >= 0.999) return base;
    return base + hex2(clamp(a, 0, 1) * 255);
  }
  function hslToRgb(h, s, l) {
    h = (((h % 360) + 360) % 360) / 360;
    s = clamp(s, 0, 1);
    l = clamp(l, 0, 1);
    if (!s) return [l * 255, l * 255, l * 255];
    const q2 = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q2;
    const f = (t) => {
      t = (t + 1) % 1;
      if (t < 1 / 6) return p + (q2 - p) * 6 * t;
      if (t < 1 / 2) return q2;
      if (t < 2 / 3) return p + (q2 - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  const NAMED = { white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', purple: '#800080', gray: '#808080', grey: '#808080', pink: '#ffc0cb' };
  /** rgb()/rgba()/hsl()/hsla() parser for when no canvas is available. */
  function parseFunctional(s) {
    const m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
    if (!m) return NAMED[s] || null;
    const parts = m[2].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    const val = (p, scale) => (/%$/.test(p) ? (parseFloat(p) / 100) * scale : parseFloat(p));
    let a = parts[3] != null ? val(parts[3], 1) : 1;
    if (!isFinite(a)) return null;
    let rgb;
    if (m[1].startsWith('rgb')) rgb = parts.slice(0, 3).map((p) => val(p, 255));
    else rgb = hslToRgb(parseFloat(parts[0]), val(parts[1], 1) / (/%$/.test(parts[1]) ? 1 : 100), val(parts[2], 1) / (/%$/.test(parts[2]) ? 1 : 100));
    if (rgb.some((c) => !isFinite(c))) return null;
    return toHex(rgb[0], rgb[1], rgb[2], a);
  }
  /** Normalize any CSS colour to '#rrggbb' or '#rrggbbaa'. Returns null when invalid. */
  function normalizeColor(v) {
    if (typeof v !== 'string') return null;
    const s = v.trim().toLowerCase();
    if (!s || s.length > 120) return null;
    if (s === 'transparent' || s === 'none') return '#00000000';
    let m = /^#([0-9a-f]{3,8})$/.exec(s) || /^([0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
    if (m) {
      const h = m[1];
      if (h.length === 3 || h.length === 4) return normalizeColor('#' + [...h].map((c) => c + c).join(''));
      if (h.length === 6) return '#' + h;
      if (h.length === 8) return h.endsWith('ff') ? '#' + h.slice(0, 6) : '#' + h;
      return null;
    }
    const ctx = getColorCtx();
    if (ctx) {
      ctx.fillStyle = '#000000';
      ctx.fillStyle = s;
      const a = ctx.fillStyle;
      ctx.fillStyle = '#ffffff';
      ctx.fillStyle = s;
      if (ctx.fillStyle !== a) return null; // the browser rejected it
      if (/^#[0-9a-f]{6}$/i.test(a)) return a.toLowerCase();
      const fm = parseFunctional(String(a).toLowerCase().replace(/\s+/g, ' '));
      if (fm) return fm;
      try {
        // exotic syntax (oklch(), color(), …): paint one pixel and read it back
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = s;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return toHex(d[0], d[1], d[2], d[3] / 255);
      } catch (e) {
        return null;
      }
    }
    return parseFunctional(s);
  }
  function color(v, ctx, label) {
    const c = normalizeColor(v);
    if (c) return c;
    ctx.warn(`${label} ${str(v)} is not a valid colour — ${ctx.mode === 'update' ? 'kept the previous colour' : 'used the default'}`);
    return undefined;
  }

  // ---------- fonts ----------
  function normalizeFont(v, ctx) {
    if (typeof v !== 'string') {
      ctx.warn(`font ${str(v)} is not a font family name — ignored`);
      return undefined;
    }
    let s = v.split(',')[0].replace(/["'`]/g, '').trim();
    const generic = { 'sans-serif': 'Inter', sans: 'Inter', serif: 'Lora', monospace: 'JetBrains Mono', mono: 'JetBrains Mono', cursive: 'Caveat', display: 'Bebas Neue' };
    if (own(generic, s.toLowerCase())) {
      const g = generic[s.toLowerCase()];
      ctx.warn(`font ${q(s)} is a generic family — used ${g}`);
      return g;
    }
    s = s.replace(/[^\w \-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!s) {
      ctx.warn(`font ${str(v)} is empty — ignored`);
      return undefined;
    }
    const list = (Folio.fonts && Folio.fonts.list) || [];
    const known = list.find((f) => f.family.toLowerCase() === s.toLowerCase());
    if (known) return known.family;
    const sys = SYSTEM_FONTS.find((f) => f.toLowerCase() === s.toLowerCase());
    if (sys) return sys;
    ctx.warn(`font ${q(s)} is not in Folio's font list — loading it from Google Fonts; if no such family exists the text falls back to a system font`);
    try {
      if (Folio.fonts && Folio.fonts.ensure) Folio.fonts.ensure(s);
    } catch (e) {
      /* ignore */
    }
    return s;
  }

  function snapWeight(font, weight, ctx) {
    if (!font || weight == null || !Folio.fonts || !Folio.fonts.weightsOf) return weight;
    const known = (Folio.fonts.list || []).some((f) => f.family === font);
    if (!known) return weight;
    const ws = Folio.fonts.weightsOf(font);
    if (!ws.length || ws.includes(weight)) return weight;
    const best = ws.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a));
    if (Math.abs(best - weight) >= 100) ctx.warn(`${font} has no weight ${weight} — used ${best}`);
    return best;
  }

  // ---------- style pieces ----------
  function sanitizeStops(stops, ctx, label) {
    if (!Array.isArray(stops)) {
      ctx.warn(`${label}.stops must be an array of {color, pos}`);
      return null;
    }
    let out = [];
    let fractions = false;
    stops.slice(0, 32).forEach((s, i) => {
      const raw = typeof s === 'string' ? { color: s } : isObj(s) ? s : null;
      if (!raw) return ctx.warn(`${label}.stops[${i}] is not a stop — dropped`);
      const c = color(raw.color, ctx, `${label}.stops[${i}].color`);
      if (!c) return;
      const posRaw = raw.pos != null ? raw.pos : raw.position != null ? raw.position : raw.offset;
      if (raw.pos == null && raw.offset != null) fractions = true; // SVG-style offsets are 0–1
      const pos = posRaw == null ? undefined : num(posRaw, ctx, `${label}.stops[${i}].pos`, -1000, 1000);
      out.push({ color: c, pos });
    });
    if (!out.length) return null;
    if (out.length === 1) out.push({ color: out[0].color, pos: 100 });
    const given = out.filter((s) => s.pos != null).map((s) => s.pos);
    if (given.length > 1 && given.every((p) => p >= 0 && p <= 1) && (fractions || given.some((p) => p > 0 && p < 1))) {
      out.forEach((s) => s.pos != null && (s.pos = r2(s.pos * 100))); // 0–1 offsets → %
    }
    out = out.map((s, i) => ({ color: s.color, pos: s.pos == null ? r2((i / (out.length - 1)) * 100) : clamp(s.pos, 0, 100) }));
    return out;
  }

  function sanitizeSrc(v, ctx, label) {
    if (typeof v !== 'string' || !v.trim()) {
      ctx.warn(`${label} must be an image URL`);
      return undefined;
    }
    const s = v.trim();
    if (/^data:[^,]*,…\(/.test(s) || /…\(\d/.test(s)) return undefined; // a shortened data URL echoed back from get_tree
    if (/^(https?:|data:image\/|blob:)/i.test(s) || /^[\w.\-\/]+\.(png|jpe?g|gif|webp|svg|avif)$/i.test(s)) return s;
    ctx.warn(`${label} ${str(s)} is not an http(s) or data:image URL — ignored`);
    return undefined;
  }

  function sanitizeFill(f, ctx, label) {
    if (typeof f === 'string') {
      const c = color(f, ctx, label);
      return c ? { type: 'solid', color: c, visible: true } : null;
    }
    if (!isObj(f)) {
      ctx.warn(`${label} is not a fill object — dropped`);
      return null;
    }
    let type = typeof f.type === 'string' ? f.type.trim().toLowerCase() : '';
    const alias = { color: 'solid', 'linear-gradient': 'linear', gradient: 'linear', 'radial-gradient': 'radial', 'conic-gradient': 'conic', 'mesh-gradient': 'mesh', grain: 'noise' };
    if (alias[type]) type = alias[type];
    if (!type) type = f.color ? 'solid' : f.points ? 'mesh' : f.stops ? 'linear' : f.src ? 'image' : '';
    if (!FILL_TYPES.includes(type)) {
      ctx.warn(`${label}.type ${str(f.type)} is not one of ${FILL_TYPES.join(' | ')} — dropped`);
      return null;
    }
    const visible = f.visible === undefined ? true : bool(f.visible);
    switch (type) {
      case 'solid': {
        const c = color(f.color, ctx, `${label}.color`);
        return c ? { type, color: c, visible } : null;
      }
      case 'linear':
      case 'conic': {
        const stops = sanitizeStops(f.stops, ctx, label);
        if (!stops) return null;
        const angle = f.angle == null ? (type === 'linear' ? 180 : 0) : num(f.angle, ctx, `${label}.angle`, -3600, 3600);
        return { type, angle: angle == null ? (type === 'linear' ? 180 : 0) : angle, stops, visible };
      }
      case 'radial': {
        const stops = sanitizeStops(f.stops, ctx, label);
        if (!stops) return null;
        const cx = f.cx == null ? 50 : num(f.cx, ctx, `${label}.cx`, -500, 500);
        const cy = f.cy == null ? 50 : num(f.cy, ctx, `${label}.cy`, -500, 500);
        return { type, cx: cx == null ? 50 : cx, cy: cy == null ? 50 : cy, stops, visible };
      }
      case 'mesh': {
        const pts = Array.isArray(f.points) ? f.points.slice(0, 8) : [];
        const corners = [[10, 10], [90, 10], [10, 90], [90, 90], [50, 50], [50, 0], [0, 50], [100, 50]];
        const points = [];
        pts.forEach((p, i) => {
          const raw = typeof p === 'string' ? { color: p } : isObj(p) ? p : null;
          if (!raw) return;
          const c = color(raw.color, ctx, `${label}.points[${i}].color`);
          if (!c) return;
          const x = raw.x == null ? corners[i][0] : num(raw.x, ctx, `${label}.points[${i}].x`, -100, 200);
          const y = raw.y == null ? corners[i][1] : num(raw.y, ctx, `${label}.points[${i}].y`, -100, 200);
          points.push({ color: c, x: x == null ? corners[i][0] : x, y: y == null ? corners[i][1] : y });
        });
        let base = f.base != null ? color(f.base, ctx, `${label}.base`) : undefined;
        if (!base) base = points.length ? points[0].color : undefined;
        if (!base && !points.length) {
          ctx.warn(`${label}: a mesh fill needs a base colour and points — dropped`);
          return null;
        }
        if (!points.length) ctx.warn(`${label}: a mesh fill without points is just its base colour`);
        const spread = f.spread == null ? 55 : num(f.spread, ctx, `${label}.spread`, 0, 200);
        return { type, base, spread: spread == null ? 55 : spread, points, visible };
      }
      case 'image': {
        const src = sanitizeSrc(f.src || f.url, ctx, `${label}.src`);
        if (!src) return null;
        const fit = f.fit == null ? 'cover' : oneOf(f.fit, ['cover', 'contain', 'fill', 'tile'], { repeat: 'tile', stretch: 'fill' }, ctx, `${label}.fit`) || 'cover';
        return { type, src, fit, visible };
      }
      case 'noise': {
        let o = f.opacity == null ? 0.15 : num(f.opacity, ctx, `${label}.opacity`, 0, 100);
        if (o == null) o = 0.15;
        if (o > 1) o = r2(o / 100);
        return { type, opacity: o, visible };
      }
    }
    return null;
  }

  function sanitizeFills(v, ctx, label = 'fills') {
    if (v == null) return [];
    const arr = Array.isArray(v) ? v : [v];
    const out = [];
    arr.slice(0, 16).forEach((f, i) => {
      const c = sanitizeFill(f, ctx, `${label}[${i}]`);
      if (c) out.push(c);
    });
    if (arr.length && !out.length && ctx.mode === 'update') return undefined; // keep the previous fills
    return out;
  }

  /** Split a CSS value list on top-level spaces (keeps rgba(…) together). */
  function splitTop(s, sep) {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
        if (cur.trim()) out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function parseCssShadow(s) {
    const parts = splitTop(s, ' ');
    const out = { inset: false };
    const nums = [];
    parts.forEach((p) => {
      if (p === 'inset') out.inset = true;
      else if (/^-?[\d.]+(px)?$/.test(p)) nums.push(parseFloat(p));
      else out.color = p;
    });
    [out.x, out.y, out.blur, out.spread] = [nums[0] || 0, nums[1] || 0, nums[2] || 0, nums[3] || 0];
    return out;
  }

  function sanitizeShadows(v, ctx) {
    if (v == null) return [];
    let arr = Array.isArray(v) ? v : [v];
    if (typeof v === 'string') arr = splitTop(v, ',');
    const out = [];
    arr.slice(0, 8).forEach((s, i) => {
      const raw = typeof s === 'string' ? parseCssShadow(s) : isObj(s) ? s : null;
      const label = `shadows[${i}]`;
      if (!raw) return ctx.warn(`${label} is not a shadow — dropped`);
      const n = (k, min, max, d) => {
        if (raw[k] == null) return d;
        const x = num(raw[k], ctx, `${label}.${k}`, min, max);
        return x == null ? d : x;
      };
      const c = raw.color == null ? '#00000040' : color(raw.color, ctx, `${label}.color`) || '#00000040';
      out.push({
        x: n('x', -2000, 2000, 0),
        y: n('y', -2000, 2000, 0),
        blur: n('blur', 0, 2000, 0),
        spread: n('spread', -2000, 2000, 0),
        color: c,
        inset: raw.inset === undefined ? false : bool(raw.inset),
        visible: raw.visible === undefined ? true : bool(raw.visible),
      });
    });
    return out;
  }

  function sanitizeBorder(v, ctx) {
    let raw = v;
    if (typeof v === 'number') raw = { width: v };
    else if (typeof v === 'string') {
      if (/^none$/i.test(v.trim())) raw = { width: 0 };
      else {
        raw = {};
        splitTop(v, ' ').forEach((p) => {
          if (/^-?[\d.]+(px)?$/.test(p)) raw.width = parseFloat(p);
          else if (['solid', 'dashed', 'dotted', 'double'].includes(p)) raw.style = p;
          else raw.color = p;
        });
      }
    }
    if (!isObj(raw)) {
      ctx.warn('border must be {width, color, style}');
      return undefined;
    }
    const out = {};
    if (raw.width != null) {
      const w = num(raw.width, ctx, 'border.width', 0, 1000);
      if (w != null) out.width = w;
    }
    if (raw.color != null) {
      const c = color(raw.color, ctx, 'border.color');
      if (c) out.color = c;
    }
    if (raw.style != null) {
      const st = oneOf(raw.style, ['solid', 'dashed', 'dotted', 'double'], null, ctx, 'border.style');
      if (st) out.style = st;
    }
    if (ctx.mode === 'create') {
      if (out.width == null && (out.color || out.style)) out.width = 1;
      if (!out.color) out.color = '#000000';
      if (!out.style) out.style = 'solid';
    }
    return Object.keys(out).length ? out : undefined;
  }

  function sanitizeRadius(v, ctx) {
    if (Array.isArray(v)) {
      const a = v.slice(0, 4).map((x, i) => num(x, ctx, `radius[${i}]`, 0, 10000));
      if (a.some((x) => x == null) || !a.length) {
        ctx.warn('radius must be a number or [topLeft, topRight, bottomRight, bottomLeft] — ignored');
        return undefined;
      }
      if (a.length === 1) return a[0];
      if (a.length === 2) return [a[0], a[1], a[0], a[1]];
      if (a.length === 3) return [a[0], a[1], a[2], a[1]];
      return a;
    }
    if (typeof v === 'string' && /\s/.test(v.trim())) return sanitizeRadius(v.trim().split(/\s+/), ctx);
    return num(v, ctx, 'radius', 0, 10000);
  }

  function sanitizeAdjust(v, ctx) {
    if (!isObj(v)) {
      ctx.warn('adjust must be an object');
      return undefined;
    }
    const lim = { brightness: [0, 400], contrast: [0, 400], saturate: [0, 400], grayscale: [0, 100], hue: [-360, 360] };
    const out = {};
    Object.keys(v).forEach((k) => {
      if (!lim[k]) return ctx.warn(`adjust.${k} is not supported (brightness, contrast, saturate, grayscale, hue) — ignored`);
      const x = num(v[k], ctx, `adjust.${k}`, lim[k][0], lim[k][1]);
      if (x != null) out[k] = x;
    });
    return Object.keys(out).length ? out : undefined;
  }

  function sanitizeStyle(raw, ctx, type) {
    if (!isObj(raw)) {
      ctx.warn('style must be an object — ignored');
      return undefined;
    }
    const v = {};
    Object.keys(raw).forEach((k) => {
      const key = own(STYLE_ALIASES, k) ? STYLE_ALIASES[k] : k;
      if (key === 'fills' && k !== 'fills' && own(raw, 'fills')) return;
      v[key] = raw[k];
    });
    const out = {};
    Object.keys(v).forEach((k) => {
      const val = v[k];
      switch (k) {
        case 'fills': {
          const f = sanitizeFills(val, ctx);
          if (f !== undefined) out.fills = f;
          break;
        }
        case 'radius': {
          const r = sanitizeRadius(val, ctx);
          if (r !== undefined) out.radius = r;
          break;
        }
        case 'border': {
          const b = sanitizeBorder(val, ctx);
          if (b) out.border = b;
          break;
        }
        case 'shadows':
          out.shadows = sanitizeShadows(val, ctx);
          break;
        case 'opacity': {
          let o = num(val, ctx, 'opacity', 0, 100, { percentToUnit: true });
          if (o != null) out.opacity = o > 1 ? r2(o / 100) : o;
          break;
        }
        case 'blur':
        case 'backdropBlur': {
          let x = val;
          if (typeof x === 'string') x = parseFloat(x.replace(/^blur\(/, ''));
          const n = num(x, ctx, k, 0, 1000);
          if (n != null) out[k] = n;
          break;
        }
        case 'blend': {
          const b = oneOf(val, BLENDS, { 'pass-through': 'normal', passthrough: 'normal' }, ctx, 'blend');
          if (b) out.blend = b;
          break;
        }
        case 'clip':
          out.clip = typeof val === 'string' ? /^(hidden|clip|true|yes|1)$/i.test(val.trim()) : bool(val);
          break;
        case 'rotation': {
          const n = num(val, ctx, 'rotation', -36000, 36000);
          if (n != null) out.rotation = r2(n % 360);
          break;
        }
        case 'adjust': {
          const a = sanitizeAdjust(val, ctx);
          if (a) out.adjust = a;
          break;
        }
        default:
          ctx.warn(`style.${k} is not a Folio style field (${STYLE_KEYS.join(', ')}) — ignored`);
      }
    });
    if (type === 'image' && out.fills && out.fills.length) ctx.warn('fills on an image node paint behind the picture (only visible with transparent images)');
    return out;
  }

  function sanitizePadding(v, ctx) {
    let a;
    if (typeof v === 'number' || (typeof v === 'string' && !/\s/.test(v.trim()))) a = [v, v, v, v];
    else if (typeof v === 'string') a = v.trim().split(/\s+/);
    else if (Array.isArray(v)) a = v.slice(0, 4);
    else if (isObj(v)) {
      const x = v.x != null ? v.x : v.horizontal;
      const y = v.y != null ? v.y : v.vertical;
      a = [v.top != null ? v.top : y || 0, v.right != null ? v.right : x || 0, v.bottom != null ? v.bottom : y || 0, v.left != null ? v.left : x || 0];
    } else {
      ctx.warn('layout.padding must be a number or [top, right, bottom, left] — ignored');
      return undefined;
    }
    if (a.length === 1) a = [a[0], a[0], a[0], a[0]];
    else if (a.length === 2) a = [a[0], a[1], a[0], a[1]];
    else if (a.length === 3) a = [a[0], a[1], a[2], a[1]];
    if (!a.length) return undefined;
    const out = a.map((x, i) => num(x, ctx, `layout.padding[${i}]`, 0, 2000));
    if (out.some((x) => x == null)) return undefined;
    return out;
  }

  const JUSTIFY_ALIASES = { start: 'flex-start', left: 'flex-start', top: 'flex-start', end: 'flex-end', right: 'flex-end', bottom: 'flex-end', middle: 'center', 'space-around': 'space-between', 'space-evenly': 'space-between', between: 'space-between' };
  const ALIGN_ALIASES = { start: 'flex-start', left: 'flex-start', top: 'flex-start', end: 'flex-end', right: 'flex-end', bottom: 'flex-end', middle: 'center', fill: 'stretch', baseline: 'flex-end' };

  function sanitizeLayout(raw, ctx) {
    if (typeof raw === 'string') {
      const s = raw.trim().toLowerCase();
      if (s === 'row' || s === 'horizontal') raw = { mode: 'flex', direction: 'row' };
      else if (s === 'column' || s === 'vertical' || s === 'flex' || s === 'auto') raw = { mode: 'flex', direction: 'column' };
      else if (s === 'none' || s === 'free' || s === 'freeform' || s === 'absolute') raw = { mode: 'none' };
      else {
        ctx.warn(`layout ${q(raw)} is not valid — ignored`);
        return undefined;
      }
    }
    if (!isObj(raw)) {
      ctx.warn('layout must be an object — ignored');
      return undefined;
    }
    const v = {};
    Object.keys(raw).forEach((k) => (v[own(LAYOUT_ALIASES, k) ? LAYOUT_ALIASES[k] : k] = raw[k]));
    const out = {};
    Object.keys(v).forEach((k) => {
      const val = v[k];
      switch (k) {
        case 'mode': {
          const s = typeof val === 'string' ? val.trim().toLowerCase() : val;
          if (['row', 'horizontal'].includes(s)) {
            out.mode = 'flex';
            if (v.direction == null) out.direction = 'row';
          } else if (['column', 'vertical'].includes(s)) {
            out.mode = 'flex';
            if (v.direction == null) out.direction = 'column';
          } else {
            const m = oneOf(val, ['flex', 'none'], { auto: 'flex', autolayout: 'flex', 'auto-layout': 'flex', flexbox: 'flex', free: 'none', freeform: 'none', absolute: 'none' }, ctx, 'layout.mode');
            if (m) out.mode = m;
          }
          break;
        }
        case 'direction': {
          const d = oneOf(val, ['row', 'column'], { horizontal: 'row', vertical: 'column', 'row-reverse': 'row', 'column-reverse': 'column' }, ctx, 'layout.direction');
          if (d) out.direction = d;
          break;
        }
        case 'wrap':
          out.wrap = typeof val === 'string' ? /^(wrap|true|yes|1)$/i.test(val.trim()) : bool(val);
          break;
        case 'gap': {
          const g = num(val, ctx, 'layout.gap', 0, 2000);
          if (g != null) out.gap = g;
          break;
        }
        case 'justify': {
          const j = oneOf(val, ['flex-start', 'center', 'flex-end', 'space-between'], JUSTIFY_ALIASES, ctx, 'layout.justify');
          if (j) out.justify = j;
          break;
        }
        case 'align': {
          const a = oneOf(val, ['flex-start', 'center', 'flex-end', 'stretch'], ALIGN_ALIASES, ctx, 'layout.align');
          if (a) out.align = a;
          break;
        }
        case 'padding': {
          const p = sanitizePadding(val, ctx);
          if (p) out.padding = p;
          break;
        }
        default:
          ctx.warn(`layout.${k} is not a layout field (${LAYOUT_KEYS.join(', ')}) — ignored`);
      }
    });
    return out;
  }

  const WEIGHTS = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };

  /** `base` = the node's current text (update) or defaults (create), used for unit conversions. */
  function sanitizeText(raw, ctx, base) {
    if (typeof raw === 'string' || typeof raw === 'number') raw = { content: raw };
    if (!isObj(raw)) {
      ctx.warn('text must be an object like {content, font, size, …} — ignored');
      return undefined;
    }
    const v = {};
    Object.keys(raw).forEach((k) => (v[own(TEXT_ALIASES, k) ? TEXT_ALIASES[k] : k] = raw[k]));
    const out = {};
    const sizeFor = () => out.size || (base && base.size) || 16;
    Object.keys(v).forEach((k) => {
      const val = v[k];
      switch (k) {
        case 'content':
          if (val == null) break;
          if (typeof val === 'object') ctx.warn('text.content must be a string');
          else out.content = String(val).slice(0, 20000);
          break;
        case 'font': {
          const f = normalizeFont(val, ctx);
          if (f) out.font = f;
          break;
        }
        case 'size': {
          const n = num(val, ctx, 'text.size', 1, 1000);
          if (n != null) out.size = n;
          break;
        }
        case 'weight': {
          let w = val;
          if (typeof w === 'string' && own(WEIGHTS, w.trim().toLowerCase().replace(/[\s_-]/g, ''))) w = WEIGHTS[w.trim().toLowerCase().replace(/[\s_-]/g, '')];
          const n = num(w, ctx, 'text.weight', 1, 1000, { int: true });
          if (n != null) out.weight = n;
          break;
        }
        case 'italic':
          out.italic = typeof val === 'string' ? /^(italic|oblique|true|yes|1)$/i.test(val.trim()) : bool(val);
          break;
        case 'color': {
          const c = color(val, ctx, 'text.color');
          if (c) out.color = c;
          break;
        }
        case 'align': {
          const a = oneOf(val, ['left', 'center', 'right', 'justify'], { start: 'left', end: 'right', middle: 'center', centre: 'center' }, ctx, 'text.align');
          if (a) out.align = a;
          break;
        }
        case 'transform': {
          const t = oneOf(val, ['none', 'uppercase', 'lowercase', 'capitalize'], { upper: 'uppercase', lower: 'lowercase', title: 'capitalize' }, ctx, 'text.transform');
          if (t) out.transform = t;
          break;
        }
        case 'decoration': {
          const d = oneOf(val, ['none', 'underline', 'line-through', 'overline'], { strikethrough: 'line-through', strike: 'line-through' }, ctx, 'text.decoration');
          if (d) out.decoration = d;
          break;
        }
        // lineHeight / letterSpacing need the final size, handled below
        case 'lineHeight':
        case 'letterSpacing':
          break;
        default:
          ctx.warn(`text.${k} is not a text field (${TEXT_KEYS.join(', ')}) — ignored`);
      }
    });
    if (v.lineHeight != null) {
      const val = v.lineHeight;
      let n;
      if (typeof val === 'string' && /px$/i.test(val.trim())) n = parseFloat(val) / sizeFor();
      else if (typeof val === 'string' && /%$/.test(val.trim())) n = parseFloat(val) / 100;
      else if (typeof val === 'string' && /^normal$/i.test(val.trim())) n = 1.2;
      else n = typeof val === 'string' ? parseFloat(val) : val;
      if (typeof n === 'number' && isFinite(n) && n > 4) {
        ctx.warn(`text.lineHeight ${r2(n)} looks like pixels — converted to the multiplier ${r2(n / sizeFor())}`);
        n = n / sizeFor();
      }
      const lh = num(n, ctx, 'text.lineHeight', 0.5, 4);
      if (lh != null) out.lineHeight = lh;
    }
    if (v.letterSpacing != null) {
      const val = v.letterSpacing;
      let n;
      if (typeof val === 'string' && /px$/i.test(val.trim())) n = parseFloat(val) / sizeFor();
      else if (typeof val === 'string' && /%$/.test(val.trim())) n = parseFloat(val) / 100;
      else n = typeof val === 'string' ? parseFloat(val) : val;
      if (typeof n === 'number' && isFinite(n) && Math.abs(n) > 1) {
        ctx.warn(`text.letterSpacing ${r2(n)} looks like pixels — converted to ${r2(n / sizeFor())}em`);
        n = n / sizeFor();
      }
      const ls = num(n, ctx, 'text.letterSpacing', -0.5, 2);
      if (ls != null) out.letterSpacing = Math.round(ls * 1000) / 1000;
    }
    if (out.weight != null) out.weight = snapWeight(out.font || (base && base.font), out.weight, ctx);
    return out;
  }

  function sanitizeImage(raw, ctx) {
    if (typeof raw === 'string') raw = { src: raw };
    if (!isObj(raw)) {
      ctx.warn('image must be {src, fit} — ignored');
      return undefined;
    }
    const out = {};
    Object.keys(raw).forEach((k) => {
      if (k === 'src' || k === 'url') {
        const s = sanitizeSrc(raw[k], ctx, 'image.src');
        if (s) out.src = s;
      } else if (k === 'fit') {
        const f = oneOf(raw.fit, ['cover', 'contain', 'fill'], { tile: 'cover', stretch: 'fill' }, ctx, 'image.fit');
        if (f) out.fit = f;
      } else if (k !== 'alt') ctx.warn(`image.${k} is not an image field (src, fit) — ignored`);
    });
    return out;
  }

  const SIZING_ALIASES = { auto: 'hug', fit: 'hug', 'fit-content': 'hug', content: 'hug', 'hug-contents': 'hug', stretch: 'fill', 'fill-container': 'fill', '100%': 'fill', full: 'fill', fixed: 'fixed' };
  function sanitizeSizing(raw, ctx) {
    if (typeof raw === 'string') raw = { w: raw, h: raw };
    if (!isObj(raw)) {
      ctx.warn('sizing must be {w, h} — ignored');
      return undefined;
    }
    const out = {};
    Object.keys(raw).forEach((k) => {
      const axis = k === 'width' || k === 'horizontal' ? 'w' : k === 'height' || k === 'vertical' ? 'h' : k;
      if (axis !== 'w' && axis !== 'h') return ctx.warn(`sizing.${k} is not w or h — ignored`);
      const m = oneOf(raw[k], ['fixed', 'hug', 'fill'], SIZING_ALIASES, ctx, `sizing.${axis}`);
      if (m) out[axis] = m;
    });
    return out;
  }

  /**
   * Sanitize the props of one node (no children). Used for both creating (full node, defaults
   * applied later) and patching (only what's present). Returns a clean props object.
   */
  function sanitizeProps(raw, type, ctx, base) {
    // hoist shorthand keys into their objects
    const src = {};
    const hoisted = { style: {}, text: {}, layout: {}, image: {} };
    const unknown = [];
    Object.keys(raw).forEach((k) => {
      const val = raw[k];
      if (NODE_KEYS.includes(k)) src[k] = val;
      else if (IGNORED_KEYS.includes(k) || k.charAt(0) === '_') return;
      else if (STYLE_KEYS.includes(k) || own(STYLE_ALIASES, k)) hoisted.style[k] = val;
      else if (type === 'text' && (TEXT_KEYS.includes(k) || own(TEXT_ALIASES, k))) hoisted.text[k] = val;
      else if (type === 'frame' && (LAYOUT_KEYS.includes(k) || own(LAYOUT_ALIASES, k))) hoisted.layout[k] = val;
      else if (type === 'image' && (IMAGE_KEYS.includes(k) || k === 'url' || k === 'alt')) hoisted.image[k] = val;
      else if (k === 'w' || k === 'h') src[k === 'w' ? 'width' : 'height'] = val;
      else unknown.push(k);
    });
    if (unknown.length) ctx.warn(`unknown field${unknown.length > 1 ? 's' : ''} ${unknown.map((k) => q(k)).join(', ')} ignored`);
    ['style', 'text', 'layout', 'image'].forEach((g) => {
      if (!Object.keys(hoisted[g]).length) return;
      if (src[g] === undefined) src[g] = hoisted[g];
      else if (isObj(src[g])) src[g] = Object.assign({}, hoisted[g], src[g]);
    });
    if (type === 'text' && typeof src.text === 'string') src.text = { content: src.text };

    const out = {};
    Object.keys(src).forEach((k) => {
      const val = src[k];
      switch (k) {
        case 'type':
        case 'children':
          break;
        case 'name':
          if (val == null) break;
          out.name = String(val).replace(/\s+/g, ' ').trim().slice(0, 120) || undefined;
          if (!out.name) delete out.name;
          break;
        case 'x':
        case 'y': {
          const n = num(val, ctx, k, -1000000, 1000000);
          if (n != null) out[k] = n;
          break;
        }
        case 'width':
        case 'height': {
          if (typeof val === 'string' && /^(auto|hug|fit-content)$/i.test(val.trim())) {
            out.sizing = Object.assign(out.sizing || {}, { [k === 'width' ? 'w' : 'h']: 'hug' });
            break;
          }
          if (typeof val === 'string' && /^(fill|100%|stretch)$/i.test(val.trim())) {
            out.sizing = Object.assign(out.sizing || {}, { [k === 'width' ? 'w' : 'h']: 'fill' });
            break;
          }
          const n = num(val, ctx, k, 0, 20000);
          if (n != null) out[k] = n;
          break;
        }
        case 'sizing': {
          const s = sanitizeSizing(val, ctx);
          if (s) out.sizing = Object.assign(out.sizing || {}, s);
          break;
        }
        case 'layout': {
          if (type !== 'frame') {
            ctx.warn(`layout only applies to frames (this is a ${type}) — ignored`);
            break;
          }
          const l = sanitizeLayout(val, ctx);
          if (l && Object.keys(l).length) out.layout = l;
          break;
        }
        case 'style': {
          const s = sanitizeStyle(val, ctx, type);
          if (s && Object.keys(s).length) out.style = s;
          break;
        }
        case 'text': {
          if (type !== 'text') {
            ctx.warn(`text settings only apply to text nodes (this is a ${type}) — ignored; put a text child inside the frame instead`);
            break;
          }
          const t = sanitizeText(val, ctx, base && base.text);
          if (t && Object.keys(t).length) out.text = t;
          break;
        }
        case 'image': {
          if (type !== 'image') {
            ctx.warn(`image settings only apply to image nodes — ignored; use an image fill on a frame instead`);
            break;
          }
          const i = sanitizeImage(val, ctx);
          if (i && Object.keys(i).length) out.image = i;
          break;
        }
        case 'visible':
        case 'locked':
          out[k] = bool(val);
          break;
      }
    });
    return out;
  }

  // ---------- create: sanitize a whole tree ----------
  function normType(t, ctx) {
    if (t == null) return 'frame';
    const s = String(t).trim().toLowerCase();
    if (TYPES.includes(s)) return s;
    const alias = { rect: 'frame', rectangle: 'frame', ellipse: 'frame', circle: 'frame', group: 'frame', box: 'frame', div: 'frame', container: 'frame', section: 'frame', artboard: 'frame', button: 'frame', img: 'image', picture: 'image', label: 'text', heading: 'text', paragraph: 'text' };
    if (alias[s]) {
      if (!['rect', 'rectangle', 'group', 'artboard'].includes(s)) ctx.warn(`type ${q(t)} is not a Folio type — created a ${alias[s]}`);
      return alias[s];
    }
    ctx.warn(`type ${q(t)} is not one of frame | text | image — created a frame`);
    return 'frame';
  }

  function hasXY(c) {
    return isObj(c) && (typeof c.x === 'number' || typeof c.y === 'number');
  }

  /**
   * Turn one raw model tree into clean trees for store.buildFromTree. Returns an array:
   * the node itself, followed by any children it wasn't allowed to have (text/image children are
   * moved up to become its next siblings).
   */
  function cleanTree(raw, ctx, info, depth, parentClean, pathPrefix) {
    if (!isObj(raw)) {
      ctx.warn(`${str(raw)} is not a node object — skipped`);
      return [];
    }
    if (info.seen.has(raw)) {
      ctx.warn('the same node object appears twice (cycle) — skipped');
      return [];
    }
    info.seen.add(raw);
    if (info.count >= MAX_NODES_PER_CALL) {
      info.truncated++;
      return [];
    }
    info.count++;
    const type = normType(raw.type, ctx);
    const prevAt = ctx.at;
    const label = (raw.name && String(raw.name).slice(0, 40)) || (type === 'text' && raw.text && raw.text.content ? String(raw.text.content).slice(0, 24) : type);
    ctx.at = pathPrefix ? pathPrefix + '/' + label : label;
    const isRoot = !parentClean && info.parentId === null;
    const parentFlex = parentClean ? parentClean.layout && parentClean.layout.mode === 'flex' : info.parentFlex;

    const props = sanitizeProps(raw, type, ctx, null);
    const kids = raw.children == null ? [] : Array.isArray(raw.children) ? raw.children : [raw.children];
    if (raw.children != null && !Array.isArray(raw.children)) ctx.warn('children must be an array');

    // --- defaults that make sense for generated designs ---
    const clean = Object.assign({ type }, props);
    const sizing = Object.assign({}, clean.sizing);
    ['w', 'h'].forEach((ax) => {
      const dim = ax === 'w' ? 'width' : 'height';
      if (!sizing[ax]) {
        if (clean[dim] != null) sizing[ax] = 'fixed';
        else if (type === 'image') sizing[ax] = 'fixed';
        else sizing[ax] = 'hug';
      }
    });
    if (isRoot) {
      ['w', 'h'].forEach((ax) => {
        if (sizing[ax] === 'fill') {
          ctx.warn(`an artboard cannot fill — used fixed ${ax === 'w' ? 'width' : 'height'}`);
          sizing[ax] = 'fixed';
        }
      });
    }
    if (type === 'frame') {
      const L = Object.assign({}, clean.layout);
      if (!L.mode) L.mode = kids.some(hasXY) ? 'none' : 'flex';
      clean.layout = L;
      const st = Object.assign({}, clean.style);
      if (!st.fills) st.fills = isRoot ? [{ type: 'solid', color: '#ffffff', visible: true }] : [];
      if (isRoot && st.clip === undefined) st.clip = true;
      clean.style = st;
      if (L.mode === 'none' && kids.length) {
        ['w', 'h'].forEach((ax) => {
          if (sizing[ax] !== 'hug') return;
          const dim = ax === 'w' ? 'width' : 'height';
          const pos = ax === 'w' ? 'x' : 'y';
          if (clean[dim] == null) {
            let ext = 0;
            kids.forEach((c) => {
              if (!isObj(c)) return;
              const p = Number(c[pos]) || 0;
              const d = Number(c[dim]) || (c.type === 'text' ? 40 : 100);
              ext = Math.max(ext, p + d);
            });
            clean[dim] = Math.max(1, Math.round(ext));
          }
          sizing[ax] = 'fixed';
          ctx.warn(`a freeform frame (layout.mode "none") cannot hug its children — made the ${dim} fixed at ${clean[dim]}px`);
        });
      }
    }
    if (type === 'text') {
      const t = Object.assign({}, clean.text);
      if (t.content == null) {
        t.content = typeof raw.name === 'string' && raw.name ? raw.name : 'Text';
        ctx.warn('text node without text.content — used its name');
      }
      clean.text = t;
      // long copy that hugs its width would run off in one line: let it wrap
      const parentColumn = parentFlex && (parentClean ? parentClean.layout.direction !== 'row' : info.parentDir !== 'row');
      if (!raw.sizing && clean.width == null && parentColumn && String(t.content).length > 60 && !/\n/.test(t.content)) sizing.w = 'fill';
      if (t.font) info.fonts.add(t.font);
    }
    clean.sizing = sizing;
    if (!clean.name) {
      if (type === 'text') clean.name = String(clean.text.content).replace(/\s+/g, ' ').trim().slice(0, 32) || 'Text';
      else if (type === 'image') clean.name = 'Image';
      else clean.name = isRoot ? 'Artboard' : 'Frame';
    }
    if (parentFlex) {
      delete clean.x;
      delete clean.y;
    }
    ctx.at = pathPrefix ? pathPrefix + '/' + clean.name : clean.name;
    const myPath = ctx.at;

    const result = [clean];
    if (kids.length) {
      if (depth >= MAX_DEPTH) {
        ctx.warn(`nesting deeper than ${MAX_DEPTH} levels — children dropped`);
      } else if (type !== 'frame') {
        ctx.warn(`a ${type} cannot have children — moved its ${kids.length} child${kids.length > 1 ? 'ren' : ''} out to sit after it`);
        kids.forEach((c) => result.push(...cleanTree(c, ctx, info, depth, parentClean, pathPrefix)));
      } else {
        clean.children = [];
        kids.forEach((c) => clean.children.push(...cleanTree(c, ctx, info, depth + 1, clean, myPath)));
      }
    }
    ctx.at = prevAt;
    return result;
  }

  // ---------- reading / serializing ----------
  let defaults = null;
  function defaultsFor(type) {
    if (!defaults) {
      const d = Folio.util && Folio.util.defaultNode;
      defaults = { text: d ? d('text').text : {}, image: d ? d('image').image : {} };
    }
    return defaults[type] || {};
  }

  function renderedSize(id) {
    try {
      if (!Folio.render || !Folio.render.el) return null;
      if (Folio.render.sync) Folio.render.sync();
      const el = Folio.render.el(id);
      if (!el || !el.isConnected || !el.getClientRects().length) return null;
      return [Math.round(el.offsetWidth), Math.round(el.offsetHeight)];
    } catch (e) {
      return null;
    }
  }

  function shortSrc(s) {
    if (typeof s !== 'string') return s;
    if (/^data:/i.test(s) && s.length > 160) {
      const head = s.slice(0, s.indexOf(',') + 1) || 'data:';
      return `${head}…(${Math.round(s.length / 1024)} KB embedded image — omit src to keep it)`;
    }
    return s;
  }

  function compactFill(f) {
    const o = {};
    Object.keys(f).forEach((k) => {
      if (k === 'visible' && f[k] !== false) return;
      o[k] = k === 'src' ? shortSrc(f[k]) : f[k];
    });
    return o;
  }

  function compactStyle(n, isRoot) {
    const st = n.style || {};
    const o = {};
    const fills = st.fills || [];
    if (fills.length || (isRoot && n.type === 'frame')) o.fills = fills.map(compactFill);
    if (Array.isArray(st.radius) ? st.radius.some(Boolean) : st.radius) o.radius = st.radius;
    if (st.border && st.border.width > 0) o.border = { width: st.border.width, color: st.border.color, ...(st.border.style && st.border.style !== 'solid' ? { style: st.border.style } : {}) };
    if (st.shadows && st.shadows.length)
      o.shadows = st.shadows.map((s) => {
        const c = { x: s.x, y: s.y, blur: s.blur };
        if (s.spread) c.spread = s.spread;
        c.color = s.color;
        if (s.inset) c.inset = true;
        if (s.visible === false) c.visible = false;
        return c;
      });
    if (st.opacity != null && st.opacity !== 1) o.opacity = st.opacity;
    if (st.blur) o.blur = st.blur;
    if (st.backdropBlur) o.backdropBlur = st.backdropBlur;
    if (st.blend && st.blend !== 'normal') o.blend = st.blend;
    if (st.clip) o.clip = true;
    if (st.rotation) o.rotation = st.rotation;
    if (st.adjust) {
      const a = st.adjust;
      const d = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, hue: 0 };
      const c = {};
      Object.keys(d).forEach((k) => a[k] != null && a[k] !== d[k] && (c[k] = a[k]));
      if (Object.keys(c).length) o.adjust = c;
    }
    return o;
  }

  /** Compact JSON for a node and its subtree: defaults stripped, ids always kept. */
  function serialize(id, opts = {}) {
    const store = S();
    const root = store.get(id);
    if (!root) return null;
    const maxDepth = opts.depth == null ? 8 : opts.depth;
    const maxNodes = opts.maxNodes == null ? 400 : opts.maxNodes;
    let count = 0;
    const walk = (n, d) => {
      count++;
      const parent = n.parent ? store.get(n.parent) : null;
      const parentFlex = parent && parent.layout && parent.layout.mode === 'flex';
      const o = { id: n.id, type: n.type, name: n.name };
      if (!parentFlex) {
        o.x = r2(n.x || 0);
        o.y = r2(n.y || 0);
      }
      const sw = (n.sizing && n.sizing.w) || 'fixed';
      const sh = (n.sizing && n.sizing.h) || 'fixed';
      if (sw === 'fixed') o.width = r2(n.width);
      if (sh === 'fixed') o.height = r2(n.height);
      if (sw !== 'fixed' || sh !== 'fixed') {
        o.sizing = { w: sw, h: sh };
        const rs = renderedSize(n.id);
        if (rs) o._rendered = rs;
      }
      if (n.type === 'frame' && n.layout) {
        const L = n.layout;
        const plainLeaf = !(n.children && n.children.length) && !L.gap && !(L.padding || []).some(Boolean) && !L.wrap;
        if (plainLeaf) {
          /* a plain shape: its layout settings don't matter */
        } else if (L.mode === 'flex') {
          const l = { mode: 'flex', direction: L.direction || 'column' };
          if (L.gap) l.gap = L.gap;
          const p = L.padding || [0, 0, 0, 0];
          if (p.some(Boolean)) l.padding = p;
          if (L.justify && L.justify !== 'flex-start') l.justify = L.justify;
          if (L.align && L.align !== 'flex-start') l.align = L.align;
          if (L.wrap) l.wrap = true;
          o.layout = l;
        } else {
          o.layout = { mode: 'none' };
          const p = L.padding || [0, 0, 0, 0];
          if (p.some(Boolean)) o.layout.padding = p;
        }
      }
      const st = compactStyle(n, !parent);
      if (Object.keys(st).length) o.style = st;
      if (n.type === 'text' && n.text) {
        const dt = defaultsFor('text');
        const t = { content: n.text.content };
        TEXT_KEYS.forEach((k) => {
          if (k === 'content') return;
          const v = n.text[k];
          if (v != null && v !== dt[k] && !(k === 'italic' && !v)) t[k] = v;
        });
        o.text = t;
      }
      if (n.type === 'image' && n.image) {
        o.image = { src: shortSrc(n.image.src || '') };
        if (n.image.fit && n.image.fit !== 'cover') o.image.fit = n.image.fit;
      }
      if (n.visible === false) o.visible = false;
      if (n.locked) o.locked = true;
      if (n.type === 'frame' && n.children && n.children.length) {
        if (d >= maxDepth || count >= maxNodes) o.childCount = n.children.length;
        else {
          o.children = [];
          for (let i = 0; i < n.children.length; i++) {
            const c = store.get(n.children[i]);
            if (!c) continue;
            if (count >= maxNodes) {
              o.children.push({ more: n.children.length - i, note: 'use get_tree on this layer to see the rest' });
              break;
            }
            o.children.push(walk(c, d + 1));
          }
        }
      }
      return o;
    };
    return walk(root, 0);
  }

  function describeNode(id) {
    const store = S();
    const n = store && store.get(id);
    if (!n) return `no layer with id ${id}`;
    const rs = renderedSize(id) || [Math.round(n.width), Math.round(n.height)];
    const p = store.getParent(id);
    return `${n.type} ${q(n.name)} (${n.id}) ${rs[0]}×${rs[1]} ${p ? 'in ' + q(p.name) : 'artboard'}`;
  }

  // ---------- finding nodes ----------
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 99;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
  }

  function nearMatches(query) {
    const store = S();
    const qs = String(query == null ? '' : query).trim().toLowerCase();
    const all = Object.values(store.doc.nodes);
    const scored = [];
    all.forEach((n) => {
      const name = String(n.name || '').toLowerCase();
      let score = 0;
      if (qs && name === qs) score = 100;
      else if (qs && qs.length > 1 && (name.includes(qs) || (name.length > 2 && qs.includes(name)))) score = 60;
      else if (qs && editDistance(qs, n.id.toLowerCase()) <= 2) score = 50;
      else if (qs && editDistance(qs, name) <= 2) score = 40;
      if (score) scored.push([score, n]);
    });
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, 6).map(([, n]) => n);
  }

  /** Resolve an id (or, as a convenience, a unique exact layer name). */
  function resolve(id, notes) {
    const store = S();
    if (typeof id === 'number') id = String(id);
    if (typeof id !== 'string' || !id.trim()) return { error: `${str(id)} is not a layer id` };
    const s = id.trim().replace(/^["'“]|["'”]$/g, '');
    const n = store.get(s);
    if (n) return { node: n };
    const byName = Object.values(store.doc.nodes).filter((x) => String(x.name || '').toLowerCase() === s.toLowerCase());
    if (byName.length === 1) {
      if (notes) notes.push(`${q(s)} is a layer name, not an id — used ${byName[0].id}`);
      return { node: byName[0] };
    }
    const near = nearMatches(s);
    const list = near.map((x) => `${x.id} ${x.type} ${q(x.name)}${x.parent ? ' in ' + q((store.get(x.parent) || {}).name) : ''}`).join('; ');
    return { error: `No layer with id ${q(s)}.${list ? ' Did you mean: ' + list + '?' : ''} Call get_document or get_tree to see the current ids.` };
  }

  // ---------- canvas helpers ----------
  function rectOf(id) {
    const store = S();
    try {
      if (Folio.canvas && Folio.canvas.nodeRect) {
        const r = Folio.canvas.nodeRect(id);
        if (r) return r;
      }
    } catch (e) {
      /* fall back to data */
    }
    const n = store.get(id);
    return n ? { x: n.x, y: n.y, width: n.width, height: n.height } : null;
  }

  /** Where the next artboard goes: right of everything, 120px gap, top-aligned to the first artboard. */
  function nextArtboardSpot(excludeIds) {
    const store = S();
    const roots = store.doc.roots.filter((id) => store.get(id) && !(excludeIds && excludeIds.includes(id)));
    if (!roots.length) return { x: 0, y: 0 };
    let maxRight = -Infinity;
    roots.forEach((id) => {
      const r = rectOf(id);
      if (r) maxRight = Math.max(maxRight, r.x + r.width);
    });
    const first = rectOf(roots[0]) || { y: 0 };
    return { x: Math.round(isFinite(maxRight) ? maxRight + 120 : 0), y: Math.round(first.y || 0) };
  }

  const vpSame = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.zoom - b.zoom) < 1e-4;
  let lastFit = null; // { root, vp, rect } — the artboard we last zoomed to

  function fitTo(rootId) {
    const C = Folio.canvas;
    if (!C || !C.zoomToFit) return;
    try {
      C.zoomToFit([rootId]);
      lastFit = { root: rootId, vp: Object.assign({}, S().viewport), rect: rectOf(rootId) };
    } catch (e) {
      /* zoom is cosmetic */
    }
  }

  /** Bring changes into view without stealing the viewport for small edits. */
  function reveal(changedIds, createdRoots) {
    const store = S();
    const C = Folio.canvas;
    if (!C || !C.zoomToFit) return;
    try {
      if (createdRoots && createdRoots.length) {
        if (createdRoots.length === 1) fitTo(createdRoots[0]);
        else {
          C.zoomToFit(createdRoots);
          lastFit = null;
        }
        return;
      }
      const ids = changedIds.filter((id) => store.get(id));
      if (!ids.length) return;
      const root = store.rootOf(ids[0]);
      // the artboard we just made grew (e.g. a new section) and the user hasn't moved the view: follow it
      if (lastFit && lastFit.root === root && vpSame(lastFit.vp, store.viewport)) {
        const r = rectOf(root);
        const p = lastFit.rect;
        if (r && p && (Math.abs(r.width - p.width) > 1 || Math.abs(r.height - p.height) > 1)) fitTo(root);
        return;
      }
      // the change happened completely off-screen: show that artboard
      const r = rectOf(root);
      const vpEl = document.getElementById('canvas-viewport');
      if (r && vpEl && C.worldToScreen) {
        const a = C.worldToScreen(r.x, r.y);
        const b = C.worldToScreen(r.x + r.width, r.y + r.height);
        const off = b.x < 0 || b.y < 0 || a.x > vpEl.clientWidth || a.y > vpEl.clientHeight;
        if (off) fitTo(root);
      }
    } catch (e) {
      /* zoom is cosmetic */
    }
  }

  /**
   * Layout check after a change: children that stick out of their flex parent. Scaled-down
   * screenshots of tall pages hide this easily, so we tell the model directly.
   */
  function layoutIssues(ids) {
    const store = S();
    const out = [];
    try {
      if (!Folio.render || !Folio.render.el) return out;
      Folio.render.sync && Folio.render.sync();
      const seen = new Set();
      for (const id of ids.slice(0, 2000)) {
        if (out.length >= 8) break;
        const n = store.get(id);
        const p = n && n.parent ? store.get(n.parent) : null;
        if (!p || seen.has(id) || n.visible === false || !(p.layout && p.layout.mode === 'flex')) continue;
        seen.add(id);
        if ((n.style && n.style.rotation) || (p.style && p.style.rotation)) continue;
        const el = Folio.render.el(id);
        const pel = Folio.render.el(p.id);
        if (!el || !pel || !el.getClientRects().length) continue;
        const pad = p.layout.padding || [0, 0, 0, 0];
        const overX = Math.round(el.offsetLeft + el.offsetWidth - (pel.clientWidth - (pad[1] || 0)));
        const pH = p.sizing && p.sizing.h;
        const overY = pH === 'hug' ? 0 : Math.round(el.offsetTop + el.offsetHeight - (pel.clientHeight - (pad[2] || 0)));
        const what = `${q(n.name)} (${n.id}, ${el.offsetWidth}×${el.offsetHeight})`;
        if (overX > 2) {
          const fix =
            n.type === 'text' && (!n.sizing || n.sizing.w !== 'fill')
              ? 'give the text sizing.w "fill" (or a fixed width) so it wraps'
              : (n.sizing && n.sizing.w === 'fill') || n.type === 'text'
              ? `its parent ${q(p.name)} hugs its content or is too narrow — give the parent a fixed or fill width`
              : 'make it narrower, use sizing.w "fill", or reduce gap/padding';
          out.push(`${what} overflows ${q(p.name)} horizontally by ${overX}px — ${fix}`);
        } else if (overY > 2) {
          out.push(`${what} overflows ${q(p.name)} vertically by ${overY}px — make ${q(p.name)} taller or "hug", or shrink its content`);
        }
      }
    } catch (e) {
      /* the check is advisory */
    }
    return out;
  }

  function afterMutation(changedIds, selectIds, createdRoots) {
    const store = S();
    const sel = (selectIds || changedIds).filter((id) => store.get(id));
    if (sel.length) store.select(sel);
    reveal(changedIds, createdRoots);
    store.emit('ai:changed', changedIds.slice());
  }

  // ---------- results ----------
  function result(obj, summary, changedIds, isError) {
    return { content: typeof obj === 'string' ? obj : JSON.stringify(obj), isError: !!isError, summary, changedIds: changedIds || [] };
  }
  const fail = (msg, summary) => result(msg, summary || 'Tool error', [], true);

  function parseInput(input) {
    if (typeof input === 'string') {
      try {
        return JSON.parse(input);
      } catch (e) {
        return {};
      }
    }
    return isObj(input) ? input : {};
  }

  // ---------- tools ----------
  function getDocument() {
    const store = S();
    const doc = store.doc;
    const artboards = doc.roots
      .map((id) => store.get(id))
      .filter(Boolean)
      .map((n) => {
        const rs = renderedSize(n.id) || [Math.round(n.width), Math.round(n.height)];
        const o = { id: n.id, type: n.type, name: n.name, x: r2(n.x), y: r2(n.y), size: rs };
        if (n.type === 'frame') {
          o.layout = n.layout && n.layout.mode === 'flex' ? `flex ${n.layout.direction || 'column'}` : 'freeform';
          o.sizing = `${(n.sizing && n.sizing.w) || 'fixed'}/${(n.sizing && n.sizing.h) || 'fixed'}`;
          o.children = n.children.slice(0, 40).map((cid) => {
            const c = store.get(cid);
            if (!c) return null;
            const k = c.type === 'frame' && c.children.length ? ` (${c.children.length} children)` : '';
            const t = c.type === 'text' ? ` ${q(String(c.text && c.text.content).replace(/\s+/g, ' ').slice(0, 40))}` : '';
            return `${c.id} ${c.type} ${q(c.name)}${t}${k}`;
          }).filter(Boolean);
          if (n.children.length > 40) o.children.push(`…${n.children.length - 40} more`);
          o.layerCount = store.descendants(n.id).length;
        }
        if (n.visible === false) o.visible = false;
        return o;
      });
    const selection = store.selection.map((id) => store.get(id)).filter(Boolean).map((n) => {
      const p = store.getParent(n.id);
      return { id: n.id, type: n.type, name: n.name, parent: p ? `${p.id} ${q(p.name)}` : null, artboard: store.rootOf(n.id) };
    });
    const out = { document: doc.name || 'Untitled', artboards, selection };
    if (!artboards.length) out.note = 'The canvas is empty. Create an artboard with create_nodes (parent_id null).';
    return result(out, `Read the document (${artboards.length} artboard${artboards.length === 1 ? '' : 's'})`, []);
  }

  function getTree(input) {
    const notes = [];
    const r = resolve(input.node_id != null ? input.node_id : input.id, notes);
    if (r.error) return fail(r.error, 'Layer not found');
    let depth = input.depth == null ? 8 : Number(input.depth);
    if (!isFinite(depth)) depth = 8;
    depth = clamp(Math.round(depth), 0, 50);
    const tree = serialize(r.node.id, { depth, maxNodes: 400 });
    const p = S().getParent(r.node.id);
    const out = { parent: p ? { id: p.id, name: p.name, layout: p.layout && p.layout.mode === 'flex' ? `flex ${p.layout.direction}` : 'freeform' } : null, tree };
    if (notes.length) out.notes = notes;
    return result(out, `Read ${q(r.node.name)}`, []);
  }

  function createNodes(input) {
    const store = S();
    const ctx = makeCtx('create');
    const notes = [];
    let nodes = input.nodes;
    if (nodes == null && input.node) nodes = [input.node];
    if (isObj(nodes)) nodes = [nodes];
    if (!Array.isArray(nodes) || !nodes.length) return fail('create_nodes needs "nodes": an array of node trees, e.g. [{"type":"frame","name":"Card","children":[…]}].', 'Nothing to create');

    let parentId = input.parent_id;
    if (parentId === undefined && input.parentId !== undefined) parentId = input.parentId;
    if (parentId === undefined) {
      notes.push('parent_id was missing — created new artboards on the canvas');
      parentId = null;
    }
    if (parentId === '' || parentId === 'null' || parentId === 'canvas' || parentId === 'root') parentId = null;
    let parent = null;
    let index = input.index;
    if (parentId !== null) {
      const r = resolve(parentId, notes);
      if (r.error) return fail(r.error + ' Nothing was created.', 'Parent not found');
      parent = r.node;
      if (parent.type !== 'frame') {
        const host = store.getParent(parent.id);
        notes.push(`${q(parent.name)} is a ${parent.type} and cannot hold children — added the new layers ${host ? 'after it in ' + q(host.name) : 'as artboards'}`);
        index = store.siblingsOf(parent.id).indexOf(parent.id) + 1;
        parent = host;
      }
    }
    const pid = parent ? parent.id : null;
    const info = {
      seen: new WeakSet(),
      count: 0,
      truncated: 0,
      fonts: new Set(),
      parentId: pid,
      parentFlex: !!(parent && parent.layout && parent.layout.mode === 'flex'),
      parentDir: parent && parent.layout ? parent.layout.direction : 'column',
    };
    const prefix = parent ? parent.name : '';
    const clean = [];
    nodes.forEach((raw) => clean.push(...cleanTree(raw, ctx, info, 0, null, prefix)));
    if (info.truncated) ctx.warn(`only the first ${MAX_NODES_PER_CALL} nodes were created (${info.truncated} skipped) — split big designs into one call per section`);
    if (!clean.length) return fail('No valid nodes to create. ' + ctx.warnings().join(' '), 'Nothing to create');

    const list = pid ? parent.children : store.doc.roots;
    if (index != null) {
      index = Number(index);
      if (!isFinite(index)) index = undefined;
      else index = clamp(Math.round(index), 0, list.length);
    }

    const created = {};
    const topIds = [];
    const allIds = [];
    const placed = [];
    clean.forEach((tree, i) => {
      if (!pid && (tree.x == null || tree.y == null)) {
        const spot = nextArtboardSpot();
        if (tree.x == null) tree.x = spot.x;
        if (tree.y == null) tree.y = spot.y;
        placed.push(tree.name);
      }
      const node = store.buildFromTree(tree, pid, index == null ? undefined : index + i);
      topIds.push(node.id);
      const walk = (n, path) => {
        const p = path ? path + '/' + n.name : n.name;
        created[n.id] = p;
        allIds.push(n.id);
        n.children.forEach((c) => walk(store.get(c), p));
      };
      walk(node, prefix);
    });
    info.fonts.forEach((f) => Folio.fonts && Folio.fonts.ensure && Folio.fonts.ensure(f));

    const roots = pid ? [] : topIds;
    afterMutation(allIds, topIds, roots);

    const out = { created };
    if (pid) out.parent = `${pid} ${q(parent.name)}`;
    else out.artboards = topIds.map((id) => {
      const n = store.get(id);
      const rs = renderedSize(id) || [n.width, n.height];
      return `${id} ${q(n.name)} at (${n.x}, ${n.y}) ${rs[0]}×${rs[1]}`;
    });
    const warnings = notes.concat(ctx.warnings());
    if (warnings.length) out.warnings = warnings;
    const issues = layoutIssues(allIds);
    if (issues.length) out.layout = issues;
    const where = pid ? ` in ${q(parent.name)}` : '';
    const summary = !pid && topIds.length === 1
      ? `Created artboard ${q(store.get(topIds[0]).name)} (${allIds.length} layer${allIds.length === 1 ? '' : 's'})`
      : `Created ${allIds.length} layer${allIds.length === 1 ? '' : 's'}${where}`;
    return result(out, summary, allIds);
  }

  /** When a frame switches from flex to freeform, keep its children where they are on screen. */
  function freezeChildPositions(node, patch) {
    const store = S();
    try {
      if (!Folio.render || !Folio.render.el) return;
      Folio.render.sync && Folio.render.sync();
      const el = Folio.render.el(node.id);
      if (!el) return;
      node.children.forEach((cid) => {
        const cel = Folio.render.el(cid);
        const c = store.get(cid);
        if (!cel || !c) return;
        const sz = c.sizing || {};
        const p = { x: cel.offsetLeft, y: cel.offsetTop };
        if (sz.w === 'fill') p.width = cel.offsetWidth;
        if (sz.h === 'fill') p.height = cel.offsetHeight;
        if (sz.w === 'fill' || sz.h === 'fill') p.sizing = { w: sz.w === 'fill' ? 'fixed' : sz.w, h: sz.h === 'fill' ? 'fixed' : sz.h };
        store.update(cid, p);
      });
      const sz = node.sizing || {};
      const ps = Object.assign({ w: sz.w, h: sz.h }, patch.sizing || {});
      if (ps.w === 'hug') {
        ps.w = 'fixed';
        if (patch.width == null) patch.width = el.offsetWidth;
      }
      if (ps.h === 'hug') {
        ps.h = 'fixed';
        if (patch.height == null) patch.height = el.offsetHeight;
      }
      patch.sizing = ps;
    } catch (e) {
      /* best effort */
    }
  }

  function updateNodes(input) {
    const store = S();
    const ctx = makeCtx('update');
    const notes = [];
    let updates = input.updates;
    if (updates == null && input.id) updates = [{ id: input.id, patch: input.patch }];
    if (isObj(updates)) updates = Object.keys(updates).map((id) => ({ id, patch: updates[id] }));
    if (!Array.isArray(updates) || !updates.length) return fail('update_nodes needs "updates": [{"id": "n_…", "patch": {…}}].', 'Nothing to update');
    const errors = [];
    const changed = [];
    updates.slice(0, 1000).forEach((u, i) => {
      if (!isObj(u)) return errors.push(`updates[${i}] is not {id, patch}`);
      const r = resolve(u.id, notes);
      if (r.error) return errors.push(r.error);
      const node = r.node;
      let raw = u.patch;
      if (raw == null) {
        // tolerate {id, text: {...}} without the patch wrapper
        raw = {};
        Object.keys(u).forEach((k) => k !== 'id' && (raw[k] = u[k]));
      }
      if (!isObj(raw)) return errors.push(`patch for ${node.id} must be an object`);
      ctx.at = `${node.id} ${q(node.name)}`;
      const blocked = ['id', 'type', 'parent', 'children'].filter((k) => own(raw, k));
      if (blocked.includes('type') && raw.type !== node.type) ctx.warn(`type cannot change (it is a ${node.type}) — delete it and create a new layer instead`);
      if (blocked.includes('children')) ctx.warn('children cannot be patched — use create_nodes, move_nodes or delete_nodes');
      if (blocked.includes('parent')) ctx.warn('parent cannot be patched — use move_nodes');
      const r0 = {};
      Object.keys(raw).forEach((k) => !blocked.includes(k) && (r0[k] = raw[k]));
      const patch = sanitizeProps(r0, node.type, ctx, node);
      // width/height without sizing → that axis becomes fixed
      ['w', 'h'].forEach((ax) => {
        const dim = ax === 'w' ? 'width' : 'height';
        if (patch[dim] != null && !(patch.sizing && patch.sizing[ax]) && node.sizing && node.sizing[ax] !== 'fixed') {
          patch.sizing = Object.assign({}, patch.sizing, { [ax]: 'fixed' });
        }
      });
      if (!node.parent && patch.sizing) {
        ['w', 'h'].forEach((ax) => {
          if (patch.sizing[ax] === 'fill') {
            ctx.warn('an artboard cannot fill — kept it fixed');
            patch.sizing[ax] = 'fixed';
          }
        });
      }
      if (node.type === 'frame' && patch.layout && patch.layout.mode === 'none' && node.layout && node.layout.mode === 'flex' && node.children.length) freezeChildPositions(node, patch);
      if (patch.text && patch.text.weight != null && !patch.text.font) patch.text.weight = snapWeight(node.text && node.text.font, patch.text.weight, ctx);
      if (!Object.keys(patch).length) {
        ctx.warn('nothing to change');
        return;
      }
      store.update(node.id, patch);
      if (patch.text && patch.text.font && Folio.fonts && Folio.fonts.ensure) Folio.fonts.ensure(patch.text.font);
      if (!changed.includes(node.id)) changed.push(node.id);
    });
    ctx.at = '';
    if (changed.length) afterMutation(changed);
    const out = { updated: changed.map((id) => `${id} ${q(store.get(id).name)}`) };
    if (errors.length) out.errors = errors;
    const warnings = notes.concat(ctx.warnings());
    if (warnings.length) out.warnings = warnings;
    const touched = [];
    changed.forEach((id) => {
      const n = store.get(id);
      if (!n) return;
      touched.push(id, ...n.children);
      if (n.parent) touched.push(...store.get(n.parent).children);
    });
    const issues = layoutIssues([...new Set(touched)]);
    if (issues.length) out.layout = issues;
    const summary = changed.length === 1 ? `Updated ${q(store.get(changed[0]).name)}` : `Updated ${changed.length} layers`;
    return result(out, changed.length ? summary : 'Nothing updated', changed, !changed.length);
  }

  function deleteNodes(input) {
    const store = S();
    const notes = [];
    let ids = input.ids;
    if (ids == null && input.id) ids = [input.id];
    if (typeof ids === 'string') ids = [ids];
    if (!Array.isArray(ids) || !ids.length) return fail('delete_nodes needs "ids": ["n_…"].', 'Nothing to delete');
    const errors = [];
    const targets = [];
    ids.slice(0, 1000).forEach((id) => {
      const r = resolve(id, notes);
      if (r.error) errors.push(r.error);
      else if (!targets.includes(r.node.id)) targets.push(r.node.id);
    });
    // skip nodes whose ancestor is also being deleted
    const top = targets.filter((id) => !targets.some((o) => o !== id && store.isAncestor(o, id)));
    const names = top.map((id) => store.get(id).name);
    let count = 0;
    top.forEach((id) => (count += 1 + store.descendants(id).length));
    if (top.length) {
      store.remove(top);
      if (lastFit && !store.get(lastFit.root)) lastFit = null;
      store.emit('ai:changed', top.slice());
    }
    const out = { deleted: top, layersRemoved: count };
    if (errors.length) out.errors = errors;
    if (notes.length) out.notes = notes;
    const summary = top.length === 1 ? `Deleted ${q(names[0])}` : `Deleted ${top.length} layers`;
    return result(out, top.length ? summary : 'Nothing deleted', top, !top.length);
  }

  function moveNodes(input) {
    const store = S();
    const ctx = makeCtx('update');
    const notes = [];
    let moves = input.moves;
    if (moves == null && input.id) moves = [input];
    if (isObj(moves)) moves = [moves];
    if (!Array.isArray(moves) || !moves.length) return fail('move_nodes needs "moves": [{"id": "n_…", "parent_id": "n_…" | null, "index"?: 0}].', 'Nothing to move');
    const errors = [];
    const moved = [];
    const newRoots = [];
    moves.slice(0, 500).forEach((m, i) => {
      if (!isObj(m)) return errors.push(`moves[${i}] is not {id, parent_id}`);
      const r = resolve(m.id, notes);
      if (r.error) return errors.push(r.error);
      const node = r.node;
      let pid = m.parent_id !== undefined ? m.parent_id : m.parentId;
      if (pid === undefined) pid = node.parent; // reorder in place
      if (pid === '' || pid === 'null' || pid === 'canvas') pid = null;
      let parent = null;
      if (pid !== null) {
        const pr = resolve(pid, notes);
        if (pr.error) return errors.push(pr.error);
        parent = pr.node;
        if (parent.id === node.id) return errors.push(`cannot move ${q(node.name)} into itself`);
        if (store.isAncestor(node.id, parent.id)) return errors.push(`cannot move ${q(node.name)} into ${q(parent.name)} because ${q(parent.name)} is inside it`);
        if (parent.type !== 'frame') return errors.push(`${q(parent.name)} is a ${parent.type}; only frames can hold children`);
      }
      const before = rectOf(node.id);
      const list = parent ? parent.children : store.doc.roots;
      let index = m.index;
      if (index != null) {
        index = Number(index);
        index = isFinite(index) ? clamp(Math.round(index), 0, list.length) : undefined;
      }
      const ok = store.move(node.id, parent ? parent.id : null, index == null ? undefined : index);
      if (!ok) return errors.push(`could not move ${q(node.name)}`);
      ctx.at = `${node.id} ${q(node.name)}`;
      const patch = {};
      const x = m.x != null ? num(m.x, ctx, 'x', -1000000, 1000000) : undefined;
      const y = m.y != null ? num(m.y, ctx, 'y', -1000000, 1000000) : undefined;
      const freeform = !parent || !(parent.layout && parent.layout.mode === 'flex');
      if (freeform) {
        if (!parent) {
          // an artboard can't fill, and needs a free spot on the canvas
          const sz = Object.assign({}, node.sizing);
          ['w', 'h'].forEach((ax) => {
            if (sz[ax] === 'fill') {
              sz[ax] = 'fixed';
              patch[ax === 'w' ? 'width' : 'height'] = Math.round(before ? (ax === 'w' ? before.width : before.height) : ax === 'w' ? node.width : node.height);
            }
          });
          patch.sizing = sz;
          if (x == null || y == null) {
            const spot = nextArtboardSpot([node.id]);
            patch.x = x != null ? x : spot.x;
            patch.y = y != null ? y : spot.y;
          }
          newRoots.push(node.id);
        } else if ((x == null || y == null) && before && Folio.canvas && Folio.canvas.layoutBox) {
          // keep it where it was on screen, relative to its new parent
          const pb = Folio.canvas.layoutBox(parent.id);
          const bw = (parent.style && parent.style.border && parent.style.border.width) || 0;
          if (pb) {
            if (x == null) patch.x = Math.round(before.x - pb.x - bw);
            if (y == null) patch.y = Math.round(before.y - pb.y - bw);
          }
        }
        if (x != null) patch.x = x;
        if (y != null) patch.y = y;
      } else if (x != null || y != null) ctx.warn(`x/y are ignored inside the flex frame ${q(parent.name)}`);
      if (Object.keys(patch).length) store.update(node.id, patch);
      moved.push(node.id);
    });
    ctx.at = '';
    if (moved.length) afterMutation(moved, moved, newRoots.length ? newRoots : null);
    const out = {
      moved: moved.map((id) => {
        const n = store.get(id);
        const p = store.getParent(id);
        return `${id} ${q(n.name)} → ${p ? q(p.name) + ' at index ' + p.children.indexOf(id) : 'canvas (artboard)'}`;
      }),
    };
    if (errors.length) out.errors = errors;
    const warnings = notes.concat(ctx.warnings());
    if (warnings.length) out.warnings = warnings;
    const issues = layoutIssues(moved);
    if (issues.length) out.layout = issues;
    let summary = `Moved ${moved.length} layers`;
    if (moved.length === 1) {
      const p = store.getParent(moved[0]);
      summary = `Moved ${q(store.get(moved[0]).name)}${p ? ' into ' + q(p.name) : ' to the canvas'}`;
    }
    return result(out, moved.length ? summary : 'Nothing moved', moved, !moved.length);
  }

  const nextFrame = () =>
    new Promise((res) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => res());
      else setTimeout(res, 16);
    });
  const timeout = (p, ms) => Promise.race([p, new Promise((res) => setTimeout(res, ms))]);

  async function waitForFonts(id) {
    const store = S();
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return;
    const want = new Set();
    [id, ...store.descendants(id)].forEach((nid) => {
      const n = store.get(nid);
      if (n && n.type === 'text' && n.text && n.text.font && !SYSTEM_FONTS.includes(n.text.font)) {
        Folio.fonts && Folio.fonts.ensure && Folio.fonts.ensure(n.text.font);
        want.add(`${n.text.italic ? 'italic ' : ''}${n.text.weight || 400} 16px "${n.text.font}"`);
      }
    });
    await timeout(Promise.all([...want].map((f) => document.fonts.load(f).catch(() => null))), 4000);
    await timeout(document.fonts.ready, 2000);
  }

  async function screenshot(input) {
    const store = S();
    const notes = [];
    const r = resolve(input.node_id != null ? input.node_id : input.id, notes);
    if (r.error) return fail(r.error, 'Layer not found');
    const node = r.node;
    const ex = Folio.exporter;
    if (!ex || !ex.pngDataUrl) return fail('Screenshots are not available in this build of Folio (exporter missing). Use get_tree to check sizes instead.', 'Screenshot unavailable');
    if (typeof window !== 'undefined' && !(window.htmlToImage && window.htmlToImage.toPng))
      return fail('Screenshots need the html-to-image library, which could not be loaded (the user may be offline). The design itself is fine; use get_tree to check rendered sizes, and ask the user to look at the canvas.', 'Screenshot unavailable');
    let scale = input.scale == null ? 1 : Number(input.scale);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    scale = clamp(scale, 0.1, 2);
    try {
      await waitForFonts(node.id);
      await nextFrame();
      await nextFrame();
      const size = renderedSize(node.id);
      if (!size || !size[0] || !size[1]) return fail(`${q(node.name)} is hidden or has zero size, so there is nothing to capture.`, 'Nothing to capture');
      const longest = Math.max(size[0], size[1]);
      let shown = Math.min(scale, 1400 / longest);
      let url = await ex.pngDataUrl(node.id, { scale, maxSize: 1400 });
      // grainy fills compress badly; keep the image well under the API's 5 MB limit
      for (let i = 0; i < 3 && String(url).length > MAX_IMAGE_CHARS; i++) {
        shown *= 0.7;
        url = await ex.pngDataUrl(node.id, { scale: shown, maxSize: 1400 });
      }
      const comma = String(url).indexOf(',');
      const data = comma >= 0 ? String(url).slice(comma + 1) : '';
      if (!data) return fail('The screenshot came back empty.', 'Screenshot failed');
      let text = `Screenshot of ${q(node.name)} (${size[0]}×${size[1]})`;
      if (shown < 0.999) text += ` — shown at ${Math.round(shown * 100)}% scale; screenshot a section for detail`;
      if (notes.length) text += '. ' + notes.join(' ');
      return {
        content: [
          { type: 'text', text },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
        ],
        isError: false,
        summary: `Screenshot of ${q(node.name)}`,
        changedIds: [],
      };
    } catch (e) {
      const why = e && e.code === 'no-lib' ? 'the html-to-image library is not loaded' : (e && e.message) || String(e);
      return fail(`Could not take a screenshot (${why}). External images without CORS can block it. Use get_tree to inspect the layout instead.`, 'Screenshot failed');
    }
  }

  const HANDLERS = {
    get_document: getDocument,
    get_tree: getTree,
    create_nodes: createNodes,
    update_nodes: updateNodes,
    delete_nodes: deleteNodes,
    move_nodes: moveNodes,
    screenshot,
  };

  async function execute(name, input) {
    try {
      if (!S()) return fail('Folio is not ready yet.', 'Folio not ready');
      const fn = own(HANDLERS, name) ? HANDLERS[name] : null;
      if (!fn) return fail(`Unknown tool ${q(name)}. Available tools: ${Object.keys(HANDLERS).join(', ')}.`, 'Unknown tool');
      return await fn(parseInput(input));
    } catch (e) {
      console.error('[Folio] AI tool failed', name, e);
      return fail(`Folio hit an internal error while running ${name}: ${(e && e.message) || e}. Some changes may have been applied — call get_document to check.`, `${name} failed`);
    }
  }

  Folio.aiTools = { execute, describeNode, serialize, renderedSize, normalizeColor, names: Object.keys(HANDLERS) };
})();
