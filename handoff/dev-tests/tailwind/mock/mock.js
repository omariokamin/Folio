// Mock run: a branded hero built by tools, then shown in the Tailwind tab (HTML + React) and as the rendered Tailwind page.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const OUT = __dirname, base = 'http://localhost:8191';
const TW = fs.readFileSync(fs.readdirSync(path.join(__dirname, '../vendor'), { recursive: true }).map((f) => path.join(__dirname, '../vendor', f)).find((f) => /index\.global\.js$/.test(f)), 'utf8');
(async () => {
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
  await ctx.route('https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3', (r) => r.fulfill({ contentType: 'text/javascript', body: TW }));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(base + '/index.html');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  const call = (n, i) => page.evaluate(([n, i]) => Folio.aiTools.execute(n, i), [n, i]);
  await page.evaluate(() => Folio.store.newDoc());
  let r = await call('set_brand', { create: true, patch: { name: 'Tidewater Coffee',
    colors: { primary: '#0f5c63', 'on-primary': '#f4efe6', secondary: '#1d2a2e', accent: '#e9a23b', background: '#f4efe6', surface: '#ffffff', text: '#1d2a2e', muted: '#5f6f73' },
    fonts: { heading: { family: 'Fraunces', weight: 600 }, body: 'DM Sans' }, style: { radius: { sm: 6, md: 14, lg: 28 } } } });
  console.log('brand', r.isError ? r.content : 'ok');
  r = await call('create_nodes', { nodes: [{ type: 'frame', name: 'Hero', x: 0, y: 0, width: 720, sizing: { h: 'hug' },
    layout: { mode: 'flex', direction: 'column', gap: 24, padding: [56, 56, 56, 56] },
    style: { fills: [{ type: 'mesh', preset: 'Lagoon' }], radius: 'var(--radius-lg)' },
    children: [
      { type: 'text', name: 'Eyebrow', text: { content: 'SMALL-BATCH ROASTERY', font: 'var(--font-body)', size: 12, weight: 600, letterSpacing: 0.12, color: 'var(--color-primary)' } },
      { type: 'text', name: 'Headline', sizing: { w: 'fill' }, text: { content: 'Coffee roasted on the coast, at your door by Friday.', font: 'var(--font-heading)', size: 48, weight: 600, lineHeight: 1.1, color: 'var(--color-text)' } },
      { type: 'text', name: 'Lede', sizing: { w: 'fill' }, text: { content: 'Fresh beans every two weeks. Pause or skip whenever you like.', font: 'var(--font-body)', size: 18, lineHeight: 1.5, color: 'var(--color-muted)' } },
      { type: 'frame', name: 'Actions', layout: { mode: 'flex', direction: 'row', gap: 12 }, children: [
        { type: 'frame', name: 'Button / Primary', layout: { mode: 'flex', padding: [14, 24] }, style: { fills: [{ type: 'solid', color: 'var(--color-primary)' }], radius: 9999 },
          children: [{ type: 'text', name: 'Label', text: { content: 'Start a subscription', font: 'var(--font-body)', size: 16, weight: 600, color: 'var(--color-on-primary)' } }] },
        { type: 'frame', name: 'Button / Glass', layout: { mode: 'flex', padding: [14, 24] }, style: { effect: 'liquid-glass', radius: 9999 },
          children: [{ type: 'text', name: 'Label', text: { content: 'See the beans', font: 'var(--font-body)', size: 16, weight: 600, color: 'var(--color-text)' } }] },
      ] },
    ] }] });
  console.log('create', r.isError ? r.content : 'ok');
  const id = await page.evaluate(() => Folio.store.doc.roots[0]);
  await page.evaluate((id) => { Folio.store.commit('mock'); Folio.store.select([id]); Folio.codePanel.toggle(true); }, id);
  await page.click('.cp__tab[data-tab="tailwind"]');
  await page.click('.cp__tw-format [data-tw-format="html"]');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, '1-tailwind-html.png') });
  await page.click('.cp__tw-format [data-tw-format="react"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '2-tailwind-react.png') });
  const code = await page.evaluate((id) => ({ theme: Folio.tailwind.themeFor(id), html: Folio.tailwind.htmlFor(id), jsx: Folio.tailwind.jsxFor(id), pg: Folio.tailwind.pageFor(id) }), id);
  fs.writeFileSync(path.join(OUT, 'Hero.jsx'), code.theme + '\n\n' + code.jsx);
  fs.writeFileSync(path.join(OUT, 'Hero.tailwind.html'), code.pg);
  const p2 = await ctx.newPage();
  await p2.setViewportSize({ width: 820, height: 640 });
  await p2.setContent(code.pg, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(1200);
  await p2.screenshot({ path: path.join(OUT, '3-rendered-tailwind.png') });
  console.log(code.theme); console.log(code.html.slice(0, 1400));
  console.log('errors', errs);
  await browser.close();
})();
