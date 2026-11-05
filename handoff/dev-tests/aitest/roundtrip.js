const { open, call } = require('./harness');
(async () => {
  const { browser, page } = await open();
  // the demo document has every feature: mesh, noise, glass, freeform poster, fills, borders…
  await page.evaluate(() => Folio.demo.build());
  const res = await page.evaluate(async () => {
    const S = Folio.store;
    const diffs = [];
    const strip = (t) => { delete t.x; delete t.y; (t.children || []).forEach(strip); return t; };
    const norm = (t, parentFlex) => {
      // compare only what affects rendering
      const o = JSON.parse(JSON.stringify(t));
      const walk = (n, pf) => {
        delete n.id; delete n.parent;
        if (pf) { delete n.x; delete n.y; }
        if (n.sizing && n.sizing.w !== 'fixed') delete n.width;
        if (n.sizing && n.sizing.h !== 'fixed') delete n.height;
        if (n.type === 'frame' && !(n.children || []).length) delete n.layout;
        (n.style.fills || []).forEach((f) => { if (f.visible === undefined) f.visible = true; });
        (n.style.shadows || []).forEach((s) => { if (s.inset === undefined) s.inset = false; if (s.visible === undefined) s.visible = true; if (s.spread === undefined) s.spread = 0; });
        if (n.style.border && !n.style.border.width) n.style.border = { width: 0 };
        const flex = n.layout && n.layout.mode === 'flex';
        (n.children || []).forEach((c) => walk(c, flex));
      };
      walk(o, parentFlex);
      return o;
    };
    for (const rid of [...S.doc.roots]) {
      const json = Folio.aiTools.serialize(rid, { depth: 50, maxNodes: 5000 });
      const r = await Folio.aiTools.execute('create_nodes', { parent_id: null, nodes: [json] });
      const out = JSON.parse(r.content);
      const newId = Object.keys(out.created)[0];
      const a = norm(S.toTree(rid)), b = norm(S.toTree(newId));
      const cmp = (x, y, path) => {
        if (JSON.stringify(x) === JSON.stringify(y)) return;
        if (typeof x !== 'object' || typeof y !== 'object' || !x || !y) return diffs.push(`${path}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
        new Set([...Object.keys(x), ...Object.keys(y)]).forEach((k) => cmp(x[k], y[k], path + '.' + k));
      };
      cmp(a, b, S.get(rid).name);
      if (out.warnings) diffs.push('warnings: ' + out.warnings.join(' | '));
      if (out.layout) diffs.push('layout: ' + out.layout.join(' | '));
    }
    return diffs;
  });
  console.log(res.length ? res.slice(0, 40).join('\n') : 'ROUNDTRIP IDENTICAL');
  await browser.close();
})();
