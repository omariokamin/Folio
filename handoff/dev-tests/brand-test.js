const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = '/home/user/folio/.dev';
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const boot = async () => {
    await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
    await page.waitForTimeout(150);
  };
  await page.goto('http://localhost:8121/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await boot();

  // helpers in page
  await page.addScriptTag({ content: `
    window.T = {
      byName(name, rootName) {
        const s = Folio.store; const nodes = Object.values(s.doc.nodes);
        let pool = nodes;
        if (rootName) { const r = nodes.find(n => !n.parent && n.name === rootName); pool = [r.id, ...s.descendants(r.id)].map(id => s.get(id)); }
        return pool.find(n => n.name === name);
      },
      css(id, prop) { Folio.render.sync(); const el = Folio.render.el(id); return el ? getComputedStyle(el)[prop] : null; },
      linked(token) { return Object.values(Folio.store.doc.nodes).filter(n => JSON.stringify([n.style, n.text, n.image]).includes(token)).map(n => n.id); },
      consistent() { const a = Folio.brand.active(); if (!a) return 'none'; const l = Folio.brand.get(a.id); return !!l && JSON.stringify(l) === JSON.stringify(a); },
    };
  `});

  // ---- tabs ----
  await page.click('.bp-tab:has-text("Brand")');
  ok(await page.isVisible('#brand-panel') && !(await page.isVisible('#layers')), 'Brand tab shows the brand panel');
  ok((await page.evaluate(() => localStorage.getItem('folio:leftTab'))) === 'brand', 'last tab remembered');

  // ---- create from each template ----
  const tplNames = await page.evaluate(() => Folio.brand.templates().map(t => t.name));
  ok(tplNames.length === 4, 'four templates: ' + tplNames.join(', '));
  for (const name of tplNames) {
    // use the actions menu → New from template
    await page.click('.bp-head .bp-ibtn');
    await page.click('.bp-menu .f-menu__item:has-text("New from template")');
    await page.click(`.bp-menu .f-menu__item:has-text("${name}")`);
    await page.waitForTimeout(80);
    const st = await page.evaluate(() => ({ active: Folio.brand.active() && Folio.brand.active().name, prim: getComputedStyle(document.getElementById('canvas-world')).getPropertyValue('--color-primary').trim(), cons: T.consistent(), n: Folio.brand.library().length }));
    ok(st.active === name && st.prim && st.cons === true, `template ${name}: active, --color-primary=${st.prim}, consistent`);
  }
  ok((await page.evaluate(() => Folio.brand.library().length)) === 4, 'library has 4 brands');
  await page.screenshot({ path: OUT + '/shot-brand-top.png' });

  // switch to Crumb Bakery via switcher
  await page.click('.bp-switch');
  await page.screenshot({ path: OUT + '/shot-switcher.png' });
  await page.click('.bp-menu .f-menu__item:has-text("Crumb Bakery")');
  await page.waitForTimeout(80);
  const toast1 = await page.textContent('#toast-root');
  ok(/Switched to Crumb Bakery/.test(toast1), 'toast "Switched to Crumb Bakery"');

  // ---- apply colours/fonts to demo layers ----
  const ids = await page.evaluate(() => {
    const h = T.byName('Headline', 'Desktop — Landing'), btn = T.byName('Button / Dark', 'Desktop — Landing'), card = T.byName('Hero card', 'Desktop — Landing'), sub = T.byName('Subhead', 'Desktop — Landing');
    return { h: h.id, btn: btn.id, card: card.id, sub: sub.id, ig: T.byName('Headline', 'Instagram Post').id };
  });
  await page.evaluate((ids) => Folio.store.select([ids.btn, ids.card]), ids);
  await page.click('.bp-color[data-id="primary"] .bp-color__sw');
  await page.evaluate((ids) => Folio.store.select([ids.h, ids.ig]), ids);
  await page.click('.bp-color[data-id="primary"] .bp-color__sw');
  await page.click('.bp-font[data-id="heading"] .bp-font__aa');
  await page.evaluate((ids) => Folio.store.select([ids.sub]), ids);
  await page.click('.bp-color[data-id="muted"] .bp-color__sw');
  await page.click('.bp-font[data-id="body"] .bp-font__aa');
  // alt-click: border
  await page.evaluate((ids) => Folio.store.select([ids.card]), ids);
  await page.click('.bp-color[data-id="accent"] .bp-color__sw', { modifiers: ['Alt'] });
  const ap = await page.evaluate((ids) => {
    const s = Folio.store;
    return {
      btnFill: s.get(ids.btn).style.fills.find(f => f.type === 'solid').color,
      cardFills: s.get(ids.card).style.fills.map(f => f.type + ':' + (f.color || '')),
      cardBorder: s.get(ids.card).style.border,
      hColor: s.get(ids.h).text.color, hFont: s.get(ids.h).text.font, hWeight: s.get(ids.h).text.weight,
      subFont: s.get(ids.sub).text.font,
      btnCss: T.css(ids.btn, 'backgroundColor'), hCss: T.css(ids.h, 'color'), hFam: T.css(ids.h, 'fontFamily'),
      lastLabel: s.history.length,
    };
  }, ids);
  ok(ap.btnFill === 'var(--color-primary)', 'frame solid fill linked to primary');
  ok(ap.cardFills[ap.cardFills.length - 1] === 'solid:var(--color-primary)', 'frame without solid got a primary fill on top: ' + ap.cardFills.join(','));
  ok(ap.cardBorder.color === 'var(--color-accent)' && ap.cardBorder.width > 0, 'Alt-click sets border to accent');
  ok(ap.hColor === 'var(--color-primary)' && ap.hFont === 'var(--font-heading)' && ap.hWeight === 700, 'text colour + heading font + weight applied');
  ok(ap.subFont === 'var(--font-body)', 'body font applied');
  ok(ap.btnCss === 'rgb(194, 65, 12)' && ap.hCss === 'rgb(194, 65, 12)', 'computed colours = Crumb primary: ' + ap.btnCss + ' / ' + ap.hCss);
  ok(/Fraunces/.test(ap.hFam), 'computed font family uses Fraunces: ' + ap.hFam);

  // ---- edit Primary via hex field ----
  const histBefore = await page.evaluate(() => Folio.store.historyIndex);
  await page.fill('.bp-color[data-id="primary"] .bp-color__hex', '#0a7d5a');
  await page.press('.bp-color[data-id="primary"] .bp-color__hex', 'Enter');
  await page.waitForTimeout(50);
  const ed = await page.evaluate((ids) => {
    const linked = T.linked('var(--color-primary)');
    const cols = linked.map(id => { const n = Folio.store.get(id); return n.type === 'text' ? T.css(id, 'color') : T.css(id, 'backgroundColor') + '|' + T.css(id, 'backgroundImage'); });
    return { linked: linked.length, cols, hist: Folio.store.historyIndex, cons: T.consistent(), lib: Folio.brand.get(Folio.brand.active().id).colors[0].value };
  }, ids);
  ok(ed.linked >= 4 && ed.cols.every(c => c.includes('rgb(10, 125, 90)')), `all ${ed.linked} linked layers now rgb(10,125,90): ${ed.cols.join(' ; ').slice(0, 200)}`);
  ok(ed.hist === histBefore + 1, 'one undo step for the hex edit');
  ok(ed.cons === true && ed.lib === '#0a7d5a', 'library updated + consistent');

  // live colour picker: input events update without commits, change commits once
  const pk = await page.evaluate(() => {
    const inp = document.querySelector('.bp-color[data-id="accent"] .bp-color__picker');
    const h0 = Folio.store.historyIndex;
    ['#112233', '#223344', '#334455'].forEach(v => { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); });
    const mid = Folio.store.historyIndex;
    const midVal = Folio.brand.active().colors.find(c => c.id === 'accent').value;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return { h0, mid, after: Folio.store.historyIndex, midVal, sameEl: document.querySelector('.bp-color[data-id="accent"] .bp-color__picker') === inp };
  });
  ok(pk.mid === pk.h0 && pk.after === pk.h0 + 1 && pk.midVal === '#334455', 'picker: live updates, one commit on change');

  // ---- undo / redo consistency ----
  const ur = await page.evaluate(() => {
    const s = Folio.store, B = Folio.brand;
    const out = {};
    s.undo(); // accent pick
    out.a1 = B.active().colors.find(c => c.id === 'accent').value; out.c1 = T.consistent();
    s.undo(); // primary edit
    out.p2 = B.active().colors[0].value; out.c2 = T.consistent(); out.lib2 = B.get(B.active().id).colors[0].value;
    out.var2 = getComputedStyle(document.getElementById('canvas-world')).getPropertyValue('--color-primary').trim();
    s.redo();
    out.p3 = B.active().colors[0].value; out.c3 = T.consistent();
    s.redo();
    out.a4 = B.active().colors.find(c => c.id === 'accent').value;
    return out;
  });
  ok(ur.a1 === '#f2b33d' && ur.c1 === true, 'undo picker → accent back to #f2b33d, library consistent');
  ok(ur.p2 === '#c2410c' && ur.lib2 === '#c2410c' && ur.var2 === '#c2410c' && ur.c2 === true, 'undo primary → doc, library and CSS var all #c2410c');
  ok(ur.p3 === '#0a7d5a' && ur.c3 === true && ur.a4 === '#334455', 'redo restores both edits');
  await page.waitForTimeout(100);
  const panelHex = await page.inputValue('.bp-color[data-id="primary"] .bp-color__hex');
  ok(panelHex === '#0a7d5a', 'panel re-rendered after undo/redo: ' + panelHex);

  // ---- switch brands → re-skin ----
  await page.click('.bp-switch');
  await page.click('.bp-menu .f-menu__item:has-text("Neon Club")');
  await page.waitForTimeout(50);
  const sw = await page.evaluate((ids) => ({ btn: T.css(ids.btn, 'backgroundColor'), h: T.css(ids.h, 'color'), fam: T.css(ids.h, 'fontFamily'), border: T.css(ids.card, 'borderTopColor'), cons: T.consistent(), name: Folio.brand.active().name }), ids);
  ok(sw.name === 'Neon Club' && sw.btn === 'rgb(255, 46, 136)' && sw.h === 'rgb(255, 46, 136)' && /Bebas/.test(sw.fam) && sw.border === 'rgb(212, 255, 58)', 'switch to Neon Club re-skins: ' + JSON.stringify(sw));
  await page.evaluate(() => Folio.store.undo());
  const back = await page.evaluate((ids) => ({ name: Folio.brand.active().name, btn: T.css(ids.btn, 'backgroundColor') }), ids);
  ok(back.name === 'Crumb Bakery' && back.btn === 'rgb(10, 125, 90)', 'undo switch → back to Crumb (edited primary)');

  // ---- custom colour in use → delete → detached ----
  const sage = await page.evaluate(() => Folio.brand.active().colors.find(c => c.name === 'Sage'));
  await page.evaluate((ids) => Folio.store.select([ids.sub]), ids);
  await page.click(`.bp-color[data-id="${sage.id}"] .bp-color__sw`);
  ok((await page.evaluate((ids) => Folio.store.get(ids.sub).text.color, ids)) === `var(--color-${sage.id})`, 'custom colour applied');
  await page.hover(`.bp-color[data-id="${sage.id}"]`);
  await page.click(`.bp-color[data-id="${sage.id}"] .bp-del`);
  const det = await page.evaluate((ids) => ({ c: Folio.store.get(ids.sub).text.color, has: Folio.brand.active().colors.some(c => c.name === 'Sage'), css: T.css(ids.sub, 'color'), cons: T.consistent() }), ids);
  ok(det.c === sage.value && !det.has && det.css === 'rgb(143, 163, 126)' && det.cons, 'delete custom colour → layer detached to ' + det.c);
  await page.evaluate(() => Folio.store.undo());
  ok((await page.evaluate((id) => Folio.brand.active().colors.some(c => c.id === id) && T.consistent(), sage.id)), 'undo restores the custom colour in doc + library');
  await page.evaluate(() => Folio.store.redo());

  // ---- add custom colour via UI + rename ----
  await page.click('.bp-sec[data-sec="colors"] .bp-sec__actions .bp-ibtn');
  await page.waitForSelector('.bp-color .bp-inline');
  await page.fill('.bp-color .bp-inline', 'Pistachio');
  await page.press('.bp-color .bp-inline', 'Enter');
  await page.waitForTimeout(50);
  ok(await page.evaluate(() => Folio.brand.active().colors.some(c => c.name === 'Pistachio' && /^c_/.test(c.id))), 'add + rename custom colour');

  // ---- font family change ----
  await page.selectOption('.bp-font[data-id="heading"] .bp-font__family', 'Playfair Display');
  await page.waitForTimeout(50);
  const ff = await page.evaluate((ids) => ({ fam: T.css(ids.h, 'fontFamily'), w: Folio.brand.active().fonts[0].weight }), ids);
  ok(/Playfair/.test(ff.fam) && ff.w === 700, 'heading family change re-skins linked text: ' + ff.fam);

  // ---- voice ----
  await page.fill('.bp-sec[data-sec="voice"] input[aria-label="Tagline"]', 'Fresh every morning');
  await page.waitForTimeout(500);
  const vMid = await page.evaluate(() => ({ t: Folio.brand.active().voice.tagline, idx: Folio.store.historyIndex }));
  await page.fill('.bp-sec[data-sec="voice"] input[aria-label="Tone"]', 'warm, cheeky, kind');
  await page.click('.bp-head');
  await page.waitForTimeout(100);
  const v = await page.evaluate(() => ({ t: Folio.brand.active().voice.tagline, tone: Folio.brand.active().voice.tone, chips: document.querySelectorAll('.bp-chip').length }));
  ok(vMid.t === 'Fresh every morning' && v.tone.join('|') === 'warm|cheeky|kind' && v.chips === 3, 'voice saves (debounced) and tone chips render');

  // ---- style ----
  await page.click('.bp-sec[data-sec="style"] .bp-seg >> nth=0 >> button:has-text("Square")');
  await page.fill('.bp-radius input[aria-label="Radius md"]', '20');
  await page.press('.bp-radius input[aria-label="Radius md"]', 'Enter');
  await page.evaluate((ids) => Folio.store.select([ids.card]), ids);
  await page.click('.bp-radius__item >> nth=1 >> .bp-radius__prev');
  const fillsBefore = await page.evaluate((ids) => Folio.store.get(ids.card).style.fills.length, ids);
  await page.click('.bp-grad__tile >> nth=0');
  const st = await page.evaluate((ids) => ({ btn: Folio.brand.active().style.button, md: Folio.brand.active().style.radius.md, r: Folio.store.get(ids.card).style.radius, rc: T.css(ids.card, 'borderTopLeftRadius'), fills: Folio.store.get(ids.card).style.fills.length, top: Folio.store.get(ids.card).style.fills.slice(-1)[0].type }), ids);
  ok(st.btn === 'square' && st.md === 20 && st.r === 'var(--radius-md)' && st.rc === '20px', 'style: button seg, radius md=20 applied as token → 20px');
  ok(st.fills === fillsBefore + 1, 'gradient preset added as top fill (' + st.top + ')');
  await page.click('.bp-savefill');
  ok((await page.evaluate(() => Folio.brand.active().style.gradients.length)) === 3, 'save selected fill as preset');

  // ---- logos: PNG (big) + SVG ----
  const pngB64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 2000; c.height = 800; const g = c.getContext('2d'); g.fillStyle = '#c2410c'; g.fillRect(0, 0, 2000, 800); g.fillStyle = '#fff'; g.font = 'bold 300px sans-serif'; g.fillText('CRUMB', 200, 520); return c.toDataURL('image/png').split(',')[1]; });
  fs.writeFileSync(OUT + '/crumb-logo.png', Buffer.from(pngB64, 'base64'));
  fs.writeFileSync(OUT + '/crumb-mark.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#5b2a12"/><text x="60" y="78" font-size="52" text-anchor="middle" fill="#f2b33d" font-family="Georgia">C</text></svg>');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.bp-sec[data-sec="logos"] .bp-drop')]);
  await chooser.setFiles([OUT + '/crumb-logo.png', OUT + '/crumb-mark.svg']);
  await page.waitForFunction(() => Folio.brand.active().logos.length === 2, null, { timeout: 5000 });
  const lg = await page.evaluate(() => Folio.brand.active().logos.map(l => ({ name: l.name, w: l.width, h: l.height, type: l.src.slice(0, 26), len: l.src.length })));
  ok(lg[0].w === 1024 && lg[0].h === 410 && lg[0].type.startsWith('data:image/png'), 'PNG resized to 1024 longest side: ' + JSON.stringify(lg[0]));
  ok(lg[1].type.startsWith('data:image/svg+xml') && lg[1].w === 120 && lg[1].h === 120, 'SVG kept as data URL with viewBox size: ' + JSON.stringify(lg[1]));
  // insert logo inside selected frame
  const igRoot = await page.evaluate(() => T.byName('Instagram Post').id);
  await page.evaluate((id) => Folio.store.select([id]), igRoot);
  await page.click('.bp-logo__thumb >> nth=0');
  await page.waitForTimeout(100);
  const ins = await page.evaluate((root) => { const p = Folio.store.primary(); Folio.render.sync(); const el = Folio.render.el(p.id); return { type: p.type, src: p.image.src, parent: p.parent === root, w: p.width, h: p.height, x: p.x, y: p.y, elSrc: el && el.getAttribute('src') ? el.getAttribute('src').slice(0, 22) : el && el.src.slice(0, 22) }; }, igRoot);
  ok(ins.type === 'image' && /^brand-logo:l_/.test(ins.src) && ins.parent && Math.abs(ins.w / ins.h - 1024 / 410) < 0.05, 'logo inserted as brand-logo image in the selected frame: ' + JSON.stringify(ins));
  ok(/^data:image\/png/.test(ins.elSrc || ''), 'render resolves brand-logo: src → ' + ins.elSrc);
  // drop a file onto the logos section
  const dropped = await page.evaluate(async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><rect width="200" height="50" fill="#3b1f12"/></svg>';
    const dt = new DataTransfer(); dt.items.add(new File([svg], 'wordmark-dark.svg', { type: 'image/svg+xml' }));
    const sec = document.querySelector('.bp-sec[data-sec="logos"]');
    sec.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    sec.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 400));
    return Folio.brand.active().logos.map(l => l.name + ' ' + l.width + 'x' + l.height);
  });
  ok(dropped.length === 3 && /wordmark dark 200x50/.test(dropped[2]), 'drag-drop SVG logo: ' + dropped.join(', '));
  // oversized logo rejected
  const big = await page.evaluate(async () => {
    try { Folio.brand.addLogoSrc(Folio.brand.active().id, { name: 'huge', src: 'data:image/png;base64,' + 'A'.repeat(1.6 * 1024 * 1024) }); return 'accepted'; } catch (e) { return e.message; }
  });
  ok(/1\.5 MB/.test(big), 'logo over 1.5 MB rejected: ' + big);
  const noise = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 1024; const g = c.getContext('2d'); const d = g.createImageData(1024, 1024);
    for (let i = 0; i < d.data.length; i++) d.data[i] = Math.random() * 256 | 0;
    g.putImageData(d, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const before = Folio.brand.active().logos.length;
    try { await Folio.brand.addLogo(Folio.brand.active().id, new File([blob], 'noise.png', { type: 'image/png' })); } catch (e) { return { size: blob.size, err: e.message, n: Folio.brand.active().logos.length - before }; }
    return { size: blob.size, err: null, n: Folio.brand.active().logos.length - before, len: Folio.brand.active().logos.slice(-1)[0].src.length };
  });
  ok(noise.err ? noise.n === 0 : noise.len <= 1.5 * 1024 * 1024, 'noisy 1024² PNG (' + noise.size + ' bytes): ' + (noise.err || 'accepted after re-encode, ' + noise.len + ' chars'));
  if (!noise.err) await page.evaluate(() => { const b = Folio.brand.active(); Folio.brand.removeLogo(b.id, b.logos.slice(-1)[0].id); Folio.store.commit('x'); });
  // delete placed logo → detached
  const ld = await page.evaluate(() => { const p = Folio.store.primary(); const b = Folio.brand.active(); const id = p.image.src.slice(11); Folio.brand.removeLogo(b.id, id); Folio.store.commit('Brand: delete logo'); return { src: Folio.store.get(p.id).image.src.slice(0, 22) }; });
  ok(ld.src.startsWith('data:image/png'), 'deleting a placed logo detaches the image to its data URL');
  await page.evaluate(() => Folio.store.undo());

  // screenshots of panel states
  await page.evaluate(() => { Folio.store.select([]); });
  await page.waitForTimeout(100);
  await page.screenshot({ path: OUT + '/shot-brand-colors.png' });
  await page.evaluate(() => document.querySelector('.bp-sec[data-sec="fonts"]').scrollIntoView());
  await page.waitForTimeout(50);
  await page.screenshot({ path: OUT + '/shot-brand-fonts-logos.png' });
  await page.evaluate(() => document.querySelector('.bp-sec[data-sec="voice"]').scrollIntoView());
  await page.screenshot({ path: OUT + '/shot-brand-voice.png' });
  await page.evaluate(() => document.querySelector('.bp-sec[data-sec="style"]').scrollIntoView());
  await page.screenshot({ path: OUT + '/shot-brand-style.png' });

  // ---- export / import json ----
  await page.evaluate(() => (document.getElementById('left-panel').scrollTop = 0));
  await page.click('.bp-head .bp-ibtn');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.bp-menu .f-menu__item:has-text("Export .json")')]);
  const dlPath = OUT + '/' + dl.suggestedFilename();
  await dl.saveAs(dlPath);
  const exported = JSON.parse(fs.readFileSync(dlPath, 'utf8'));
  ok(dl.suggestedFilename() === 'crumb-bakery.brand.json' && exported.brand && exported.brand.logos.length === 3, 'export .json: ' + dl.suggestedFilename());
  // delete then import via file chooser
  const crumbId = exported.brand.id;
  await page.click('.bp-head .bp-ibtn');
  await page.click('.bp-menu .f-menu__item:has-text("Delete brand")'); // dialog auto-accepted
  await page.waitForTimeout(50);
  const del = await page.evaluate((ids) => ({ active: Folio.brand.active(), lib: Folio.brand.library().map(b => b.name), btn: Folio.store.get(ids.btn).style.fills.find(f => f.type === 'solid').color, css: T.css(ids.btn, 'backgroundColor'), font: Folio.store.get(ids.h).text.font }), ids);
  ok(!del.active && !del.lib.includes('Crumb Bakery') && del.btn === '#0a7d5a' && del.css === 'rgb(10, 125, 90)' && del.font === 'Playfair Display', 'delete active brand → removed from library, layers detached: ' + JSON.stringify(del));
  await page.screenshot({ path: OUT + '/shot-empty-with-library.png' });
  const [ch2] = await Promise.all([page.waitForEvent('filechooser'), page.click('.bp-empty__row button:has-text("Import")')]);
  await ch2.setFiles(dlPath);
  await page.waitForTimeout(150);
  const imp = await page.evaluate((id) => ({ a: Folio.brand.active() && Folio.brand.active().id, logos: Folio.brand.active() && Folio.brand.active().logos.length }), crumbId);
  ok(imp.a === crumbId && imp.logos === 3, 'import .json restores the brand and activates it (doc had none)');
  // import garbage
  const bad = await page.evaluate(() => { try { Folio.brand.importJson('{"hello":1}'); return 'no error'; } catch (e) { return e.message; } });
  ok(/No brand kit/.test(bad), 'bad import → friendly error: ' + bad);
  // re-link layers to the brand for persistence check
  await page.evaluate((ids) => { Folio.store.select([ids.btn, ids.h]); }, ids);
  await page.click('.bp-color[data-id="primary"] .bp-color__sw');

  // ---- reload → persistence ----
  await page.evaluate(() => { Folio.brand.flush(); Folio.store.saveNow(); });
  await page.reload();
  await boot();
  await page.addScriptTag({ content: `window.T = { css(id, p) { Folio.render.sync(); return getComputedStyle(Folio.render.el(id))[p]; }, consistent() { const a = Folio.brand.active(); const l = Folio.brand.get(a.id); return JSON.stringify(l) === JSON.stringify(a); } };` });
  const pr = await page.evaluate((ids) => ({ lib: Folio.brand.library().length, a: Folio.brand.active() && Folio.brand.active().name, css: T.css(ids.btn, 'backgroundColor'), cons: T.consistent(), tabVisible: !document.getElementById('brand-panel').hidden, tagline: Folio.brand.active().voice.tagline }), ids);
  ok(pr.lib === 4 && pr.a === 'Crumb Bakery' && pr.css === 'rgb(10, 125, 90)' && pr.cons && pr.tabVisible && pr.tagline === 'Fresh every morning', 'reload: library, active brand, linked colours, tab, voice persisted ' + JSON.stringify(pr));

  // ---- library newer than doc wins on load; unknown brand from file joins library ----
  const rt = await page.evaluate(() => {
    const ex = Folio.exporter, s = Folio.store, B = Folio.brand;
    const text = s.serialize();
    const id = B.active().id;
    // newer library edit (as if made in another document)
    const lib = JSON.parse(localStorage.getItem('folio:brands:v1'));
    B.update(id, { colors: B.active().colors.map(c => c.id === 'accent' ? { ...c, value: '#123456' } : c) });
    s.commit('Brand: edit');
    ex.loadText(text, 'test.folio.json');
    const accent = B.active().colors.find(c => c.id === 'accent').value;
    const histSnap = JSON.parse(s.history[s.historyIndex]).brand.colors.find(c => c.id === 'accent').value;
    // unknown brand: remove from library then reopen the file
    B.remove(id); s.commit('x');
    const n0 = B.library().length;
    ex.loadText(text, 'test.folio.json');
    return { accent, histSnap, readded: B.library().length === n0 + 1 && !!B.get(id), active: B.active() && B.active().id === id, varP: getComputedStyle(document.getElementById('canvas-world')).getPropertyValue('--color-primary').trim() };
  });
  ok(rt.accent === '#123456' && rt.histSnap === '#123456', 'open file with older doc.brand → library (newer) wins, history snapshot refreshed');
  ok(rt.readded && rt.active && rt.varP === '#0a7d5a', 'doc.brand round-trips through Save/Open; unknown brand re-added to library');

  // ---- quota error path ----
  const q = await page.evaluate(async () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'folio:brands:v1') throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); };
    const b = Folio.brand.active();
    Folio.brand.update(b.id, { name: 'Crumb Bakery' });
    const r = Folio.brand.flush();
    Storage.prototype.setItem = orig;
    await new Promise(r => setTimeout(r, 50));
    return { r, toast: document.getElementById('toast-root').textContent };
  });
  ok(q.r === false && /storage limit/.test(q.toast), 'quota exceeded → toast: ' + q.toast.slice(0, 90));

  // ---- API odds and ends ----
  const api = await page.evaluate(() => {
    const B = Folio.brand, b = B.active();
    return {
      tok: JSON.stringify([B.tokenOf('var(--color-primary)'), B.tokenOf('var(--font-heading)'), B.tokenOf('var(--radius-md)'), B.tokenOf('brand-logo:l_ab12'), B.tokenOf('#fff')]),
      res: [B.resolveColor('var(--color-primary)'), B.resolveColor('#abc'), B.resolveColor('var(--color-nope)'), B.resolveFont('var(--font-heading)'), B.resolveRadius('var(--radius-lg)'), B.resolveSrc('brand-logo:nope')],
      root: B.cssRootBlock(b).split('\n').slice(0, 3).join(' / '),
      vars: Object.keys(B.cssVars(b)).length,
      stale: (() => { const w = document.getElementById('canvas-world'); B.setActive(B.library().find(x => x.name === 'Northwind').id); const hasSage = w.style.getPropertyValue('--color-sage'); const hasFont = w.style.getPropertyValue('--font-script'); Folio.store.undo(); return [hasSage, hasFont, w.style.getPropertyValue('--color-sage')]; })(),
    };
  });
  console.log('  tokens', api.tok);
  console.log('  resolve', JSON.stringify(api.res));
  console.log('  root', api.root, '| vars', api.vars, '| stale', JSON.stringify(api.stale));
  ok(api.res[0] === '#0a7d5a' && api.res[1] === '#abc' && api.res[2] === null && api.res[3] === 'Playfair Display' && api.res[4] === 32 && api.res[5] === '', 'resolve helpers');
  ok(api.stale[0] === '' && api.stale[1] === '', 'stale vars removed when switching to a brand without them');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
