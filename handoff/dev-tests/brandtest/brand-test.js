// Brand-kit AI tools test in the real index.html. Run: node .dev/brandtest/brand-test.js
// Needs `python3 -m http.server 8123` running in the repo root.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const H2I = path.join(__dirname, '../aitest/vendor/package/dist/html-to-image.js');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120" viewBox="0 0 400 120"><rect width="400" height="120" rx="60" fill="#431407"/><circle cx="62" cy="60" r="34" fill="#f59e0b"/><text x="120" y="78" font-family="Georgia" font-size="52" font-weight="700" fill="#fff7ed">Crumb</text></svg>`;

let failures = 0;
const check = (cond, msg, extra) => {
  if (cond) console.log('  ok  ', msg);
  else {
    failures++;
    console.log('  FAIL', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : '');
  }
};

async function open() {
  const launch = { headless: true };
  if (process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' };
  const browser = await chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => m.type() === 'error' && logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.route(/^https:\/\/(cdn\.jsdelivr\.net|esm\.sh)\//, (route) => {
    if (/html-to-image@[\d.]+\/dist\/html-to-image\.js/.test(route.request().url()))
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(H2I, 'utf8') });
    return route.abort();
  });
  // a fake "https" logo host the model may reference
  await page.route(/^https:\/\/logo\.example\.test\//, (route) => {
    if (/crumb\.svg/.test(route.request().url()))
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: LOGO_SVG });
    return route.fulfill({ status: 404, body: 'nope' });
  });
  await page.goto('http://localhost:8123/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready') && window.Folio && Folio.aiTools && Folio.brand);
  await page.evaluate(() => Folio.store.newDoc());
  return { browser, page, logs };
}

async function call(page, name, input, shotName) {
  const res = await page.evaluate(async ([n, i]) => Folio.aiTools.execute(n, i), [name, input]);
  if (Array.isArray(res.content)) {
    const img = res.content.find((b) => b.type === 'image');
    if (img && shotName) fs.writeFileSync(path.join(OUT, shotName + '.png'), Buffer.from(img.source.data, 'base64'));
    res.content = res.content.map((b) => (b.type === 'image' ? { type: 'image', bytes: b.source.data.length } : b));
    return res;
  }
  try {
    res.json = JSON.parse(res.content);
  } catch (e) {
    res.json = null;
  }
  return res;
}

(async () => {
  const { browser, page, logs } = await open();
  try {
    console.log('# no brand yet');
    let r = await call(page, 'get_brand', {});
    check(!r.isError && r.json.active === null && /No brand kit is active/.test(r.json.note), 'get_brand without a kit explains how to create one', r.json);
    check(Array.isArray(r.json.templates) && r.json.templates.length >= 3, 'templates are listed', r.json.templates);
    r = await call(page, 'set_brand', { patch: { colors: { primary: '#ff0000' } } });
    check(r.isError && /create/.test(r.content), 'editing with no active kit is an error that mentions create', r.content);
    r = await call(page, 'create_nodes', { parent_id: null, nodes: [{ type: 'frame', name: 'T', width: 100, height: 100, style: { fills: [{ type: 'solid', color: 'var(--color-primary)' }] } }] });
    check(/no brand kit is active/.test(r.content), 'colour token without a kit warns', r.json && r.json.warnings);
    await page.evaluate(() => Folio.store.newDoc());
    let ctxText = await page.evaluate(() => Folio.aiPrompt.contextFor());
    check(/Brand kit: none active/.test(ctxText), 'contextFor says no kit is active', ctxText);

    console.log('# create the bakery kit');
    r = await call(page, 'set_brand', {
      create: true,
      patch: {
        name: 'Crumb Bakery',
        colors: {
          primary: '#c2410c',
          secondary: '#431407',
          accent: '#f59e0b',
          background: '#fff7ed',
          surface: '#ffedd5',
          text: '#1c1917',
          muted: '#78716c',
          Cream: '#fdf6ec',
        },
        fonts: { heading: { family: 'Fraunces', weight: 700 }, body: 'DM Sans' },
        logos: [{ name: 'Logo on light', src: 'https://logo.example.test/crumb.svg' }],
        voice: { tagline: 'Baked slow, eaten fast.', tone: 'warm, playful, homely', useWords: ['fresh', 'handmade', 'golden'], avoidWords: 'cheap, processed', audience: 'neighbours who love a slow morning' },
        style: {
          radius: { sm: 8, md: 16, lg: 32 },
          button: 'pill',
          density: 'airy',
          shadow: 'soft',
          gradients: [{ name: 'Sunrise crust', fill: { type: 'linear', angle: 160, stops: [{ color: 'var(--color-accent)', pos: 0 }, { color: 'var(--color-primary)', pos: 100 }] } }],
        },
      },
    });
    check(!r.isError && r.json.created && r.json.active, 'set_brand create succeeds and activates', r.json || r.content);
    console.log('   ', JSON.stringify(r.json).slice(0, 900));
    const kit = await page.evaluate(() => Folio.brand.active());
    check(kit && kit.name === 'Crumb Bakery', 'doc.brand is the bakery kit');
    check(kit.colors.find((c) => c.id === 'primary').value === '#c2410c', 'primary saved');
    const cream = kit.colors.find((c) => c.name === 'Cream');
    check(cream && /^c_/.test(cream.id), 'custom colour Cream got a generated id', cream);
    check(kit.fonts.find((f) => f.id === 'heading').family === 'Fraunces', 'heading font Fraunces');
    check(kit.logos.length === 1 && kit.logos[0].width === 400 && kit.logos[0].height === 120, 'https logo added with measured size', kit.logos);
    check(kit.voice.useWords === 'fresh, handmade, golden' && kit.voice.tone.length === 3, 'voice stored in brand.js format', kit.voice);
    check(kit.style.gradients.length === 1 && kit.style.gradients[0].fill.stops[1].color === 'var(--color-primary)', 'gradient preset keeps tokens', kit.style.gradients);
    const histBefore = await page.evaluate(() => Folio.store.historyIndex);
    const logoId = kit.logos[0].id;

    r = await call(page, 'get_brand', {});
    check(!r.isError && r.json.brand && r.json.brand.colors.length === 11, 'get_brand returns the active kit', r.json);
    check(!JSON.stringify(r.json).includes('data:'), 'get_brand never leaks data URLs');
    check(r.json.brand.logos[0].src === `brand-logo:${logoId}`, 'logo listed as brand-logo reference');
    ctxText = await page.evaluate(() => Folio.aiPrompt.contextFor());
    check(/primary=#c2410c/.test(ctxText) && /Fraunces/.test(ctxText) && /brand-logo:/.test(ctxText), 'contextFor carries the kit summary');
    console.log(ctxText.split('\n').map((l) => '     | ' + l).join('\n'));
    r = await call(page, 'get_document', {});
    check(r.json.brand && /primary=#c2410c/.test(r.json.brand.colors), 'get_document includes the brand brief', r.json.brand);

    console.log('# build an Instagram post with tokens');
    const post = {
      type: 'frame',
      name: 'Instagram / Sourdough Saturday',
      width: 1080,
      height: 1080,
      layout: { mode: 'none' },
      style: { fills: [{ type: 'solid', color: 'var(--color-background)' }], clip: true },
      children: [
        { type: 'frame', name: 'Glow', x: 560, y: -120, width: 720, height: 720, style: { radius: 9999, blur: 140, opacity: 0.55, fills: [{ type: 'solid', color: 'var(--color-accent)' }] } },
        {
          type: 'frame',
          name: 'Content',
          x: 0,
          y: 0,
          width: 1080,
          height: 1080,
          layout: { direction: 'column', gap: 40, padding: [88, 88, 88, 88], justify: 'space-between' },
          children: [
            { type: 'image', name: 'Logo', width: 300, image: { src: `brand-logo:${logoId}` } },
            {
              type: 'frame',
              name: 'Copy',
              sizing: { w: 'fill' },
              layout: { gap: 28 },
              children: [
                { type: 'text', name: 'Eyebrow', text: { content: 'THIS SATURDAY · 7AM', font: 'var(--font-body)', size: 30, weight: 700, letterSpacing: 0.12, color: 'var(--color-primary)' } },
                { type: 'text', name: 'Headline', sizing: { w: 'fill' }, text: { content: 'Sourdough,\nslow-proved\nfor 36 hours.', font: 'var(--font-heading)', size: 118, lineHeight: 1.0, letterSpacing: -0.03, color: 'var(--color-secondary)' } },
                { type: 'text', name: 'Sub', sizing: { w: 'fill' }, text: { content: 'Fresh, handmade loaves with a golden crust. Baked slow, eaten fast.', font: 'var(--font-body)', size: 34, lineHeight: 1.4, color: 'var(--color-muted)' } },
              ],
            },
            {
              type: 'frame',
              name: 'Footer',
              sizing: { w: 'fill' },
              layout: { direction: 'row', align: 'center', justify: 'space-between' },
              children: [
                {
                  type: 'frame',
                  name: 'Button / Primary',
                  layout: { direction: 'row', align: 'center', padding: [26, 44] },
                  style: { radius: 9999, fills: [{ type: 'solid', color: 'var(--color-primary)' }], shadows: [{ x: 0, y: 14, blur: 36, spread: -8, color: '#c2410c55' }] },
                  children: [{ type: 'text', name: 'Label', text: { content: 'Pre-order a loaf', font: 'var(--font-body)', size: 32, weight: 600, color: 'var(--color-background)' } }],
                },
                {
                  type: 'frame',
                  name: 'Price card',
                  layout: { padding: [20, 28], gap: 2 },
                  style: { radius: 'var(--radius-lg)', fills: [{ type: 'solid', color: 'var(--color-surface)' }], border: { width: 2, color: 'var(--color-accent)' } },
                  children: [
                    { type: 'text', name: 'Price', text: { content: '£6.50', font: 'var(--font-heading)', size: 52, color: 'var(--color-primary)' } },
                    { type: 'text', name: 'Per', text: { content: 'per loaf', size: 24, color: '#78716c' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    r = await call(page, 'create_nodes', { parent_id: null, nodes: [post] });
    check(!r.isError, 'create_nodes with tokens succeeds', r.content);
    console.log('    warnings:', JSON.stringify(r.json.warnings || []));
    check((r.json.warnings || []).some((w) => /#78716c → var\(--color-muted\)/.test(w)), 'literal brand colour gets a link hint');
    const ids = await page.evaluate(() => {
      const n = Object.values(Folio.store.doc.nodes);
      const by = (name) => n.find((x) => x.name === name);
      return { board: by('Instagram / Sourdough Saturday').id, btn: by('Button / Primary').id, head: by('Headline').id, logo: by('Logo').id, card: by('Price card').id };
    });
    const nodes = await page.evaluate((ids) => {
      const g = (id) => Folio.store.get(id);
      return { btn: g(ids.btn), head: g(ids.head), logo: g(ids.logo), card: g(ids.card) };
    }, ids);
    check(nodes.btn.style.fills[0].color === 'var(--color-primary)', 'button fill stored as token');
    check(nodes.head.text.font === 'var(--font-heading)' && nodes.head.text.weight === 700, 'headline font token + kit weight 700', nodes.head.text);
    check(nodes.logo.image.src === `brand-logo:${logoId}` && nodes.logo.height === 90 && nodes.logo.image.fit === 'contain', 'logo keeps aspect (300×90) and fit contain', nodes.logo);
    check(nodes.card.style.radius === 'var(--radius-lg)', 'radius token stored');
    r = await call(page, 'get_tree', { node_id: ids.btn });
    check(JSON.stringify(r.json.tree).includes('var(--color-primary)'), 'get_tree shows tokens back to the model');
    const css1 = await page.evaluate((ids) => {
      Folio.render.sync && Folio.render.sync();
      const cs = (id) => getComputedStyle(Folio.render.el(id));
      return { btn: cs(ids.btn).backgroundColor, card: cs(ids.card).borderTopLeftRadius, head: cs(ids.head).fontFamily, logo: Folio.render.el(ids.logo).src.slice(0, 30) };
    }, ids);
    console.log('    computed:', JSON.stringify(css1));
    check(css1.btn === 'rgb(194, 65, 12)', 'button renders brand primary');
    check(css1.card === '32px', 'card renders radius lg 32px');
    check(/Fraunces/.test(css1.head), 'headline renders Fraunces');
    r = await call(page, 'screenshot', { node_id: ids.board }, 'post-orange');
    check(!r.isError, 'screenshot 1', r.content);

    console.log('# edit the kit: primary → blue, heading → Playfair');
    r = await call(page, 'set_brand', { patch: { colors: [{ id: 'primary', value: '#1d4ed8' }], fonts: [{ id: 'heading', family: 'Playfair Display' }] } });
    check(!r.isError && r.json.changes.some((c) => /primary #c2410c → #1d4ed8/.test(c)), 'set_brand update reports the change', r.json || r.content);
    console.log('   ', r.json.linkedLayers, '|', r.summary);
    const css2 = await page.evaluate((ids) => {
      Folio.render.sync && Folio.render.sync();
      const cs = (id) => getComputedStyle(Folio.render.el(id));
      return { btn: cs(ids.btn).backgroundColor, head: cs(ids.head).fontFamily };
    }, ids);
    check(css2.btn === 'rgb(29, 78, 216)', 'button re-coloured to blue', css2);
    check(/Playfair/.test(css2.head), 'headline switched to Playfair Display', css2);
    r = await call(page, 'screenshot', { node_id: ids.board }, 'post-blue');
    check(!r.isError, 'screenshot 2');
    const committed = await page.evaluate((h) => Folio.store.historyIndex === h, histBefore);
    check(committed, 'set_brand did not commit (history index unchanged)');

    console.log('# hostile inputs');
    r = await call(page, 'update_nodes', {
      updates: [
        { id: ids.btn, patch: { style: { fills: [{ type: 'solid', color: 'var(--color-brandd)' }] } } },
        { id: ids.card, patch: { style: { radius: 'var(--radius-xl)', border: { color: 'var(--color-zzz)' } } } },
        { id: ids.head, patch: { text: { font: 'var(--font-fancy)', color: 'var(--accent)' } } },
        { id: ids.logo, patch: { image: { src: 'brand-logo:nope' } } },
      ],
    });
    console.log('    warnings:', JSON.stringify(r.json.warnings, null, 0).slice(0, 1500));
    const after = await page.evaluate((ids) => ({ btn: Folio.store.get(ids.btn).style.fills, card: Folio.store.get(ids.card).style, head: Folio.store.get(ids.head).text, logo: Folio.store.get(ids.logo).image }), ids);
    check(after.btn[0].color === 'var(--color-primary)', '"brandd" typo → primary', after.btn);
    check(after.card.radius === 'var(--radius-lg)', 'radius-xl → radius-lg');
    check(after.card.border.color === 'var(--color-accent)', 'unknown colour token keeps previous value');
    check(r.json.warnings.some((w) => /Valid colour tokens/.test(w)), 'unknown colour token lists the valid tokens');
    check(after.head.font === 'var(--font-heading)', 'unknown font token keeps previous font', after.head);
    check(after.head.color === 'var(--color-accent)', 'var(--accent) maps to the accent token');
    check(after.logo.src === `brand-logo:${logoId}`, 'unknown logo keeps previous src');

    r = await call(page, 'set_brand', { patch: { colors: [{ id: 'primary', delete: true }, { id: 'text', delete: true }] } });
    check(r.isError && /core brand colour/.test(r.content), 'deleting core colours is refused', r.content);
    r = await call(page, 'set_brand', { patch: { logos: [{ name: 'Sneaky', src: 'data:image/png;base64,iVBORw0KGgo=' }] } });
    check(r.isError && /data: and blob: URLs are refused/.test(r.content), 'data: logo from the model is refused', r.content);
    r = await call(page, 'set_brand', { patch: { logos: [{ name: 'Missing', src: 'https://logo.example.test/missing.png' }, { name: 'Plain http', src: 'http://logo.example.test/x.png' }] } });
    check(r.isError && /could not be loaded/.test(r.content) && /https/.test(r.content), 'unloadable / http logos refused', r.content);
    r = await call(page, 'set_brand', { patch: { colors: { primary: 'not-a-colour', accent: 'var(--color-secondary)' } } });
    check(!r.isError && (r.json.warnings || []).some((w) => /not a valid colour/.test(w)) && r.json.changes.some((c) => /accent .* → #431407/.test(c)), 'bad colour ignored, token value resolved to literal', r.json || r.content);
    r = await call(page, 'set_brand', { patch: { voice: { sampleCopy: 'x'.repeat(70000) } } });
    check(r.isError && /too large/.test(r.content), 'huge patch refused', r.content.slice(0, 200));
    const many = {};
    for (let i = 0; i < 80; i++) many['extra' + i] = '#' + (i * 3).toString(16).padStart(2, '0') + '8844';
    r = await call(page, 'set_brand', { patch: { colors: many, style: { gradients: [{ name: 'img', fill: { type: 'image', src: 'https://x.test/a.png' } }], button: 'blob', density: 'spacious' }, voice: { tone: 'a,'.repeat(50) }, junk: 1 } });
    const k2 = await page.evaluate(() => Folio.brand.active());
    check(!r.isError && k2.colors.length <= 40, `colour count capped (${k2.colors.length})`);
    check(k2.style.density === 'airy' && k2.style.button === 'pill', 'density alias, bad button ignored', k2.style);
    check(k2.style.gradients.length === 1, 'image fill refused as a gradient preset (old list kept)', k2.style.gradients);
    check(k2.voice.tone.length <= 8, 'tone list capped');
    check((r.json.warnings || []).some((w) => /patch\.junk/.test(w)), 'unknown patch keys warned');
    r = await call(page, 'set_brand', { patch: 'make it blue' });
    check(r.isError, 'string patch is an error');
    r = await call(page, 'set_brand', { patch: {} });
    check(r.isError && /Nothing changed/.test(r.content), 'empty patch → nothing changed');
    r = await call(page, 'get_brand', { brand_id: 'b_nope' });
    check(r.isError, 'unknown brand_id is an error');
    // clean up: delete the many extra colours (custom ones can be deleted)
    const extraIds = k2.colors.filter((c) => /^Extra/.test(c.name)).map((c) => ({ id: c.id, delete: true }));
    r = await call(page, 'set_brand', { patch: { colors: extraIds } });
    check(!r.isError && r.json.changes.length === extraIds.length, `deleted ${extraIds.length} custom colours`);

    console.log('# second kit + switching');
    r = await call(page, 'set_brand', { create: true, activate: false, template: 'Folio Violet', patch: { name: 'Night Market' } });
    check(!r.isError && r.json.active === false, 'create without activating', r.json || r.content);
    const nightId = r.json.brand.split(' ')[0];
    r = await call(page, 'set_brand', { brand_id: nightId, activate: true, patch: {} });
    check(!r.isError && r.json.active === true, 'switch the document to the other kit', r.json || r.content);
    const css3 = await page.evaluate((ids) => {
      Folio.render.sync && Folio.render.sync();
      return getComputedStyle(Folio.render.el(ids.btn)).backgroundColor;
    }, ids);
    check(css3 === 'rgb(109, 94, 252)', 'design re-skinned with the violet primary', css3);
    r = await call(page, 'screenshot', { node_id: ids.board }, 'post-violet');
    await page.evaluate(() => Folio.store.commit('test'));

    check(!logs.some((l) => /pageerror/.test(l)), 'no page errors', logs);
    if (logs.length) console.log(logs.join('\n'));
  } catch (e) {
    failures++;
    console.error(e);
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
