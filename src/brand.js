/*
 * brand.js — brand kits (colours, fonts, logos, voice, style) and the tokens that link layers to them.
 *
 * Brands live in a LIBRARY in this browser (localStorage 'folio:brands:v1'). Each document has one
 * ACTIVE brand, embedded as a full copy in `doc.brand`, so saved files and undo/redo carry it.
 * Layers link to brand values with real CSS variables — var(--color-primary), var(--font-heading),
 * var(--radius-md) — which this file sets on #canvas-world. Edit a brand colour and every linked
 * layer updates at once; switch the document to another brand and the whole design re-skins.
 *
 *   Folio.brand.init()                      load the library, sync doc.brand, apply the CSS variables
 *   Folio.brand.library() / active() / get(id) / templates()
 *   Folio.brand.create(templateIdOrPartial) a new brand in the library (not activated)
 *   Folio.brand.update(id, patch)           deep-merge (arrays replaced); never commits — callers do
 *   Folio.brand.remove(id) / duplicate(id) / setActive(id | null)
 *   Folio.brand.exportJson(id) / importJson(text)
 *   Folio.brand.cssVars(brand) / cssRootBlock(brand)
 *   Folio.brand.isToken / tokenOf / resolveColor / resolveFont / resolveRadius / resolveSrc
 *   Folio.brand.colorRef(id) / fontRef(id) / radiusRef(size) / logoRef(id) / detach(token)
 *   Folio.brand.addColor / removeColor / addFont / removeFont / addLogo(brandId, file) / removeLogo
 *
 * Store event 'brand' fires whenever the active brand or the library changes.
 * Safe to load before render.js, and before #canvas-world exists.
 */
window.Folio = window.Folio || {};

(function () {
  const LIB_KEY = 'folio:brands:v1';
  const LOGO_MAX_SIDE = 1024;
  const LOGO_MAX_BYTES = 1.5 * 1024 * 1024;

  const store = () => Folio.store;
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const rid = (n = 6) => {
    let s = '';
    while (s.length < n) s += Math.random().toString(36).slice(2);
    return s.slice(0, n);
  };
  const toast = (msg, kind) => (Folio.ui && Folio.ui.toast ? Folio.ui.toast(msg, kind) : console.log('[Folio]', msg));
  const emit = (evt, data) => store() && store().emit(evt, data);

  function deepMerge(target, patch) {
    for (const k of Object.keys(patch || {})) {
      const v = patch[k];
      if (v === undefined) continue;
      if (isObj(v) && isObj(target[k])) deepMerge(target[k], v);
      else target[k] = isObj(v) || Array.isArray(v) ? clone(v) : v;
    }
    return target;
  }

  // =====================================================================
  //  Schema & defaults
  // =====================================================================
  const CORE_COLORS = [
    { id: 'primary', name: 'Primary', value: '#2563eb' },
    { id: 'on-primary', name: 'On primary', value: '#ffffff' }, // missing in a kit → picked for contrast (see readableOn)
    { id: 'secondary', name: 'Secondary', value: '#0f172a' },
    { id: 'accent', name: 'Accent', value: '#f59e0b' },
    { id: 'background', name: 'Background', value: '#ffffff' },
    { id: 'surface', name: 'Surface', value: '#f4f4f5' },
    { id: 'text', name: 'Text', value: '#18181b' },
    { id: 'muted', name: 'Muted', value: '#71717a' },
    { id: 'success', name: 'Success', value: '#16a34a' },
    { id: 'danger', name: 'Danger', value: '#dc2626' },
  ];
  const CORE_FONTS = [
    { id: 'heading', name: 'Heading', family: 'Inter', weight: 700 },
    { id: 'body', name: 'Body', family: 'Inter', weight: 400 },
  ];
  /** Plain-English role of each core colour (shown in the brand panel and useful for the AI). */
  const ROLES = {
    primary: 'Main brand colour — buttons, links, highlights',
    'on-primary': 'Text and icons on primary — button labels',
    secondary: 'Supporting colour — dark sections, headings',
    accent: 'Pop colour — badges, small details',
    background: 'Page background',
    surface: 'Cards and panels on the background',
    text: 'Main text colour',
    muted: 'Secondary text, captions, borders',
    success: 'Confirmations, positive states, success badges',
    danger: 'Errors, destructive actions, warnings',
    heading: 'Headlines and titles',
    body: 'Paragraphs, buttons and UI text',
  };
  const ENUMS = {
    button: ['pill', 'rounded', 'square'],
    density: ['compact', 'comfortable', 'airy'],
    shadow: ['none', 'soft', 'bold'],
  };
  const FILL_TYPES = ['solid', 'linear', 'radial', 'conic', 'mesh', 'image', 'noise'];
  const TOKEN_RE = /^\s*var\(\s*--(color|font|radius)-([A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)\s*$/;
  const LOGO_PREFIX = 'brand-logo:';

  const str = (v, max = 4000) => (v == null ? '' : String(v)).slice(0, max);
  // WCAG relative luminance; used to pick a readable "on primary" for kits that don't set one
  const lum = (hex) => {
    const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
    if (!m) return 0;
    return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
  };
  const contrastRatio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const readableOn = (bg) => (contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111111') ? '#ffffff' : '#111111');
  const safeId = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null);
  const num = (v, d, lo = -Infinity, hi = Infinity) => {
    const n = Number(v);
    return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  };

  function isColor(v) {
    if (typeof v !== 'string' || !v.trim() || v.length > 100) return false;
    v = v.trim();
    if (TOKEN_RE.test(v)) return false; // a brand colour must be a literal
    if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return true;
    if (typeof CSS !== 'undefined' && CSS.supports) return CSS.supports('color', v);
    return /^(rgb|rgba|hsl|hsla)\(/i.test(v);
  }
  /** '#abc' / 'abc' / '#aabbcc' / rgba(...) → normalised colour string, or null. */
  function normColor(v) {
    if (typeof v !== 'string') return null;
    let s = v.trim();
    if (/^[0-9a-f]{3,8}$/i.test(s) && [3, 4, 6, 8].includes(s.length)) s = '#' + s;
    if (!isColor(s)) return null;
    if (/^#[0-9a-f]{3,4}$/i.test(s)) s = '#' + s.slice(1).split('').map((c) => c + c).join('');
    return s.startsWith('#') ? s.toLowerCase() : s;
  }

  const LOGO_VERSIONS = ['on-light', 'on-dark', 'mono', 'metal', 'symbol'];
  /** A logo's optional version label and the group linking the versions of one logo. */
  function logoMeta(l) {
    const out = {};
    if (LOGO_VERSIONS.includes(l.version)) out.version = l.version;
    if (safeId(l.group)) out.group = l.group;
    return out;
  }

  function normFill(f) {
    if (!isObj(f) || !FILL_TYPES.includes(f.type)) return null;
    const out = clone(f);
    if (out.visible === undefined) out.visible = true;
    return out;
  }

  /** Make any brand-ish object a valid brand (fills defaults, guarantees core colours/fonts). */
  function normalize(b, { keepId = true } = {}) {
    b = isObj(b) ? b : {};
    const out = {
      id: (keepId && safeId(b.id)) || 'b_' + rid(6),
      name: str(b.name, 80).trim() || 'Untitled brand',
      updatedAt: num(b.updatedAt, Date.now(), 0),
      colors: [],
      fonts: [],
      logos: [],
      voice: {},
      style: {},
    };
    if (b.description && !(b.voice && b.voice.description)) out._description = str(b.description);

    // ---- colours (array, or a {primary:'#..'} map — handy for hand-written JSON) ----
    let colors = b.colors;
    if (isObj(colors)) colors = Object.keys(colors).map((k) => (isObj(colors[k]) ? { id: k, ...colors[k] } : { id: k, value: colors[k] }));
    colors = Array.isArray(colors) ? colors : [];
    const seen = new Set();
    CORE_COLORS.forEach((def) => {
      const c = colors.find((x) => x && x.id === def.id);
      out.colors.push({
        id: def.id,
        name: (c && str(c.name, 60).trim()) || def.name,
        value: (c && normColor(c.value)) || (def.id === 'on-primary' ? readableOn(out.colors[0].value) : def.value),
        core: true,
      });
      seen.add(def.id);
    });
    colors.forEach((c) => {
      if (!isObj(c)) return;
      const value = normColor(c.value);
      if (!value) return;
      let id = safeId(c.id);
      if (!id || seen.has(id)) {
        if (id && seen.has(id)) return; // duplicate of a core/earlier id
        id = 'c_' + rid(4);
      }
      seen.add(id);
      out.colors.push({ id, name: str(c.name, 60).trim() || 'Colour', value });
    });

    // ---- fonts ----
    let fonts = b.fonts;
    if (isObj(fonts)) fonts = Object.keys(fonts).map((k) => (isObj(fonts[k]) ? { id: k, ...fonts[k] } : { id: k, family: fonts[k] }));
    fonts = Array.isArray(fonts) ? fonts : [];
    const fseen = new Set();
    const normFont = (f, def) => {
      const family = str((f && f.family) || (def && def.family) || 'Inter', 80).replace(/["';{}<>]/g, '').trim() || 'Inter';
      return {
        family,
        weight: Math.round(num(f && f.weight, (def && def.weight) || 400, 100, 1000) / 100) * 100 || 400,
      };
    };
    CORE_FONTS.forEach((def) => {
      const f = fonts.find((x) => x && x.id === def.id);
      out.fonts.push({ id: def.id, name: (f && str(f.name, 60).trim()) || def.name, ...normFont(f, def), core: true });
      fseen.add(def.id);
    });
    fonts.forEach((f) => {
      if (!isObj(f) || !f.family) return;
      let id = safeId(f.id);
      if (id && fseen.has(id)) return;
      if (!id) id = 'f_' + rid(4);
      fseen.add(id);
      out.fonts.push({ id, name: str(f.name, 60).trim() || f.family, ...normFont(f) });
    });

    // ---- logos ----
    (Array.isArray(b.logos) ? b.logos : []).forEach((l) => {
      if (!isObj(l) || typeof l.src !== 'string' || !l.src) return;
      if (!/^(data:image\/|https?:\/\/|\.{0,2}\/|blob:)/i.test(l.src) && !/^[\w./-]+\.(png|jpe?g|svg|webp|gif)$/i.test(l.src)) return;
      const id = (safeId(l.id) && !out.logos.some((x) => x.id === l.id) && l.id) || 'l_' + rid(4);
      out.logos.push({
        id,
        name: str(l.name, 60).trim() || 'Logo',
        src: l.src,
        width: num(l.width, 0, 0, 100000) || 0,
        height: num(l.height, 0, 0, 100000) || 0,
        ...logoMeta(l),
      });
    });

    // ---- voice ----
    const v = isObj(b.voice) ? b.voice : {};
    let tone = v.tone;
    if (typeof tone === 'string') tone = tone.split(',');
    out.voice = {
      tagline: str(v.tagline, 300),
      description: str(v.description != null ? v.description : out._description || ''),
      audience: str(v.audience),
      tone: (Array.isArray(tone) ? tone : []).map((t) => str(t, 40).trim()).filter(Boolean).slice(0, 12),
      useWords: str(Array.isArray(v.useWords) ? v.useWords.join(', ') : v.useWords),
      avoidWords: str(Array.isArray(v.avoidWords) ? v.avoidWords.join(', ') : v.avoidWords),
      sampleCopy: str(v.sampleCopy, 8000),
    };
    delete out._description;

    // ---- style ----
    const s = isObj(b.style) ? b.style : {};
    const r = isObj(s.radius) ? s.radius : {};
    out.style = {
      radius: { sm: num(r.sm, 6, 0, 999), md: num(r.md, 12, 0, 999), lg: num(r.lg, 24, 0, 999) },
      button: ENUMS.button.includes(s.button) ? s.button : 'rounded',
      density: ENUMS.density.includes(s.density) ? s.density : 'comfortable',
      shadow: ENUMS.shadow.includes(s.shadow) ? s.shadow : 'soft',
      gradients: (Array.isArray(s.gradients) ? s.gradients : [])
        .map((g, i) => {
          const fill = normFill(g && g.fill);
          return fill ? { name: str(g.name, 60).trim() || 'Gradient ' + (i + 1), fill } : null;
        })
        .filter(Boolean),
    };
    return out;
  }

  // =====================================================================
  //  Starter templates
  // =====================================================================
  const cr = (id) => `var(--color-${id})`;
  const lin = (angle, ...stops) => ({ type: 'linear', angle, visible: true, stops: stops.map(([color, pos]) => ({ color, pos })) });
  const mesh = (base, pts, spread = 60) => ({ type: 'mesh', base, spread, visible: true, points: pts.map(([color, x, y]) => ({ color, x, y })) });
  const rad = (cx, cy, ...stops) => ({ type: 'radial', cx, cy, visible: true, stops: stops.map(([color, pos]) => ({ color, pos })) });
  const colorsOf = (o) => Object.keys(o).map((id) => ({ id, value: o[id] }));

  const TEMPLATES = [
    {
      templateId: 'folio-violet',
      name: 'Folio Violet',
      blurb: 'Tech & SaaS — crisp, modern, confident',
      colors: [
        ...colorsOf({ primary: '#6d5efc', secondary: '#14112b', accent: '#22d3ee', background: '#ffffff', surface: '#f4f3ff', text: '#14112b', muted: '#6b6880', success: '#16a34a', danger: '#dc2626' }),
        { id: 'success', name: 'Success', value: '#16a34a' },
      ],
      fonts: [
        { id: 'heading', family: 'Bricolage Grotesque', weight: 700 },
        { id: 'body', family: 'Inter', weight: 400 },
        { id: 'code', name: 'Code', family: 'JetBrains Mono', weight: 500 },
      ],
      voice: {
        tagline: 'Ship your best ideas, faster.',
        description: 'A friendly product platform that helps small teams plan, build and launch without the busywork.',
        audience: 'Founders, product managers and developers at startups and small software teams.',
        tone: ['clear', 'confident', 'friendly', 'smart'],
        useWords: 'ship, build, simple, fast, together, launch',
        avoidWords: 'synergy, leverage, revolutionary, disrupt, best-in-class',
        sampleCopy: 'Plan it, build it, ship it.\nFolio keeps your roadmap, docs and launches in one calm place — so your team spends less time updating tools and more time making things people love.',
      },
      style: {
        radius: { sm: 8, md: 14, lg: 24 },
        button: 'rounded',
        density: 'comfortable',
        shadow: 'soft',
        gradients: [
          { name: 'Violet glow', fill: mesh(cr('primary'), [[cr('accent'), 85, 10], ['#a78bfa', 10, 15], [cr('secondary'), 20, 95], ['#c4b5fd', 90, 90]], 62) },
          { name: 'Aurora', fill: lin(135, [cr('primary'), 0], [cr('accent'), 100]) },
        ],
      },
    },
    {
      templateId: 'crumb-bakery',
      name: 'Crumb Bakery',
      blurb: 'Food & hospitality — warm, cosy, handmade',
      colors: [
        ...colorsOf({ primary: '#c2410c', secondary: '#5b2a12', accent: '#f2b33d', background: '#fff8ee', surface: '#f8e7cf', text: '#3b1f12', muted: '#8a6a58', success: '#3f7d3a', danger: '#b42318' }),
        { id: 'sage', name: 'Sage', value: '#8fa37e' },
      ],
      fonts: [
        { id: 'heading', family: 'Fraunces', weight: 700 },
        { id: 'body', family: 'DM Sans', weight: 400 },
        { id: 'script', name: 'Script', family: 'Caveat', weight: 600 },
      ],
      voice: {
        tagline: 'Baked this morning, loved all day.',
        description: 'A neighbourhood bakery making sourdough, pastries and celebration cakes by hand, every single morning.',
        audience: 'Local families, coffee lovers and anyone ordering a cake for a special day.',
        tone: ['warm', 'playful', 'homely', 'honest'],
        useWords: 'fresh, handmade, golden, slow-proved, neighbourhood, treat',
        avoidWords: 'cheap, processed, artisanal (overused), mass-produced',
        sampleCopy: 'Our ovens fire up at 4am so your croissant is still warm at 8.\nPop in, say hi, and take home something golden.',
      },
      style: {
        radius: { sm: 10, md: 18, lg: 32 },
        button: 'pill',
        density: 'airy',
        shadow: 'soft',
        gradients: [
          { name: 'Golden crust', fill: rad(30, 25, [cr('accent'), 0], [cr('primary'), 70], [cr('secondary'), 100]) },
          { name: 'Warm oven', fill: mesh(cr('background'), [[cr('accent'), 15, 20], ['#f6c7a1', 85, 15], [cr('primary'), 80, 95], [cr('surface'), 10, 85]], 58) },
        ],
      },
    },
    {
      templateId: 'northwind',
      name: 'Northwind',
      blurb: 'Corporate & finance — trustworthy, calm, precise',
      colors: colorsOf({ primary: '#1d4ed8', secondary: '#0b1f3a', accent: '#0ea5e9', background: '#ffffff', surface: '#f1f5f9', text: '#0f172a', muted: '#64748b', success: '#15803d', danger: '#b91c1c' }),
      fonts: [
        { id: 'heading', family: 'Manrope', weight: 800 },
        { id: 'body', family: 'Inter', weight: 400 },
      ],
      voice: {
        tagline: 'Clarity for every decision.',
        description: 'A consulting and financial services firm helping mid-size companies plan, grow and stay compliant.',
        audience: 'CFOs, operations leaders and business owners who value expertise and reliability.',
        tone: ['professional', 'reassuring', 'precise', 'plain-spoken'],
        useWords: 'clear, trusted, proven, partner, insight, results',
        avoidWords: 'guarantee, cheap, hack, crazy, game-changer',
        sampleCopy: 'Numbers you can trust, advice you can act on.\nFor 25 years Northwind has helped growing companies turn complex data into confident decisions.',
      },
      style: {
        radius: { sm: 4, md: 8, lg: 12 },
        button: 'rounded',
        density: 'comfortable',
        shadow: 'soft',
        gradients: [
          { name: 'Deep sea', fill: lin(160, [cr('secondary'), 0], [cr('primary'), 100]) },
          { name: 'Clear sky', fill: lin(180, [cr('surface'), 0], ['#dbeafe', 100]) },
        ],
      },
    },
    {
      templateId: 'neon-club',
      name: 'Neon Club',
      blurb: 'Events & nightlife — loud, bold, made for social',
      colors: [
        ...colorsOf({ primary: '#ff2e88', secondary: '#7c3aed', accent: '#d4ff3a', background: '#0a0a12', surface: '#1a1a26', text: '#ffffff', muted: '#a3a3c2', success: '#4ade80', danger: '#f87171' }),
        { id: 'electric', name: 'Electric blue', value: '#2ee6ff' },
      ],
      fonts: [
        { id: 'heading', family: 'Bebas Neue', weight: 400 },
        { id: 'body', family: 'Space Grotesk', weight: 500 },
        { id: 'impact', name: 'Impact', family: 'Anton', weight: 400 },
      ],
      voice: {
        tagline: 'Turn it up. All night.',
        description: 'A club night and event series with big-name DJs, immersive lights and a crowd that comes to dance.',
        audience: '18–35 music fans who find their weekend plans on Instagram and TikTok.',
        tone: ['bold', 'energetic', 'cheeky', 'inclusive'],
        useWords: 'tonight, live, drop, lineup, sold out, VIP',
        avoidWords: 'formal, maybe, event (say "night"), corporate jargon',
        sampleCopy: 'FRIDAY. 10PM. NO SLEEP.\nThe lineup just dropped — grab your tickets before they’re gone.',
      },
      style: {
        radius: { sm: 4, md: 10, lg: 20 },
        button: 'pill',
        density: 'compact',
        shadow: 'bold',
        gradients: [
          { name: 'Laser', fill: lin(120, [cr('primary'), 0], [cr('secondary'), 100]) },
          { name: 'Club haze', fill: mesh(cr('background'), [[cr('primary'), 15, 15], [cr('secondary'), 85, 25], ['#2ee6ff', 75, 90], [cr('primary'), 20, 85]], 55) },
        ],
      },
    },
  ];

  function templates() {
    return TEMPLATES.map((t) => {
      const b = normalize(t, { keepId: false });
      b.id = 't_' + t.templateId;
      b.templateId = t.templateId;
      b.blurb = t.blurb;
      return b;
    });
  }

  // =====================================================================
  //  Library persistence
  // =====================================================================
  let lib = []; // brands (live objects — treat as read-only outside this file)
  let loaded = false;
  let saveTimer = 0;
  let lastQuotaToast = 0;

  function loadLibrary() {
    let raw = null;
    try {
      raw = localStorage.getItem(LIB_KEY);
    } catch (e) {
      raw = null;
    }
    let list = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.brands) ? parsed.brands : [];
      } catch (e) {
        console.warn('[Folio] brand library is corrupted — starting fresh', e);
      }
    }
    const ids = new Set();
    lib = list.map((b) => normalize(b)).filter((b) => (ids.has(b.id) ? false : ids.add(b.id)));
    loaded = true;
  }
  function ensureLoaded() {
    if (!loaded) loadLibrary();
  }

  /** Write the library now. Returns false when the browser refused (usually storage full). */
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    try {
      localStorage.setItem(LIB_KEY, JSON.stringify({ version: 1, brands: lib }));
      return true;
    } catch (e) {
      console.warn('[Folio] could not save the brand library', e);
      const now = Date.now();
      if (now - lastQuotaToast > 4000) {
        lastQuotaToast = now;
        const quota = e && (e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(String(e.message)));
        toast(
          quota
            ? 'Brand library is full — this browser’s storage limit was reached (big logos?). Export brands as .json and remove large logos.'
            : 'Could not save the brand library in this browser (private window?). Export it as .json to keep it.',
          'error'
        );
      }
      return false;
    }
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 250);
  }

  // =====================================================================
  //  Reading
  // =====================================================================
  function library() {
    ensureLoaded();
    return lib;
  }
  function get(id) {
    ensureLoaded();
    return lib.find((b) => b.id === id) || null;
  }
  function active() {
    const s = store();
    return (s && s.doc && isObj(s.doc.brand) && s.doc.brand) || null;
  }
  const activeId = () => (active() ? active().id : null);

  // =====================================================================
  //  CSS variables
  // =====================================================================
  function fontStack(family) {
    return Folio.fonts && Folio.fonts.stack ? Folio.fonts.stack(family) : `"${family}", system-ui, sans-serif`;
  }
  function cssVars(brand) {
    const out = {};
    if (!brand) return out;
    (brand.colors || []).forEach((c) => c && c.id && c.value && (out['--color-' + c.id] = c.value));
    (brand.fonts || []).forEach((f) => f && f.id && f.family && (out['--font-' + f.id] = fontStack(f.family)));
    const r = (brand.style && brand.style.radius) || {};
    ['sm', 'md', 'lg'].forEach((k) => (out['--radius-' + k] = num(r[k], 0, 0) + 'px'));
    return out;
  }
  function cssRootBlock(brand) {
    const vars = cssVars(brand);
    const keys = Object.keys(vars);
    if (!keys.length) return ':root {\n}';
    return ':root {\n' + keys.map((k) => `  ${k}: ${vars[k]};`).join('\n') + '\n}';
  }

  let applied = new Set();
  let appliedSig = '';
  let appliedEl = null;
  /** Put the active brand's variables on #canvas-world (or `el`), removing stale ones. */
  function apply(el) {
    const target = el || document.getElementById('canvas-world');
    const b = active();
    const vars = cssVars(b);
    const sig = JSON.stringify(vars);
    if (!el) {
      if (!target) return;
      if (target === appliedEl && sig === appliedSig) return;
      if (target !== appliedEl) applied = new Set();
      appliedEl = target;
      appliedSig = sig;
    }
    const keys = Object.keys(vars);
    (el ? [] : [...applied]).forEach((k) => !(k in vars) && target.style.removeProperty(k));
    keys.forEach((k) => target.style.setProperty(k, vars[k]));
    if (!el) {
      applied = new Set(keys);
      target.dataset.brand = b ? b.id : '';
    }
    if (b && Folio.fonts && Folio.fonts.ensure) (b.fonts || []).forEach((f) => f.family && Folio.fonts.ensure(f.family));
  }

  // =====================================================================
  //  Tokens
  // =====================================================================
  function tokenOf(v) {
    if (typeof v !== 'string') return null;
    if (v.startsWith(LOGO_PREFIX)) {
      const id = v.slice(LOGO_PREFIX.length).trim();
      return id ? { kind: 'logo', id } : null;
    }
    const m = v.match(TOKEN_RE);
    return m ? { kind: m[1], id: m[2] } : null;
  }
  const isToken = (v) => !!tokenOf(v);
  const colorRef = (id) => `var(--color-${id})`;
  const fontRef = (id) => `var(--font-${id})`;
  const radiusRef = (size) => `var(--radius-${size})`;
  const logoRef = (id) => LOGO_PREFIX + id;

  /** The literal value behind a token for `brand` (default: active). undefined when it can't be resolved. */
  function literalOf(t, brand) {
    brand = brand || active();
    if (!t || !brand) return undefined;
    if (t.kind === 'color') {
      const c = (brand.colors || []).find((x) => x.id === t.id);
      return c ? c.value : undefined;
    }
    if (t.kind === 'font') {
      const f = (brand.fonts || []).find((x) => x.id === t.id);
      return f ? f.family : undefined;
    }
    if (t.kind === 'radius') {
      const r = brand.style && brand.style.radius;
      return r && r[t.id] != null ? Number(r[t.id]) : undefined;
    }
    if (t.kind === 'logo') {
      const l = (brand.logos || []).find((x) => x.id === t.id);
      return l ? l.src : undefined;
    }
    return undefined;
  }

  /** Colour token → literal colour. Non-tokens come back unchanged; unknown tokens → `fallback` (default null). */
  function resolveColor(v, fallback = null) {
    const t = tokenOf(v);
    if (!t || t.kind !== 'color') return v;
    const out = literalOf(t);
    return out !== undefined ? out : fallback;
  }
  /** Font token → family name ('Fraunces'). Non-tokens unchanged; unknown tokens → 'Inter'. */
  function resolveFont(v) {
    const t = tokenOf(v);
    if (!t || t.kind !== 'font') return v;
    const out = literalOf(t);
    return out !== undefined ? out : 'Inter';
  }
  /** Radius token → px number. Numbers/arrays unchanged; unknown tokens → 0. */
  function resolveRadius(v) {
    const t = tokenOf(v);
    if (!t || t.kind !== 'radius') return v;
    const out = literalOf(t);
    return out !== undefined ? out : 0;
  }
  /** 'brand-logo:<id>' → the logo's src ('' when missing). Other srcs unchanged. */
  function resolveSrc(src) {
    const t = tokenOf(src);
    if (!t || t.kind !== 'logo') return src;
    const out = literalOf(t);
    return out !== undefined ? out : '';
  }

  const SKIP_KEYS = new Set(['id', 'parent', 'children', 'name', 'type', 'content']);
  /** Deep copy of `v` where every string token `fn` returns a value for is replaced. */
  function mapTokens(v, fn, key) {
    if (typeof v === 'string') {
      const t = tokenOf(v);
      if (!t) return v;
      const r = fn(t, v, key);
      return r === undefined ? v : r;
    }
    if (Array.isArray(v)) return v.map((x) => mapTokens(x, fn, key));
    if (isObj(v)) {
      const o = {};
      Object.keys(v).forEach((k) => (o[k] = SKIP_KEYS.has(k) ? v[k] : mapTokens(v[k], fn, k)));
      return o;
    }
    return v;
  }
  /** Copy of any value (node, fill…) with brand tokens replaced by `brand`'s literal values. */
  function resolveDeep(v, brand) {
    return mapTokens(v, (t) => literalOf(t, brand));
  }

  /** Apply `fn(token)` to every layer in the document; patches only changed nodes. Returns count. */
  function rewriteDoc(fn) {
    const s = store();
    if (!s || !s.doc) return 0;
    const patches = {};
    Object.keys(s.doc.nodes).forEach((id) => {
      const n = s.doc.nodes[id];
      const p = {};
      ['style', 'text', 'image'].forEach((k) => {
        if (!n[k]) return;
        const before = JSON.stringify(n[k]);
        if (before.indexOf('var(') < 0 && before.indexOf(LOGO_PREFIX) < 0) return;
        const next = mapTokens(n[k], fn, k);
        if (JSON.stringify(next) !== before) p[k] = next;
      });
      if (Object.keys(p).length) patches[id] = p;
    });
    const ids = Object.keys(patches);
    if (!ids.length) return 0;
    // replace (not merge) the touched sections so arrays & strings swap cleanly
    ids.forEach((id) => Object.assign(s.doc.nodes[id], patches[id]));
    s.emit('change');
    return ids.length;
  }

  /**
   * Replace every use of `token` in the document with its literal value from `brand` (default: active).
   * Works for colours, fonts, radius tokens and 'brand-logo:<id>'. Returns the number of layers changed.
   */
  function detach(token, brand) {
    const want = tokenOf(token);
    if (!want) return 0;
    brand = brand || active();
    const lit = literalOf(want, brand);
    if (lit === undefined) return 0;
    return rewriteDoc((t) => (t.kind === want.kind && t.id === want.id ? lit : undefined));
  }
  /** Detach every brand token in the document (bake the current values in). */
  function detachAll(brand) {
    brand = brand || active();
    if (!brand) return 0;
    return rewriteDoc((t) => literalOf(t, brand));
  }

  /**
   * Switching brands: keep links that exist in the new brand (core ids always do), re-link custom
   * colours/fonts by name and logos by name or position, and bake the rest in with the old values.
   */
  function remapTokens(from, to) {
    if (!from || !to) return 0;
    const lc = (s) => String(s || '').trim().toLowerCase();
    return rewriteDoc((t) => {
      if (t.kind === 'radius') return undefined;
      if (literalOf(t, to) !== undefined) return undefined; // same id exists in the new brand
      const list = t.kind === 'color' ? from.colors : t.kind === 'font' ? from.fonts : from.logos;
      const toList = t.kind === 'color' ? to.colors : t.kind === 'font' ? to.fonts : to.logos;
      const i = (list || []).findIndex((x) => x.id === t.id);
      const old = i >= 0 ? list[i] : null;
      if (!old) return undefined;
      let match = (toList || []).find((x) => lc(x.name) === lc(old.name));
      if (!match && t.kind === 'logo') match = toList[i] || null;
      if (match) return t.kind === 'color' ? colorRef(match.id) : t.kind === 'font' ? fontRef(match.id) : logoRef(match.id);
      return literalOf(t, from);
    });
  }

  // =====================================================================
  //  Mutations (never commit — callers do)
  // =====================================================================
  const nextStamp = (prev) => Math.max(Date.now(), (Number(prev) || 0) + 1);

  /** Copy a library brand into doc.brand (when it is the active one) and tell everyone. */
  function changed(id, type) {
    const s = store();
    if (s && s.doc && id && activeId() === id) {
      const b = get(id);
      if (b) {
        s.doc.brand = clone(b);
        apply();
        s.emit('change');
      }
    }
    emit('brand', { type, id });
  }

  function create(from) {
    ensureLoaded();
    let src = from;
    if (typeof from === 'string') {
      src = templates().find((t) => t.templateId === from || t.id === from || t.name === from);
      if (!src) src = { name: from };
    }
    const b = normalize(src || {}, { keepId: false });
    b.name = uniqueName(src && src.name ? b.name : 'New brand');
    b.updatedAt = Date.now();
    lib.push(b);
    scheduleSave();
    emit('brand', { type: 'create', id: b.id });
    return b;
  }

  function uniqueName(base) {
    const names = new Set(lib.map((b) => b.name));
    if (!names.has(base)) return base;
    for (let i = 2; i < 999; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
    return base;
  }

  /**
   * Deep-merge `patch` into brand `id` (arrays are replaced). Bumps updatedAt, writes the library and
   * doc.brand (when active), emits 'brand'. Does NOT commit: call Folio.store.commit('Brand: …') after.
   */
  function update(id, patch) {
    const b = get(id);
    if (!b || !isObj(patch)) return null;
    const merged = deepMerge(clone(b), patch);
    merged.id = b.id;
    const next = normalize(merged);
    next.updatedAt = nextStamp(b.updatedAt);
    const i = lib.indexOf(b);
    lib[i] = next;
    scheduleSave();
    changed(id, 'update');
    return next;
  }

  /** Delete a brand from the library. If it is the document's active brand, layers are detached first. */
  function remove(id) {
    const b = get(id);
    if (!b) return false;
    const s = store();
    if (activeId() === id && s) {
      detachAll(s.doc.brand);
      delete s.doc.brand;
      apply();
      s.emit('change');
    }
    lib.splice(lib.indexOf(b), 1);
    flush();
    emit('brand', { type: 'remove', id });
    return true;
  }

  function duplicate(id) {
    const b = get(id);
    if (!b) return null;
    const copy = normalize(clone(b), { keepId: false });
    copy.name = uniqueName(b.name + ' copy');
    copy.updatedAt = Date.now();
    lib.splice(lib.indexOf(b) + 1, 0, copy);
    scheduleSave();
    emit('brand', { type: 'create', id: copy.id });
    return copy;
  }

  /**
   * Make brand `id` the document's active brand (copied into doc.brand). Linked layers re-skin.
   * `null` removes the brand from the document; its tokens are detached first so the design keeps
   * its look (pass {detach:false} to leave links dangling). Does not commit.
   */
  function setActive(id, opts = {}) {
    const s = store();
    if (!s || !s.doc) return null;
    const prev = active();
    if (id == null) {
      if (!prev) return null;
      if (opts.detach !== false) detachAll(prev);
      delete s.doc.brand;
      apply();
      s.emit('change');
      emit('brand', { type: 'active', id: null });
      return null;
    }
    const b = get(id);
    if (!b) return null;
    if (prev && prev.id !== b.id && opts.remap !== false) remapTokens(prev, b);
    s.doc.brand = clone(b);
    apply();
    s.emit('change');
    emit('brand', { type: 'active', id: b.id });
    return s.doc.brand;
  }

  // ---- convenience helpers (used by the brand panel; handy for AI tools) ----
  function addColor(brandId, { name = 'Colour', value = '#888888' } = {}) {
    const b = get(brandId);
    if (!b) return null;
    const c = { id: 'c_' + rid(4), name: str(name, 60) || 'Colour', value: normColor(value) || '#888888' };
    while (b.colors.some((x) => x.id === c.id)) c.id = 'c_' + rid(4);
    update(brandId, { colors: [...b.colors, c] });
    return c;
  }
  function setColor(brandId, colorId, patch) {
    const b = get(brandId);
    if (!b) return null;
    const colors = b.colors.map((c) => {
      if (c.id !== colorId) return c;
      const n = { ...c };
      if (patch.name != null) n.name = str(patch.name, 60).trim() || c.name;
      if (patch.value != null) n.value = normColor(patch.value) || c.value;
      return n;
    });
    return update(brandId, { colors });
  }
  /** Remove a custom colour (core colours can't be removed). Linked layers are detached first. */
  function removeColor(brandId, colorId) {
    const b = get(brandId);
    const c = b && b.colors.find((x) => x.id === colorId);
    if (!c || c.core) return false;
    if (activeId() === brandId) detach(colorRef(colorId));
    update(brandId, { colors: b.colors.filter((x) => x.id !== colorId) });
    return true;
  }
  function addFont(brandId, { name, family = 'Inter', weight = 400 } = {}) {
    const b = get(brandId);
    if (!b) return null;
    const f = { id: 'f_' + rid(4), name: str(name || family, 60), family, weight };
    while (b.fonts.some((x) => x.id === f.id)) f.id = 'f_' + rid(4);
    update(brandId, { fonts: [...b.fonts, f] });
    return f;
  }
  function setFont(brandId, fontId, patch) {
    const b = get(brandId);
    if (!b) return null;
    return update(brandId, { fonts: b.fonts.map((f) => (f.id === fontId ? { ...f, ...patch, id: f.id, core: f.core } : f)) });
  }
  function removeFont(brandId, fontId) {
    const b = get(brandId);
    const f = b && b.fonts.find((x) => x.id === fontId);
    if (!f || f.core) return false;
    if (activeId() === brandId) detach(fontRef(fontId));
    update(brandId, { fonts: b.fonts.filter((x) => x.id !== fontId) });
    return true;
  }
  function removeLogo(brandId, logoId) {
    const b = get(brandId);
    if (!b || !b.logos.some((l) => l.id === logoId)) return false;
    if (activeId() === brandId) detach(logoRef(logoId));
    update(brandId, { logos: b.logos.filter((l) => l.id !== logoId) });
    return true;
  }
  /**
   * Add an already-prepared logo {name, src, width, height, version?, group?}. Returns the logo (with id).
   * src may be an internal data:image/svg+xml URL from Folio.svg (sanitized by the caller).
   */
  function addLogoSrc(brandId, { name = 'Logo', src, width = 0, height = 0, ...meta } = {}) {
    const b = get(brandId);
    if (!b || typeof src !== 'string' || !src) return null;
    if (src.length > LOGO_MAX_BYTES) throw new Error('That logo is too large (over 1.5 MB). Try a smaller file or an SVG.');
    const logo = { id: 'l_' + rid(4), name: str(name, 60) || 'Logo', src, width: Math.round(width) || 0, height: Math.round(height) || 0, ...logoMeta(meta) };
    while (b.logos.some((x) => x.id === logo.id)) logo.id = 'l_' + rid(4);
    update(brandId, { logos: [...b.logos, logo] });
    return logo;
  }

  // ---- logo upload: raster → max 1024px via canvas, SVG kept as text ----
  function readAs(file, how) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read that file.'));
      if (how === 'text') r.readAsText(file);
      else r.readAsDataURL(file);
    });
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file doesn’t look like an image Folio can read.'));
      img.src = src;
    });
  }
  function svgSize(text) {
    const open = (text.match(/<svg\b[^>]*>/i) || [''])[0];
    const attr = (name) => parseFloat((open.match(new RegExp('\\s' + name + '\\s*=\\s*["\']?\\s*([\\d.]+)(?:px)?["\'\\s/>]', 'i')) || [])[1]);
    let w = attr('width');
    let h = attr('height');
    const vb = open.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (!(w > 0 && h > 0) && vb) {
      w = parseFloat(vb[1]);
      h = parseFloat(vb[2]);
    }
    return { width: w > 0 ? w : 0, height: h > 0 ? h : 0 };
  }
  const baseName = (n) => String(n || 'Logo').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 60) || 'Logo';

  /** Prepare an image File for the brand kit → Promise<{name, src, width, height}> (no library change). */
  async function prepareLogo(file) {
    if (!file) throw new Error('No file.');
    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || '');
    if (isSvg) {
      let text = String(await readAs(file, 'text'));
      if (!/<svg[\s>]/i.test(text)) throw new Error('That SVG file looks broken.');
      if (Folio.svg) text = Folio.svg.sanitize(text).svg; // uploads get the same whitelist as Claude's drafts
      const src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
      if (src.length > LOGO_MAX_BYTES) throw new Error('That SVG is too large (over 1.5 MB).');
      let { width, height } = svgSize(text);
      if (!(width && height)) {
        try {
          const img = await loadImage(src);
          width = img.naturalWidth || 300;
          height = img.naturalHeight || 150;
        } catch (e) {
          width = 300;
          height = 150;
        }
      }
      return { name: baseName(file.name), src, width, height };
    }
    if (file.type && !/^image\//.test(file.type)) throw new Error('Please choose an image (PNG, JPG, SVG, WebP or GIF).');
    const original = String(await readAs(file, 'dataurl'));
    const img = await loadImage(original);
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (!w || !h) throw new Error('That image has no size.');
    const scale = Math.min(1, LOGO_MAX_SIDE / Math.max(w, h));
    if (scale === 1 && original.length <= LOGO_MAX_BYTES) return { name: baseName(file.name), src: original, width: w, height: h };
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const jpeg = /jpe?g/i.test(file.type);
    let src = canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9);
    if (src.length > LOGO_MAX_BYTES) {
      const webp = canvas.toDataURL('image/webp', 0.9);
      if (webp.startsWith('data:image/webp') && webp.length < src.length) src = webp;
    }
    if (src.length > LOGO_MAX_BYTES) throw new Error('That logo is still over 1.5 MB after resizing. Try an SVG or a simpler PNG.');
    return { name: baseName(file.name), src, width: w, height: h };
  }

  /** Upload a logo File into brand `brandId` → Promise<logo>. Rejects with a friendly Error. */
  async function addLogo(brandId, file) {
    if (!get(brandId)) throw new Error('That brand no longer exists.');
    const prepared = await prepareLogo(file);
    return addLogoSrc(brandId, prepared);
  }

  // ---- import / export ----
  function exportJson(id) {
    const b = get(id) || (active() && active().id === id ? active() : null);
    if (!b) return null;
    return JSON.stringify({ folioBrand: 1, brand: b }, null, 2);
  }

  /**
   * Import brand JSON (one brand, {brand}, {brands:[…]} or an array). A brand whose id already exists
   * replaces the library copy only when it is newer. Returns the library brands. Throws a friendly Error.
   */
  function importJson(text) {
    ensureLoaded();
    let data;
    try {
      data = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (e) {
      throw new Error('That file is not valid JSON.');
    }
    let list = Array.isArray(data) ? data : data && Array.isArray(data.brands) ? data.brands : data && isObj(data.brand) ? [data.brand] : isObj(data) && data.doc && isObj(data.doc.brand) ? [data.doc.brand] : [data];
    list = list.filter((b) => isObj(b) && !b.nodes && (b.name || b.colors || b.fonts));
    if (!list.length) throw new Error('No brand kit found in that file.');
    const out = [];
    list.forEach((raw) => {
      const b = normalize(raw);
      if (!raw.updatedAt) b.updatedAt = Date.now();
      const existing = get(b.id);
      if (!existing) {
        lib.push(b);
        out.push(b);
      } else if (b.updatedAt > existing.updatedAt) {
        lib[lib.indexOf(existing)] = b;
        out.push(b);
        if (activeId() === b.id) changed(b.id, 'update');
      } else out.push(existing);
    });
    flush();
    emit('brand', { type: 'import', ids: out.map((b) => b.id) });
    return out;
  }

  // =====================================================================
  //  Document ⇄ library sync
  // =====================================================================
  /** Called for a newly loaded document: newer updatedAt wins; unknown brands join the library. */
  function syncDoc() {
    const s = store();
    if (!s || !s.doc) return;
    const raw = s.doc.brand;
    let docChanged = false;
    if (raw != null && !isObj(raw)) {
      delete s.doc.brand;
      docChanged = true;
    } else if (raw) {
      const nb = normalize(raw);
      if (JSON.stringify(nb) !== JSON.stringify(raw)) {
        s.doc.brand = nb;
        docChanged = true;
      }
      const libB = get(nb.id);
      if (!libB) {
        lib.push(clone(nb));
        scheduleSave();
      } else if (libB.updatedAt > nb.updatedAt) {
        s.doc.brand = clone(libB);
        docChanged = true;
      } else if (nb.updatedAt > libB.updatedAt) {
        lib[lib.indexOf(libB)] = clone(nb);
        scheduleSave();
      }
    }
    if (docChanged) {
      // The loaded snapshot is the current undo step: refresh it so undo can't bring the stale copy back.
      if (s.history && s.history[s.historyIndex] != null) s.history[s.historyIndex] = JSON.stringify(s.doc);
      s.scheduleSave && s.scheduleSave();
      s.emit('change');
    }
    apply();
    emit('brand', { type: 'doc', id: activeId() });
  }

  /** After undo/redo: the restored doc.brand is the truth; write it back to the library. */
  function syncFromHistory() {
    const b = active();
    if (!b) {
      apply();
      emit('brand', { type: 'history', id: null });
      return;
    }
    const libB = get(b.id);
    if (!libB) lib.push(clone(b));
    else if (JSON.stringify(libB) !== JSON.stringify(b)) lib[lib.indexOf(libB)] = clone(b);
    else {
      apply();
      return;
    }
    flush();
    apply();
    emit('brand', { type: 'history', id: b.id });
  }

  let inited = false;
  let lastHistory = null;
  function init() {
    ensureLoaded();
    const s = store();
    if (!s) return;
    if (!inited) {
      inited = true;
      lastHistory = s.history;
      s.on('change', () => apply());
      s.on('doc', () => syncDoc());
      s.on('history', (label) => {
        const arr = s.history;
        const isNewArray = arr !== lastHistory;
        lastHistory = arr;
        if (label !== undefined) {
          // a commit: make sure a pending library write lands with it
          if (saveTimer) flush();
          return;
        }
        if (isNewArray) return; // store.load(): handled by the 'doc' event that follows
        syncFromHistory(); // undo / redo
      });
      window.addEventListener('storage', (e) => {
        if (e.key !== LIB_KEY) return;
        loadLibrary();
        emit('brand', { type: 'library' });
      });
      window.addEventListener('pagehide', () => saveTimer && flush());
      window.addEventListener('beforeunload', () => saveTimer && flush());
    }
    syncDoc();
  }

  Folio.brand = {
    init,
    // reading
    library,
    active,
    get,
    templates,
    roles: ROLES,
    coreColorIds: CORE_COLORS.map((c) => c.id),
    coreFontIds: CORE_FONTS.map((f) => f.id),
    // mutations (never commit)
    create,
    update,
    remove,
    duplicate,
    setActive,
    addColor,
    setColor,
    removeColor,
    addFont,
    setFont,
    removeFont,
    addLogo,
    addLogoSrc,
    prepareLogo,
    removeLogo,
    exportJson,
    importJson,
    // css
    cssVars,
    cssRootBlock,
    apply,
    // tokens
    isToken,
    tokenOf,
    resolveColor,
    resolveFont,
    resolveRadius,
    resolveSrc,
    resolveDeep,
    colorRef,
    fontRef,
    radiusRef,
    logoRef,
    detach,
    detachAll,
    // misc
    normalize,
    normColor,
    flush,
    LOGO_MAX_BYTES,
  };
})();
