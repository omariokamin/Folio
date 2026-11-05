/* Test stub of Folio.brand following SPEC "Brand kit (v0.3)". Only used by .dev tests. */
window.Folio = window.Folio || {};
(function () {
  const store = Folio.store;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const LOGO_SVG = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" rx="8" fill="#c2410c"/><text x="60" y="27" font-size="20" text-anchor="middle" fill="#fff" font-family="Arial">CRUMB</text></svg>');
  const LOGO2_SVG = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" rx="8" fill="#1d4ed8"/><text x="60" y="27" font-size="20" text-anchor="middle" fill="#fff" font-family="Arial">NEW</text></svg>');
  Folio.__LOGO2 = LOGO2_SVG;
  const TEMPLATE = {
    name: 'Crumb Bakery',
    colors: [
      { id: 'primary', name: 'Primary', value: '#c2410c', core: true },
      { id: 'secondary', name: 'Secondary', value: '#1e3a8a', core: true },
      { id: 'accent', name: 'Accent', value: '#f59e0b', core: true },
      { id: 'background', name: 'Background', value: '#fff7ed', core: true },
      { id: 'surface', name: 'Surface', value: '#ffffff', core: true },
      { id: 'text', name: 'Text', value: '#1c1917', core: true },
      { id: 'muted', name: 'Muted', value: '#78716c', core: true },
      { id: 'c_ab12', name: 'Crust', value: '#92400e' },
    ],
    fonts: [
      { id: 'heading', name: 'Heading', family: 'Fraunces', weight: 700, core: true },
      { id: 'body', name: 'Body', family: 'DM Sans', weight: 400, core: true },
    ],
    logos: [{ id: 'l_ab12', name: 'Logo — on light', src: LOGO_SVG, width: 120, height: 40 }],
    voice: { tagline: 'Fresh daily', description: '', audience: '', tone: ['warm'], useWords: '', avoidWords: '', sampleCopy: '' },
    style: {
      radius: { sm: 6, md: 12, lg: 24 }, button: 'pill', density: 'comfortable', shadow: 'soft',
      gradients: [
        { name: 'Sunrise', fill: { type: 'linear', angle: 135, stops: [{ color: 'var(--color-primary)', pos: 0 }, { color: 'var(--color-accent)', pos: 100 }] } },
        { name: 'Dough', fill: { type: 'mesh', base: 'var(--color-background)', spread: 60, points: [{ color: 'var(--color-accent)', x: 12, y: 18 }, { color: '#fde68a', x: 88, y: 12 }, { color: 'var(--color-primary)', x: 82, y: 88 }, { color: '#fdba74', x: 18, y: 82 }] } },
      ],
    },
  };
  let lib = [];
  const RE = /^var\(--(color|font|radius)-([\w-]+)\)$/;
  function active() { return store.doc.brand || null; }
  function get(id) { return lib.find((b) => b.id === id) || null; }
  function cssVars(b) {
    const o = {};
    if (!b) return o;
    (b.colors || []).forEach((c) => (o['--color-' + c.id] = c.value));
    (b.fonts || []).forEach((f) => (o['--font-' + f.id] = Folio.fonts.stack(f.family)));
    const r = (b.style && b.style.radius) || {};
    ['sm', 'md', 'lg'].forEach((k) => r[k] != null && (o['--radius-' + k] = r[k] + 'px'));
    return o;
  }
  function cssRootBlock(b) {
    const v = cssVars(b);
    return ':root {\n' + Object.entries(v).map(([k, x]) => `  ${k}: ${x};`).join('\n') + '\n}';
  }
  let applied = '';
  function apply() {
    const w = document.getElementById('canvas-world');
    if (!w) return;
    const v = cssVars(active());
    const key = JSON.stringify(v);
    if (key === applied) return;
    [...w.style].filter((p) => p.startsWith('--')).forEach((p) => w.style.removeProperty(p));
    Object.entries(v).forEach(([k, x]) => w.style.setProperty(k, x));
    applied = key;
  }
  function tokenOf(v) { const m = typeof v === 'string' && v.trim().match(RE); return m ? { kind: m[1], id: m[2] } : null; }
  function resolveColor(v) {
    const t = tokenOf(v); if (!t || t.kind !== 'color') return v;
    const b = active(); const c = b && b.colors.find((x) => x.id === t.id); return c ? c.value : v;
  }
  function resolveFont(v) {
    const t = tokenOf(v); if (!t || t.kind !== 'font') return v;
    const b = active(); const f = b && b.fonts.find((x) => x.id === t.id); return f ? f.family : v;
  }
  function resolveSrc(src) {
    if (typeof src !== 'string' || !src.startsWith('brand-logo:')) return src;
    const b = active(); const l = b && b.logos.find((x) => x.id === src.slice(11)); return l ? l.src : '';
  }
  function update(id, patch) {
    const b = get(id); if (!b) return;
    Folio.util.deepMerge(b, patch); b.updatedAt = Date.now();
    if (active() && active().id === id) store.doc.brand = clone(b);
    apply(); store.emit('brand');
  }
  function create(p) { const b = Object.assign(clone(TEMPLATE), clone(p || {}), { id: 'b_' + Math.random().toString(36).slice(2, 8), updatedAt: Date.now() }); lib.push(b); return b; }
  function setActive(id) { const b = id ? get(id) : null; store.doc.brand = b ? clone(b) : null; if (!b) delete store.doc.brand; apply(); store.emit('brand'); store.emit('change'); }
  function detach(tok) {
    const t = tokenOf(tok); if (!t) return;
    const b = active(); if (!b) return;
    const lit = t.kind === 'color' ? resolveColor(tok) : t.kind === 'font' ? resolveFont(tok) : (b.style.radius[t.id] || 0);
    const walk = (o) => { for (const k in o) { if (o[k] === tok) o[k] = lit; else if (o[k] && typeof o[k] === 'object') walk(o[k]); } };
    Object.values(store.doc.nodes).forEach(walk); store.emit('change');
  }
  function init() {
    if (store.doc.brand && !get(store.doc.brand.id)) lib.push(clone(store.doc.brand));
    apply();
    ['change', 'doc', 'history'].forEach((e) => store.on(e, apply));
  }
  Folio.brand = {
    __stub: true, init, library: () => lib, active, get, templates: () => [clone(TEMPLATE)], create, update,
    remove: (id) => (lib = lib.filter((b) => b.id !== id)), duplicate: (id) => create(get(id)), setActive,
    exportJson: (id) => JSON.stringify(get(id)), importJson: (t) => create(JSON.parse(t)),
    cssVars, cssRootBlock, isToken: (v) => !!tokenOf(v), tokenOf, resolveColor, resolveFont, resolveSrc,
    colorRef: (id) => `var(--color-${id})`, fontRef: (id) => `var(--font-${id})`, detach,
  };
})();
