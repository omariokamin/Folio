// Tailwind fidelity: every demo artboard (+ a brand-linked kitchen-sink artboard) rendered from
// Folio.tailwind.pageFor vs Folio.exporter.pageFor, pixel-compared in Chromium.
// run: node .dev/tailwind/fidelity.js [base]   (serve the repo on :8191)   FONTS=1 lets Google Fonts load
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const base = process.argv[2] || 'http://localhost:8191';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const TW = fs.readFileSync(path.join(__dirname, 'vendor/package/dist/index.global.js'), 'utf8');
const H2I = '/home/user/folio/.dev/aitest/vendor/package/dist/html-to-image.js';
const LIMIT = Number(process.env.LIMIT || 0.1); // % of pixels allowed to differ (anti-aliasing)
let fails = 0;

async function routes(ctx) {
  await ctx.route('https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3', (r) => r.fulfill({ contentType: 'text/javascript', body: TW }));
  await ctx.route('https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(H2I, 'utf8') }));
  if (!process.env.FONTS) await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/^https:\/\/(images\.unsplash\.com|picsum\.photos)/, (r) => r.abort());
  await ctx.route('https://folio.test/**', (r) => r.fulfill({ contentType: 'text/html', body: pages[new URL(r.request().url()).pathname.slice(1)] }));
}
const pages = {};

(async () => {
  const browser = await chromium.launch(process.env.FONTS ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await routes(ctx);
  const app = await ctx.newPage();
  const errors = [];
  app.on('pageerror', (e) => errors.push(String(e)));
  await app.goto(base + '/index.html');
  await app.evaluate(() => localStorage.clear());
  await app.reload();
  await app.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  const boards = await app.evaluate(() => {
    const S = Folio.store, B = Folio.brand;
    B.setActive(B.create(B.templates()[0]).id);
    const img = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#3b82f6"/><circle cx="20" cy="15" r="10" fill="#f59e0b"/></svg>');
    S.buildFromTree({
      type: 'frame', name: 'Kitchen sink', x: 0, y: 4000, width: 720, sizing: { w: 'fixed', h: 'hug' },
      layout: { mode: 'flex', direction: 'column', gap: 18, padding: [40, 36, 44, 30], align: 'flex-start' },
      style: { fills: [{ type: 'solid', color: 'var(--color-background)' }] },
      children: [
        { type: 'text', name: 'Title', sizing: { w: 'fill', h: 'hug' }, text: { content: 'Brand {tokens} <b> & co', font: 'var(--font-heading)', size: 48, weight: 700, lineHeight: 1, color: 'var(--color-primary)' } },
        { type: 'text', name: 'Body', sizing: { w: 'fill', h: 'hug' }, text: { content: 'Line one\nLine  two, italic + underline', font: 'var(--font-body)', size: 17, weight: 450, lineHeight: 1.45, letterSpacing: -0.02, color: '#334155cc', italic: true, decoration: 'underline', align: 'center' } },
        { type: 'text', name: 'Caps', text: { content: 'eyebrow', font: 'Inter', size: 12, weight: 600, lineHeight: 1.2, letterSpacing: 0.12, color: 'var(--color-muted)', transform: 'uppercase' } },
        { type: 'frame', name: 'Row', sizing: { w: 'fill', h: 'hug' }, layout: { mode: 'flex', direction: 'row', gap: 10, padding: [12, 18, 12, 18], justify: 'space-between', align: 'center', wrap: true },
          style: { fills: [{ type: 'solid', color: 'var(--color-surface)' }], radius: 'var(--radius-md)', border: { width: 1, color: 'var(--color-muted)', style: 'dashed' }, shadows: [{ x: 0, y: 10, blur: 28, spread: -6, color: '#6d5efc80' }, { x: 0, y: 1, blur: 0, spread: 0, color: '#ffffff80', inset: true }] },
          children: [
            { type: 'frame', name: 'Pill', width: 120, height: 36, style: { fills: [{ type: 'solid', color: 'var(--color-primary)' }], radius: 9999, opacity: 0.85 } },
            { type: 'frame', name: 'Corners', width: 90, height: 50, style: { fills: [{ type: 'linear', angle: 135, stops: [{ color: 'var(--color-accent)', pos: 0 }, { color: '#0ea5e9', pos: 100 }] }], radius: [16, 0, 7, 3], rotation: -7.5 } },
            { type: 'frame', name: 'Blurred', width: 50, height: 50, style: { fills: [{ type: 'solid', color: 'rgba(255, 0, 80, 0.6)' }], blur: 3, blend: 'multiply', radius: 'var(--radius-sm)' } },
            { type: 'frame', name: 'Grow', sizing: { w: 'fill', h: 'fixed' }, height: 40, style: { fills: [{ type: 'solid', color: '#10b981' }], border: { width: 3, color: '#064e3b', style: 'dotted' } } },
          ] },
        { type: 'frame', name: 'Free', width: 660, height: 170, layout: { mode: 'none' }, style: { fills: [{ type: 'mesh', base: '#1e1b4b', spread: 60, points: [{ color: '#f472b6', x: 10, y: 20 }, { color: '#22d3ee', x: 80, y: 30 }, { color: '#a3e635', x: 30, y: 90 }, { color: '#facc15', x: 90, y: 85 }] }, { type: 'noise', opacity: 0.12 }], clip: true, radius: 'var(--radius-lg)' },
          children: [
            { type: 'frame', name: 'Glass', x: -18, y: 17, width: 260, height: 110, style: { fills: [{ type: 'linear', angle: 160, stops: [{ color: '#ffffff47', pos: 0 }, { color: '#ffffff14', pos: 100 }] }], backdropBlur: 24, backdropSaturate: 180, radius: 24, border: { width: 1, color: '#ffffff59', style: 'solid' } } },
            { type: 'image', name: 'Pic', x: 300, y: 20, width: 400, height: 130, image: { src: img, fit: 'cover' }, style: { radius: 12, adjust: { brightness: 110, contrast: 120, saturate: 140 } } },
            { type: 'text', name: 'Shadowed', x: 21, y: 135, text: { content: 'Text shadow', font: 'DM Sans', size: 22, weight: 800, lineHeight: 1.3, color: '#ffffff', }, style: { shadows: [{ x: 0, y: 2, blur: 6, color: '#000000aa' }] } },
          ] },
        { type: 'frame', name: 'Column', width: 300, sizing: { w: 'fixed', h: 'hug' }, layout: { mode: 'flex', direction: 'column', gap: 6, padding: [10, 10, 10, 10] }, style: { fills: [{ type: 'solid', color: '#e2e8f0' }] },
          children: [
            { type: 'text', name: 'A', sizing: { w: 'fill', h: 'hug' }, text: { content: 'Hug column', size: 14, lineHeight: 1.4, color: '#0f172a' } },
            { type: 'frame', name: 'Fill H', sizing: { w: 'fill', h: 'fill' }, height: 40, layout: { mode: 'flex', direction: 'column', padding: [8, 8, 8, 8] }, style: { fills: [{ type: 'solid', color: '#94a3b8' }] },
              children: [{ type: 'text', name: 'In', text: { content: 'fill height', size: 13, lineHeight: 1.4, color: '#fff' } }] },
          ] },
      ],
    });
    S.commit('kitchen sink');
    return S.doc.roots.map((id) => ({ id, name: S.get(id).name, css: Folio.exporter.pageFor(id), tw: Folio.tailwind.pageFor(id) }));
  });

  const view = await ctx.newPage();
  const shot = async (key, html) => {
    pages[key] = html;
    await view.goto('https://folio.test/' + key);
    if (/tailwindcss/.test(html)) await view.waitForFunction(() => [...document.querySelectorAll('style')].some((s) => /--tw-|tailwindcss v4/.test(s.textContent)));
    await view.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))); });
    await view.waitForTimeout(150);
    return view.locator('body > :first-child').screenshot();
  };
  const cmp = await ctx.newPage();
  await cmp.setContent('<canvas></canvas>');
  for (const b of boards) {
    const a = await shot(b.id + '-css.html', b.css);
    const t = await shot(b.id + '-tw.html', b.tw);
    fs.writeFileSync(path.join(OUT, b.name.replace(/\W+/g, '_') + '-css.png'), a);
    fs.writeFileSync(path.join(OUT, b.name.replace(/\W+/g, '_') + '-tw.png'), t);
    fs.writeFileSync(path.join(OUT, b.name.replace(/\W+/g, '_') + '-tw.html'), b.tw);
    const r = await cmp.evaluate(async ([a, t]) => {
      const load = async (b64) => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode(); return i; };
      const [ia, it] = [await load(a), await load(t)];
      if (ia.width !== it.width || ia.height !== it.height) return { size: [ia.width, ia.height, it.width, it.height] };
      const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
      const [da, dt] = [px(ia), px(it)];
      let diff = 0, first = null;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - dt[i]), Math.abs(da[i + 1] - dt[i + 1]), Math.abs(da[i + 2] - dt[i + 2]));
        if (d > 24) { diff++; if (!first) first = [(i / 4) % ia.width, Math.floor(i / 4 / ia.width)]; }
      }
      return { w: ia.width, h: ia.height, pct: (100 * diff) / (da.length / 4), first };
    }, [a.toString('base64'), t.toString('base64')]);
    const good = r.pct !== undefined && r.pct <= LIMIT;
    if (!good) fails++;
    console.log(`${good ? '  ok  ' : '  FAIL'} ${b.name}: ${r.size ? 'size differs ' + JSON.stringify(r.size) : `${r.w}x${r.h}, ${r.pct.toFixed(4)}% pixels differ` + (r.first ? ' first at ' + r.first : '')}`);
  }
  if (errors.length) { fails++; console.log('  FAIL page errors', errors); }
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
