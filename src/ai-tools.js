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
      literals: new Map(), // literal colours/fonts that equal a brand value (hint only)
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
    const t = colorToken(v, ctx, label);
    if (t) return t.value;
    const c = normalizeColor(v);
    if (c) {
      noteLiteralColor(c, ctx);
      return c;
    }
    ctx.warn(`${label} ${str(v)} is not a valid colour — ${ctx.mode === 'update' ? 'kept the previous colour' : 'used the default'}`);
    return undefined;
  }

  // ---------- brand kits: token references ----------
  // Layers link to the active brand with plain CSS strings: var(--color-<id>), var(--font-<id>),
  // var(--radius-sm|md|lg) and image src "brand-logo:<logoId>". They are stored (and shown to the
  // model) as tokens; Folio.brand turns them into CSS variables on the canvas.
  const CORE_COLORS = [
    ['primary', 'Primary', '#2563eb'],
    ['on-primary', 'On primary', '#ffffff'],
    ['secondary', 'Secondary', '#0f172a'],
    ['accent', 'Accent', '#f59e0b'],
    ['background', 'Background', '#ffffff'],
    ['surface', 'Surface', '#f4f4f5'],
    ['text', 'Text', '#18181b'],
    ['muted', 'Muted', '#71717a'],
    ['success', 'Success', '#16a34a'],
    ['danger', 'Danger', '#dc2626'],
  ];
  const CORE_COLOR_IDS = CORE_COLORS.map((c) => c[0]);
  const CORE_FONTS = [
    ['heading', 'Heading', 'Inter', 700],
    ['body', 'Body', 'Inter', 400],
  ];
  const CORE_FONT_IDS = CORE_FONTS.map((f) => f[0]);
  const RADIUS_IDS = ['sm', 'md', 'lg'];
  const RADIUS_DEFAULTS = { sm: 6, md: 12, lg: 24 };
  const COLOR_ALIASES = { brand: 'primary', main: 'primary', cta: 'primary', action: 'primary', second: 'secondary', highlight: 'accent', pop: 'accent', bg: 'background', page: 'background', canvas: 'background', paper: 'background', card: 'surface', panel: 'surface', elevated: 'surface', foreground: 'text', fg: 'text', ink: 'text', body: 'text', heading: 'text', subtle: 'muted', grey: 'muted', gray: 'muted', caption: 'muted', border: 'muted', onprimary: 'on-primary', on_primary: 'on-primary', onPrimary: 'on-primary', 'button-text': 'on-primary', 'button-label': 'on-primary', ok: 'success', positive: 'success', green: 'success', error: 'danger', destructive: 'danger', warning: 'danger', red: 'danger' };
  const FONT_ALIASES = { display: 'heading', headline: 'heading', headings: 'heading', title: 'heading', h1: 'heading', header: 'heading', primary: 'heading', text: 'body', paragraph: 'body', copy: 'body', base: 'body', secondary: 'body', ui: 'body' };
  const RADIUS_ALIASES = { s: 'sm', small: 'sm', xs: 'sm', xsmall: 'sm', m: 'md', medium: 'md', base: 'md', default: 'md', l: 'lg', large: 'lg', xl: 'lg', '2xl': 'lg', xxl: 'lg' };

  let brandScope; // undefined = the document's active brand; set_brand validates gradients against the kit it edits
  function activeBrand() {
    if (brandScope !== undefined) return brandScope;
    try {
      return (Folio.brand && Folio.brand.active && Folio.brand.active()) || null;
    } catch (e) {
      return null;
    }
  }
  const keyOf = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const listOf = (b, k) => (b && Array.isArray(b[k]) ? b[k].filter(isObj) : []);
  const tokenFor = (kind, id) => (kind === 'logo' ? `brand-logo:${id}` : `var(--${kind}-${id})`);

  /** 'var(--color-primary)' → {kind:'color', id:'primary'}; 'var(--accent)' → {kind:null, id:'accent'}; otherwise null. */
  function parseVar(v) {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    const m = /^var\(\s*--([A-Za-z0-9_-]+)\s*(?:,[\s\S]*)?\)$/.exec(s) || /^--([A-Za-z0-9_-]+)$/.exec(s);
    if (!m) return null;
    const k = /^(colou?r|font|radius)-(.+)$/i.exec(m[1]);
    if (!k) return { kind: null, id: m[1], raw: s };
    return { kind: /^colou?r$/i.test(k[1]) ? 'color' : k[1].toLowerCase(), id: k[2], raw: s };
  }

  /** Find a brand entry by id, then forgivingly by name / alias / typo. */
  function nearestEntry(list, id, aliases) {
    const exact = list.find((e) => e.id === id);
    if (exact) return { entry: exact, exact: true };
    const tries = [keyOf(id)];
    if (/^brand./.test(tries[0])) tries.push(tries[0].replace(/^brand/, ''));
    for (const k of tries) {
      if (!k) continue;
      let e = list.find((x) => keyOf(x.id) === k) || list.find((x) => keyOf(x.name) === k);
      if (!e && aliases && own(aliases, k)) e = list.find((x) => x.id === aliases[k]);
      if (!e && aliases && k.length > 3) {
        const a = Object.keys(aliases).find((x) => x.length > 3 && editDistance(k, x) <= 1);
        if (a) e = list.find((x) => x.id === aliases[a]);
      }
      if (!e && k.length > 2) e = list.find((x) => editDistance(k, keyOf(x.id)) <= 1 || editDistance(k, keyOf(x.name)) <= 2);
      if (!e && k.length > 3)
        e = list.find((x) => {
          const n = keyOf(x.name);
          return n.length > 2 && (n.includes(k) || k.includes(n));
        });
      if (e) return { entry: e, exact: false };
    }
    return null;
  }

  const fallbackWord = (ctx) => (ctx.mode === 'update' ? 'kept the previous value' : 'used the default');
  function validTokens(ctx, kind, b) {
    const flag = 'listed_' + kind;
    if (ctx[flag]) return ' (valid tokens are listed above)';
    ctx[flag] = true;
    if (kind === 'color') return '. Valid colour tokens: ' + listOf(b, 'colors').map((c) => `${tokenFor('color', c.id)} = ${c.name} ${c.value}`).join(', ');
    if (kind === 'font') return '. Valid font tokens: ' + listOf(b, 'fonts').map((f) => `${tokenFor('font', f.id)} = ${f.family}`).join(', ');
    if (kind === 'logo') {
      const ls = listOf(b, 'logos');
      return ls.length ? '. Valid logos: ' + ls.map((l) => `brand-logo:${l.id} (${q(l.name)})`).join(', ') : '. This kit has no logos yet (the user can upload one in the Brand panel)';
    }
    return '';
  }

  /** A colour token → {value: 'var(--color-id)' | undefined}; null when `v` is not a token. */
  function colorToken(v, ctx, label) {
    const t = parseVar(v);
    if (!t) return null;
    if (t.kind && t.kind !== 'color') {
      ctx.warn(`${label} ${q(t.raw)} is a ${t.kind} token, not a colour — ${fallbackWord(ctx)}`);
      return { value: undefined };
    }
    const b = activeBrand();
    if (!b) {
      ctx.warn(`${label} ${q(t.raw)}: no brand kit is active, so colour tokens have nothing to link to — ${fallbackWord(ctx)}. Use hex colours, or create a kit with set_brand first`);
      return { value: undefined };
    }
    const hit = nearestEntry(listOf(b, 'colors'), t.id, COLOR_ALIASES);
    if (hit) {
      const tok = tokenFor('color', hit.entry.id);
      if (!hit.exact || !t.kind) ctx.warn(`${label} ${q(t.raw)} is not a colour token of ${q(b.name)} — used ${tok} (${hit.entry.name} ${hit.entry.value})`);
      return { value: tok };
    }
    ctx.warn(`${label} ${q(t.raw)} is not a colour in the brand kit ${q(b.name)} — ${fallbackWord(ctx)}${validTokens(ctx, 'color', b)}`);
    return { value: undefined };
  }

  /** Remember literal colours that equal a brand colour, so the result can suggest linking them. */
  function noteLiteralColor(c, ctx) {
    if (brandScope !== undefined || !ctx.literals) return;
    const hex = c.slice(0, 7);
    if (c.length !== 7 || hex === '#ffffff' || hex === '#000000') return;
    const b = activeBrand();
    if (!b) return;
    const hit = listOf(b, 'colors').find((x) => normalizeColor(x.value) === c);
    if (hit) ctx.literals.set(c, tokenFor('color', hit.id));
  }
  function literalHint(ctx) {
    if (!ctx.literals || !ctx.literals.size) return null;
    const pairs = [...ctx.literals].slice(0, 6).map(([c, t]) => `${c} → ${t}`);
    return `These literal values equal the brand's but are not linked, so they won't follow brand edits: ${pairs.join(', ')}. Prefer the tokens.`;
  }

  /** A font token → {value: 'var(--font-id)' | undefined}; null when `v` is not a token. */
  function fontToken(v, ctx) {
    const t = parseVar(v);
    if (!t) return null;
    if (t.kind && t.kind !== 'font') {
      ctx.warn(`font ${q(t.raw)} is a ${t.kind} token, not a font — ${fallbackWord(ctx)}`);
      return { value: undefined };
    }
    const b = activeBrand();
    if (!b) {
      ctx.warn(`font ${q(t.raw)}: no brand kit is active, so font tokens have nothing to link to — ${fallbackWord(ctx)}. Use a family name such as "Inter"`);
      return { value: undefined };
    }
    const hit = nearestEntry(listOf(b, 'fonts'), t.id, FONT_ALIASES);
    if (hit) {
      const tok = tokenFor('font', hit.entry.id);
      if (!hit.exact || !t.kind) ctx.warn(`font ${q(t.raw)} is not a font token of ${q(b.name)} — used ${tok} (${hit.entry.family})`);
      return { value: tok };
    }
    ctx.warn(`font ${q(t.raw)} is not a font in the brand kit ${q(b.name)} — ${fallbackWord(ctx)}${validTokens(ctx, 'font', b)}`);
    return { value: undefined };
  }

  /** The brand font entry behind a font token (or null). */
  function brandFont(font) {
    const t = parseVar(font);
    if (!t || t.kind !== 'font') return null;
    return listOf(activeBrand(), 'fonts').find((f) => f.id === t.id) || null;
  }
  /** Real family name for a font value (resolves brand tokens). */
  function familyOf(font) {
    if (typeof font !== 'string' || !/^var\(/.test(font)) return font;
    const f = brandFont(font);
    if (f && f.family) return f.family;
    try {
      if (Folio.brand && Folio.brand.resolveFont) return Folio.brand.resolveFont(font);
    } catch (e) {
      /* fall through */
    }
    return font;
  }

  function radiusOf(b, id) {
    const r = b && isObj(b.style) && isObj(b.style.radius) ? b.style.radius : null;
    const v = r ? Number(r[id]) : NaN;
    return isFinite(v) ? v : RADIUS_DEFAULTS[id];
  }
  /** A radius token → {value: 'var(--radius-id)' | number | undefined}; null when `v` is not a token. */
  function radiusToken(v, ctx, label, literal) {
    const t = parseVar(v);
    if (!t) return null;
    if (t.kind && t.kind !== 'radius') {
      ctx.warn(`${label} ${q(t.raw)} is a ${t.kind} token, not a radius — ignored`);
      return { value: undefined };
    }
    const k = keyOf(t.id);
    if (/^(full|pill|round|circle|max)$/.test(k)) {
      ctx.warn(`${label} ${q(t.raw)} is not a brand radius (sm, md, lg) — used 9999 for a pill/circle`);
      return { value: 9999 };
    }
    const id = RADIUS_IDS.includes(t.id) ? t.id : own(RADIUS_ALIASES, k) ? RADIUS_ALIASES[k] : null;
    if (!id) {
      ctx.warn(`${label} ${q(t.raw)} is not a radius token — valid ones are var(--radius-sm), var(--radius-md), var(--radius-lg); ignored`);
      return { value: undefined };
    }
    const b = activeBrand();
    if (!b) {
      ctx.warn(`${label} ${q(t.raw)}: no brand kit is active — used ${RADIUS_DEFAULTS[id]}px`);
      return { value: RADIUS_DEFAULTS[id] };
    }
    if (literal) {
      ctx.warn(`${label}: per-corner radius arrays can't hold tokens — used ${radiusOf(b, id)}px from var(--radius-${id})`);
      return { value: radiusOf(b, id) };
    }
    if (id !== t.id || !t.kind) ctx.warn(`${label} ${q(t.raw)} — used var(--radius-${id})`);
    return { value: `var(--radius-${id})` };
  }

  /** 'brand-logo:<id>' → {value} | {value: undefined}; null when `v` is not a logo reference. */
  function logoSrc(v, ctx, label) {
    if (typeof v !== 'string') return null;
    const m = /^brand-logo:\s*(.*)$/i.exec(v.trim());
    if (!m) return null;
    const b = activeBrand();
    if (!b) {
      ctx.warn(`${label} ${q(v)}: no brand kit is active, so there is no logo to show — ignored`);
      return { value: undefined };
    }
    const logos = listOf(b, 'logos');
    if (!logos.length) {
      ctx.warn(`${label} ${q(v)}: the brand kit ${q(b.name)} has no logos yet (the user can upload one in the Brand panel) — ignored`);
      return { value: undefined };
    }
    if (!m[1]) {
      ctx.warn(`${label} ${q(v)} names no logo — used brand-logo:${logos[0].id} (${q(logos[0].name)})`);
      return { value: tokenFor('logo', logos[0].id) };
    }
    const hit = nearestEntry(logos, m[1], null);
    if (hit) {
      if (!hit.exact) ctx.warn(`${label} ${q(v)} is not a logo of ${q(b.name)} — used brand-logo:${hit.entry.id} (${q(hit.entry.name)})`);
      return { value: tokenFor('logo', hit.entry.id) };
    }
    ctx.warn(`${label} ${q(v)} is not a logo of ${q(b.name)} — ignored${validTokens(ctx, 'logo', b)}`);
    return { value: undefined };
  }
  function logoOf(src) {
    const m = typeof src === 'string' && /^brand-logo:(.+)$/.exec(src);
    return m ? listOf(activeBrand(), 'logos').find((l) => l.id === m[1]) || null : null;
  }

  // ---------- fonts ----------
  function normalizeFont(v, ctx) {
    const tok = fontToken(v, ctx);
    if (tok) return tok.value;
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
    if (known) {
      noteLiteralFont(known.family, ctx);
      return known.family;
    }
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

  function noteLiteralFont(family, ctx) {
    if (brandScope !== undefined || !ctx.literals) return;
    const hit = listOf(activeBrand(), 'fonts').find((f) => f.family === family);
    if (hit) ctx.literals.set(`font ${q(family)}`, tokenFor('font', hit.id));
  }

  function snapWeight(font, weight, ctx) {
    font = familyOf(font);
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
    const logo = logoSrc(v, ctx, label);
    if (logo) return logo.value;
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
    const tok = radiusToken(v, ctx, 'radius');
    if (tok) return tok.value;
    if (Array.isArray(v)) {
      const a = v.slice(0, 4).map((x, i) => {
        const t = radiusToken(x, ctx, `radius[${i}]`, true);
        return t ? t.value : num(x, ctx, `radius[${i}]`, 0, 10000);
      });
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
      // a brand font token brings the kit's weight for that role unless the model chose one
      const bf = brandFont(t.font);
      if (bf && t.weight == null && Number(bf.weight) && Number(bf.weight) !== 400) t.weight = snapWeight(t.font, Number(bf.weight), ctx);
    }
    if (type === 'image' && clean.image && logoOf(clean.image.src)) {
      // brand logos: keep their aspect ratio and show them whole
      const logo = logoOf(clean.image.src);
      const lw = Number(logo.width);
      const lh = Number(logo.height);
      if (lw > 0 && lh > 0) {
        if (clean.width != null && clean.height == null) clean.height = Math.max(1, Math.round((clean.width * lh) / lw));
        else if (clean.height != null && clean.width == null) clean.width = Math.max(1, Math.round((clean.height * lw) / lh));
        else if (clean.width == null && clean.height == null) {
          const k = Math.min(1, 240 / Math.max(lw, lh));
          clean.width = Math.max(1, Math.round(lw * k));
          clean.height = Math.max(1, Math.round(lh * k));
        }
      }
      if (!clean.image.fit) clean.image.fit = 'contain';
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
      const measure = () => {
        const el = Folio.render.el(id);
        if (!el || !el.isConnected || !el.getClientRects().length) return null;
        return [Math.round(el.offsetWidth), Math.round(el.offsetHeight)];
      };
      // layers on hidden pages have no layout; peek lays their artboard out just long enough to measure
      return measure() || (Folio.render.peek ? Folio.render.peek([id], measure) : null);
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
    const C = comps();
    // instance internals follow the main: list them only when reading the instance (or a layer in it) itself
    const collapse = !!C && !opts.expandInstances && !C.instanceRootOf(id);
    let count = 0;
    const walk = (n, d) => {
      count++;
      const parent = n.parent ? store.get(n.parent) : null;
      const parentFlex = parent && parent.layout && parent.layout.mode === 'flex';
      const o = { id: n.id, type: n.type, name: n.name };
      const mc = C && n.component && C.componentOf(n.id);
      if (mc) o.component = Object.assign({ id: mc.id, name: mc.name }, varText(mc.variant) ? { variant: mc.variant } : {});
      const ic = C && n.instance && C.get(n.instance.componentId);
      if (ic) {
        o.instance = { component: `${ic.id} ${q(ic.name)}` };
        if (varText(ic.variant)) o.instance.variant = ic.variant;
        const ov = C.overridesOf(n.id);
        if (Object.keys(ov).length) o.instance.overrides = ov;
      }
      const folded = !!ic && collapse && n.type === 'frame' && n.children && n.children.length;
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
      if (folded) {
        // layout and style come from the main; overrides already show what differs
        delete o.layout;
        delete o.style;
      }
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
        if (d >= maxDepth || count >= maxNodes || folded) o.childCount = n.children.length;
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
      createdRoots = createdRoots && createdRoots.filter(onCurrentPage); // never zoom to a hidden page
      if (createdRoots && createdRoots.length) {
        if (createdRoots.length === 1) fitTo(createdRoots[0]);
        else {
          C.zoomToFit(createdRoots);
          lastFit = null;
        }
        return;
      }
      const first = changedIds.find(onCurrentPage);
      if (!first) return;
      const root = store.rootOf(first);
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
    const C = comps();
    if (C) C.flush(); // propagate edited mains now, so results and screenshots show the instances updated
    const sel = (selectIds || changedIds).filter(onCurrentPage);
    if (sel.length) store.select(sel);
    reveal(changedIds, createdRoots);
    store.emit('ai:changed', changedIds.slice());
  }

  // ---------- pages (store page API, SPEC "Pages (v0.6)") ----------
  const pagesOn = () => {
    const s = S();
    return !!(s && typeof s.pages === 'function' && typeof s.withPage === 'function' && typeof s.switchPage === 'function');
  };
  const pageTag = (p) => `${p.id} ${q(p.name)}`;
  const isCurrent = (p) => {
    const c = S().currentPage();
    return !!(p && c && p.id === c.id);
  };
  function onCurrentPage(id) {
    const store = S();
    if (!store.get(id)) return false;
    if (!pagesOn()) return true;
    const p = store.pageOf(id);
    return !p || isCurrent(p);
  }
  /** Artboards of every page (just doc.roots without pages). */
  function allRoots() {
    const store = S();
    return pagesOn() ? [].concat(...store.pages().map((p) => p.roots)) : store.doc.roots;
  }
  function boardLine(id) {
    const n = S().get(id);
    const rs = renderedSize(id) || [Math.round(n.width), Math.round(n.height)];
    return `${n.id} ${q(n.name)} ${rs[0]}×${rs[1]}`;
  }
  /** Pages with one line per artboard; the current page only counts its artboards unless `full`. */
  function pagesOutline(full) {
    const store = S();
    return store.pages().map((p) => {
      const ids = p.roots.filter((id) => store.get(id));
      const o = { id: p.id, name: p.name };
      if (isCurrent(p)) o.current = true;
      if (o.current && !full) o.artboards = ids.length;
      else {
        o.artboards = ids.slice(0, 20).map(boardLine);
        if (ids.length > 20) o.artboards.push(`…${ids.length - 20} more`);
      }
      return o;
    });
  }
  function findPage(ref) {
    const store = S();
    const list = store.pages();
    const s = typeof ref === 'string' ? ref.trim().replace(/^["'“]|["'”]$/g, '') : '';
    const p = s && (list.find((x) => x.id === s) || list.find((x) => String(x.name).toLowerCase() === s.toLowerCase()));
    if (p) return { page: p };
    const names = list.map((x) => `${pageTag(x)}${isCurrent(x) ? ' (current)' : ''}`).join(', ');
    return { error: `${s ? `No page ${q(s)}` : 'Which page? page_id is missing'}. Pages: ${names}.` };
  }
  /** The page (found or made) for a special artboard such as "Components" or "Logo concepts". */
  function homePage(boardName, pageName) {
    const store = S();
    if (!pagesOn()) return null;
    const board = allRoots().map((id) => store.get(id)).find((n) => n && n.type === 'frame' && n.name === boardName && !n.instance && !n.component);
    return (board && store.pageOf(board.id)) || store.ensurePage(pageName);
  }
  /** Run fn with doc.roots bound to page (no view switch); returns fn's result. */
  const onPage = (page, fn) => (!page || isCurrent(page) ? fn() : S().withPage(page.id, fn));
  const pageNote = (page) =>
    isCurrent(page) ? `on page ${pageTag(page)}, the one the user is viewing` : `on page ${pageTag(page)}; the view stays on ${q(S().currentPage().name)}, so new artboards still go there`;

  // Tools that act on (or screenshot) existing layers: the view follows them to their page.
  const FOLLOW_TOOLS = new Set(['create_nodes', 'update_nodes', 'delete_nodes', 'move_nodes', 'screenshot', 'create_component', 'create_instances', 'update_instances', 'import_html']);
  function touchedIds(inp) {
    const out = [];
    const add = (v) => typeof v === 'string' && v.trim() && out.push(v);
    [inp.parent_id, inp.node_id, inp.id].forEach(add);
    [inp.ids, inp.node_ids].forEach((a) => Array.isArray(a) && a.forEach(add));
    [inp.moves, inp.items, inp.updates].forEach((a) => Array.isArray(a) && a.forEach((it) => isObj(it) && (add(it.parent_id), add(it.id))));
    return out;
  }
  /** Switch the view to the page of the first layer the call touches. Returns a note for the result, or ''. */
  function followPage(inp) {
    if (!pagesOn()) return '';
    const store = S();
    const from = store.currentPage();
    for (const ref of touchedIds(inp).slice(0, 50)) {
      const n = store.get(ref) || resolve(ref).node;
      if (!n) continue;
      const p = store.pageOf(n.id);
      if (!p || isCurrent(p)) return '';
      store.switchPage(p.id);
      return `The view switched from page ${q(from ? from.name : '')} to ${pageTag(p)}, where ${n.id} is, so the user can follow along. New artboards now go on this page; manage_pages "switch" goes back.`;
    }
    return '';
  }
  function withNote(res, note) {
    if (Array.isArray(res.content)) {
      const t = res.content.find((b) => b.type === 'text');
      if (t) t.text += ' ' + note;
      else res.content.unshift({ type: 'text', text: note });
      return res;
    }
    let o = null;
    try {
      o = JSON.parse(res.content);
    } catch (e) {
      /* plain text result */
    }
    res.content = isObj(o) ? JSON.stringify(Object.assign({ page: note }, o)) : `${note}\n${res.content}`;
    return res;
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
            return `${c.id} ${c.type} ${q(c.name)}${t}${k}${compTag(c)}`;
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
    const out = { document: doc.name || 'Untitled' };
    if (pagesOn()) out.pages = pagesOutline(false);
    Object.assign(out, { artboards, selection });
    const brief = brandBrief();
    out.brand = brief || null;
    if (!brief && brandsAvailable()) out.brandNote = 'No brand kit is active: design freely, and offer to save the look as a kit with set_brand.';
    const C = comps();
    if (C && C.list().length) {
      const names = [...C.sets().map((x) => `${q(x.name)} (${C.list().filter((c) => c.setId === x.id).length} variants)`), ...C.list().filter((c) => !c.setId).map((c) => q(c.name))];
      out.components = `${names.slice(0, 20).join(', ')}. list_components shows their ids, variants and layer paths.`;
    }
    if (!artboards.length) out.note = `${out.pages ? 'This page' : 'The canvas'} is empty. Create an artboard with create_nodes (parent_id null).`;
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
      if (parent && instanceScope(parent.id))
        return fail(`${q(parent.name)} (${parent.id}) is part of an instance, and instances follow their main component, so layers can't be added inside them. Add the layers to the main${parent.sourceId ? ' (' + parent.sourceId + ')' : ''} to change every instance, or detach this instance first (update_instances with "detach": true). Nothing was created.`, 'Cannot add inside an instance');
    }
    const pid = parent ? parent.id : null;
    let page = null; // page_id: another page for the new artboards (built there without switching the view)
    if (input.page_id != null && input.page_id !== '') {
      if (!pagesOn()) notes.push('this Folio has no pages, so page_id was ignored');
      else if (pid) notes.push('page_id only applies to new artboards (parent_id null), so it was ignored');
      else {
        const pr = findPage(input.page_id);
        if (pr.error) return fail(pr.error + ' Nothing was created.', 'Page not found');
        page = pr.page;
      }
    }
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

    const list = pid ? parent.children : page ? page.roots : store.doc.roots;
    if (index != null) {
      index = Number(index);
      if (!isFinite(index)) index = undefined;
      else index = clamp(Math.round(index), 0, list.length);
    }

    const created = {};
    const topIds = [];
    const allIds = [];
    const placed = [];
    onPage(page, () => clean.forEach((tree, i) => {
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
    }));
    info.fonts.forEach((f) => Folio.fonts && Folio.fonts.ensure && Folio.fonts.ensure(f));

    const roots = pid ? [] : topIds;
    afterMutation(allIds, topIds, roots);

    const out = { created };
    if (page && !isCurrent(page)) out.page = 'Created ' + pageNote(page);
    if (pid) out.parent = `${pid} ${q(parent.name)}`;
    else out.artboards = topIds.map((id) => {
      const n = store.get(id);
      const rs = renderedSize(id) || [n.width, n.height];
      return `${id} ${q(n.name)} at (${n.x}, ${n.y}) ${rs[0]}×${rs[1]}`;
    });
    const warnings = notes.concat(ctx.warnings());
    const hint = literalHint(ctx);
    if (hint) warnings.push(hint);
    if (warnings.length) out.warnings = warnings;
    const issues = layoutIssues(allIds);
    if (issues.length) out.layout = issues;
    const where = pid ? ` in ${q(parent.name)}` : '';
    const summary = !pid && topIds.length === 1
      ? `Created artboard ${q(store.get(topIds[0]).name)} (${allIds.length} layer${allIds.length === 1 ? '' : 's'})`
      : `Created ${allIds.length} layer${allIds.length === 1 ? '' : 's'}${where}`;
    return result(out, summary + (page && !isCurrent(page) ? ` on page ${q(page.name)}` : ''), allIds);
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
      const sc = instanceScope(node.id);
      if (sc) {
        if (sc.root && node.instance) { const k = comps().get(node.instance.componentId); keepFixedAxes(k && S().get(k.mainId), patch, ctx); }
        const part = overridablePart(node, patch, sc.root);
        if (part.dropped.length)
          ctx.warn(`${part.dropped.join(', ')} not changed: this layer is part of an instance, so only overrides apply (text content and colour, fills, border colour, image src/fit, visible${sc.root ? '; the instance root also owns name, position, size and sizing' : ''}). Use update_instances to switch variants, or edit the main${node.sourceId ? ' (' + node.sourceId + ')' : ''} to change every instance`);
        Object.keys(patch).forEach((k) => delete patch[k]);
        Object.assign(patch, part.patch);
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
    const hint = literalHint(ctx);
    if (hint) warnings.push(hint);
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
    const top0 = targets.filter((id) => !targets.some((o) => o !== id && store.isAncestor(o, id)));
    // layers inside an instance follow the main, so they are hidden instead of removed
    const hidden = top0.filter((id) => {
      const sc = instanceScope(id);
      return sc && !sc.root;
    });
    hidden.forEach((id) => store.update(id, { visible: false }));
    if (hidden.length) notes.push(`${hidden.map((id) => q(store.get(id).name)).join(', ')} ${hidden.length === 1 ? 'is' : 'are'} part of an instance, so ${hidden.length === 1 ? 'it was' : 'they were'} hidden instead of deleted (visible false is an override). Delete ${hidden.length === 1 ? 'it' : 'them'} in the main component to remove ${hidden.length === 1 ? 'it' : 'them'} from every instance`);
    const top = top0.filter((id) => !hidden.includes(id));
    const C = comps();
    if (C) {
      const counts = instanceCounts();
      C.list().forEach((c) => {
        if (counts[c.id] && top.some((id) => id === c.mainId || store.isAncestor(id, c.mainId))) notes.push(`${q(c.name)} was a main component: its ${counts[c.id]} instance${counts[c.id] === 1 ? '' : 's'} became plain layers`);
      });
    }
    const names = top.map((id) => store.get(id).name);
    let count = 0;
    top.forEach((id) => (count += 1 + store.descendants(id).length));
    if (top.length) {
      store.remove(top);
      if (lastFit && !store.get(lastFit.root)) lastFit = null;
      store.emit('ai:changed', top.slice());
    }
    if (hidden.length) afterMutation(hidden, []);
    const out = { deleted: top, layersRemoved: count };
    if (hidden.length) out.hidden = hidden;
    if (errors.length) out.errors = errors;
    if (notes.length) out.notes = notes;
    const summary = top.length === 1 ? `Deleted ${q(names[0])}` : top.length ? `Deleted ${top.length} layers` : `Hid ${hidden.length} layer${hidden.length === 1 ? '' : 's'}`;
    return result(out, top.length || hidden.length ? summary : 'Nothing deleted', top.concat(hidden), !top.length && !hidden.length);
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
      const sc = instanceScope(node.id);
      if (sc && !sc.root) return errors.push(`${q(node.name)} is part of the instance ${sc.instanceId}, whose layers follow the main component. Move it in the main${node.sourceId ? ' (' + node.sourceId + ')' : ''} instead, or detach the instance first`);
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
        if (instanceScope(parent.id)) return errors.push(`cannot move ${q(node.name)} into ${q(parent.name)}: it is part of an instance, and instances follow their main component. Add it to the main${parent.sourceId ? ' (' + parent.sourceId + ')' : ''} instead, or detach the instance first`);
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

  // requestAnimationFrame never fires in a background tab (the Claude Code bridge often runs in one),
  // so always race it against a timer.
  const nextFrame = () =>
    new Promise((res) => {
      const t = setTimeout(res, 100);
      if (typeof requestAnimationFrame === 'function')
        requestAnimationFrame(() => {
          clearTimeout(t);
          res();
        });
    });
  const timeout = (p, ms) => Promise.race([p, new Promise((res) => setTimeout(res, ms))]);

  async function waitForFonts(id) {
    const store = S();
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return;
    const want = new Set();
    [id, ...store.descendants(id)].forEach((nid) => {
      const n = store.get(nid);
      const fam = n && n.type === 'text' && n.text ? familyOf(n.text.font) : null;
      if (fam && !/^var\(/.test(fam) && !SYSTEM_FONTS.includes(fam)) {
        Folio.fonts && Folio.fonts.ensure && Folio.fonts.ensure(fam);
        want.add(`${n.text.italic ? 'italic ' : ''}${n.text.weight || 400} 16px "${fam}"`);
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

  // ---------- brand kit tools ----------
  const BRAND_KEYS = ['name', 'colors', 'fonts', 'logos', 'voice', 'style'];
  const BRAND_ALIASES = { colours: 'colors', palette: 'colors', typography: 'fonts', logo: 'logos', tone: 'voice' };
  const BRAND_MAX_INPUT = 60000; // characters of JSON
  const MAX_BRAND_COLORS = 40;
  const MAX_BRAND_FONTS = 12;
  const MAX_BRAND_LOGOS = 12;
  const MAX_GRADIENTS = 12;
  const UNAVAILABLE = 'Brand kits are not available in this build of Folio (src/brand.js is not loaded). Design with literal colours and fonts instead.';

  const brandApi = () => (Folio.brand && typeof Folio.brand.active === 'function' ? Folio.brand : null);
  const brandsAvailable = () => !!brandApi();
  function safe(fn, d) {
    try {
      const v = fn();
      return v === undefined ? d : v;
    } catch (e) {
      return d;
    }
  }
  const clip = (s, n) => {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  const clipText = (s, n) => String(s == null ? '' : s).replace(/\r/g, '').trim().slice(0, n);
  const asList = (v) =>
    Array.isArray(v)
      ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
      : typeof v === 'string' && v.trim()
      ? v.split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean)
      : [];
  const cloneJson = (v) => JSON.parse(JSON.stringify(v));
  const yes = (v) => v === true || v === 'true';

  function library() {
    const B = brandApi();
    return B && B.library ? (safe(() => B.library(), []) || []).filter(isObj) : [];
  }
  /** A kit by id (or exact name); the document's copy wins for the active kit. */
  function findBrand(id) {
    const act = activeBrand();
    const all = (act ? [act] : []).concat(library().filter((b) => !act || b.id !== act.id));
    return all.find((b) => b.id === id) || all.find((b) => keyOf(b.name) === keyOf(id)) || null;
  }
  const libLine = (lib) => (lib.length ? lib.slice(0, 20).map((b) => `${b.id} ${q(b.name)}`).join(', ') : 'empty');

  function voiceLine(v) {
    if (!isObj(v)) return '';
    const parts = [];
    const tone = asList(v.tone);
    if (tone.length) parts.push('tone ' + tone.slice(0, 5).join(', '));
    if (v.tagline) parts.push('tagline ' + q(clip(v.tagline, 80)));
    if (v.audience) parts.push('for ' + clip(v.audience, 60));
    const use = asList(v.useWords);
    if (use.length) parts.push('use: ' + use.slice(0, 8).join(', '));
    const avoid = asList(v.avoidWords);
    if (avoid.length) parts.push('avoid: ' + avoid.slice(0, 8).join(', '));
    return clip(parts.join(' · '), 320);
  }
  function styleLine(st) {
    if (!isObj(st)) st = {};
    const parts = [`button ${st.button || 'rounded'}`, `density ${st.density || 'comfortable'}`, `shadow ${st.shadow || 'soft'}`];
    const g = Array.isArray(st.gradients) ? st.gradients.filter(isObj) : [];
    if (g.length) parts.push(`gradients ${g.slice(0, 6).map((x) => q(clip(x.name || 'Gradient', 30))).join(', ')}`);
    return parts.join(' · ');
  }
  function logoLine(l) {
    const sz = Number(l.width) > 0 && Number(l.height) > 0 ? ` ${Math.round(l.width)}×${Math.round(l.height)}` : '';
    return `${tokenFor('logo', l.id)} ${q(clip(l.name, 40))}${sz}`;
  }
  function logoFormat(src) {
    if (typeof src !== 'string') return 'unknown';
    const m = /^data:image\/([a-z0-9.+-]+)/i.exec(src);
    if (m) return m[1].toLowerCase().replace('svg+xml', 'svg').replace('jpeg', 'jpg');
    return /^https?:/i.test(src) ? 'url' : 'unknown';
  }

  /** Compact one-glance summary of a kit (active kit by default); null when there is none. */
  function brandBrief(b) {
    if (b === undefined) b = activeBrand();
    if (!isObj(b)) return null;
    const o = {
      id: b.id,
      name: b.name,
      colors: listOf(b, 'colors').map((c) => `${c.id}=${c.value}`).join(' '),
      fonts: listOf(b, 'fonts').map((f) => `${f.id}=${f.family}${f.weight ? ' ' + f.weight : ''}`).join(', '),
      radius: RADIUS_IDS.map((id) => `${id} ${radiusOf(b, id)}`).join(' / '),
      logos: listOf(b, 'logos').map(logoLine),
      style: styleLine(b.style),
    };
    const v = voiceLine(b.voice);
    if (v) o.voice = v;
    return o;
  }

  /** Lines for the per-message context (contextFor). Empty string when brand kits don't exist. */
  function brandContext() {
    if (!brandsAvailable()) return '';
    const b = activeBrand();
    if (!b) {
      const lib = library();
      return `Brand kit: none active${lib.length ? ` (library: ${lib.slice(0, 8).map((x) => q(x.name)).join(', ')})` : ''}. Design freely; offer to save the look as a kit with set_brand.`;
    }
    const x = brandBrief(b);
    const lines = [
      `Active brand kit: ${q(x.name)} (${x.id}). Link to it with tokens; get_brand shows the whole kit.`,
      `- colours, var(--color-<id>): ${x.colors}`,
      `- fonts, var(--font-<id>): ${x.fonts}; radius, var(--radius-<sm|md|lg>): ${x.radius}`,
    ];
    if (x.logos.length) lines.push(`- logos, image src: ${x.logos.join(', ')}`);
    if (x.voice) lines.push(`- voice: ${x.voice}`);
    lines.push(`- style: ${x.style}`);
    return lines.join('\n');
  }

  function roleOf(id) {
    const r = Folio.brand && Folio.brand.roles;
    return (isObj(r) && typeof r[id] === 'string' && r[id]) || undefined;
  }

  function brandDetail(b, isActive) {
    const v = isObj(b.voice) ? b.voice : {};
    const st = isObj(b.style) ? b.style : {};
    const voice = {};
    ['tagline', 'description', 'audience', 'sampleCopy'].forEach((k) => v[k] && (voice[k] = clipText(v[k], 1500)));
    ['tone', 'useWords', 'avoidWords'].forEach((k) => {
      const l = asList(v[k]);
      if (l.length) voice[k] = l.slice(0, 40);
    });
    return {
      id: b.id,
      name: b.name,
      active: !!isActive,
      colors: listOf(b, 'colors').map((c) => Object.assign({ id: c.id, name: c.name, value: c.value, token: tokenFor('color', c.id) }, CORE_COLOR_IDS.includes(c.id) ? { core: true, role: roleOf(c.id) } : {})),
      fonts: listOf(b, 'fonts').map((f) => Object.assign({ id: f.id, name: f.name, family: f.family, weight: f.weight || 400, token: tokenFor('font', f.id) }, CORE_FONT_IDS.includes(f.id) ? { core: true, role: roleOf(f.id) } : {})),
      radius: { sm: radiusOf(b, 'sm'), md: radiusOf(b, 'md'), lg: radiusOf(b, 'lg'), tokens: 'var(--radius-sm) var(--radius-md) var(--radius-lg)' },
      logos: listOf(b, 'logos').map((l) => {
        const o = { id: l.id, name: l.name, src: tokenFor('logo', l.id), format: logoFormat(l.src) };
        if (Number(l.width) > 0 && Number(l.height) > 0) o.size = [Math.round(l.width), Math.round(l.height)];
        return o;
      }),
      voice,
      style: {
        button: st.button || 'rounded',
        density: st.density || 'comfortable',
        shadow: st.shadow || 'soft',
        gradients: (Array.isArray(st.gradients) ? st.gradients.filter(isObj) : []).map((g) => ({ name: g.name, fill: isObj(g.fill) ? compactFill(g.fill) : g.fill })),
      },
    };
  }

  /** How many layers use each token / logo reference in the current document. */
  function tokenUses() {
    const uses = new Map();
    const store = S();
    Object.values((store && store.doc && store.doc.nodes) || {}).forEach((n) => {
      let s = '';
      try {
        s = JSON.stringify([n.style, n.text, n.image]);
      } catch (e) {
        return;
      }
      const seen = new Set();
      const re = /var\(--((?:color|font|radius)-[A-Za-z0-9_-]+)\)|brand-logo:([A-Za-z0-9_-]+)/g;
      let m;
      while ((m = re.exec(s))) seen.add(m[1] ? `var(--${m[1]})` : `brand-logo:${m[2]}`);
      seen.forEach((t) => uses.set(t, (uses.get(t) || 0) + 1));
    });
    return uses;
  }

  function getBrand(input) {
    const B = brandApi();
    if (!B) return fail(UNAVAILABLE, 'Brand kits unavailable');
    const act = activeBrand();
    const lib = library();
    const id = input.brand_id != null ? input.brand_id : input.id;
    let b = act;
    if (id != null && String(id).trim()) {
      b = findBrand(String(id).trim());
      if (!b) return fail(`No brand kit ${q(id)} in the library (${libLine(lib)}).`, 'Brand kit not found');
    }
    const out = { active: act ? `${act.id} ${q(act.name)}` : null };
    if (b) out.brand = brandDetail(b, !!act && act.id === b.id);
    out.library = lib.map((x) => `${x.id} ${q(x.name)}${act && x.id === act.id ? ' (active)' : ''}`);
    if (!act) {
      out.note =
        'No brand kit is active for this document. Design freely; to make one, call set_brand with "create": true (it becomes the document\'s brand)' +
        (lib.length ? ', or switch to a library kit with set_brand {"brand_id": "…", "activate": true, "patch": {}}' : '') +
        '.';
      const ts = (safe(() => B.templates(), []) || []).filter(isObj);
      if (ts.length) out.templates = ts.map((t) => `${t.templateId || t.id || ''} ${q(t.name)}${t.blurb ? ' — ' + clip(t.blurb, 60) : ''}`.trim());
    } else if (b && b.id === act.id) {
      const uses = tokenUses();
      const linked = [...uses.values()].length ? [...uses.entries()].map(([t, n]) => `${t} ×${n}`) : [];
      out.inUse = linked.length ? linked.slice(0, 40) : 'no layers are linked to this kit yet';
    }
    return result(out, b ? `Read brand kit ${q(b.name)}` : 'Read brand kits', []);
  }

  function newId(prefix, taken) {
    let id = '';
    for (let i = 0; i < 50 && (!id || taken.has(id)); i++) id = prefix + Math.random().toString(36).slice(2, 6).padEnd(4, '0');
    return id;
  }
  function titleCase(s) {
    s = String(s).replace(/[-_]+/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** Starting point for a new kit: a template (by id or name) or neutral defaults. */
  function baseBrand(template, ctx) {
    const B = brandApi();
    let base = null;
    if (template != null && String(template).trim()) {
      const ts = (safe(() => B.templates(), []) || []).filter(isObj);
      base = ts.find((t) => t.id === template || t.templateId === template) || ts.find((t) => keyOf(t.name) === keyOf(template) || keyOf(t.templateId) === keyOf(template)) || null;
      if (!base) ctx.warn(`template ${q(template)} not found${ts.length ? ` (templates: ${ts.map((t) => q(t.name)).join(', ')})` : ''} — started from neutral defaults`);
    }
    if (base) base = cloneJson(base);
    else if (typeof B.normalize === 'function') base = Object.assign(cloneJson(safe(() => B.normalize({}, { keepId: false }), {}) || {}), { name: '' });
    if (!isObj(base) || !Array.isArray(base.colors)) {
      base = {
        name: '',
        colors: CORE_COLORS.map(([id, name, value]) => ({ id, name, value, core: true })),
        fonts: CORE_FONTS.map(([id, name, family, weight]) => ({ id, name, family, weight, core: true })),
        logos: [],
        voice: { tagline: '', description: '', audience: '', tone: [], useWords: '', avoidWords: '', sampleCopy: '' },
        style: { radius: Object.assign({}, RADIUS_DEFAULTS), button: 'rounded', density: 'comfortable', shadow: 'soft', gradients: [] },
      };
    }
    ['id', 'updatedAt', 'templateId', 'blurb'].forEach((k) => delete base[k]);
    base.logos = listOf(base, 'logos').filter((l) => typeof l.src === 'string' && /^https:/i.test(l.src)); // never copy embedded files from templates
    return base;
  }

  /** Make sure the core colours and fonts exist (older or hand-edited kits). */
  function ensureCore(next, ctx) {
    next.colors = listOf(next, 'colors').map((c) => Object.assign({}, c));
    next.fonts = listOf(next, 'fonts').map((f) => Object.assign({}, f));
    next.logos = listOf(next, 'logos').map((l) => Object.assign({}, l));
    CORE_COLORS.forEach(([id, name, value]) => {
      if (id === 'on-primary') return; // left out on purpose: Folio.brand picks the readable one from primary
      if (!next.colors.some((c) => c.id === id)) next.colors.push({ id, name, value, core: true });
    });
    CORE_FONTS.forEach(([id, name, family, weight]) => {
      if (!next.fonts.some((f) => f.id === id)) next.fonts.push({ id, name, family, weight, core: true });
    });
  }

  /** Brand entries as an array: accepts [{id, …}] or a map {primary: "#…", heading: {…}}. */
  function normEntries(v, ctx, label, valueKey, max) {
    let arr;
    if (Array.isArray(v)) arr = v;
    else if (isObj(v)) arr = Object.keys(v).map((k) => (isObj(v[k]) ? Object.assign({ id: k }, v[k]) : { id: k, [valueKey]: v[k] }));
    else {
      ctx.warn(`${label} must be an array like [{"id": "…", …}] — ignored`);
      return [];
    }
    if (arr.length > max) ctx.warn(`${label}: only the first ${max} entries were used`);
    return arr.slice(0, max);
  }
  function findEntry(list, it) {
    const id = it.id != null ? String(it.id).trim() : '';
    const t = parseVar(id);
    const key = t ? t.id : id.replace(/^brand-logo:/, '');
    if (key) {
      const e = list.find((x) => x.id === key) || list.find((x) => keyOf(x.name) === keyOf(key));
      if (e) return e;
    }
    if (!key && it.name != null) return list.find((x) => keyOf(x.name) === keyOf(it.name)) || null;
    return null;
  }
  const wantsDelete = (it) => yes(it.delete) || yes(it.remove) || yes(it.deleted);

  /** A brand colour value must be a literal; a token is resolved against the kit being edited. */
  function brandColorValue(v, kit, ctx, label) {
    const t = parseVar(v);
    if (t) {
      const hit = nearestEntry(listOf(kit, 'colors'), t.id, COLOR_ALIASES);
      const lit = hit && normalizeColor(hit.entry.value);
      if (lit) {
        ctx.warn(`${label}: brand colours hold literal values — copied ${lit} from ${tokenFor('color', hit.entry.id)}`);
        return lit;
      }
      ctx.warn(`${label} ${q(v)} is a token that does not resolve — ignored`);
      return null;
    }
    const c = normalizeColor(v);
    if (!c) ctx.warn(`${label} ${str(v)} is not a valid colour — ignored`);
    return c;
  }

  function applyColors(next, raw, ctx, out) {
    const list = next.colors;
    normEntries(raw, ctx, 'colors', 'value', 64).forEach((it, i) => {
      const label = `colors[${i}]`;
      if (!isObj(it)) return ctx.warn(`${label} must be {id?, name?, value?, delete?} — ignored`);
      const id = it.id != null ? String(it.id).trim() : '';
      const name = it.name != null ? clip(it.name, 40) : '';
      const entry = findEntry(list, it);
      if (wantsDelete(it)) {
        if (!entry) return ctx.warn(`${label}: no colour ${q(id || name)} to delete`);
        if (CORE_COLOR_IDS.includes(entry.id)) return ctx.warn(`${label}: ${entry.id} is a core brand colour and cannot be deleted (change its value instead) — kept`);
        list.splice(list.indexOf(entry), 1);
        out.detach.push(tokenFor('color', entry.id));
        out.changes.push(`removed colour ${entry.id} ${q(entry.name)}`);
        out.changed.add('colors');
        return;
      }
      const rawVal = it.value != null ? it.value : it.color != null ? it.color : it.hex;
      let value = null;
      if (rawVal != null) {
        value = brandColorValue(rawVal, next, ctx, `${label}.value`);
        if (!value) return;
      }
      if (entry) {
        if (value && value !== entry.value) {
          out.changes.push(`${entry.id} ${entry.value} → ${value}`);
          out.tokens.add(tokenFor('color', entry.id));
          entry.value = value;
          out.changed.add('colors');
        }
        if (name && name !== entry.name) {
          out.changes.push(`${entry.id} renamed ${q(entry.name)} → ${q(name)}`);
          entry.name = name;
          out.changed.add('colors');
        }
        return;
      }
      if (!value) return ctx.warn(`${label}: there is no colour ${q(id || name)}; a new colour needs a value — ignored`);
      if (list.length >= MAX_BRAND_COLORS) return ctx.warn(`${label}: a kit holds at most ${MAX_BRAND_COLORS} colours — ignored`);
      const nid = newId('c_', new Set(list.map((c) => c.id)));
      const nm = name || (id ? clip(titleCase(parseVar(id) ? parseVar(id).id : id), 40) : `Colour ${list.length + 1}`);
      if (id) ctx.warn(`${label}: no colour has the id ${q(id)}, so it was added as the custom colour ${nid} (custom ids are generated)`);
      list.push({ id: nid, name: nm, value });
      out.changes.push(`added colour ${nid} ${q(nm)} ${value} → ${tokenFor('color', nid)}`);
      out.changed.add('colors');
    });
  }

  function brandWeight(family, w, ctx, label) {
    if (typeof w === 'string' && own(WEIGHTS, w.trim().toLowerCase().replace(/[\s_-]/g, ''))) w = WEIGHTS[w.trim().toLowerCase().replace(/[\s_-]/g, '')];
    const n = num(w, ctx, label, 100, 900, { int: true });
    return n == null ? null : snapWeight(family, Math.round(n / 100) * 100 || 400, ctx);
  }

  function applyFonts(next, raw, ctx, out) {
    const list = next.fonts;
    normEntries(raw, ctx, 'fonts', 'family', 24).forEach((it, i) => {
      const label = `fonts[${i}]`;
      if (typeof it === 'string') it = { family: it };
      if (!isObj(it)) return ctx.warn(`${label} must be {id?, name?, family?, weight?, delete?} — ignored`);
      const id = it.id != null ? String(it.id).trim() : '';
      const name = it.name != null ? clip(it.name, 40) : '';
      const entry = findEntry(list, it);
      if (wantsDelete(it)) {
        if (!entry) return ctx.warn(`${label}: no font ${q(id || name)} to delete`);
        if (CORE_FONT_IDS.includes(entry.id)) return ctx.warn(`${label}: ${entry.id} is a core brand font and cannot be deleted (change its family instead) — kept`);
        list.splice(list.indexOf(entry), 1);
        out.detach.push(tokenFor('font', entry.id));
        out.changes.push(`removed font ${entry.id} ${q(entry.name)}`);
        out.changed.add('fonts');
        return;
      }
      const famRaw = it.family != null ? it.family : it.font != null ? it.font : it.value;
      let family = null;
      if (famRaw != null) {
        const t = parseVar(famRaw);
        if (t) {
          const hit = nearestEntry(list, t.id, FONT_ALIASES);
          family = hit ? hit.entry.family : null;
          ctx.warn(`${label}.family: brand fonts hold family names${family ? ` — copied ${q(family)}` : ` — ${q(famRaw)} does not resolve; ignored`}`);
        } else {
          const save = ctx.at;
          ctx.at = label;
          family = normalizeFont(famRaw, ctx) || null;
          ctx.at = save;
        }
        if (!family) return;
      }
      const fam = family || (entry && entry.family) || 'Inter';
      const weight = it.weight != null ? brandWeight(fam, it.weight, ctx, `${label}.weight`) : entry && family ? snapWeight(fam, Number(entry.weight) || 400, ctx) : null;
      if (entry) {
        if (family && family !== entry.family) {
          out.changes.push(`${entry.id} ${entry.family} → ${family}`);
          out.tokens.add(tokenFor('font', entry.id));
          entry.family = family;
          out.changed.add('fonts');
        }
        if (weight && weight !== entry.weight) {
          out.changes.push(`${entry.id} weight ${entry.weight || 400} → ${weight}`);
          entry.weight = weight;
          out.changed.add('fonts');
        }
        if (name && name !== entry.name) {
          out.changes.push(`${entry.id} renamed ${q(entry.name)} → ${q(name)}`);
          entry.name = name;
          out.changed.add('fonts');
        }
        return;
      }
      if (!family) return ctx.warn(`${label}: there is no font ${q(id || name)}; a new font needs a family — ignored`);
      if (list.length >= MAX_BRAND_FONTS) return ctx.warn(`${label}: a kit holds at most ${MAX_BRAND_FONTS} fonts — ignored`);
      const nid = newId('f_', new Set(list.map((f) => f.id)));
      const nm = name || (id ? clip(titleCase(id), 40) : family);
      if (id) ctx.warn(`${label}: no font has the id ${q(id)}, so it was added as the custom font ${nid}`);
      list.push({ id: nid, name: nm, family, weight: weight || 400 });
      out.changes.push(`added font ${nid} ${q(nm)} ${family} → ${tokenFor('font', nid)}`);
      out.changed.add('fonts');
    });
  }

  function measureImage(src, ms) {
    return new Promise((res) => {
      if (typeof Image === 'undefined') return res({ width: 0, height: 0 });
      const img = new Image();
      const t = setTimeout(() => res(null), ms);
      img.onload = () => {
        clearTimeout(t);
        res({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
      };
      img.onerror = () => {
        clearTimeout(t);
        res(null);
      };
      img.src = src;
    });
  }

  async function applyLogos(next, raw, ctx, out) {
    const list = next.logos;
    let items = Array.isArray(raw) ? raw : isObj(raw) ? [raw] : null;
    if (!items) return ctx.warn('logos must be an array like [{"name": "Logo", "src": "https://…"}] — ignored');
    if (items.length > MAX_BRAND_LOGOS) ctx.warn(`logos: only the first ${MAX_BRAND_LOGOS} entries were used`);
    items = items.slice(0, MAX_BRAND_LOGOS);
    for (let i = 0; i < items.length; i++) {
      const label = `logos[${i}]`;
      let it = items[i];
      if (typeof it === 'string') it = { src: it };
      if (!isObj(it)) {
        ctx.warn(`${label} must be {id?, name?, src?, delete?} — ignored`);
        continue;
      }
      const entry = it.id != null || it.src == null ? findEntry(list, it) : null;
      const name = it.name != null ? clip(it.name, 60) : '';
      if (wantsDelete(it)) {
        if (!entry) ctx.warn(`${label}: no logo ${q(it.id || name)} to delete`);
        else {
          list.splice(list.indexOf(entry), 1);
          out.detach.push(tokenFor('logo', entry.id));
          out.changes.push(`removed logo ${entry.id} ${q(entry.name)}`);
          out.changed.add('logos');
        }
        continue;
      }
      let src = null;
      let dims = null;
      if (it.src != null || it.url != null) {
        const s = String(it.src != null ? it.src : it.url).trim();
        if (/^data:/i.test(s) || /^blob:/i.test(s)) {
          ctx.warn(`${label}: data: and blob: URLs are refused by set_brand. Save an SVG logo you drew with save_logo (svg or node_id); for the user's own file, ask them to upload it in the Brand panel, or give an https:// URL`);
          continue;
        }
        let ok = /^https:\/\//i.test(s) && s.length <= 2048;
        try {
          ok = ok && new URL(s).protocol === 'https:';
        } catch (e) {
          ok = false;
        }
        if (!ok) {
          ctx.warn(`${label}.src ${str(s)} must be an https:// image URL — ignored`);
          continue;
        }
        dims = await measureImage(s, 6000);
        if (!dims) {
          ctx.warn(`${label}: the image at ${str(s)} could not be loaded — check the URL (or ask the user to upload the file in the Brand panel)`);
          continue;
        }
        src = s;
      }
      if (entry) {
        if (src && src !== entry.src) {
          entry.src = src;
          if (dims.width && dims.height) Object.assign(entry, { width: dims.width, height: dims.height });
          out.changes.push(`logo ${entry.id} now shows ${clip(src, 60)}`);
          out.changed.add('logos');
        }
        if (name && name !== entry.name) {
          out.changes.push(`logo ${entry.id} renamed ${q(entry.name)} → ${q(name)}`);
          entry.name = name;
          out.changed.add('logos');
        }
        continue;
      }
      if (!src) {
        ctx.warn(`${label}: there is no logo ${q(it.id || name)}; a new logo needs an https:// src — ignored`);
        continue;
      }
      if (list.length >= MAX_BRAND_LOGOS) {
        ctx.warn(`${label}: a kit holds at most ${MAX_BRAND_LOGOS} logos — ignored`);
        continue;
      }
      const nid = newId('l_', new Set(list.map((l) => l.id)));
      const logo = { id: nid, name: name || `Logo ${list.length + 1}`, src };
      if (dims.width && dims.height) Object.assign(logo, { width: dims.width, height: dims.height });
      list.push(logo);
      out.changes.push(`added logo ${nid} ${q(logo.name)} → image src "brand-logo:${nid}"`);
      out.changed.add('logos');
    }
  }

  const VOICE_TEXT = { tagline: 200, description: 1200, audience: 300, sampleCopy: 2000 };
  const VOICE_LISTS = { tone: [8, 30], useWords: [40, 40], avoidWords: [40, 40] };
  const VOICE_ALIASES = { slogan: 'tagline', about: 'description', summary: 'description', audiences: 'audience', sample: 'sampleCopy', example: 'sampleCopy', tones: 'tone', personality: 'tone', words: 'useWords', use: 'useWords', wordsToUse: 'useWords', avoid: 'avoidWords', banned: 'avoidWords', wordsToAvoid: 'avoidWords', dontSay: 'avoidWords' };
  function applyVoice(next, raw, ctx, out) {
    if (typeof raw === 'string') raw = { description: raw };
    if (!isObj(raw)) return ctx.warn('voice must be {tagline, description, audience, tone, useWords, avoidWords, sampleCopy} — ignored');
    const v = isObj(next.voice) ? Object.assign({}, next.voice) : {};
    const touched = [];
    Object.keys(raw).forEach((k0) => {
      const k = own(VOICE_ALIASES, k0) ? VOICE_ALIASES[k0] : k0;
      const val = raw[k0];
      if (own(VOICE_TEXT, k)) {
        if (val != null && typeof val === 'object') return ctx.warn(`voice.${k0} must be text — ignored`);
        const s = clipText(val == null ? '' : val, VOICE_TEXT[k]);
        if (String(val == null ? '' : val).trim().length > VOICE_TEXT[k]) ctx.warn(`voice.${k0} was cut to ${VOICE_TEXT[k]} characters`);
        if (s !== (v[k] || '')) {
          v[k] = s;
          touched.push(k);
        }
      } else if (own(VOICE_LISTS, k)) {
        const [max, len] = VOICE_LISTS[k];
        const all = asList(val);
        if (all.length > max) ctx.warn(`voice.${k0}: only the first ${max} entries were kept`);
        const l = [...new Set(all.map((x) => clip(x, len)))].slice(0, max);
        const asString = k !== 'tone'; // Folio stores tone as a list, words to use/avoid as comma-separated text
        const nv = asString ? l.join(', ') : l;
        if (JSON.stringify(nv) !== JSON.stringify(v[k] == null ? (asString ? '' : []) : v[k])) {
          v[k] = nv;
          touched.push(k);
        }
      } else ctx.warn(`voice.${k0} is not a voice field (${Object.keys(VOICE_TEXT).concat(Object.keys(VOICE_LISTS)).join(', ')}) — ignored`);
    });
    if (touched.length) {
      next.voice = v;
      out.changed.add('voice');
      out.changes.push(`voice: ${touched.join(', ')}`);
    }
  }

  const GRADIENT_TYPES = ['linear', 'radial', 'conic', 'mesh'];
  function applyStyle(next, raw, ctx, out) {
    if (!isObj(raw)) return ctx.warn('style must be {radius, button, density, shadow, gradients} — ignored');
    const st = isObj(next.style) ? cloneJson(next.style) : {};
    const touched = [];
    const alias = { radii: 'radius', corners: 'radius', buttons: 'button', buttonShape: 'button', buttonStyle: 'button', spacing: 'density', shadows: 'shadow', shadowStrength: 'shadow', gradient: 'gradients', presets: 'gradients' };
    Object.keys(raw).forEach((k0) => {
      const k = own(alias, k0) ? alias[k0] : k0;
      const val = raw[k0];
      switch (k) {
        case 'radius': {
          const r = Object.assign({}, RADIUS_DEFAULTS, isObj(st.radius) ? st.radius : {});
          let src = val;
          if (typeof val === 'number' || (typeof val === 'string' && isFinite(parseFloat(val)))) {
            const md = num(val, ctx, 'style.radius', 0, 200);
            if (md == null) break;
            src = { sm: Math.round(md / 2), md, lg: Math.min(200, md * 2) };
            ctx.warn(`style.radius should be {sm, md, lg} — used sm ${src.sm}, md ${src.md}, lg ${src.lg}`);
          }
          if (!isObj(src)) {
            ctx.warn('style.radius must be {sm, md, lg} in px — ignored');
            break;
          }
          let did = false;
          Object.keys(src).forEach((rk) => {
            const id = RADIUS_IDS.includes(rk) ? rk : RADIUS_ALIASES[keyOf(rk)];
            if (!id) return ctx.warn(`style.radius.${rk} is not sm, md or lg — ignored`);
            const n = num(src[rk], ctx, `style.radius.${rk}`, 0, 200);
            if (n != null && n !== r[id]) {
              r[id] = n;
              did = true;
              out.tokens.add(`var(--radius-${id})`);
            }
          });
          if (did) {
            if (!(r.sm <= r.md && r.md <= r.lg)) ctx.warn(`style.radius is usually sm ≤ md ≤ lg (now ${r.sm} / ${r.md} / ${r.lg})`);
            st.radius = r;
            touched.push(`radius ${r.sm}/${r.md}/${r.lg}`);
          }
          break;
        }
        case 'button':
        case 'density':
        case 'shadow': {
          const opts = { button: ['pill', 'rounded', 'square'], density: ['compact', 'comfortable', 'airy'], shadow: ['none', 'soft', 'bold'] }[k];
          const al = {
            button: { round: 'rounded', capsule: 'pill', full: 'pill', sharp: 'square', none: 'square', squared: 'square' },
            density: { tight: 'compact', dense: 'compact', normal: 'comfortable', regular: 'comfortable', default: 'comfortable', medium: 'comfortable', spacious: 'airy', loose: 'airy', open: 'airy' },
            shadow: { flat: 'none', off: 'none', subtle: 'soft', light: 'soft', strong: 'bold', hard: 'bold', heavy: 'bold' },
          }[k];
          const v = oneOf(val, opts, al, ctx, `style.${k0}`);
          if (v && v !== st[k]) {
            st[k] = v;
            touched.push(`${k} ${v}`);
          }
          break;
        }
        case 'gradients': {
          let arr = Array.isArray(val) ? val : isObj(val) ? [val] : null;
          if (!arr) {
            ctx.warn('style.gradients must be an array of {name, fill} — ignored');
            break;
          }
          if (arr.length > MAX_GRADIENTS) ctx.warn(`style.gradients: only the first ${MAX_GRADIENTS} were kept`);
          arr = arr.slice(0, MAX_GRADIENTS);
          const list = [];
          brandScope = next; // gradients may link to the kit's own colour tokens
          try {
            arr.forEach((g, i) => {
              const label = `style.gradients[${i}]`;
              if (!isObj(g)) return ctx.warn(`${label} must be {name, fill} — dropped`);
              const rawFill = isObj(g.fill) ? g.fill : g.type || g.stops || g.points ? g : null;
              if (!rawFill) return ctx.warn(`${label} needs a fill such as {"type": "linear", "angle": 135, "stops": […]} — dropped`);
              const f = sanitizeFill(rawFill, ctx, `${label}.fill`);
              if (!f) return;
              if (!GRADIENT_TYPES.includes(f.type)) return ctx.warn(`${label}: a gradient preset must be ${GRADIENT_TYPES.join(' | ')} (not ${f.type}) — dropped`);
              delete f.visible;
              list.push({ name: clip(g.name || `Gradient ${list.length + 1}`, 40), fill: f });
            });
          } finally {
            brandScope = undefined;
          }
          if (arr.length && !list.length) {
            ctx.warn('style.gradients: none of the gradients were valid — kept the previous presets');
            break;
          }
          if (JSON.stringify(list) !== JSON.stringify(st.gradients || [])) {
            st.gradients = list;
            touched.push(`gradients (${list.length})`);
          }
          break;
        }
        default:
          ctx.warn(`style.${k0} is not a brand style field (radius, button, density, shadow, gradients) — ignored`);
      }
    });
    if (touched.length) {
      next.style = st;
      out.changed.add('style');
      out.changes.push(`style: ${touched.join(', ')}`);
    }
  }

  async function setBrand(input) {
    const B = brandApi();
    if (!B || typeof B.update !== 'function' || typeof B.create !== 'function') return fail(UNAVAILABLE, 'Brand kits unavailable');
    let size = 0;
    try {
      size = JSON.stringify(input).length;
    } catch (e) {
      return fail('set_brand input could not be read as JSON.', 'Bad brand input');
    }
    if (size > BRAND_MAX_INPUT) return fail(`set_brand input is too large (${Math.round(size / 1024)} KB; the limit is ${Math.round(BRAND_MAX_INPUT / 1024)} KB). Send only the fields that change. Nothing was changed.`, 'Brand patch too large');
    const ctx = makeCtx('update');
    ctx.literals = null;
    let patch = input.patch;
    if (patch == null) {
      patch = {};
      Object.keys(input).forEach((k) => (BRAND_KEYS.includes(k) || own(BRAND_ALIASES, k)) && (patch[k] = input[k]));
    }
    if (!isObj(patch)) return fail('set_brand needs "patch": {name?, colors?, fonts?, logos?, voice?, style?}.', 'Bad brand input');
    const p = {};
    Object.keys(patch).forEach((k) => {
      const key = own(BRAND_ALIASES, k) ? BRAND_ALIASES[k] : k;
      if (BRAND_KEYS.includes(key)) p[key] = patch[k];
      else ctx.warn(`patch.${k} is not a brand field (${BRAND_KEYS.join(', ')}) — ignored`);
    });

    const create = yes(input.create);
    const act = activeBrand();
    const wantId = input.brand_id != null && String(input.brand_id).trim() ? String(input.brand_id).trim() : null;
    let target = null;
    if (!create) {
      target = wantId ? findBrand(wantId) : act;
      if (!target)
        return fail(
          wantId
            ? `No brand kit ${q(wantId)} in the library (${libLine(library())}). Pass "create": true to make a new kit.`
            : 'No brand kit is active for this document. Pass "create": true (with a patch) to make a new kit, which becomes the document\'s brand, or brand_id to edit a kit from the library.',
          'No brand kit'
        );
    } else if (wantId) ctx.warn('brand_id is ignored when "create" is true');
    const wasActive = !create && !!act && target.id === act.id;
    const next = create ? baseBrand(input.template, ctx) : cloneJson(target);
    ensureCore(next, ctx);
    const out = { changes: [], detach: [], changed: new Set(), tokens: new Set() };

    if (own(p, 'name')) {
      const nm = clip(typeof p.name === 'string' ? p.name : '', 60);
      if (!nm) ctx.warn('name must be non-empty text — ignored');
      else if (nm !== next.name) {
        out.changes.push(`name ${q(next.name || '')} → ${q(nm)}`);
        next.name = nm;
        out.changed.add('name');
      }
    }
    if (own(p, 'colors')) applyColors(next, p.colors, ctx, out);
    if (own(p, 'fonts')) applyFonts(next, p.fonts, ctx, out);
    if (own(p, 'logos')) await applyLogos(next, p.logos, ctx, out);
    if (own(p, 'voice')) applyVoice(next, p.voice, ctx, out);
    if (own(p, 'style')) applyStyle(next, p.style, ctx, out);

    const activate = create ? input.activate !== false && input.activate !== 'false' : yes(input.activate);
    if (!create && !out.changed.size && !(activate && !wasActive)) {
      const w = ctx.warnings();
      return fail(`Nothing changed in ${q(target.name)}.${w.length ? ' ' + w.join(' ') : ''}`, 'Brand unchanged');
    }
    if (create && !own(p, 'colors') && !input.template) ctx.warn('no colours were given, so the kit uses neutral placeholder colours — set at least primary, secondary and accent');

    let id;
    try {
      if (create) {
        if (!next.name) next.name = 'New brand';
        const made = B.create(next);
        id = (made && made.id) || (typeof made === 'string' ? made : null);
        if (!id) return fail('Folio could not create the brand kit.', 'Brand kit not created');
        if (activate && !(activeBrand() && activeBrand().id === id)) B.setActive(id);
      } else {
        id = target.id;
        if (wasActive && B.detach) out.detach.forEach((tok) => safe(() => B.detach(tok)));
        if (out.changed.size) {
          const up = {};
          out.changed.forEach((k) => (up[k] = next[k]));
          B.update(id, up);
        }
        if (activate && !wasActive) B.setActive(id);
      }
    } catch (e) {
      return fail(`Folio could not save the brand kit: ${(e && e.message) || e}. Call get_brand to see its current state.`, 'Brand kit not saved');
    }

    const now = activeBrand();
    const isActive = !!now && now.id === id;
    const fb = findBrand(id) || next;
    const res = { brand: `${id} ${q(fb.name)}`, active: isActive };
    if (create) res.created = true;
    // a new kit's summary already lists every value; only the generated ids are news
    const changes = create ? out.changes.filter((c) => /^added /.test(c)) : out.changes;
    if (changes.length) res.changes = changes.slice(0, 40);
    res.kit = brandBrief(fb);
    if (isActive) {
      const uses = tokenUses();
      if (wasActive && out.tokens.size) {
        const linked = [...out.tokens].reduce((a, t) => a + (uses.get(t) || 0), 0);
        res.linkedLayers = linked ? `${linked} layer link${linked === 1 ? '' : 's'} to the changed tokens updated automatically` : 'no layers use the changed tokens yet';
      }
      if (!wasActive) {
        const missing = [...uses.keys()].filter((t) => {
          const m = /^var\(--(color|font)-(.+)\)$/.exec(t) || /^brand-logo:(.+)$/.exec(t);
          if (!m) return false;
          if (m.length === 2) return !listOf(fb, 'logos').some((l) => l.id === m[1]);
          return !listOf(fb, m[1] === 'color' ? 'colors' : 'fonts').some((x) => x.id === m[2]);
        });
        res.note = `${q(fb.name)} is now the document's brand kit; layers linked to tokens re-skin automatically. Use its tokens in new layers.`;
        if (missing.length) ctx.warn(`these tokens used in the document are not defined in ${q(fb.name)}, so those layers lose that style: ${missing.slice(0, 12).join(', ')}`);
      }
    } else if (!create) res.note = `${q(fb.name)} is saved in the library but is not the document's brand (pass "activate": true to switch to it).`;
    const w = ctx.warnings();
    if (w.length) res.warnings = w;
    const summary = create
      ? `Created brand kit ${q(fb.name)}${isActive ? '' : ' (not active)'}`
      : `${out.changed.size ? 'Updated' : 'Switched to'} brand kit ${q(fb.name)}${activate && !wasActive && out.changed.size ? ' and made it active' : ''}`;
    return result(res, summary, []);
  }

  // ---------- components (Folio.components, src/components.js) ----------
  const comps = () => (Folio.components && typeof Folio.components.list === 'function' ? Folio.components : null);
  const NO_COMPONENTS = 'Components are not available in this build of Folio (src/components.js is not loaded). Build repeated parts with create_nodes instead.';
  const errText = (e) => String((e && e.message) || e);
  const varText = (v) => (isObj(v) && Object.keys(v).length ? Object.keys(v).map((k) => `${k}=${v[k]}`).join(', ') : '');
  const compLabel = (c) => `${c.id} ${q(c.name)}${varText(c.variant) ? ' ' + varText(c.variant) : ''}`;

  /** Instance scope of a layer: null when it is not part of an instance; root = it is a direct instance root. */
  function instanceScope(id) {
    const C = comps();
    const ir = C && C.instanceRootOf(id);
    if (!ir) return null;
    return { root: C.isDirectInstance(id), instanceId: ir };
  }

  /** Short tag for get_document lists. */
  function compTag(n) {
    const C = comps();
    if (!C) return '';
    const c = n.component && C.componentOf(n.id);
    if (c) return ` [main component ${q(c.name)}${varText(c.variant) ? ' ' + varText(c.variant) : ''}]`;
    const ic = n.instance && C.get(n.instance.componentId);
    if (ic) return ` [instance of ${q(ic.name)}${varText(ic.variant) ? ' ' + varText(ic.variant) : ''}]`;
    return '';
  }

  /** { 'name/path': node } for a subtree, '' = root; first name wins (same rule as components.js). */
  function layerPaths(rootId) {
    const store = S();
    const out = {};
    const walk = (id, p) => {
      const n = store.get(id);
      if (!n) return;
      if (!own(out, p)) out[p] = n;
      n.children.forEach((c) => walk(c, p ? p + '/' + (store.get(c) || {}).name : (store.get(c) || {}).name));
    };
    walk(rootId, '');
    return out;
  }

  /** A sanitized patch → [field, value] pairs in components.js field names (text.content, style.border.color, …). */
  function patchFields(patch) {
    const out = [];
    Object.keys(patch).forEach((k) => {
      const v = patch[k];
      if (['style', 'text', 'image'].includes(k) && isObj(v))
        Object.keys(v).forEach((k2) => {
          if (k === 'style' && k2 === 'border' && isObj(v[k2])) Object.keys(v[k2]).forEach((k3) => out.push([`style.border.${k3}`, v[k2][k3]]));
          else out.push([`${k}.${k2}`, v[k2]]);
        });
      else out.push([k, v]);
    });
    return out;
  }
  function fieldsToPatch(fields) {
    const p = {};
    fields.forEach(([f, v]) => {
      const parts = f.split('.');
      let o = p;
      parts.slice(0, -1).forEach((k) => (o = o[k] = isObj(o[k]) ? o[k] : {}));
      o[parts[parts.length - 1]] = v;
    });
    return p;
  }
  const valueAt = (n, f) => f.split('.').reduce((o, k) => (o == null ? undefined : o[k]), n);
  const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /** Keep only what an instance layer may change. Returns { patch, dropped: [fields that would really change] }. */
  function overridablePart(node, patch, isRoot) {
    const C = comps();
    const kept = [];
    const dropped = [];
    patchFields(patch).forEach(([f, v]) => {
      if (C.isOverridable(f, isRoot)) kept.push([f, v]);
      else if (!sameJson(valueAt(node, f), v)) dropped.push(f);
    });
    return { patch: fieldsToPatch(kept), dropped };
  }

  /** Overrides from the model ({ path: partial node }) → sanitized overrides for components.js, with warnings. */
  function cleanOverrides(raw, rootId, ctx) {
    if (raw == null) return undefined;
    if (!isObj(raw)) {
      ctx.warn('overrides must be an object keyed by layer path, e.g. {"Label": {"text": {"content": "Book a table"}}} — ignored');
      return undefined;
    }
    const paths = layerPaths(rootId);
    const out = {};
    Object.keys(raw).forEach((key) => {
      const path = key === '/' || key === '.' ? '' : String(key).replace(/^\/+|\/+$/g, '');
      const n = paths[path];
      if (!n) {
        const list = Object.keys(paths).filter(Boolean);
        return ctx.warn(`no layer ${q(key)} in this component — ignored. Layer paths: ${list.slice(0, 30).join(', ') || '(none)'}`);
      }
      if (!isObj(raw[key])) return ctx.warn(`override for ${q(key)} must be a partial layer like {"text": {"content": "…"}} — ignored`);
      const prevAt = ctx.at;
      ctx.at = (prevAt ? prevAt + ' ' : '') + (path || '(root)');
      // accept the dotted form tool results show ({"text.content": "…"}) as well as nested objects
      const nested = {};
      Object.keys(raw[key]).forEach((k) => {
        const v = raw[key][k];
        const dotted = k.includes('.') ? fieldsToPatch([[k, v]]) : { [k]: v };
        Object.keys(dotted).forEach((t) => (nested[t] = isObj(nested[t]) && isObj(dotted[t]) ? Object.assign({}, nested[t], dotted[t]) : dotted[t]));
      });
      const patch = sanitizeProps(nested, n.type, ctx, n);
      const part = overridablePart(n, patch, path === '');
      if (part.dropped.length) ctx.warn(`${part.dropped.join(', ')} can't be overridden (only text content/colour, fills, border colour, image src/fit and visible${path === '' ? ', plus the root\'s name, position, size and sizing' : ''}) — edit the main component or add a variant instead`);
      ctx.at = prevAt;
      if (Object.keys(part.patch).length) out[path] = part.patch;
    });
    return Object.keys(out).length ? out : undefined;
  }

  function instanceCounts() {
    const m = {};
    Object.values(S().doc.nodes).forEach((n) => n.instance && (m[n.instance.componentId] = (m[n.instance.componentId] || 0) + 1));
    return m;
  }

  /** Compact outline of a main: one string per layer, by name path (the paths overrides use). */
  function mainOutline(mainId) {
    const C = comps();
    const paths = layerPaths(mainId);
    const lines = [];
    Object.keys(paths).forEach((p) => {
      if (!p) return;
      const n = paths[p];
      if (lines.length >= 30) return;
      let s = `${p}: ${n.type}`;
      if (n.type === 'text') s += ` ${q(String((n.text && n.text.content) || '').replace(/\s+/g, ' ').slice(0, 40))}`;
      if (n.visible === false) s += ' (hidden)';
      const ic = n.instance && C.get(n.instance.componentId);
      if (ic) s += ` (instance of ${q(ic.name)}${varText(ic.variant) ? ' ' + varText(ic.variant) : ''})`;
      lines.push(s);
    });
    const total = Object.keys(paths).length - 1;
    if (total > lines.length) lines.push(`…${total - lines.length} more (get_tree ${mainId})`);
    return lines;
  }

  function componentsOutline(onlyIds) {
    const C = comps();
    const counts = instanceCounts();
    const pick = (c) => !onlyIds || onlyIds.includes(c.id);
    const sizeOfMain = (id) => renderedSize(id) || [Math.round((S().get(id) || {}).width || 0), Math.round((S().get(id) || {}).height || 0)];
    const sets = C.sets()
      .map((set) => {
        const members = C.list().filter((c) => c.setId === set.id);
        if (!members.some(pick) || !members.length) return null;
        const ordered = C.variantsOf(members[0].id);
        const first = mainOutline(ordered[0].mainId);
        return {
          id: set.id,
          name: set.name,
          frame: set.frameId,
          props: set.props,
          layers: first,
          variants: ordered.map((c) => {
            const v = { component: c.id, main: c.mainId, variant: c.variant, size: sizeOfMain(c.mainId) };
            const lines = mainOutline(c.mainId);
            if (!sameJson(lines, first)) v.layers = lines;
            if (counts[c.id]) v.instances = counts[c.id];
            return v;
          }),
        };
      })
      .filter(Boolean);
    const singles = C.list()
      .filter((c) => !(c.setId && C.getSet(c.setId)) && pick(c))
      .map((c) => {
        const o = { id: c.id, name: c.name, main: c.mainId, size: sizeOfMain(c.mainId), layers: mainOutline(c.mainId) };
        if (c.description) o.description = clip(c.description, 200);
        if (counts[c.id]) o.instances = counts[c.id];
        return o;
      });
    return { sets, components: singles };
  }

  function listComponents() {
    const C = comps();
    if (!C) return fail(NO_COMPONENTS, 'Components unavailable');
    C.flush();
    const out = componentsOutline();
    const n = C.list().length;
    if (!n) out.note = 'No components yet. Call add_starter_kit for ready-made Button, Badge, Card, Input, Nav bar and Avatar sets, or turn layers into one with create_component.';
    else out.note = 'Place them with create_instances (component = id or name, variant = {"Prop": "Value"}). Overrides are keyed by the layer paths above. Edit a main (update_nodes on its ids) to change every instance.';
    return result(out, `Read ${n} component${n === 1 ? '' : 's'}`, []);
  }

  /** component reference (id, main id, set id/frame or name) + optional variant → a component, or { error }. */
  function resolveComponent(ref, variant) {
    const C = comps();
    const store = S();
    const s = typeof ref === 'string' ? ref.trim().replace(/^["'“]|["'”]$/g, '') : '';
    if (!s) return { error: 'component is missing: give a component id (k_…), a main id or a component name' };
    let comp = C.get(s) || (store.get(s) && C.componentOf(s)) || null;
    let set = !comp ? C.getSet(s) || C.sets().find((x) => x.frameId === s) || null : null;
    if (!comp && !set) {
      const key = s.toLowerCase();
      set = C.sets().find((x) => String(x.name).toLowerCase() === key) || null;
      if (!set) comp = C.list().find((c) => String(c.name).toLowerCase() === key && !c.setId) || C.list().find((c) => String((store.get(c.mainId) || {}).name).toLowerCase() === key) || null;
    }
    if (!comp && !set) {
      const names = [...C.sets().map((x) => x.name), ...C.list().filter((c) => !c.setId).map((c) => c.name)];
      return { error: `No component ${q(s)}. ${names.length ? 'Components: ' + names.slice(0, 30).map((x) => q(x)).join(', ') + '.' : 'There are no components yet (add_starter_kit or create_component).'}` };
    }
    if (comp && comp.setId) set = C.getSet(comp.setId);
    if (!set) {
      if (isObj(variant) && Object.keys(variant).length) return { comp, note: `${q(comp.name)} has no variants — variant ignored` };
      return { comp };
    }
    const members = C.variantsOf((comp || C.list().find((c) => c.setId === set.id) || {}).id);
    if (!members.length) return { error: `The set ${q(set.name)} has no variants.` };
    if (variant != null && !isObj(variant)) return { error: `variant must be an object like {"${Object.keys(set.props)[0] || 'Style'}": "${(Object.values(set.props)[0] || ['…'])[0]}"}` };
    const want = {};
    const bad = [];
    Object.keys(variant || {}).forEach((k) => {
      const pk = Object.keys(set.props).find((p) => p.toLowerCase() === String(k).toLowerCase());
      const vals = pk ? set.props[pk] : null;
      const val = vals && vals.find((x) => x.toLowerCase() === String(variant[k]).toLowerCase());
      if (!pk) bad.push(`unknown property ${q(k)}`);
      else if (!val) bad.push(`${pk} has no value ${q(variant[k])} (values: ${vals.join(', ')})`);
      else want[pk] = val;
    });
    if (bad.length) return { error: `${q(set.name)}: ${bad.join('; ')}. Properties: ${Object.keys(set.props).map((k) => `${k} = ${set.props[k].join(' | ')}`).join('; ')}.` };
    const base = Object.assign({}, (comp || members[0]).variant, want);
    const hit = members.find((c) => Object.keys(base).every((k) => c.variant[k] === base[k])) || members.find((c) => Object.keys(want).every((k) => c.variant[k] === want[k]));
    if (!hit) return { error: `${q(set.name)} has no variant ${varText(want)}.` };
    return { comp: hit };
  }

  /** "hug" on an axis where the main is a fixed size collapses the instance (a 48px button shrinks to its label), so keep the main's size. */
  function keepFixedAxes(main, p, ctx) {
    if (!main || !p || !p.sizing) return;
    ['w', 'h'].forEach((ax) => {
      const dim = ax === 'w' ? 'width' : 'height';
      if (p.sizing[ax] !== 'hug' || p[dim] != null || !main.sizing || main.sizing[ax] !== 'fixed') return;
      p.sizing = Object.assign({}, p.sizing, { [ax]: 'fixed' });
      p[dim] = main[dim];
      ctx.warn(`kept ${dim} fixed at ${main[dim]}px like the main component (hug would shrink it to its content); send a ${dim} to change it`);
    });
  }

  function rootFieldsOf(item, ctx, main) {
    const raw = {};
    ['name', 'width', 'height', 'sizing'].forEach((k) => item[k] !== undefined && (raw[k] = item[k]));
    if (!Object.keys(raw).length) return null;
    const p = sanitizeProps(raw, 'frame', ctx, null);
    ['w', 'h'].forEach((ax) => {
      const dim = ax === 'w' ? 'width' : 'height';
      if (p[dim] != null && !(p.sizing && p.sizing[ax])) p.sizing = Object.assign({}, p.sizing, { [ax]: 'fixed' });
    });
    keepFixedAxes(main, p, ctx);
    return Object.keys(p).length ? p : null;
  }

  function createInstances(input) {
    const C = comps();
    if (!C) return fail(NO_COMPONENTS, 'Components unavailable');
    const store = S();
    const ctx = makeCtx('update');
    const notes = [];
    let items = input.items;
    if (items == null && input.component) items = [input];
    if (isObj(items)) items = [items];
    if (!Array.isArray(items) || !items.length) return fail('create_instances needs "items": [{"component": "Button", "variant": {"Style": "Primary"}, "parent_id": "n_…", "overrides": {"Label": {"text": {"content": "Book a table"}}}}].', 'Nothing to place');
    const errors = [];
    const created = [];
    const allIds = [];
    const roots = [];
    items.slice(0, 200).forEach((item, i) => {
      if (!isObj(item)) return errors.push(`items[${i}] is not an object`);
      const rc = resolveComponent(item.component != null ? item.component : item.component_id, item.variant);
      if (rc.error) return errors.push(`items[${i}]: ${rc.error}`);
      if (rc.note) notes.push(`items[${i}]: ${rc.note}`);
      const comp = rc.comp;
      let pid = item.parent_id !== undefined ? item.parent_id : item.parentId !== undefined ? item.parentId : input.parent_id;
      if (pid === undefined || pid === '' || pid === 'null' || pid === 'canvas') pid = null;
      if (pid !== null) {
        const pr = resolve(pid, notes);
        if (pr.error) return errors.push(`items[${i}]: ${pr.error}`);
        pid = pr.node.id;
      }
      ctx.at = `items[${i}] ${q(comp.name)}`;
      const overrides = cleanOverrides(item.overrides, comp.mainId, ctx) || {};
      const rootPatch = rootFieldsOf(item, ctx, store.get(comp.mainId));
      if (rootPatch) overrides[''] = Object.assign({}, overrides[''], rootPatch);
      const opts = { parentId: pid, overrides };
      if (item.index != null && isFinite(Number(item.index))) opts.index = Math.max(0, Math.round(Number(item.index)));
      ['x', 'y'].forEach((k) => item[k] != null && (opts[k] = num(item[k], ctx, k, -1000000, 1000000)));
      try {
        const id = C.createInstance(comp.id, opts);
        const n = store.get(id);
        const p = store.getParent(id);
        created.push(`${id} ${q(n.name)} (${compLabel(comp)})${p ? ' in ' + q(p.name) + ' at index ' + p.children.indexOf(id) : ' on the canvas'}`);
        allIds.push(id, ...store.descendants(id));
        if (!p) roots.push(id);
      } catch (e) {
        errors.push(`items[${i}] ${q(comp.name)}: ${errText(e)}`);
      }
    });
    ctx.at = '';
    if (allIds.length) afterMutation(allIds, allIds.filter((id) => created.some((c) => c.startsWith(id + ' '))), roots.length ? roots : null);
    const out = { created };
    if (errors.length) out.errors = errors;
    const warnings = notes.concat(ctx.warnings());
    const hint = literalHint(ctx);
    if (hint) warnings.push(hint);
    if (warnings.length) out.warnings = warnings;
    const issues = layoutIssues(allIds);
    if (issues.length) out.layout = issues;
    return result(out, created.length ? `Placed ${created.length} instance${created.length === 1 ? '' : 's'}` : 'No instances placed', allIds, !created.length);
  }

  function updateInstances(input) {
    const C = comps();
    if (!C) return fail(NO_COMPONENTS, 'Components unavailable');
    const store = S();
    const ctx = makeCtx('update');
    const notes = [];
    let items = input.items;
    if (items == null && input.id) items = [input];
    if (isObj(items)) items = [items];
    if (!Array.isArray(items) || !items.length) return fail('update_instances needs "items": [{"id": "n_…", "variant"?: {…}, "overrides"?: {…}, "reset"?: true | ["Label"], "detach"?: true}].', 'Nothing to update');
    const errors = [];
    const updated = [];
    const changed = [];
    items.slice(0, 500).forEach((item, i) => {
      if (!isObj(item)) return errors.push(`items[${i}] is not {id, …}`);
      const r = resolve(item.id, notes);
      if (r.error) return errors.push(r.error);
      const n = r.node;
      if (!n.instance) {
        const ir = C.instanceRootOf(n.id);
        return errors.push(ir ? `${n.id} ${q(n.name)} is a layer inside the instance ${ir} ${q(store.get(ir).name)}: use that id and address the layer by its path (${q(C.pathOf(n.id, ir))}) in overrides` : `${n.id} ${q(n.name)} is not an instance${n.component ? ' (it is a main component: edit it with update_nodes)' : ''}`);
      }
      ctx.at = `${n.id} ${q(n.name)}`;
      const did = [];
      try {
        if (item.reset === true || item.reset === 'all') {
          C.resetOverrides(n.id);
          did.push('reset all overrides');
        } else if (item.reset != null) {
          const paths = [].concat(item.reset).map((p) => String(p));
          paths.forEach((p) => C.resetOverrides(n.id, p));
          did.push(`reset ${paths.map((p) => q(p)).join(', ')}`);
        }
        if (item.variant != null) {
          if (!isObj(item.variant)) throw new Error('variant must be an object like {"Style": "Secondary"}');
          C.setVariant(n.id, item.variant);
          const now = C.get(store.get(n.id).instance.componentId);
          did.push(`variant ${varText(now && now.variant) || varText(item.variant)}`);
        }
        if (item.overrides != null) {
          const ov = cleanOverrides(item.overrides, n.id, ctx);
          if (ov) {
            C.setOverrides(n.id, ov);
            did.push(`overrides on ${Object.keys(ov).map((p) => q(p || '(root)')).join(', ')}`);
          }
        }
        if (yes(item.detach)) {
          C.detach(n.id);
          did.push('detached (now plain layers)');
        }
      } catch (e) {
        errors.push(`${n.id} ${q(n.name)}: ${errText(e)}`);
      }
      if (did.length) {
        updated.push(`${n.id} ${q((store.get(n.id) || n).name)}: ${did.join('; ')}`);
        changed.push(n.id, ...store.descendants(n.id));
      }
    });
    ctx.at = '';
    if (changed.length) afterMutation(changed, [...new Set(changed.filter((id) => updated.some((u) => u.startsWith(id + ' '))))]);
    const out = { updated };
    const ovs = {};
    updated.forEach((u) => {
      const id = u.split(' ')[0];
      const o = store.get(id) && store.get(id).instance ? C.overridesOf(id) : null;
      if (o && Object.keys(o).length) ovs[id] = o;
    });
    if (Object.keys(ovs).length) out.overrides = ovs;
    if (errors.length) out.errors = errors;
    const warnings = notes.concat(ctx.warnings());
    if (warnings.length) out.warnings = warnings;
    const issues = layoutIssues(changed);
    if (issues.length) out.layout = issues;
    return result(out, updated.length ? `Updated ${updated.length} instance${updated.length === 1 ? '' : 's'}` : 'No instances updated', changed, !updated.length);
  }

  function combosOf(props) {
    return Object.keys(props).reduce((acc, k) => acc.flatMap((v) => props[k].map((val) => Object.assign({}, v, { [k]: val }))), [{}]);
  }

  function createComponent(input) {
    const C = comps();
    if (!C) return fail(NO_COMPONENTS, 'Components unavailable');
    const store = S();
    const notes = [];
    let ids = input.node_ids != null ? input.node_ids : input.ids != null ? input.ids : input.node_id;
    if (typeof ids === 'string') ids = [ids];
    if (!Array.isArray(ids) || !ids.length) return fail('create_component needs "node_ids": ["n_…"] and a "name".', 'Nothing to turn into a component');
    const nodes = [];
    for (const id of ids.slice(0, 100)) {
      const r = resolve(id, notes);
      if (r.error) return fail(r.error + ' Nothing was changed.', 'Layer not found');
      if (!nodes.includes(r.node.id)) nodes.push(r.node.id);
    }
    const name = input.name != null ? clipText(input.name, 120) : '';
    let props = null;
    if (input.variants != null) {
      if (!isObj(input.variants) || !Object.keys(input.variants).length) return fail('variants must be an object of property → values, e.g. {"Style": ["Primary", "Secondary", "Ghost"]}. Nothing was changed.', 'Bad variants');
      props = {};
      for (const k of Object.keys(input.variants).slice(0, 4)) {
        const vals = [...new Set([].concat(input.variants[k]).map((v) => String(v == null ? '' : v).trim()).filter(Boolean))];
        if (!vals.length) return fail(`variants.${k} needs at least one value. Nothing was changed.`, 'Bad variants');
        props[String(k).trim()] = vals;
      }
    }
    const combos = props ? combosOf(props) : [];
    if (combos.length > 36) return fail(`${combos.length} variant combinations is too many (36 at most). Use fewer properties or values. Nothing was changed.`, 'Too many variants');
    let setName = name || (store.get(nodes[0]) || {}).name || 'Component';
    try {
      // one main per layer (when there is one layer per combination), else one main from all layers
      let mains;
      if (combos.length > 1 && nodes.length === combos.length) {
        mains = nodes.map((id, i) => C.create([id], { name: `${setName} / __${i}` }));
      } else {
        const base = C.create(nodes, { name: name || undefined });
        mains = [base];
        setName = name || base.name;
        if (combos.length > 1) {
          C.update(base.id, { name: `${setName} / __0` });
          for (let i = 1; i < combos.length; i++) {
            const id = store.duplicate([base.mainId], 0)[0];
            mains.push(C.create([id], { name: `${setName} / __${i}` }));
          }
        }
      }
      let set = null;
      if (combos.length > 1) {
        const P = Object.keys(props);
        set = C.combineAsVariants(mains.map((m) => m.id), { name: setName, prop: P[0] });
        // every main now has a unique temporary value of P[0]; add the other properties, then assign real variants
        const tmp = { [P[0]]: mains.map((m) => C.get(m.id).variant[P[0]]) };
        P.slice(1).forEach((k) => (tmp[k] = props[k]));
        if (P.length > 1) C.setSetProps(set.id, tmp);
        mains.forEach((m, i) => C.setVariantOf(m.id, combos[i]));
        C.setSetProps(set.id, props);
      } else if (combos.length === 1) notes.push('only one variant combination, so a plain component was made (add values to build a set)');
      if (input.description != null && mains.length === 1) C.update(mains[0].id, { description: String(input.description) });
      const ids2 = mains.map((m) => m.id);
      const changed = [];
      ids2.forEach((cid) => {
        const c = C.get(cid);
        if (c) changed.push(c.mainId, ...store.descendants(c.mainId));
      });
      if (set) changed.unshift(set.frameId);
      afterMutation(changed, set ? [set.frameId] : [C.get(ids2[0]).mainId]);
      const out = componentsOutline(ids2);
      out.note = set
        ? 'Each variant main is a duplicate of the first: restyle the variants with update_nodes on their main ids, then place them with create_instances.'
        : 'Place it with create_instances; edit the main to change every instance.';
      if (nodes.length > 1 && !(combos.length > 1 && nodes.length === combos.length)) notes.push('the layers were wrapped in one frame that became the main');
      if (notes.length) out.notes = notes;
      return result(out, set ? `Made component set ${q(set.name)} (${mains.length} variants)` : `Made component ${q(C.get(ids2[0]).name)}`, changed);
    } catch (e) {
      return fail(`Could not create the component: ${errText(e)}`, 'Component not created');
    }
  }

  function addStarterKit() {
    const C = comps();
    if (!C || typeof C.addStarterKit !== 'function') return fail(NO_COMPONENTS, 'Components unavailable');
    const store = S();
    let ids;
    let page = null;
    try {
      page = homePage('Components', 'Components');
      ids = onPage(page, () => C.addStarterKit()) || [];
    } catch (e) {
      return fail(`Could not add the starter kit: ${errText(e)}`, 'Starter kit failed');
    }
    const board = allRoots().map((id) => store.get(id)).find((n) => n && n.name === 'Components' && !n.instance && !n.component);
    const changed = board ? [board.id, ...store.descendants(board.id)] : [];
    if (changed.length) afterMutation(changed, [board.id], ids.length ? [board.id] : null);
    const out = componentsOutline();
    out.artboard = board ? `${board.id} ${q(board.name)}` : null;
    if (page) out.page = 'The kit is ' + pageNote(page);
    out.added = ids.length ? `${ids.length} component mains` : 'nothing new: the kit was already there';
    out.note = 'The kit follows the active brand kit. Restyle a main with update_nodes to change all its instances; place them with create_instances.';
    return result(out, ids.length ? `Added the starter kit (${ids.length} components)` : 'Starter kit already present', changed);
  }

  // ---------- logos (Folio.svg, src/svg.js) ----------
  const svgApi = () => (Folio.svg && typeof Folio.svg.sanitize === 'function' ? Folio.svg : null);
  const NO_SVG = 'Logo tools are not available in this build of Folio (src/svg.js is not loaded). Draft the logo with create_nodes (text and frames) instead.';
  const LOGO_BOARD = 'Logo concepts';
  const CARD_PREFIX = 'Concept / ';
  const MAX_SVG_CHARS = 200000;
  const MAX_KIT_LOGOS = 24;
  const SIZES = [64, 32, 16];

  /** Sanitized SVG with its fonts embedded: { svg, warnings } or { error }. */
  async function cleanSvg(raw, label) {
    const V = svgApi();
    if (typeof raw !== 'string' || !/<svg[\s>]/i.test(raw)) return { error: `${label} must be SVG markup starting with <svg …>.` };
    if (raw.length > MAX_SVG_CHARS) return { error: `${label} is too large (${Math.round(raw.length / 1024)} KB; the limit is ${MAX_SVG_CHARS / 1000} KB). Simplify the paths.` };
    let s;
    try {
      s = V.sanitize(raw);
    } catch (e) {
      return { error: `${label} could not be used: ${errText(e)}` };
    }
    const warnings = (Array.isArray(s.warnings) ? s.warnings : []).map((w) => `${label}: ${w}`);
    let svg = s.svg;
    const fw = [];
    try {
      const out = await timeout(V.embedFonts(svg, fw), 12000);
      if (typeof out === 'string') svg = out;
      else fw.push('fonts could not be embedded in time, so its text may show in a fallback font outside Folio');
    } catch (e) {
      fw.push(`fonts could not be embedded (${errText(e)})`);
    }
    fw.forEach((w) => warnings.push(`${label}: ${w}`));
    return { svg, warnings };
  }

  function svgRatio(svg) {
    const sz = safe(() => Folio.svg.size(svg), null);
    const w = sz && Number(sz.width);
    const h = sz && Number(sz.height);
    return w > 0 && h > 0 ? { w, h, ratio: clamp(w / h, 0.1, 20) } : { w: 0, h: 0, ratio: 1 };
  }

  /** Width × height that fits a box while keeping the logo's proportions. */
  const fit = (ratio, maxW, maxH) => {
    const w = Math.min(maxW, maxH * ratio);
    return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(w / ratio)) };
  };

  /** One concept card: large on white, 64/32/16 px on white and on near-black, caption. Fixed size so cards line up. */
  function cardTree(name, concept, light, dark, ratio) {
    const img = (nm, src, sz) => ({ type: 'image', name: nm, width: sz.width, height: sz.height, image: { src, fit: 'contain' } });
    const ground = (nm, bg, border, src, ink) => ({
      type: 'frame',
      name: nm,
      sizing: { w: 'fill' },
      layout: { gap: 10, padding: [14, 16] },
      style: { fills: [{ type: 'solid', color: bg }], radius: 10, border: { width: 1, color: border } },
      children: SIZES.map((px) => {
        const sz = fit(ratio, 290, px);
        return {
          type: 'frame',
          name: `${px} px`,
          sizing: { w: 'fill' },
          layout: { direction: 'row', align: 'center', gap: 12 },
          children: [
            { type: 'text', name: 'Size', width: 40, text: { content: `${sz.height} px`, size: 11, weight: 500, color: ink } },
            img('Logo', src, sz),
          ],
        };
      }),
    });
    return {
      type: 'frame',
      name: CARD_PREFIX + name,
      width: 426,
      sizing: { h: 'hug' },
      layout: { gap: 12, padding: 20 },
      style: { fills: [{ type: 'solid', color: '#ffffff' }], radius: 16 },
      children: [
        {
          type: 'frame',
          name: 'Stage',
          sizing: { w: 'fill' },
          height: 190,
          layout: { justify: 'center', align: 'center' },
          style: { fills: [{ type: 'solid', color: '#ffffff' }], radius: 10, border: { width: 1, color: '#e6e5e1' } },
          children: [img('Logo', light, fit(ratio, 300, 120))],
        },
        ground('On light', '#ffffff', '#e6e5e1', light, '#8b8a85'),
        ground('On dark', '#131416', '#131416', dark, '#8e9096'),
        {
          type: 'frame',
          name: 'Caption',
          sizing: { w: 'fill' },
          height: 88,
          layout: { gap: 4, padding: [4, 2, 0, 2] },
          style: { clip: true },
          children: [
            { type: 'text', name: 'Name', sizing: { w: 'fill' }, text: { content: name, size: 15, weight: 600, color: '#16181d' } },
            ...(concept ? [{ type: 'text', name: 'Concept', sizing: { w: 'fill' }, text: { content: concept, size: 13, lineHeight: 1.45, color: '#5d5f66' } }] : []),
          ],
        },
      ],
    };
  }

  async function draftLogo(input) {
    const V = svgApi();
    if (!V) return fail(NO_SVG, 'Logo tools unavailable');
    const store = S();
    const name = clip(typeof input.name === 'string' ? input.name : '', 60);
    if (!name) return fail('draft_logo needs "name": a short label for this concept, e.g. "Arch dot wordmark".', 'Bad logo input');
    let concept = typeof input.concept === 'string' ? clip(input.concept, 400) : '';
    const warnings = [];
    if (!concept) warnings.push('no "concept" was given: add one sentence saying the idea, so the user can compare drafts');
    if (concept.length > 150) {
      concept = clip(concept, 150);
      warnings.push('the concept was shortened to fit the card: keep it to one sentence');
    }
    const c = await cleanSvg(input.svg, 'svg');
    if (c.error) return fail(c.error + ' Nothing was drafted.', 'Logo not drafted');
    warnings.push(...c.warnings);
    const { ratio, w, h } = svgRatio(c.svg);
    const vers = safe(() => V.versions(c.svg, activeBrand() || undefined), null);
    const light = V.toDataUrl(c.svg);
    const dark = vers && typeof vers['on-dark'] === 'string' ? V.toDataUrl(vers['on-dark']) : light;

    const page = homePage(LOGO_BOARD, 'Logos');
    return onPage(page, () => {
      let board = store.doc.roots.map((id) => store.get(id)).find((n) => n && n.type === 'frame' && n.name === LOGO_BOARD && !n.instance && !n.component);
      const created = [];
      if (!board) {
        const spot = nextArtboardSpot();
        board = store.buildFromTree({
          type: 'frame',
          name: LOGO_BOARD,
          x: spot.x,
          y: spot.y,
          width: 1440,
          height: 800,
          sizing: { w: 'fixed', h: 'hug' },
          layout: { mode: 'flex', direction: 'row', wrap: true, gap: 32, padding: [48, 48, 48, 48], align: 'flex-start' },
          style: { fills: [{ type: 'solid', color: '#e9e8e4', visible: true }], clip: true },
        });
        created.push(board.id);
      }
      const old = board.children.map((id) => store.get(id)).find((n) => n && n.name && keyOf(n.name) === keyOf(CARD_PREFIX + name));
      let index;
      if (old) {
        index = board.children.indexOf(old.id);
        store.remove([old.id]);
      }
      const ctx = makeCtx('create');
      const info = { seen: new WeakSet(), count: 0, truncated: 0, fonts: new Set(), parentId: board.id, parentFlex: true, parentDir: 'row' };
      const clean = cleanTree(cardTree(name, concept, light, dark, ratio), ctx, info, 0, null, LOGO_BOARD);
      const card = store.buildFromTree(clean[0], board.id, index);
      const ids = [card.id, ...store.descendants(card.id)];
      const logoId = ids.find((id) => store.get(id).type === 'image');
      afterMutation(created.concat(ids), [card.id], created.length ? created : null);
      const out = {
        card: card.id,
        image: logoId,
        artboard: `${board.id} ${q(LOGO_BOARD)}`,
        viewBox: w && h ? [r2(w), r2(h)] : undefined,
        next: `Screenshot ${board.id} to judge every draft at once (readable at 16 px? still clear reversed?). To keep one, call save_logo with "node_id": "${logoId}".`,
      };
      if (old) out.replaced = `the earlier draft ${q(name)} (${old.id})`;
      if (page && !isCurrent(page)) out.page = `The drafts are ${pageNote(page)}; screenshotting the artboard switches the view there.`;
      if (warnings.length) out.warnings = warnings.slice(0, MAX_WARNINGS);
      return result(out, `${old ? 'Redrew' : 'Drafted'} logo ${q(name)}`, ids);
    });
  }

  async function saveLogo(input) {
    const V = svgApi();
    if (!V) return fail(NO_SVG, 'Logo tools unavailable');
    const B = brandApi();
    if (!B || typeof B.addLogoSrc !== 'function' || typeof B.create !== 'function') return fail(UNAVAILABLE, 'Brand kits unavailable');
    const store = S();
    const notes = [];
    let name = clip(typeof input.name === 'string' ? input.name : '', 60);
    let raw = input.svg;
    if (raw == null) {
      const nid = input.node_id != null ? input.node_id : input.id;
      if (nid == null) return fail('save_logo needs "node_id" (a draft\'s image or card from draft_logo, or any frame or image) or "svg" markup.', 'Bad logo input');
      const r = resolve(nid, notes);
      if (r.error) return fail(r.error + ' Nothing was saved.', 'Layer not found');
      let node = r.node;
      // a concept card from draft_logo, or any layer inside one, means that draft's logo
      let card = node;
      while (card && !(card.type === 'frame' && String(card.name).startsWith(CARD_PREFIX))) card = store.getParent(card.id);
      if (card) {
        if (!name) name = clip(card.name.slice(CARD_PREFIX.length), 60);
        node = store.descendants(card.id).map((id) => store.get(id)).find((n) => n.type === 'image') || node;
      }
      if (node.type === 'text') return fail(`${q(node.name)} is a text layer; pass the frame or image that holds the whole logo.`, 'Bad logo input');
      // an SVG image (a draft) keeps its own markup and viewBox; anything else is drawn as vectors
      const src = node.type === 'image' && node.image ? safe(() => Folio.brand.resolveSrc(node.image.src), node.image.src) : null;
      raw = src && V.decode ? V.decode(src) : null;
      if (!raw) {
        try {
          raw = await V.fromNode(node.id, notes);
        } catch (e) {
          return fail(`Could not turn ${q(node.name)} into SVG: ${errText(e)}. Pass "svg" markup instead.`, 'Logo not saved');
        }
      }
      if (!name) name = clip(node.name, 60);
    }
    if (!name) return fail('save_logo needs "name", e.g. the brand name.', 'Bad logo input');
    const c = await cleanSvg(raw, 'logo');
    if (c.error) return fail(c.error + ' Nothing was saved.', 'Logo not saved');
    const warnings = notes.concat(c.warnings);
    let sym = null;
    if (input.symbol_svg != null) {
      sym = await cleanSvg(input.symbol_svg, 'symbol_svg');
      if (sym.error) {
        warnings.push(sym.error + ' The symbol was skipped.');
        sym = null;
      } else warnings.push(...sym.warnings);
    }

    let brand = activeBrand();
    let createdKit = false;
    if (!brand) {
      try {
        const made = B.create({ name });
        B.setActive(made.id);
        brand = activeBrand() || made;
        createdKit = true;
      } catch (e) {
        return fail(`Folio could not create a brand kit for the logo: ${errText(e)}`, 'Logo not saved');
      }
    }
    if (listOf(brand, 'logos').length + (sym ? 4 : 3) > MAX_KIT_LOGOS) return fail(`${q(brand.name)} already holds ${listOf(brand, 'logos').length} logos. Remove old ones first (set_brand logos [{"id": …, "delete": true}]). Nothing was saved.`, 'Too many logos');

    const vers = safe(() => V.versions(c.svg, brand), null) || {};
    const list = [['on-light', vers['on-light'] || c.svg, 'on light'], ['on-dark', vers['on-dark'], 'on dark'], ['mono', vers.mono, 'one colour']];
    if (sym) list.push(['symbol', sym.svg, 'symbol']);
    const group = newId('g_', new Set(listOf(brand, 'logos').map((l) => l.group).filter(Boolean)));
    const logos = {};
    for (const [version, svg, label] of list) {
      if (typeof svg !== 'string') {
        warnings.push(`the ${label} version could not be made`);
        continue;
      }
      const sz = svgRatio(svg);
      try {
        const l = B.addLogoSrc(brand.id, { name: `${name} — ${label}`, src: V.toDataUrl(svg), width: sz.w, height: sz.h, version, group });
        if (l && l.id) logos[version] = tokenFor('logo', l.id);
      } catch (e) {
        warnings.push(`the ${label} version was not saved: ${errText(e)}`);
      }
    }
    if (!Object.keys(logos).length) return fail(`No logo version could be saved. ${warnings.join(' ')}`, 'Logo not saved');
    const out = { brand: `${brand.id} ${q(brand.name)}`, logos };
    out.note = `Show a version with an image node {"image": {"src": "${logos['on-light'] || Object.values(logos)[0]}", "fit": "contain"}} and a width or height; use on-dark on dark grounds and mono for one-colour uses.`;
    if (createdKit) out.createdKit = `No brand kit was active, so a new kit ${q(brand.name)} was made the document's brand, with placeholder colours and fonts. Tell the user, and set its colours and fonts with set_brand.`;
    if (warnings.length) out.warnings = warnings.slice(0, MAX_WARNINGS);
    return result(out, `Saved logo ${q(name)} to ${q(brand.name)}`, []);
  }

  // ---------- pages ----------
  const PAGE_ACTIONS = ['list', 'create', 'switch', 'rename', 'delete', 'move'];
  const PAGE_ACTION_ALIASES = { add: 'create', new: 'create', open: 'switch', go: 'switch', show: 'switch', remove: 'delete', reorder: 'move' };
  const pageName = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 60) : '');

  function managePages(input) {
    if (!pagesOn()) return fail('Pages are not available in this build of Folio; every artboard is on one canvas.', 'Pages unavailable');
    const store = S();
    const raw = typeof input.action === 'string' ? input.action.trim().toLowerCase() : '';
    const action = PAGE_ACTIONS.includes(raw) ? raw : PAGE_ACTION_ALIASES[raw];
    if (!action) return fail(`manage_pages needs "action": one of ${PAGE_ACTIONS.join(', ')}.`, 'Bad page action');
    const name = pageName(input.name);
    const taken = (nm, except) => store.pages().find((p) => p !== except && String(p.name).toLowerCase() === nm.toLowerCase());
    const index = (len) => (input.index == null || !isFinite(Number(input.index)) ? undefined : clamp(Math.round(Number(input.index)), 0, len));
    const done = (msg, summary) => result({ done: msg, pages: pagesOutline(false) }, summary, []);
    if (action === 'list') return result({ pages: pagesOutline(true) }, `Listed ${store.pages().length} pages`, []);
    if (action === 'create') {
      const dup = name && taken(name);
      if (dup) return fail(`A page named ${q(dup.name)} already exists (${dup.id}). Switch to it, or pick another name.`, 'Page exists');
      const p = store.addPage(name || undefined, { index: index(store.pages().length), activate: true });
      return done(`Created page ${pageTag(p)} and switched the view to it. New artboards (create_nodes with parent_id null) go here.`, `Created page ${q(p.name)}`);
    }
    const pr = findPage(input.page_id != null ? input.page_id : action === 'switch' || action === 'delete' ? input.name : undefined);
    if (pr.error) return fail(pr.error, 'Page not found');
    const page = pr.page;
    if (action === 'switch') {
      if (isCurrent(page)) return result({ done: `The user is already viewing ${pageTag(page)}.`, pages: pagesOutline(false) }, `Already on ${q(page.name)}`, []);
      store.switchPage(page.id);
      return done(`Switched the view to ${pageTag(page)}. New artboards go here; get_document shows its artboards.`, `Switched to page ${q(page.name)}`);
    }
    if (action === 'rename') {
      if (!name) return fail('rename needs "name": the new page name.', 'Bad page name');
      const dup = taken(name, page);
      if (dup) return fail(`Another page is already called ${q(dup.name)} (${dup.id}).`, 'Page exists');
      const was = page.name;
      store.renamePage(page.id, name);
      return done(`Renamed ${q(was)} to ${q(page.name)}.`, `Renamed page to ${q(page.name)}`);
    }
    if (action === 'delete') {
      if (store.pages().length <= 1) return fail(`${pageTag(page)} is the only page, and a document needs at least one. Rename it instead.`, 'Cannot delete the last page');
      const boards = page.roots.filter((id) => store.get(id));
      if (boards.length && !yes(input.confirm))
        return fail(`${pageTag(page)} has ${boards.length} artboard${boards.length === 1 ? '' : 's'} (${boards.slice(0, 10).map(boardLine).join('; ')}${boards.length > 10 ? '; …' : ''}). Deleting the page deletes them and everything inside. Ask the user first, then call again with "confirm": true. Nothing was deleted.`, 'Page has artboards');
      store.removePage(page.id);
      return done(`Deleted page ${q(page.name)}${boards.length ? ` and its ${boards.length} artboard${boards.length === 1 ? '' : 's'}` : ''}. The user is now viewing ${pageTag(store.currentPage())}.`, `Deleted page ${q(page.name)}`);
    }
    // move: artboards to page_id, or the page itself to index
    const refs = asList(input.node_ids);
    if (refs.length) {
      const ids = [];
      const errs = [];
      refs.slice(0, 200).forEach((ref) => {
        const r = resolve(ref);
        if (r.error) errs.push(r.error);
        else if (r.node.parent) errs.push(`${describeNode(r.node.id)} is not an artboard; only artboards move between pages (its artboard is ${store.rootOf(r.node.id)})`);
        else if (!ids.includes(r.node.id) && (store.pageOf(r.node.id) || {}).id !== page.id) ids.push(r.node.id);
      });
      if (errs.length) return fail(errs.slice(0, 8).join(' ') + ' Nothing was moved.', 'Cannot move to page');
      if (!ids.length) return done(`Those artboards are already on ${pageTag(page)}.`, 'Nothing to move');
      store.moveToPage(ids, page.id);
      return done(`Moved ${ids.length} artboard${ids.length === 1 ? '' : 's'} to ${pageTag(page)}${isCurrent(page) ? '' : '; the view stays on ' + q(store.currentPage().name)}.`, `Moved ${ids.length} artboard${ids.length === 1 ? '' : 's'} to ${q(page.name)}`);
    }
    const to = index(store.pages().length - 1);
    if (to == null) return fail('move needs "node_ids" (artboards to move to page_id) or "index" (the new position of page page_id, 0 = first).', 'Bad page move');
    store.movePage(page.id, to);
    return done(`Moved page ${q(page.name)} to position ${to}.`, `Reordered pages`);
  }

  // ---------- HTML import (SPEC "HTML import (v0.7)") ----------
  const MAX_HTML_BYTES = 3 * 1024 * 1024;

  async function importHtml(input) {
    const I = Folio.importer;
    if (!I || typeof I.fromHtml !== 'function') return fail('HTML import is not available in this build of Folio (src/import.js is not loaded). Rebuild the design with create_nodes instead.', 'Import unavailable');
    const store = S();
    const html = input.html;
    if (typeof html !== 'string' || !html.trim()) return fail('import_html needs "html": the page or snippet as one string, with its CSS in <style> or style attributes.', 'Nothing to import');
    const bytes = new Blob([html]).size;
    if (bytes > MAX_HTML_BYTES) return fail(`The HTML is ${Math.ceil(bytes / 1024)} KB, over the 3 MB limit. Import one section (selector), or remove inlined images and fonts first.`, 'HTML too large');
    const width = input.width == null ? 1440 : Number(input.width);
    if (!isFinite(width) || width < 320 || width > 2560) return fail(`"width" must be a number from 320 to 2560 (desktop 1440, laptop 1280, tablet 768, mobile 390); got ${str(input.width)}.`, 'Bad width');
    const opts = { width: Math.round(width) };
    if (typeof input.name === 'string' && input.name.trim()) opts.name = clip(input.name, 80);
    if (input.base_url != null && input.base_url !== '') {
      let u = null;
      try {
        u = new URL(String(input.base_url));
      } catch (e) {
        /* reported below */
      }
      if (!u || !/^https?:$/.test(u.protocol)) return fail(`"base_url" must be an http(s) address such as https://example.com/; got ${str(input.base_url)}.`, 'Bad base URL');
      opts.baseUrl = u.href;
    }
    if (input.selector != null && input.selector !== '') {
      const sel = String(input.selector).trim().slice(0, 300);
      try {
        document.createDocumentFragment().querySelector(sel);
      } catch (e) {
        return fail(`"selector" ${q(sel)} is not a valid CSS selector.`, 'Bad selector');
      }
      opts.selector = sel;
    }
    const notes = [];
    let parent = null;
    let page = null;
    if (input.parent_id != null && input.parent_id !== '') {
      const r = resolve(input.parent_id, notes);
      if (r.error) return fail(r.error + ' Nothing was imported.', 'Parent not found');
      parent = r.node;
      if (parent.type !== 'frame') return fail(`${describeNode(parent.id)} cannot hold children; parent_id must be a frame. Nothing was imported.`, 'Bad parent');
      if (instanceScope(parent.id)) return fail(`${q(parent.name)} (${parent.id}) is part of an instance, so nothing can be added inside it. Import into the main component, or detach the instance first. Nothing was imported.`, 'Cannot add inside an instance');
      opts.parentId = parent.id;
      if (input.width == null) {
        // lay the snippet out at the frame's content width, like paste-as-layers does
        const el = Folio.render && Folio.render.el && Folio.render.el(parent.id);
        const pad = (parent.layout && parent.layout.padding) || [0, 0, 0, 0];
        opts.width = Math.max(100, Math.round((el ? el.clientWidth : parent.width) - pad[1] - pad[3]));
      }
      if (input.page_id != null && input.page_id !== '') notes.push('page_id only applies to new artboards (no parent_id), so it was ignored');
    } else if (input.page_id != null && input.page_id !== '' && pagesOn()) {
      const pr = findPage(input.page_id);
      if (pr.error) return fail(pr.error + ' Nothing was imported.', 'Page not found');
      page = pr.page;
      opts.pageId = page.id;
    }
    let res;
    try {
      res = await I.fromHtml(html, opts);
    } catch (e) {
      return fail(`The import failed: ${errText(e)}. Nothing was added.`, 'Import failed');
    }
    const root = res && store.get(res.rootId);
    if (!root) return fail('The import produced no layers (the HTML may be empty, or everything in it is hidden or built by scripts, which never run). Nothing was added.', 'Nothing imported');
    const ids = [root.id, ...store.descendants(root.id)];
    afterMutation(ids, [root.id], parent ? null : [root.id]);
    const rs = renderedSize(root.id) || [Math.round(root.width), Math.round(root.height)];
    const out = { [parent ? 'layer' : 'artboard']: `${root.id} ${q(root.name)} ${rs[0]}×${rs[1]}`, layers: ids.length };
    if (parent) out.parent = `${parent.id} ${q(parent.name)}`;
    if (page && !isCurrent(page)) out.page = 'Imported ' + pageNote(page);
    const warnings = notes.concat(Array.isArray(res.warnings) ? res.warnings.map(String) : []);
    if (warnings.length) out.warnings = warnings.slice(0, MAX_WARNINGS);
    if (isObj(res.skipped) && Object.keys(res.skipped).length) out.skipped = res.skipped;
    if (ids.length <= 3 && /<script/i.test(html)) out.nearlyEmpty = 'Almost nothing came in: the page is probably built by JavaScript, which import never runs. Tell the user, and offer to rebuild it from a screenshot or a description.';
    out.next = `Screenshot ${root.id} and compare, then clean up: rename layers, link brand tokens, turn repeated parts into components. get_tree shows more than this outline.`;
    out.outline = serialize(root.id, { depth: 3, maxNodes: 60 });
    return result(out, `Imported ${q(root.name)} (${ids.length} layer${ids.length === 1 ? '' : 's'})`, ids);
  }

  const importUrl = () =>
    fail('import_url only works when Folio is driven from Claude Code (it needs a helper on the computer to fetch the page). Here, ask the user to paste the page\'s HTML into the chat (then use import_html) or into File → Import HTML…, or to ask again from Claude Code.', 'URL import needs Claude Code');

  const HANDLERS = {
    get_document: getDocument,
    get_tree: getTree,
    create_nodes: createNodes,
    update_nodes: updateNodes,
    delete_nodes: deleteNodes,
    move_nodes: moveNodes,
    screenshot,
    get_brand: getBrand,
    set_brand: setBrand,
    list_components: listComponents,
    create_component: createComponent,
    create_instances: createInstances,
    update_instances: updateInstances,
    add_starter_kit: addStarterKit,
    draft_logo: draftLogo,
    save_logo: saveLogo,
    manage_pages: managePages,
    import_html: importHtml,
    import_url: importUrl,
  };

  async function execute(name, input) {
    try {
      if (!S()) return fail('Folio is not ready yet.', 'Folio not ready');
      const fn = own(HANDLERS, name) ? HANDLERS[name] : null;
      if (!fn) return fail(`Unknown tool ${q(name)}. Available tools: ${Object.keys(HANDLERS).join(', ')}.`, 'Unknown tool');
      const inp = parseInput(input);
      const note = FOLLOW_TOOLS.has(name) ? followPage(inp) : '';
      const res = await fn(inp);
      return note ? withNote(res, note) : res;
    } catch (e) {
      console.error('[Folio] AI tool failed', name, e);
      return fail(`Folio hit an internal error while running ${name}: ${(e && e.message) || e}. Some changes may have been applied — call get_document to check.`, `${name} failed`);
    }
  }

  Folio.aiTools = { execute, describeNode, serialize, renderedSize, normalizeColor, brandBrief, brandContext, names: Object.keys(HANDLERS) };
})();
