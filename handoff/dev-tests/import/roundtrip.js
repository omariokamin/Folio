// Round trips: Folio design → exporter.pageFor → importer.fromHtml → PNG diff. Plus hand-written pages vs browser render.
const { open, ok, helpers, savePng, reference, fails } = require('./harness');
const fs = require('fs');
const path = require('path');
const only = process.argv[2];
(async () => {
  const { browser, page, errors } = await open({ width: 1800, height: 1100 });
  await helpers(page);
  const results = [];
  // ---------- Folio → HTML → Folio ----------
  const sets = await page.evaluate(async () => {
    Folio.demo.build();
    const S = Folio.store;
    const out = S.doc.roots.map((id) => ({ id, name: S.get(id).name }));
    // a brand-token design (var(--color-…), var(--font-…), var(--radius-…))
    const B = Folio.brand;
    const br = B.create((B.templates()[0] || {}).id);
    B.setActive(br.id);
    const tok = S.buildFromTree({
      type: 'frame', name: 'Brand card', x: 0, y: 3000, width: 720, sizing: { w: 'fixed', h: 'hug' },
      layout: { mode: 'flex', direction: 'column', gap: 20, padding: [48, 48, 48, 48] },
      style: { fills: [{ type: 'solid', color: 'var(--color-background)' }] },
      children: [
        { type: 'text', name: 'Headline', sizing: { w: 'fill', h: 'hug' }, text: { content: 'Brand tokens survive the trip', font: 'var(--font-heading)', size: 44, weight: 700, color: 'var(--color-text)', lineHeight: 1.1 } },
        { type: 'text', name: 'Body', sizing: { w: 'fill', h: 'hug' }, text: { content: 'Colours, fonts and corner radii come from the active brand kit and are exported as CSS variables.', font: 'var(--font-body)', size: 18, color: 'var(--color-muted)', lineHeight: 1.5 } },
        { type: 'frame', name: 'Row', sizing: { w: 'fill', h: 'hug' }, layout: { mode: 'flex', direction: 'row', gap: 16, align: 'center' }, style: { fills: [] }, children: [
          { type: 'frame', name: 'Button', sizing: { w: 'hug', h: 'hug' }, layout: { mode: 'flex', direction: 'row', padding: [14, 22, 14, 22] }, style: { fills: [{ type: 'solid', color: 'var(--color-primary)' }], radius: 'var(--radius-md)', shadows: [{ x: 0, y: 6, blur: 18, spread: 0, color: '#00000033', visible: true }] },
            children: [{ type: 'text', name: 'Label', text: { content: 'Get started', font: 'var(--font-body)', size: 16, weight: 600, color: '#ffffff' } }] },
          { type: 'frame', name: 'Swatch', width: 120, height: 48, style: { fills: [{ type: 'linear', angle: 90, stops: [{ color: 'var(--color-primary)', pos: 0 }, { color: 'var(--color-accent)', pos: 100 }] }], radius: 'var(--radius-lg)' } },
          { type: 'frame', name: 'Mesh', width: 120, height: 48, style: { fills: [{ type: 'mesh', base: 'var(--color-surface)', spread: 60, points: [{ color: 'var(--color-primary)', x: 10, y: 10 }, { color: '#22d3ee', x: 90, y: 10 }, { color: 'var(--color-accent)', x: 90, y: 90 }, { color: '#10b981', x: 10, y: 90 }] }], border: { width: 2, color: 'var(--color-text)', style: 'dashed' } } },
        ] },
      ],
    });
    out.push({ id: tok.id, name: 'Brand card' });
    Folio.components.addStarterKit();
    S.commit('setup');
    const kit = S.pages().find((p) => p.name === 'Components');
    (kit ? kit.roots : []).forEach((id) => out.push({ id, name: 'Kit ' + S.get(id).name }));
    return out;
  });
  for (const s of sets) {
    if (only && !s.name.toLowerCase().includes(only)) continue;
    const r = await page.evaluate(async (id) => {
      const n = Folio.store.get(id);
      const html = Folio.exporter.pageFor(id);
            await Folio.render.peek([id], () => {}); const res = await Folio.importer.fromHtml(html, { selector: 'body > :first-child', width: Folio.render.el(id).offsetWidth || 1440, name: n.name + ' (import)', pageId: Folio.store.pageOf(id).id });
      Folio.store.commit('import');
      await new Promise((r) => setTimeout(r, 300));
      const a = await __png(id), b = await __png(res.rootId);
      const d = await __diff(a, b);
      return { ...d, count: res.count, warnings: res.warnings, skipped: res.skipped, outline: __outline(res.rootId, 0, 3), orig: __outline(id, 0, 3) };
    }, s.id);
    savePng('rt-' + s.name.replace(/\W+/g, '_'), r.side);
    results.push([s.name, r.pct]);
    ok(r.pct < 5, `round trip "${s.name}": ${r.pct}% pixels differ (${r.a} vs ${r.b}), ${r.count} layers`, { warnings: r.warnings, skipped: r.skipped });
    if (process.env.V) console.log(r.orig + '---\n' + r.outline);
  }
  // ---------- hand-written pages ----------
  const dir = path.join(__dirname, 'pages');
  const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => path.join(dir, f));
  pages.push('/home/user/folio/.dev/import-ai/landing.html');
  for (const file of pages) {
    const name = path.basename(file, '.html');
    if (only && !name.includes(only)) continue;
    const html = fs.readFileSync(file, 'utf8');
    const width = /mobile/.test(name) ? 390 : 1280;
    const ref = await reference(browser, html, width);
    const r = await page.evaluate(async ([html, width, ref]) => {
      const res = await Folio.importer.fromHtml(html, { width });
      Folio.store.commit('import');
      await new Promise((r) => setTimeout(r, 300));
      const b = await __png(res.rootId);
      const d = await __diff(ref, b);
      return { ...d, count: res.count, warnings: res.warnings, skipped: res.skipped, outline: __outline(res.rootId, 0, 6) };
    }, [html, width, ref]);
    savePng('hw-' + name, r.side);
    results.push([name, r.pct]);
    ok(r.pct < 8, `page "${name}": ${r.pct}% pixels differ (${r.a} vs ${r.b}), ${r.count} layers`, { warnings: r.warnings, skipped: r.skipped });
    if (process.env.V) console.log(r.outline);
  }
  console.log('\nDIFFS ' + results.map(([n, p]) => `${n}: ${p}%`).join(' | '));
  if (errors.length) console.log('ERRORS', errors);
  ok(!errors.length, 'no page errors');
  await browser.close();
  console.log(fails() ? `\n${fails()} FAILED` : '\nALL PASSED');
  process.exit(fails() ? 1 : 0);
})();
