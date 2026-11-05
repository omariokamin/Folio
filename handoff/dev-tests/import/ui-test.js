// Security + UI: node .dev/import/ui-test.js  (serve /home/user/folio on :8161)
const { open, ok, fails, OUT } = require('./harness');
const fs = require('fs');
const path = require('path');
const HOSTILE = `<!doctype html><html><head><title>Evil</title>
<meta http-equiv="refresh" content="0;url=javascript:parent.__pwned='meta'">
<script>parent.__pwned = 'script'; alert('x')</script>
<base href="javascript:parent.__pwned='base'//">
<link rel="import" href="data:text/html,<script>parent.__pwned='import'</script>">
<style>@import url("javascript:parent.__pwned='css'"); .x{background:url("javascript:parent.__pwned='bg'")}</style></head>
<body onload="parent.__pwned='onload'">
<h1 onclick="parent.__pwned='click'" onmouseover="parent.__pwned='hover'">Hello <a href="javascript:parent.__pwned='link'">link</a></h1>
<img src="x" onerror="parent.__pwned='onerror'">
<img src="javascript:parent.__pwned='imgsrc'">
<svg onload="parent.__pwned='svg'" width="20" height="20"><script>parent.__pwned='svgscript'</script><rect width="20" height="20" fill="red"/><a xlink:href="javascript:parent.__pwned='xlink'"><circle r="5"/></a></svg>
<iframe srcdoc="<script>parent.parent.__pwned='iframe'</script>" width="200" height="100"></iframe>
<iframe src="javascript:parent.__pwned='iframesrc'"></iframe>
<object data="data:text/html,<script>parent.__pwned='object'</script>"></object>
<embed src="data:text/html,<script>parent.__pwned='embed'</script>">
<form action="javascript:parent.__pwned='form'"><input autofocus onfocus="parent.__pwned='focus'" value="typed"><button formaction="javascript:parent.__pwned='fa'">Go</button></form>
<details open ontoggle="parent.__pwned='toggle'"><summary>s</summary>d</details>
<video poster="https://example.com/p.jpg" autoplay onplay="parent.__pwned='video'"><source src="x.mp4"></video>
<div style="background-image:url(javascript:parent.__pwned='style')">styled</div>
<noscript><p>noscript shows</p></noscript>
<math><mtext><table><mglyph><style><img src=x onerror="parent.__pwned='mxss'">
</body></html>`;

(async () => {
  const { browser, ctx, page, errors } = await open({ perms: ['clipboard-read', 'clipboard-write'] });
  const ev = (fn, a) => page.evaluate(fn, a);

  // ---------- hostile HTML never runs ----------
  const before = await ev(() => document.querySelectorAll('iframe').length);
  const h = await ev(async (html) => {
    window.__pwned = undefined;
    const iframes = [];
    const mo = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.tagName === 'IFRAME' && iframes.push(n.getAttribute('sandbox')))));
    mo.observe(document.body, { childList: true });
    const res = await Folio.importer.fromHtml(html, { width: 800 });
    await new Promise((r) => setTimeout(r, 1500));
    mo.disconnect();
    const S = Folio.store;
    const nodes = [res.rootId, ...S.descendants(res.rootId)].map((id) => S.get(id));
    const json = JSON.stringify(nodes);
    return { pwned: window.__pwned, sandbox: iframes, count: res.count, js: /javascript:/i.test(json), onattr: /\bon[a-z]+=/i.test(json), href: location.href, texts: nodes.filter((n) => n.type === 'text').map((n) => n.text.content), names: nodes.map((n) => n.name), skipped: res.skipped, active: document.activeElement.tagName };
  }, HOSTILE);
  ok(h.pwned === undefined, 'hostile HTML: no script, handler, URL or refresh ran', h.pwned);
  ok(h.sandbox.length === 1 && h.sandbox[0] === 'allow-same-origin', 'render iframe is sandboxed without allow-scripts', h.sandbox);
  ok(!h.js && !h.onattr, 'no javascript: URL or on* attribute reaches the document');
  ok(/localhost:8161\/index.html/.test(h.href), 'Folio did not navigate');
  ok(h.active !== 'IFRAME', 'autofocus did not steal focus', h.active);
  ok(h.texts.some((t) => /Hello/.test(t)) && !h.texts.some((t) => /noscript/.test(t)), 'visible content imported, noscript dropped', h.texts);
  ok(/Embed|Video/.test(h.names.join()), 'iframes/video became placeholders', h.skipped);
  ok((await ev(() => document.querySelectorAll('iframe').length)) === before, 'render iframe removed afterwards');
  await page.waitForTimeout(500);
  ok(!errors.some((e) => /^dialog/.test(e)), 'no dialog opened');

  // ---------- limits ----------
  const lim = await ev(async () => {
    const out = {};
    try { await Folio.importer.fromHtml('<p>' + 'x'.repeat(3.1 * 1024 * 1024) + '</p>'); } catch (e) { out.big = e.message; }
    const many = '<div style="display:flex;flex-wrap:wrap;gap:2px">' + Array.from({ length: 4000 }, (_, i) => `<span style="display:inline-block;width:8px;height:8px;background:#${(i % 9) + 1}${(i % 7) + 2}c"></span>`).join('') + '</div>';
    const t = performance.now();
    const r = await Folio.importer.fromHtml(many, { width: 1440 });
    out.ms = Math.round(performance.now() - t);
    out.count = r.count;
    out.warn = r.warnings;
    Folio.store.remove(r.rootId);
    return out;
  });
  ok(/too large/.test(lim.big || ''), '3 MB limit refuses with a clear message', lim.big);
  ok(lim.count <= 3001 && lim.count > 2900 && lim.warn.some((w) => /3,000 layers/.test(w)), `3,000 layer limit (${lim.count} layers, ${lim.ms} ms)`, lim.warn);

  // ---------- undo removes an import in one step; lands on the current page ----------
  const u = await ev(async () => {
    const S = Folio.store;
    const p2 = S.addPage('Second', { activate: true });
    S.commit('page');
    const roots0 = S.doc.roots.length;
    const hist0 = S.historyIndex;
    const res = await Folio.importer.fromHtml('<h1>Hi</h1><p>There</p>', { name: 'Undo me' });
    S.commit('Import HTML');
    const onPage = S.pageOf(res.rootId) === p2 && S.doc.roots.length === roots0 + 1;
    const steps = S.historyIndex - hist0;
    S.undo();
    const gone = !S.get(res.rootId);
    S.redo();
    const other = S.pages()[0];
    const r2 = await Folio.importer.fromHtml('<p>elsewhere</p>', { pageId: other.id });
    return { onPage, steps, gone, back: !!S.get(res.rootId), elsewhere: S.pageOf(r2.rootId).id === other.id && S.currentPage().id === p2.id };
  });
  ok(u.onPage, 'import lands on the current page');
  ok(u.steps === 1 && u.gone && u.back, 'one commit; undo removes the import, redo brings it back', u);
  ok(u.elsewhere, 'pageId puts it on another page without switching');

  // ---------- modal flow ----------
  await page.click('.tb-file');
  await page.click('.f-menu__item:has-text("Import HTML")');
  await page.waitForSelector('.im-modal');
  await page.screenshot({ path: path.join(OUT, 'ui-modal.png') });
  await page.fill('.im-code', '<style>.c{display:flex;gap:12px;padding:24px;background:#eef}</style><div class="c"><b>One</b><i>Two</i></div>');
  await page.click('.im-modal .f-seg button:has-text("Mobile")');
  const n0 = await ev(() => Folio.store.doc.roots.length);
  await page.click('.im-foot .f-btn--primary');
  await page.waitForFunction((n) => Folio.store.doc.roots.length === n + 1, n0);
  await page.waitForTimeout(300);
  const m = await ev(() => { const n = Folio.store.primary(); return { name: n && n.name, w: n && n.width, modal: !!document.querySelector('.im-modal'), sel: Folio.store.selection.length }; });
  ok(m.w === 390 && m.sel === 1, 'modal imports at the chosen width and selects it', m);
  if (m.modal) await page.click('.im-foot .f-btn--ghost');
  // .html file open
  await page.click('.tb-file');
  await page.click('.f-menu__item:has-text("Import HTML")');
  const fp = path.join(OUT, 'sample-file.html');
  fs.writeFileSync(fp, '<!doctype html><title>From file</title><h2 style="color:#c00">File heading</h2>');
  await page.setInputFiles('.im-modal input[type=file]', fp);
  await page.waitForFunction(() => /File heading/.test(document.querySelector('.im-code').value));
  await page.click('.im-foot .f-btn--primary');
  await page.waitForFunction(() => Folio.store.primary() && Folio.store.primary().name === 'sample-file');
  ok(true, '.html file opens into the modal and imports (named after the file)');
  if (await page.$('.im-modal')) await page.click('.im-foot .f-btn--ghost');
  // errors show in the modal
  await page.click('.tb-file');
  await page.click('.f-menu__item:has-text("Import HTML")');
  await page.click('.im-foot .f-btn--primary');
  ok(/Paste some HTML/.test(await page.textContent('.im-status')), 'empty import explains itself');
  await page.keyboard.press('Escape');
  ok(!(await page.$('.im-modal')), 'Esc closes the modal');

  // ---------- clipboard ----------
  await page.click('#canvas-viewport', { position: { x: 5, y: 5 } }); // focus the canvas, clear selection
  const writeHtml = (html) => ev(async (html) => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob(['plain'], { type: 'text/plain' }) })]); }, html);
  await writeHtml('<div style="padding:16px;background:#ffe"><h3 style="margin:0">Copied from a site</h3></div>');
  let r0 = await ev(() => Folio.store.doc.roots.length);
  await page.keyboard.press('Control+Shift+V');
  await page.waitForTimeout(1500);
  let c = await ev(() => { const p = Folio.store.primary(); return { roots: Folio.store.doc.roots.length, name: p && p.name, text: p && Folio.store.descendants(p.id).map((i) => Folio.store.get(i)).filter((n) => n.type === 'text').map((n) => n.text.content) }; });
  ok(c.roots === r0 + 1 && c.text.join().includes('Copied from a site'), '⇧⌘V imports text/html from the clipboard as a new artboard', c);
  // into the selected frame
  const target = await ev(() => { const f = Folio.store.buildFromTree({ type: 'frame', name: 'Target', x: 0, y: -2000, width: 500, sizing: { w: 'fixed', h: 'hug' }, layout: { mode: 'flex', direction: 'column', padding: [10, 10, 10, 10] }, style: { fills: [{ type: 'solid', color: '#fff' }] } }); Folio.store.select([f.id]); Folio.store.commit('t'); return f.id; });
  await page.keyboard.press('Control+Shift+V');
  await page.waitForTimeout(1500);
  c = await ev((t) => ({ kids: Folio.store.get(t).children.length, w: Folio.store.get(t).children[0] && Folio.store.get(Folio.store.get(t).children[0]).width }), target);
  ok(c.kids === 1 && c.w === 480, '⇧⌘V with a frame selected imports into it (at its content width)', c);
  // normal ⌘V: HTML from elsewhere (no Folio copy yet in this context → imports)
  // Folio copy → ⌘V pastes layers, even though text/html sat on the clipboard before
  await ev((t) => Folio.store.select([t]), target);
  await page.keyboard.press('Control+C');
  await page.waitForTimeout(300);
  const clipText = await ev(() => navigator.clipboard.readText());
  r0 = await ev(() => Folio.store.doc.roots.length);
  await ev(() => Folio.store.select([]));
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(800);
  c = await ev(() => { const p = Folio.store.primary(); return { roots: Folio.store.doc.roots.length, name: p && p.name }; });
  ok(c.roots === r0 + 1 && c.name === 'Target', '⌘V after a Folio copy pastes Folio layers', { c, clipText });
  // ⌘V with website HTML copied after the Folio copy → imports
  await writeHtml('<p style="font-size:30px">Later copy</p>');
  await ev(() => Folio.store.select([]));
  r0 = await ev(() => Folio.store.doc.roots.length);
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(1500);
  c = await ev(() => { const p = Folio.store.primary(); return { roots: Folio.store.doc.roots.length, text: p && Folio.store.descendants(p.id).map((i) => Folio.store.get(i)).filter((n) => n.type === 'text').map((n) => n.text.content).join() }; });
  ok(c.roots === r0 + 1 && /Later copy/.test(c.text), '⌘V with HTML copied elsewhere afterwards imports it', c);
  // undo the paste-import in one step
  await page.keyboard.press('Control+Z');
  ok((await ev(() => Folio.store.doc.roots.length)) === r0, 'one ⌘Z removes the pasted import');
  // typing in an input is untouched
  await page.click('.tb-docname');
  r0 = await ev(() => Folio.store.doc.roots.length);
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(500);
  ok((await ev(() => Folio.store.doc.roots.length)) === r0, 'paste inside an input does not import');

  console.log(errors.length ? 'ERRORS ' + JSON.stringify(errors) : '');
  ok(!errors.filter((e) => !/^dialog/.test(e)).length, 'no page errors');
  await browser.close();
  console.log(fails() ? `\n${fails()} FAILED` : '\nALL PASSED');
  process.exit(fails() ? 1 : 0);
})();
