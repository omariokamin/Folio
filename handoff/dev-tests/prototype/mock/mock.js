// Prototyping mock run: a 3-screen coffee app + menu sheet, wired, then played.
const { chromium } = require('playwright');
const path = require('path');
const OUT = __dirname, base = 'http://localhost:8191', wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(base + '/index.html');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  await page.evaluate(() => Folio.store.newDoc());
  await page.evaluate(() => Folio.aiTools.execute('set_brand', { create: true, patch: { name: 'Tidewater Coffee',
    colors: { primary: '#0f5c63', 'on-primary': '#f4efe6', secondary: '#1d2a2e', accent: '#e9a23b', background: '#f4efe6', surface: '#ffffff', text: '#1d2a2e', muted: '#5f6f73' },
    fonts: { heading: { family: 'Fraunces', weight: 600 }, body: 'DM Sans' }, style: { radius: { sm: 8, md: 16, lg: 28 } } } }));
  const ids = await page.evaluate(() => {
    const s = Folio.store, K = Folio.components;
    const solid = (c) => [{ type: 'solid', color: c }];
    const col = (o = {}) => ({ mode: 'flex', direction: 'column', gap: 16, padding: [24, 24, 24, 24], justify: 'flex-start', align: 'stretch', ...o });
    const row = (o = {}) => ({ mode: 'flex', direction: 'row', gap: 12, padding: 0, justify: 'space-between', align: 'center', ...o });
    const T = (name, content, o = {}) => ({ type: 'text', name, sizing: { w: o.w || 'hug' }, text: { content, font: o.font || 'var(--font-body)', size: o.size || 16, weight: o.weight || 400, lineHeight: o.lh || 1.4, color: o.color || 'var(--color-text)' } });
    // Button component with a Hover variant
    const C = s.buildFromTree({ type: 'frame', name: 'Components', x: 0, y: 1000, width: 700, sizing: { w: 'fixed', h: 'hug' }, layout: col({ direction: 'row' }), style: { fills: solid('#ffffff') } });
    const btn = s.buildFromTree({ type: 'frame', name: 'Button', sizing: { w: 'hug', h: 'hug' }, layout: { mode: 'flex', direction: 'row', padding: [16, 24, 16, 24], justify: 'center', align: 'center' }, style: { fills: solid('var(--color-primary)'), radius: 9999 },
      children: [T('Label', 'Order now', { weight: 600, color: 'var(--color-on-primary)' })] }, C.id);
    const comp = K.create([btn.id], { name: 'Button' });
    K.addVariant(comp.id, { State: 'Hover' });
    const hov = K.variantsOf(comp.id).find((c) => /hover/i.test(c.variant.State));
    s.update(hov.mainId, { style: { fills: solid('var(--color-accent)'), shadows: [{ x: 0, y: 8, blur: 24, spread: -6, color: '#e9a23b99', inset: false, visible: true }] } });
    K.flush();
    const screen = (name, x, children, extra = {}) => s.buildFromTree({ type: 'frame', name, x, y: 0, width: 390, height: 844, layout: col({ gap: 20, padding: [56, 24, 32, 24] }), style: { fills: solid('var(--color-background)') }, children, ...extra });
    const card = (name, price, tint) => ({ type: 'frame', name: 'Card / ' + name, sizing: { w: 'fill', h: 'hug' }, layout: row({ padding: [16, 16, 16, 16] }), style: { fills: solid('var(--color-surface)'), radius: 'var(--radius-md)' },
      children: [{ type: 'frame', name: 'Swatch', width: 56, height: 56, style: { fills: solid(tint), radius: 'var(--radius-sm)' } }, { type: 'frame', name: 'Info', sizing: { w: 'fill', h: 'hug' }, layout: { mode: 'flex', direction: 'column', gap: 4 }, children: [T('Name', name, { weight: 600 }), T('Notes', 'Whole bean · 250 g', { size: 13, color: 'var(--color-muted)' })] }, T('Price', price, { weight: 600, color: 'var(--color-primary)' })] });
    const home = screen('Home', 0, [
      { type: 'frame', name: 'Top bar', sizing: { w: 'fill', h: 'hug' }, layout: row(), style: { fills: [] }, children: [T('Brand', 'Tidewater', { font: 'var(--font-heading)', size: 22, weight: 600 }), T('Menu', '☰ Menu', { weight: 600 })] },
      T('Headline', 'Fresh roasts, on the coast.', { w: 'fill', font: 'var(--font-heading)', size: 36, weight: 600, lh: 1.1 }),
      { type: 'frame', name: 'Beans list', sizing: { w: 'fill', h: 'fixed' }, height: 360, scroll: 'vertical', style: { fills: [] }, layout: { mode: 'flex', direction: 'column', gap: 12 },
        children: [card('Harbour Blend', '$18', '#7a4b2a'), card('Low Tide Decaf', '$17', '#a9744f'), card('Kelp Forest', '$21', '#3e5c3a'), card('Lighthouse', '$19', '#c58b4a'), card('Fog Bank', '$16', '#6b6f73'), card('Driftwood', '$20', '#8c5a3c')] },
    ]);
    const product = screen('Product', 520, [
      T('Back', '← Back', { weight: 600, color: 'var(--color-primary)' }),
      { type: 'frame', name: 'Photo', sizing: { w: 'fill', h: 'fixed' }, height: 300, style: { fills: [{ type: 'mesh', preset: 'Dusk' }].map((f) => Folio.effects.mesh('Dusk')), radius: 'var(--radius-lg)' } },
      T('Title', 'Harbour Blend', { font: 'var(--font-heading)', size: 32, weight: 600 }),
      T('Body', 'Chocolate, toasted hazelnut and a little sea-salt caramel. Roasted every Tuesday.', { w: 'fill', color: 'var(--color-muted)', lh: 1.5 }),
    ]);
    const cart = screen('Cart', 1040, [
      T('Back', '← Back', { weight: 600, color: 'var(--color-primary)' }),
      T('Title', 'Your bag', { font: 'var(--font-heading)', size: 32, weight: 600 }),
      card('Harbour Blend', '$18', '#7a4b2a'),
      T('Checkout', 'Checkout on our website ↗', { weight: 600, color: 'var(--color-primary)' }),
    ]);
    const sheet = s.buildFromTree({ type: 'frame', name: 'Menu sheet', x: 1560, y: 0, width: 390, sizing: { w: 'fixed', h: 'hug' }, layout: col({ gap: 18, padding: [28, 24, 40, 24] }), style: { fills: solid('var(--color-surface)'), radius: [28, 28, 0, 0] },
      children: [{ type: 'frame', name: 'Head', sizing: { w: 'fill', h: 'hug' }, layout: row(), style: { fills: [] }, children: [T('Title', 'Menu', { font: 'var(--font-heading)', size: 24, weight: 600 }), T('Close', '✕', { size: 20 })] }, T('Item', 'Shop beans', { size: 18 }), T('Item', 'Subscriptions', { size: 18 }), T('Item', 'Visit the roastery', { size: 18 })] });
    // instances of the button on Home and Product
    const homeBtn = K.createInstance(comp.id, { parentId: home.id });
    const prodBtn = K.createInstance(comp.id, { parentId: product.id });
    K.setOverrides(prodBtn, { Label: { text: { content: 'Add to bag — $18' } } });
    const find = (root, name) => { const walk = (id) => { const n = s.get(id); if (n.name === name) return id; for (const c of n.children || []) { const r = walk(c); if (r) return r; } }; return walk(root); };
    const P = Folio.prototype;
    const wire = (id, list) => s.update(id, { interactions: P.normalize(id, list).interactions });
    const slide = { type: 'slide', direction: 'left', duration: 320 };
    wire(homeBtn, [{ action: 'navigate', target: product.id, transition: slide }]);
    wire(find(home.id, 'Card / Harbour Blend'), [{ action: 'navigate', target: product.id, transition: slide }]);
    wire(find(home.id, 'Menu'), [{ action: 'overlay', target: sheet.id, transition: { type: 'dissolve', duration: 200 }, overlay: { position: 'bottom', closeOnOutside: true } }]);
    wire(find(sheet.id, 'Close'), [{ action: 'close' }]);
    wire(find(product.id, 'Back'), [{ action: 'back' }]);
    wire(prodBtn, [{ action: 'navigate', target: cart.id, transition: slide }]);
    wire(find(cart.id, 'Back'), [{ action: 'back' }]);
    wire(find(cart.id, 'Checkout'), [{ action: 'url', url: 'https://example.com/checkout' }]);
    Folio.store.currentPage().start = home.id;
    s.select([homeBtn]);
    s.commit('mock flow');
    return { home: home.id, product: product.id, cart: cart.id, sheet: sheet.id, homeBtn, prodBtn };
  });
  // editor: Prototype tab with arrows
  await page.click('#right-tabs [data-tab="prototype"]').catch(async () => page.click('#right-tabs button:has-text("Prototype")'));
  await page.evaluate((ids) => Folio.canvas.zoomToFit([ids.home, ids.product, ids.cart, ids.sheet]), ids);
  await wait(1500);
  await page.screenshot({ path: path.join(OUT, '1-editor-flow.png') });
  // play
  await page.evaluate(() => Folio.store.select([]));
  await page.click('#toolbar .tb-play');
  await page.waitForSelector('#play-root iframe');
  const f = await (await page.$('#play-root iframe')).contentFrame();
  await f.waitForSelector('.fp-screen'); await wait(1500);
  await page.screenshot({ path: path.join(OUT, '2-play-home.png') });
  await f.hover(`[data-fid="${ids.homeBtn}"]`); await wait(200);
  await page.screenshot({ path: path.join(OUT, '3-play-hover.png') });
  await f.evaluate(() => { const l = [...document.querySelectorAll('[data-fp-click]')].find((e) => /Menu/.test(e.textContent) && e.textContent.length < 10); l.click(); });
  await wait(500);
  await page.screenshot({ path: path.join(OUT, '4-play-menu-overlay.png') });
  await page.keyboard.press('Escape'); await wait(300);
  await f.click(`[data-fid="${ids.homeBtn}"]`); await wait(140);
  await page.screenshot({ path: path.join(OUT, '5-play-slide-mid.png') });
  await wait(600);
  await page.screenshot({ path: path.join(OUT, '6-play-product.png') });
  // shareable file
  const html = await page.evaluate(() => Folio.prototype.fileFor());
  require('fs').writeFileSync(path.join(OUT, 'Tidewater.prototype.html'), html);
  console.log('file', html.length, 'errors', errs);
  await browser.close();
})();
