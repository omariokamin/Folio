// Prototype runtime in the real app. run: node .dev/prototype/browser-test.js [base]   (serve the repo, e.g. python3 -m http.server 8237)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const base = process.argv[2] || 'http://127.0.0.1:8237';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (c || x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.goto(base + '/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  const ev = (fn, a) => page.evaluate(fn, a);

  // ---------- build a small flow ----------
  const ids = await ev(() => {
    const s = Folio.store, K = Folio.components;
    s.newDoc();
    const solid = (c) => [{ type: 'solid', color: c }];
    const flex = (o = {}) => ({ mode: 'flex', direction: 'column', gap: 12, padding: [24, 24, 24, 24], justify: 'flex-start', align: 'flex-start', wrap: false, ...o });
    const A = s.buildFromTree({ type: 'frame', name: 'Home', x: 0, y: 0, width: 390, height: 700, layout: flex(), style: { fills: solid('#ffffff') } });
    const B = s.buildFromTree({ type: 'frame', name: 'Details', x: 500, y: 0, width: 390, height: 700, layout: flex(), style: { fills: solid('#eef2ff') }, children: [
      { type: 'text', name: 'Back', text: { content: '← Back', size: 16, color: '#111111' }, interactions: [{ trigger: 'click', action: 'back' }] },
    ] });
    const O = s.buildFromTree({ type: 'frame', name: 'Sheet', x: 1000, y: 0, width: 390, height: 240, layout: flex(), style: { fills: solid('#fde68a') }, children: [
      { type: 'text', name: 'Close', text: { content: 'Close', size: 16, color: '#111111' }, interactions: [{ trigger: 'click', action: 'close' }] },
    ] });
    // Button set: State = Default / Hover
    const C = s.buildFromTree({ type: 'frame', name: 'Components', x: 0, y: 900, width: 600, height: 300, layout: flex() });
    const btn = s.buildFromTree({ type: 'frame', name: 'Button', sizing: { w: 'hug', h: 'hug' }, layout: flex({ padding: [10, 16, 10, 16] }), style: { fills: solid('#2563eb'), radius: 8 }, children: [
      { type: 'text', name: 'Label', text: { content: 'Go', size: 16, color: '#ffffff' } },
    ] }, C.id);
    const comp = K.create([btn.id], { name: 'Button' });
    K.addVariant(comp.id, { State: 'Hover' });
    const set = K.getSet(K.get(comp.id).setId);
    const hoverComp = K.variantsOf(comp.id).find((c) => /hover/i.test(c.variant.State));
    s.update(hoverComp.mainId, { style: { fills: solid('#ff0000') } });
    K.flush();
    const inst = K.createInstance(comp.id, { parentId: A.id });
    s.update(inst, { interactions: [{ trigger: 'click', action: 'navigate', target: B.id, transition: { type: 'slide', direction: 'left', duration: 300 } }] });
    const mk = (name, content, interactions) => s.buildFromTree({ type: 'text', name, text: { content, size: 16, color: '#111111' }, interactions }, A.id).id;
    const sheet = mk('Open sheet', 'Open sheet', [{ trigger: 'click', action: 'overlay', target: O.id, transition: { type: 'dissolve', duration: 200 }, overlay: { position: 'bottom', closeOnOutside: true, backdrop: '#0f172a66' } }]);
    const link = mk('Link', 'Website', [{ trigger: 'click', action: 'url', url: 'https://example.com/' }]);
    const bad = mk('Bad', 'Bad link', [{ trigger: 'click', action: 'url', url: 'javascript:alert(1)' }]);
    const dangling = mk('Dangling', 'Dangling', [{ trigger: 'click', action: 'navigate', target: 'n_gone' }]);
    const scroller = s.buildFromTree({ type: 'frame', name: 'Scroller', width: 300, height: 150, scroll: 'vertical', layout: flex(), style: { fills: solid('#f3f4f6') }, children: [
      { type: 'frame', name: 'Tall', width: 260, height: 600, style: { fills: [{ type: 'linear', angle: 180, stops: [{ color: '#22c55e', pos: 0 }, { color: '#3b82f6', pos: 100 }] }] } },
    ] }, A.id);
    s.select([]);
    s.commit('flow');
    return { A: A.id, B: B.id, O: O.id, C: C.id, inst, sheet, link, bad, dangling, scroller: scroller.id, comp: comp.id, props: set.props, hoverMain: hoverComp.mainId };
  });
  ok(ids.props.State && ids.props.State.includes('Hover'), 'Button set has State with Hover', ids.props);

  // ---------- data plumbing ----------
  let r = await ev((ids) => {
    const s = Folio.store, K = Folio.components;
    const sc = s.get(ids.scroller);
    const canvas = Folio.css.nodeStyles(sc, { mode: 'canvas' });
    const play = Folio.css.nodeStyles(sc, { mode: 'play' });
    const tw = Folio.tailwind.classesFor(sc, s.get(ids.A)).classes;
    const el = Folio.render.el(ids.scroller);
    // instance root keeps its own interactions when the main changes
    s.update(K.get(ids.comp).mainId, { style: { radius: 12 } });
    K.flush();
    const instAfter = s.get(ids.inst);
    return { canvas: canvas.overflow, playX: play['overflow-x'], playY: play['overflow-y'], playOv: play.overflow, tw, css: Folio.exporter.cssFor(ids.A).includes('overflow-y: auto'), elOv: el && getComputedStyle(el).overflow, keep: instAfter.interactions && instAfter.interactions[0].target === ids.B, radius: instAfter.style.radius };
  }, ids);
  ok(r.canvas === 'hidden' && r.elOv === 'hidden', 'scroll frame clips on the canvas', r);
  ok(r.playY === 'auto' && r.playX === 'hidden' && !r.playOv, 'scroll frame scrolls vertically in play mode', r);
  ok(r.tw.includes('overflow-y-auto') && r.tw.includes('overflow-x-hidden') && r.css, 'HTML/CSS and Tailwind exports emit the overflow', r.tw);
  ok(r.keep && r.radius === 12, 'instance root owns its interactions across propagation', r);
  await ev(() => Folio.store.commit('radius'));

  r = await ev((ids) => {
    const s = Folio.store;
    s.select([ids.inst]);
    const dup = s.duplicate([ids.inst])[0];
    s.copy([ids.sheet]);
    s.select([ids.A]);
    const pasted = s.paste()[0];
    const abCopy = s.duplicate([ids.A])[0];
    const btnInCopy = s.descendants(abCopy).find((d) => s.get(d).name === 'Open sheet');
    const out = {
      dup: JSON.stringify(s.get(dup).interactions),
      pasted: JSON.stringify(s.get(pasted).interactions),
      abCopyTarget: s.get(btnInCopy).interactions[0].target,
      scrollCopy: s.descendants(abCopy).map((d) => s.get(d)).find((n) => n.name === 'Scroller').scroll,
    };
    s.undo();
    s.undo();
    s.undo(); // back to the committed flow
    return out;
  }, ids);
  ok(r.dup.includes(ids.B) && r.pasted.includes(ids.O), 'duplicate and copy/paste keep interactions', r);
  ok(r.abCopyTarget === ids.O && r.scrollCopy === 'vertical', 'duplicated artboard keeps targets pointing at the original screens', r);
  // (the duplicates above were never committed: reload the committed state)
  await ev(() => { Folio.store.undo(); Folio.store.redo(); });

  // ---------- bundleFor leaves doc + history + autosave untouched ----------
  await wait(700); // let autosave + propagation settle
  const snap = () => ev(() => ({ doc: JSON.stringify(Folio.store.doc), hist: Folio.store.history.join('\u0001'), idx: Folio.store.historyIndex, save: localStorage.getItem('folio:autosave:v1'), sel: Folio.store.selection.join() }));
  const before = await snap();
  r = await ev((ids) => {
    const P = Folio.prototype;
    const b = P.bundleFor();
    const file = P.fileFor();
    return {
      screens: Object.keys(b.screens),
      start: b.start,
      inter: Object.keys(b.interactions),
      hover: b.hovers[ids.inst] && b.hovers[ids.inst].html,
      size: file.length,
      externalJs: /<script[^>]+src=/i.test(file),
      startOf: P.startOf(),
    };
  }, ids);
  await wait(700);
  const after = await snap();
  ok(before.doc === after.doc && before.hist === after.hist && before.idx === after.idx && before.save === after.save && before.sel === after.sel, 'document, history, autosave and selection identical after bundleFor/fileFor');
  ok(r.screens.length === 4 && r.start === ids.A && r.startOf === ids.A, 'bundle has every artboard of the page, start = first artboard', r);
  ok(r.inter.includes(ids.inst) && r.inter.includes(ids.sheet) && !r.inter.includes(ids.bad) && !r.inter.includes(ids.dangling), 'bad URLs and dangling targets dropped from the bundle', r.inter);
  ok(r.hover && /#ff0000|255, 0, 0/i.test(r.hover) && r.hover.includes(`data-fid="${ids.inst}"`), 'hover variant rendered (instance id kept)', r.hover && r.hover.slice(0, 200));
  ok(!r.externalJs, 'exported file has no external JS');

  // page.start
  r = await ev((ids) => { Folio.store.currentPage().start = ids.B; const a = Folio.prototype.startOf(); Folio.store.currentPage().start = 'n_gone'; const b = Folio.prototype.startOf(); delete Folio.store.currentPage().start; return [a, b]; }, ids);
  ok(r[0] === ids.B && r[1] === ids.A, 'startOf honours page.start and ignores a dangling one', r);

  // ---------- in-app player ----------
  await page.click('#toolbar .tb-play');
  await page.waitForSelector('#play-root iframe');
  const frameOf = async () => {
    const h = await page.$('#play-root iframe');
    const f = await h.contentFrame();
    await f.waitForSelector('.fp-screen');
    return f;
  };
  let f = await frameOf();
  const fev = (fn, a) => f.evaluate(fn, a);
  const screenId = () => fev(() => { const w = [...document.querySelectorAll('#fp-stage > .fp-wrap .fp-screen')]; return w.length ? w[w.length - 1].dataset.screen : null; });
  ok((await screenId()) === ids.A, 'Play opens on the first artboard');
  const sel = () => ev(() => document.querySelector('#play-root select').value);
  ok((await sel()) === ids.A, 'top bar shows the current screen');
  r = await fev((ids) => { const el = document.querySelector(`[data-fid="${ids.inst}"]`); return { role: el.getAttribute('role'), tab: el.tabIndex, link: document.querySelector(`[data-fid="${ids.link}"]`).getAttribute('role'), bad: document.querySelector(`[data-fid="${ids.bad}"]`).hasAttribute('data-fp-click') }; }, ids);
  ok(r.role === 'button' && r.tab === 0 && r.link === 'link' && !r.bad, 'clickable layers get role + tabindex; unsafe link is not clickable', r);

  // scroll frame scrolls in play
  r = await fev((ids) => { const el = document.querySelector(`[data-fid="${ids.scroller}"]`); const cs = getComputedStyle(el); el.scrollTop = 200; return { y: cs.overflowY, x: cs.overflowX, top: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight }; }, ids);
  ok(r.y === 'auto' && r.top > 0 && r.sh > r.ch, 'scroll frame scrolls in the player', r);

  // hover swaps to the Hover variant and back
  const bg = () => fev((ids) => { const el = document.querySelector(`[data-fid="${ids.inst}"]`); return el ? getComputedStyle(el).backgroundColor : null; }, ids);
  const normalBg = await bg();
  await f.hover(`[data-fid="${ids.inst}"]`);
  await wait(50);
  const hoverBg = await bg();
  await page.mouse.move(5, 5);
  await f.hover(`[data-fid="${ids.link}"]`);
  await wait(50);
  const backBg = await bg();
  ok(normalBg === 'rgb(37, 99, 235)' && hoverBg === 'rgb(255, 0, 0)' && backBg === normalBg, 'hover shows the Hover variant, leaving restores it', { normalBg, hoverBg, backBg });

  // navigate with slide, then back
  await f.hover(`[data-fid="${ids.inst}"]`);
  await f.click(`[data-fid="${ids.inst}"]`);
  await wait(60);
  const during = await fev(() => ({ n: document.querySelectorAll('#fp-stage > .fp-wrap').length, anims: document.getAnimations().length }));
  await wait(400);
  ok(during.n === 2 && during.anims >= 2, 'slide transition animates both screens', during);
  ok((await screenId()) === ids.B && (await fev(() => document.querySelectorAll('#fp-stage > .fp-wrap').length)) === 1, 'click navigates to the target screen');
  ok((await sel()) === ids.B, 'top bar follows navigation');
  await f.click('text=← Back');
  await wait(400);
  ok((await screenId()) === ids.A, 'Back returns to the previous screen');

  // overlay: outside click, Esc, close action
  await f.click('text=Open sheet');
  await wait(300);
  r = await fev(() => { const l = document.querySelector('.fp-layer'); return l && { bg: getComputedStyle(l).backgroundColor, align: l.style.alignItems }; });
  ok(r && r.align === 'flex-end' && /rgba\(15, 23, 42/.test(r.bg), 'overlay opens at the bottom on a backdrop', r);
  await page.mouse.click(20, 80); // inside the iframe, above the bottom sheet
  await wait(300);
  ok((await fev(() => document.querySelectorAll('.fp-layer').length)) === 0, 'click outside closes the overlay');
  await f.click('text=Open sheet');
  await wait(300);
  await page.keyboard.press('Escape');
  await wait(300);
  ok((await fev(() => document.querySelectorAll('.fp-layer').length)) === 0 && (await ev(() => Folio.prototype.isPlaying())), 'Esc closes the overlay (player stays open)');
  await f.click('text=Open sheet');
  await wait(300);
  await f.click('.fp-layer >> text=Close');
  await wait(300);
  ok((await fev(() => document.querySelectorAll('.fp-layer').length)) === 0, 'close action closes the overlay');

  // URL: http opens with noopener, javascript: never opens; empty click shows hint
  await fev(() => { window.__opened = []; window.open = function () { window.__opened.push([].slice.call(arguments)); return null; }; });
  await f.click('text=Website');
  await f.click('text=Bad link');
  r = await fev(() => ({ opened: window.__opened, hint: document.body.classList.contains('fp-hint') }));
  ok(r.opened.length === 1 && r.opened[0][0] === 'https://example.com/' && r.opened[0][2] === 'noopener', 'URL opens in a new tab with noopener; javascript: refused', r.opened);
  ok(r.hint, 'clicking a non-interactive spot highlights the hotspots');

  // keyboard activation
  await fev((ids) => document.querySelector(`[data-fid="${ids.inst}"]`).focus(), ids);
  await page.keyboard.press('Enter');
  await wait(400);
  ok((await screenId()) === ids.B, 'Enter activates a focused hotspot');
  await f.focus('text=← Back');
  await page.keyboard.press(' ');
  await wait(400);
  ok((await screenId()) === ids.A, 'Space activates a focused hotspot');

  // screen menu + restart
  await page.selectOption('#play-root select', ids.O);
  await wait(100);
  ok((await screenId()) === ids.O, 'screen menu jumps to a screen');
  await page.click('#play-root button:has-text("Restart")');
  await wait(100);
  ok((await screenId()) === ids.A, 'Restart goes back to the start screen');
  await page.screenshot({ path: path.join(OUT, 'play.png') });

  // Esc with no overlay exits; Close button exits
  await fev(() => document.querySelector('.fp-wrap').focus());
  await page.keyboard.press('Escape');
  await wait(100);
  ok(!(await ev(() => Folio.prototype.isPlaying())) && !(await page.$('#play-root')), 'Esc exits play');
  await page.keyboard.press(process.platform === 'darwin' ? 'Alt+Meta+Enter' : 'Alt+Control+Enter');
  await page.waitForSelector('#play-root iframe');
  ok(await ev(() => Folio.prototype.isPlaying()), 'shortcut ⌥⌘↵ starts play');
  await page.click('#play-root [aria-label^="Close prototype"]');
  ok(!(await ev(() => Folio.prototype.isPlaying())), 'Close button exits play');

  // play starts on the selected artboard
  await ev((ids) => Folio.store.select([ids.O]), ids);
  await ev(() => Folio.prototype.play());
  f = await frameOf();
  ok((await screenId()) === ids.O, 'Play starts on the selected artboard');
  await ev(() => Folio.prototype.stop());
  await ev(() => Folio.store.select([]));

  // reduced motion → instant
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ev(() => Folio.prototype.play());
  f = await frameOf();
  await f.click(`[data-fid="${ids.inst}"]`);
  r = await f.evaluate(() => ({ n: document.querySelectorAll('#fp-stage > .fp-wrap').length, a: document.getAnimations().length }));
  ok(r.n === 1 && r.a === 0, 'prefers-reduced-motion makes transitions instant', r);
  await ev(() => Folio.prototype.stop());
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const after2 = await snap();
  ok(after2.doc === before.doc && after2.hist === before.hist, 'document and history unchanged after playing');

  // ---------- Export menu download ----------
  await page.click('#toolbar .tb-export');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.f-menu__item:has-text("Prototype (HTML)")')]);
  const pageName = await ev(() => Folio.store.currentPage().name);
  ok(dl.suggestedFilename() === pageName + '.prototype.html', 'Export menu downloads <Page name>.prototype.html', dl.suggestedFilename());
  const file = path.join(OUT, 'flow.prototype.html');
  await dl.saveAs(file);

  // ---------- exported file from file:// with no network ----------
  const ctx2 = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const requests = [];
  await ctx2.route(/^https?:/, (rt) => { requests.push(rt.request().url()); rt.abort(); });
  const p2 = await ctx2.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(String(e)));
  await p2.goto('file://' + file);
  await p2.waitForSelector('.fp-screen');
  const sid = () => p2.evaluate(() => { const w = [...document.querySelectorAll('#fp-stage > .fp-wrap .fp-screen')]; return w[w.length - 1].dataset.screen; });
  ok((await sid()) === ids.A, 'exported file opens on the start screen from file://');
  await p2.click(`[data-fid="${ids.inst}"]`);
  await p2.waitForTimeout(400);
  ok((await sid()) === ids.B, 'exported file navigates');
  await p2.click('text=← Back');
  await p2.waitForTimeout(400);
  await p2.click('text=Open sheet');
  await p2.waitForTimeout(300);
  await p2.keyboard.press('Escape');
  await p2.waitForTimeout(300);
  ok((await sid()) === ids.A && (await p2.evaluate(() => document.querySelectorAll('.fp-layer').length)) === 0, 'exported file: back + overlay + Esc work');
  ok(requests.every((u) => /fonts\.(googleapis|gstatic)\.com/.test(u)), 'exported file needs no network besides optional fonts', requests);
  ok(errs2.length === 0, 'no errors in the exported file', errs2);
  // fit: a 390px wide screen in a 300px window scales down
  await p2.setViewportSize({ width: 300, height: 600 });
  await p2.waitForTimeout(100);
  r = await p2.evaluate(() => { const w = document.querySelector('#fp-stage > .fp-wrap'); return { w: w.getBoundingClientRect().width, t: w.firstChild.style.transform }; });
  ok(Math.round(r.w) === 300 && /scale/.test(r.t), 'screen scales down to fit the window width', r);
  await p2.screenshot({ path: path.join(OUT, 'exported.png') });
  await ctx2.close();

  ok(errors.length === 0, 'no page errors in the app', errors);
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
