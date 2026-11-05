/* Brand kit integration test — node .dev/brand/test.js [--stub] */
const { open, check, SHOTS, useStub, fail } = require('./harness');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log(useStub ? '[using Folio.brand STUB]' : '[using real src/brand.js]');
  const { browser, page, errors } = await open({ noFonts: true });
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ---------- set up a brand + a test artboard ----------
  const setup = await ev(() => {
    const B = Folio.brand;
    const LOGO = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" rx="8" fill="#c2410c"/><circle cx="20" cy="20" r="10" fill="#fff"/></svg>');
    const tpl = (B.templates && B.templates()[0]) || {};
    const b = B.create(tpl);
    B.update(b.id, {
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
      logos: [{ id: 'l_ab12', name: 'Logo — on light', src: LOGO, width: 120, height: 40 }],
      style: {
        radius: { sm: 6, md: 12, lg: 24 },
        gradients: [
          { name: 'Sunrise', fill: { type: 'linear', angle: 135, stops: [{ color: 'var(--color-primary)', pos: 0 }, { color: 'var(--color-accent)', pos: 100 }] } },
          { name: 'Dough', fill: { type: 'mesh', base: 'var(--color-background)', spread: 60, points: [{ color: 'var(--color-accent)', x: 12, y: 18 }, { color: '#fde68a', x: 88, y: 12 }, { color: 'var(--color-primary)', x: 82, y: 88 }, { color: '#fdba74', x: 18, y: 82 }] } },
        ],
      },
    });
    B.setActive(b.id);
    const store = Folio.store;
    const ab = store.buildFromTree({
      type: 'frame', name: 'Brand Test', x: 0, y: 0, width: 600, height: 420,
      layout: { mode: 'flex', direction: 'column', gap: 16, padding: [32, 32, 32, 32] },
      style: { fills: [{ type: 'solid', color: 'var(--color-background)' }] },
      children: [
        { type: 'text', name: 'Headline', sizing: { w: 'fill', h: 'hug' }, text: { content: 'Fresh bread daily', font: 'var(--font-heading)', size: 40, weight: 700, color: 'var(--color-text)' } },
        { type: 'frame', name: 'Card', width: 300, height: 80, sizing: { w: 'fixed', h: 'fixed' },
          style: { fills: [{ type: 'solid', color: 'var(--color-primary)' }], radius: 'var(--radius-md)', border: { width: 4, color: 'var(--color-secondary)', style: 'solid' },
            shadows: [{ x: 0, y: 8, blur: 0, spread: 0, color: 'var(--color-accent)', visible: true }] } },
        { type: 'frame', name: 'Gradient', width: 300, height: 40, sizing: { w: 'fixed', h: 'fixed' },
          style: { fills: [{ type: 'linear', angle: 90, stops: [{ color: 'var(--color-primary)', pos: 0 }, { color: 'var(--color-secondary)', pos: 100 }] }] } },
        { type: 'frame', name: 'Row', layout: { mode: 'flex', direction: 'row', gap: 16 }, sizing: { w: 'hug', h: 'hug' }, style: { fills: [] },
          children: [
            { type: 'image', name: 'Logo', width: 120, height: 40, image: { src: 'brand-logo:l_ab12', fit: 'contain' } },
            { type: 'frame', name: 'Logo Fill', width: 120, height: 40, sizing: { w: 'fixed', h: 'fixed' }, style: { fills: [{ type: 'image', src: 'brand-logo:l_ab12', fit: 'contain' }] } },
            { type: 'frame', name: 'Mesh', width: 120, height: 40, sizing: { w: 'fixed', h: 'fixed' }, style: { fills: [{ type: 'mesh', base: 'var(--color-surface)', spread: 60, points: [{ color: 'var(--color-primary)', x: 10, y: 10 }, { color: '#22d3ee', x: 90, y: 10 }, { color: 'var(--color-accent)', x: 90, y: 90 }, { color: '#10b981', x: 10, y: 90 }] }] } },
          ] },
      ],
    });
    // put it alone on the canvas
    store.doc.roots.filter((id) => id !== ab.id).forEach((id) => store.remove(id));
    store.commit('setup');
    const ids = {};
    [ab.id, ...store.descendants(ab.id)].forEach((id) => (ids[store.get(id).name] = id));
    return { brandId: b.id, ids };
  });
  const { ids, brandId } = setup;
  await page.waitForTimeout(200);

  // ---------- canvas rendering ----------
  console.log('canvas');
  const cs = await ev((ids) => {
    const g = (id) => getComputedStyle(Folio.render.el(id));
    return {
      ab: g(ids['Brand Test']).backgroundColor,
      card: g(ids.Card).backgroundColor,
      radius: g(ids.Card).borderTopLeftRadius,
      border: g(ids.Card).borderTopColor,
      shadow: g(ids.Card).boxShadow,
      font: g(ids.Headline).fontFamily,
      color: g(ids.Headline).color,
      grad: g(ids.Gradient).backgroundImage,
      img: Folio.render.el(ids.Logo).src.slice(0, 30),
      fill: g(ids['Logo Fill']).backgroundImage.slice(0, 40),
      fontLinks: [...document.querySelectorAll('link[data-font]')].map((l) => l.dataset.font),
    };
  }, ids);
  check(cs.ab === 'rgb(255, 247, 237)', 'artboard background token renders', cs.ab);
  check(cs.card === 'rgb(194, 65, 12)', 'solid fill token renders', cs.card);
  check(cs.radius === '12px', 'radius token renders', cs.radius);
  check(cs.border === 'rgb(30, 58, 138)', 'border token renders', cs.border);
  check(/245, 158, 11/.test(cs.shadow), 'shadow token renders', cs.shadow);
  check(/Fraunces/.test(cs.font), 'font token renders', cs.font);
  check(cs.color === 'rgb(28, 25, 23)', 'text colour token renders', cs.color);
  check(/194, 65, 12/.test(cs.grad), 'gradient stop tokens render', cs.grad);
  check(cs.img.startsWith('data:image/svg'), 'brand-logo image node resolves', cs.img);
  check(/url\("data:image\/svg/.test(cs.fill), 'brand-logo image fill resolves', cs.fill);
  check(cs.fontLinks.includes('Fraunces'), 'brand font token loads Google font', cs.fontLinks);

  // ---------- inspector: linked chips ----------
  console.log('inspector');
  const sel = async (id) => {
    await ev((id) => Folio.store.select(id), id);
    await page.waitForTimeout(80);
  };
  await sel(ids.Card);
  const q = await ev(() => {
    const qk = document.querySelector('#inspector .ins-fill .ins-quick');
    return { linked: qk.classList.contains('is-linked'), name: qk.querySelector('.ins-link__name').textContent };
  });
  check(q.linked && q.name === 'Primary', 'fill row shows linked chip "Primary"', q);
  const sw = await ev(() => getComputedStyle(document.querySelector('#inspector .ins-fill .ins-swatch i')).backgroundColor);
  check(sw === 'rgb(194, 65, 12)', 'fill row swatch preview resolves token', sw);
  // border + shadow fields
  const bs = await ev(() => {
    const out = {};
    document.querySelectorAll('#inspector .ins-sec').forEach((s) => {
      const c = s.querySelector('.ins-color');
      if (c) out[s.dataset.sec] = { linked: c.classList.contains('is-linked'), name: (c.querySelector('.ins-link__name') || {}).textContent, chip: getComputedStyle(c.querySelector('.ins-link__sw i')).backgroundColor };
    });
    return out;
  });
  check(bs.border && bs.border.linked && bs.border.name === 'Secondary' && bs.border.chip === 'rgb(30, 58, 138)', 'border field linked chip', bs.border);
  check(bs.shadows && bs.shadows.linked && bs.shadows.name === 'Accent', 'shadow field linked chip', bs.shadows);
  // radius chip
  const rad = await ev(() => {
    const c = document.querySelector('#inspector .ins-link--radius');
    const act = [...document.querySelectorAll('#inspector .ins-rad-presets button')].map((b) => b.dataset.radius + ':' + b.classList.contains('is-active'));
    return { name: c && c.querySelector('.ins-link__name').textContent, act };
  });
  check(rad.name === 'MD · 12', 'radius linked chip shows MD · 12', rad);
  check(rad.act.includes('var(--radius-md):true') && rad.act.length === 4, 'radius quick buttons sm/md/lg/pill, md active', rad.act);
  // css preview prints var()
  const cssTxt = await ev(() => document.querySelector('#inspector .ins-code').textContent);
  check(/background-color: var\(--color-primary\)/.test(cssTxt) && /border-radius: var\(--radius-md\)/.test(cssTxt), 'CSS view prints var() values');
  const tkv = await ev(() => document.querySelectorAll('#inspector .ins-code .tk-var').length);
  check(tkv >= 3, 'CSS view highlights tokens', tkv);
  await page.screenshot({ path: path.join(SHOTS, 'card-linked.png'), clip: { x: 1160, y: 40, width: 280, height: 860 } });

  // ---- detach + relink: fill quick
  const fillColor = (id, i = 0) => ev(({ id, i }) => Folio.store.get(id).style.fills[i].color, { id, i });
  await page.click('#inspector .ins-fill .ins-qlink');
  await page.waitForTimeout(50);
  check(await page.isVisible('.ins-pop .ins-bcolor[data-color="primary"].is-active'), 'quick chip opens brand popover with Primary active');
  await page.screenshot({ path: path.join(SHOTS, 'popover.png'), clip: { x: 900, y: 0, width: 540, height: 600 } });
  await page.click('.ins-pop .ins-bcolor[data-color="secondary"]');
  await page.waitForTimeout(60);
  check((await fillColor(ids.Card)) === 'var(--color-secondary)', 'pick brand colour from quick chip links fill');
  check(!(await page.isVisible('.ins-pop')), 'popover closes after pick');
  // open the fill editor (click swatch), detach in colorField
  await page.click('#inspector .ins-fill .ins-swatch');
  await page.waitForTimeout(80);
  const ed = '#inspector .ins-fill-item .ins-editor .ins-color';
  check(await ev((s) => document.querySelector(s).classList.contains('is-linked'), ed), 'fill editor colour field is linked');
  await page.click(ed + ' .ins-detach');
  await page.waitForTimeout(60);
  check((await fillColor(ids.Card)) === '#1e3a8a', 'detach fill → literal value', await fillColor(ids.Card));
  check(await ev((s) => !document.querySelector(s).classList.contains('is-linked') && !document.querySelector(s + ' .ins-bbtn').hidden, ed), 'detached field shows hex + palette button');
  const hexv = await ev((s) => document.querySelector(s + ' .ins-hex').value, ed);
  check(hexv === '1E3A8A', 'hex field shows literal after detach', hexv);
  await page.click(ed + ' .ins-bbtn');
  await page.click('.ins-pop .ins-bcolor[data-color="primary"]');
  await page.waitForTimeout(60);
  check((await fillColor(ids.Card)) === 'var(--color-primary)', 'palette button links fill to Primary');
  // quick palette when literal
  await ev((id) => { Folio.store.update(id, { style: { fills: [{ type: 'solid', color: '#123456', visible: true }] } }); Folio.store.commit('x'); }, ids.Card);
  await page.waitForTimeout(80);
  check(await page.isVisible('#inspector .ins-fill .ins-qbrand'), 'quick palette visible for literal fill');
  await page.screenshot({ path: path.join(SHOTS, 'card-literal.png'), clip: { x: 1160, y: 40, width: 280, height: 860 } });
  await page.click('#inspector .ins-fill .ins-qbrand');
  await page.click('.ins-pop .ins-bcolor[data-color="c_ab12"]');
  await page.waitForTimeout(60);
  check((await fillColor(ids.Card)) === 'var(--color-c_ab12)', 'quick palette links custom colour');
  const qn = await ev(() => document.querySelector('#inspector .ins-fill .ins-quick .ins-link__name').textContent);
  check(qn === 'Crust', 'custom colour chip shows its name', qn);

  // ---- border + shadow link/detach
  const secColor = (sec) => '#inspector .ins-sec[data-sec="' + sec + '"] .ins-color';
  await page.click(secColor('border') + ' .ins-detach');
  await page.waitForTimeout(50);
  check((await ev((id) => Folio.store.get(id).style.border.color, ids.Card)) === '#1e3a8a', 'border detach');
  await page.click(secColor('border') + ' .ins-bbtn');
  await page.click('.ins-pop .ins-bcolor[data-color="muted"]');
  await page.waitForTimeout(50);
  check((await ev((id) => Folio.store.get(id).style.border.color, ids.Card)) === 'var(--color-muted)', 'border link');
  await page.click(secColor('shadows') + ' .ins-detach');
  await page.waitForTimeout(50);
  check((await ev((id) => Folio.store.get(id).style.shadows[0].color, ids.Card)) === '#f59e0b', 'shadow detach');
  await page.click(secColor('shadows') + ' .ins-bbtn');
  await page.click('.ins-pop .ins-bcolor[data-color="text"]');
  await page.waitForTimeout(50);
  check((await ev((id) => Folio.store.get(id).style.shadows[0].color, ids.Card)) === 'var(--color-text)', 'shadow link');

  // ---- radius buttons
  await page.click('#inspector .ins-link--radius .ins-detach');
  await page.waitForTimeout(60);
  check((await ev((id) => Folio.store.get(id).style.radius, ids.Card)) === 12, 'radius detach → 12');
  await page.click('#inspector .ins-rad-presets button[data-radius="var(--radius-lg)"]');
  await page.waitForTimeout(60);
  check((await ev((id) => Folio.store.get(id).style.radius, ids.Card)) === 'var(--radius-lg)', 'radius LG button links token');
  check((await ev((id) => getComputedStyle(Folio.render.el(id)).borderTopLeftRadius, ids.Card)) === '24px', 'canvas shows lg radius');
  await page.click('#inspector .ins-rad-presets button[data-radius="9999"]');
  await page.waitForTimeout(60);
  check((await ev((id) => Folio.store.get(id).style.radius, ids.Card)) === 9999, 'pill → 9999 literal');
  await page.click('#inspector .ins-rad-presets button[data-radius="var(--radius-md)"]');
  await page.waitForTimeout(60);

  // ---- fill + menu with brand gradients
  await page.click('#inspector .ins-sec[data-sec="fill"] .ins-sec__actions button[title="Add fill"]');
  await page.waitForTimeout(50);
  check(await page.isVisible('.ins-pop--fill .ins-bgrad[data-gradient="Sunrise"]'), 'fill + menu lists brand gradients');
  const gradPrev = await ev(() => getComputedStyle(document.querySelector('.ins-pop--fill .ins-bgrad')).backgroundImage);
  check(/194, 65, 12/.test(gradPrev), 'brand gradient preview resolves tokens', gradPrev);
  await page.screenshot({ path: path.join(SHOTS, 'fill-menu.png'), clip: { x: 900, y: 0, width: 540, height: 700 } });
  await page.click('.ins-pop--fill .ins-bgrad[data-gradient="Sunrise"]');
  await page.waitForTimeout(80);
  const nf = await ev((id) => Folio.store.get(id).style.fills, ids.Card);
  check(nf.length === 2 && nf[1].type === 'linear' && nf[1].stops[0].color === 'var(--color-primary)', 'brand gradient added on top', nf);
  // gradient stops in the (auto-expanded) editor
  const stops = await ev(() => [...document.querySelectorAll('#inspector .ins-stop .ins-color')].map((c) => c.classList.contains('is-linked') && c.querySelector('.ins-link__name').textContent));
  check(stops[0] === 'Primary' && stops[1] === 'Accent', 'gradient stop fields show linked chips', stops);
  const handle = await ev(() => getComputedStyle(document.querySelector('#inspector .ins-gstop i')).backgroundColor);
  check(handle === 'rgb(194, 65, 12)', 'stop handle preview resolves token', handle);
  await page.screenshot({ path: path.join(SHOTS, 'gradient-editor.png'), clip: { x: 1160, y: 40, width: 280, height: 860 } });
  await page.click('#inspector .ins-stop .ins-color .ins-detach');
  await page.waitForTimeout(60);
  check((await ev((id) => Folio.store.get(id).style.fills[1].stops[0].color, ids.Card)) === '#c2410c', 'gradient stop detach');
  await page.click('#inspector .ins-stop .ins-color .ins-bbtn');
  await page.click('.ins-pop .ins-bcolor[data-color="secondary"]');
  await page.waitForTimeout(60);
  check((await ev((id) => Folio.store.get(id).style.fills[1].stops[0].color, ids.Card)) === 'var(--color-secondary)', 'gradient stop link');
  // + menu: brand colour fill
  await page.click('#inspector .ins-sec[data-sec="fill"] .ins-sec__actions button[title="Add fill"]');
  await page.click('.ins-pop--fill .ins-bcolor[data-color="accent"]');
  await page.waitForTimeout(60);
  check((await ev((id) => Folio.store.get(id).style.fills[2], ids.Card)).color === 'var(--color-accent)', '+ menu brand colour adds linked solid fill');
  await page.click('#inspector .ins-sec[data-sec="fill"] .ins-sec__actions button[title="Add fill"]');
  await page.click('.ins-pop--fill .ins-pop__item');
  await page.waitForTimeout(60);
  check((await ev((id) => Folio.store.get(id).style.fills.length, ids.Card)) === 4, '+ menu plain solid fill');
  await ev((id) => { Folio.store.update(id, { style: { fills: [{ type: 'solid', color: 'var(--color-primary)', visible: true }] } }); Folio.store.commit('x'); }, ids.Card);

  // ---- mesh points
  await sel(ids.Mesh);
  await page.click('#inspector .ins-fill .ins-swatch');
  await page.waitForTimeout(80);
  const mesh = await ev(() => [...document.querySelectorAll('#inspector .ins-editor .ins-prop .ins-color')].map((c) => (c.classList.contains('is-linked') ? c.querySelector('.ins-link__name').textContent : c.querySelector('.ins-hex').value)));
  check(mesh.join(',') === 'Surface,Primary,22D3EE,Accent,10B981', 'mesh base + points linked/literal', mesh);
  await page.screenshot({ path: path.join(SHOTS, 'mesh-editor.png'), clip: { x: 1160, y: 40, width: 280, height: 860 } });
  const meshRows = '#inspector .ins-editor .ins-prop .ins-color';
  await page.click(`${meshRows} >> nth=2 >> .ins-bbtn`);
  await page.click('.ins-pop .ins-bcolor[data-color="secondary"]');
  await page.waitForTimeout(60);
  check((await ev((id) => Folio.store.get(id).style.fills[0].points[1].color, ids.Mesh)) === 'var(--color-secondary)', 'mesh point link');
  await page.click(`${meshRows} >> nth=0 >> .ins-detach`);
  await page.waitForTimeout(60);
  check((await ev((id) => Folio.store.get(id).style.fills[0].base, ids.Mesh)) === '#ffffff', 'mesh base detach');

  // ---- text colour + font select
  await sel(ids.Headline);
  const tsec = '#inspector .ins-sec[data-sec="text"]';
  const font = await ev((s) => {
    const sel = document.querySelector(s + ' select.ins-font');
    const g = sel.querySelector('optgroup');
    return { value: sel.value, group: g.label, opts: [...g.querySelectorAll('option')].map((o) => o.value + '=' + o.textContent), shown: sel.selectedOptions[0].textContent,
      weights: [...document.querySelectorAll(s + ' select[data-k="weight"] option')].map((o) => +o.value), link: !!document.querySelector(s + ' .ins-font-link'), detach: !!document.querySelector(s + ' .ins-detach') };
  }, tsec);
  check(font.group.startsWith('Brand') && font.opts[0] === 'var(--font-heading)=Heading · Fraunces' && font.opts[1] === 'var(--font-body)=Body · DM Sans', 'brand fonts at top of family select', font);
  check(font.value === 'var(--font-heading)' && font.shown === 'Heading · Fraunces', 'linked font shown with resolved family', font.shown);
  check(font.weights.length === 9 && font.link && font.detach, 'weights of resolved family (Fraunces 100–900) + link + detach', font.weights);
  const tcol = await ev((s) => { const c = document.querySelector(s + ' .ins-color'); return c.classList.contains('is-linked') && c.querySelector('.ins-link__name').textContent; }, tsec);
  check(tcol === 'Text', 'text colour linked chip', tcol);
  await page.screenshot({ path: path.join(SHOTS, 'text-linked.png'), clip: { x: 1160, y: 40, width: 280, height: 860 } });
  await page.selectOption(tsec + ' select.ins-font', 'var(--font-body)');
  await page.waitForTimeout(80);
  let tn = await ev((id) => Folio.store.get(id).text, ids.Headline);
  check(tn.font === 'var(--font-body)' && tn.weight === 400, 'select brand body font links it and takes brand weight', tn);
  await page.click(tsec + ' .ins-detach');
  await page.waitForTimeout(80);
  tn = await ev((id) => Folio.store.get(id).text, ids.Headline);
  check(tn.font === 'DM Sans', 'font detach → family', tn.font);
  await page.selectOption(tsec + ' select.ins-font', 'var(--font-heading)');
  await page.waitForTimeout(80);
  await page.click(tsec + ' .ins-color .ins-detach');
  await page.waitForTimeout(60);
  check((await ev((id) => Folio.store.get(id).text.color, ids.Headline)) === '#1c1917', 'text colour detach');
  await page.click(tsec + ' .ins-color .ins-bbtn');
  await page.click('.ins-pop .ins-bcolor[data-color="text"]');
  await page.waitForTimeout(60);
  check((await ev((id) => Folio.store.get(id).text.color, ids.Headline)) === 'var(--color-text)', 'text colour link');

  // ---- image node: logo chip
  await sel(ids.Logo);
  const logo = await ev(() => {
    const c = document.querySelector('#inspector .ins-link--logo');
    return { hidden: c.hidden, name: c.querySelector('.ins-link__name').textContent, thumb: getComputedStyle(document.querySelector('#inspector .ins-thumb')).backgroundImage.slice(0, 30), active: !!document.querySelector('#inspector .ins-blogo.is-active') };
  });
  check(!logo.hidden && logo.name === 'Logo — on light' && /data:image\/svg/.test(logo.thumb) && logo.active, 'image section shows linked logo', logo);
  await page.screenshot({ path: path.join(SHOTS, 'image-logo.png'), clip: { x: 1160, y: 40, width: 280, height: 700 } });

  // ---------- live brand edit ----------
  console.log('live brand edit');
  await sel(ids.Card);
  await ev((bid) => {
    const b = Folio.brand.get(bid);
    const colors = JSON.parse(JSON.stringify(b.colors));
    colors.find((c) => c.id === 'primary').value = '#16a34a';
    Folio.brand.update(bid, { colors });
  }, brandId);
  await page.waitForTimeout(120);
  const live = await ev((ids) => ({
    canvas: getComputedStyle(Folio.render.el(ids.Card)).backgroundColor,
    grad: getComputedStyle(Folio.render.el(ids.Gradient)).backgroundImage,
    rowSw: getComputedStyle(document.querySelector('#inspector .ins-fill .ins-swatch i')).backgroundColor,
    code: document.querySelector('#inspector .ins-code').innerHTML.includes('#16a34a'),
  }), ids);
  check(live.canvas === 'rgb(22, 163, 74)', 'canvas updates live after brand edit', live.canvas);
  check(/22, 163, 74/.test(live.grad), 'canvas gradient updates live', live.grad);
  check(live.rowSw === 'rgb(22, 163, 74)', 'inspector swatch updates live', live.rowSw);
  check(live.code, 'CSS view swatch updates live');
  // brand edit while typing in the inspector must not rebuild under the focused field
  await page.click('#inspector input[data-k="name"]');
  await page.keyboard.type('X');
  await ev((bid) => Folio.brand.update(bid, { fonts: [{ id: 'heading', name: 'Heading', family: 'Playfair Display', weight: 700, core: true }, { id: 'body', name: 'Body', family: 'DM Sans', weight: 400, core: true }] }), brandId);
  await page.waitForTimeout(120);
  const foc = await ev(() => document.activeElement && document.activeElement.dataset.k);
  check(foc === 'name', 'focus kept while brand fonts change', foc);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  await ev((id) => Folio.store.update(id, { name: 'Card' }), ids.Card);
  await sel(ids.Headline);
  const shown = await ev(() => document.querySelector('#inspector select.ins-font').selectedOptions[0].textContent);
  check(shown === 'Heading · Playfair Display', 'font select follows brand family change', shown);
  check((await ev((id) => getComputedStyle(Folio.render.el(id)).fontFamily, ids.Headline)).includes('Playfair'), 'canvas font follows brand family change');
  // logo replaced
  await ev((bid) => {
    const b = Folio.brand.get(bid);
    const logos = JSON.parse(JSON.stringify(b.logos));
    logos[0].src = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#1d4ed8"/></svg>');
    Folio.brand.update(bid, { logos });
  }, brandId);
  await page.waitForTimeout(120);
  const lg = await ev((ids) => ({ img: Folio.render.el(ids.Logo).src, fill: getComputedStyle(Folio.render.el(ids['Logo Fill'])).backgroundImage }), ids);
  const newB64 = await ev(() => btoa('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#1d4ed8"/></svg>'));
  check(lg.img.includes(newB64) && lg.fill.includes(newB64), 'replaced logo re-renders image node + image fill');
  await ev((bid) => Folio.brand.update(bid, { fonts: [{ id: 'heading', name: 'Heading', family: 'Fraunces', weight: 700, core: true }, { id: 'body', name: 'Body', family: 'DM Sans', weight: 400, core: true }] }), brandId);

  // ---------- exports ----------
  console.log('exports');
  const ex = await ev((id) => {
    const E = Folio.exporter;
    return { css: E.cssFor(id), html: E.htmlFor(id), inline: E.inlineHtmlFor(id), page: E.pageFor(id), fonts: E.fontsUsed(id), snippet: E.snippetFor(id) };
  }, ids['Brand Test']);
  check(/^:root \{\n  --color-/.test(ex.css), 'cssFor starts with :root block');
  check(/--color-primary: #16a34a;/.test(ex.css) && /--font-heading: "Fraunces"/.test(ex.css) && /--radius-md: 12px;/.test(ex.css), ':root has used vars');
  check(!/--color-c_ab12|--radius-sm|--radius-lg|--font-body/.test(ex.css), ':root limited to vars actually used', ex.css.slice(0, 500));
  check(ex.page.includes(':root {') && ex.snippet.includes(':root {'), 'page + snippet include :root');
  check(!ex.inline.includes('var(--') && ex.inline.includes('#16a34a') && ex.inline.includes('&quot;Fraunces&quot;'), 'inline HTML resolves tokens to literals');
  check(!/brand-logo:/.test(ex.css + ex.html + ex.inline + ex.page), 'no brand-logo: left in exports');
  check(/<img[^>]+src="data:image\/svg/.test(ex.html) && /url\("data:image\/svg/.test(ex.css), 'logo resolved in html img + css fill');
  check(ex.fonts.includes('Fraunces') && /family=Fraunces/.test(ex.page), 'Google Fonts link includes brand font', ex.fonts);
  // code panel
  await sel(ids['Brand Test']);
  await ev(() => Folio.codePanel.toggle(true));
  await page.waitForTimeout(250);
  const cp = await ev(() => document.querySelector('#code-panel [data-pane="css"] pre').textContent);
  check(cp.startsWith(':root {'), 'code panel CSS shows :root vars');
  await ev(() => Folio.codePanel.setTab('inline'));
  await page.waitForTimeout(100);
  const cpi = await ev(() => document.querySelector('#code-panel [data-pane="inline"] pre').textContent);
  check(!cpi.includes('var(--'), 'code panel inline resolves tokens');
  await ev(() => { Folio.codePanel.setTab('split'); Folio.codePanel.toggle(false); });

  // ---------- standalone page vs canvas ----------
  console.log('standalone page vs canvas');
  await ev(() => { Folio.store.select([]); Folio.store.setViewport({ x: 100, y: 100, zoom: 1 }); });
  await page.addStyleTag({ content: '#canvas-overlay{display:none!important}' });
  await page.waitForTimeout(200);
  const r = await ev((id) => { const b = Folio.render.el(id).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, ids['Brand Test']);
  const canvasShot = await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
  fs.writeFileSync(path.join(SHOTS, 'cmp-canvas.png'), canvasShot);
  const pageFile = path.join(SHOTS, 'standalone.html');
  fs.writeFileSync(pageFile, ex.page);
  const p2 = await page.context().newPage();
  await p2.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p2.setViewportSize({ width: 1000, height: 700 });
  await p2.goto('file://' + pageFile);
  await p2.waitForTimeout(300);
  const r2 = await p2.evaluate(() => { const b = document.body.firstElementChild.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const pageShot = await p2.screenshot({ clip: { x: r2.x, y: r2.y, width: r2.w, height: r2.h } });
  fs.writeFileSync(path.join(SHOTS, 'cmp-page.png'), pageShot);
  check(Math.round(r.w) === Math.round(r2.w) && Math.round(r.h) === Math.round(r2.h), 'standalone page same size as canvas', [r, r2]);
  const diff = await ev(async ([a, b]) => {
    const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
    const [A, B] = await Promise.all([load(a), load(b)]);
    const w = Math.min(A.width, B.width), h = Math.min(A.height, B.height);
    const px = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = px(A), db = px(B);
    let bad = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 30) bad++;
    return bad / (w * h);
  }, [canvasShot.toString('base64'), pageShot.toString('base64')]);
  check(diff < 0.005, 'standalone page renders identically to canvas (diff ' + (diff * 100).toFixed(3) + '%)');
  // inline variant renders identically as well
  const inlineDoc = `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0}body{display:flex;min-height:100vh;background:#e9e9ec}body>:first-child{margin:auto;flex-shrink:0}h1,h2,h3,p{margin:0}img{display:block;max-width:none}</style></head><body>${ex.inline}</body></html>`;
  await p2.setContent(inlineDoc);
  await p2.waitForTimeout(200);
  const r3 = await p2.evaluate(() => { const b = document.body.firstElementChild.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const inlShot = await p2.screenshot({ clip: { x: r3.x, y: r3.y, width: r3.w, height: r3.h } });
  const diff2 = await ev(async ([a, b]) => {
    const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
    const [A, B] = await Promise.all([load(a), load(b)]);
    const w = Math.min(A.width, B.width), h = Math.min(A.height, B.height);
    const px = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = px(A), db = px(B);
    let bad = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 30) bad++;
    return bad / (w * h);
  }, [canvasShot.toString('base64'), inlShot.toString('base64')]);
  check(diff2 < 0.005, 'inline HTML renders identically to canvas (diff ' + (diff2 * 100).toFixed(3) + '%)');
  await p2.close();

  // ---------- PNG ----------
  console.log('png');
  const png = await ev((id) => Folio.exporter.pngDataUrl(id, { scale: 1 }).then((u) => u, (e) => 'ERR ' + e.message), ids['Brand Test']);
  check(png.startsWith('data:image/png'), 'pngDataUrl works', png.slice(0, 60));
  if (png.startsWith('data:image/png')) {
    fs.writeFileSync(path.join(SHOTS, 'export.png'), Buffer.from(png.split(',')[1], 'base64'));
    const diff3 = await ev(async ([a, b]) => {
      const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
      const [A, B] = await Promise.all([load('data:image/png;base64,' + a), load(b)]);
      const w = Math.min(A.width, B.width), h = Math.min(A.height, B.height);
      const px = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
      const da = px(A), db = px(B);
      let bad = 0;
      for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 30) bad++;
      return { d: bad / (w * h), size: [A.width, A.height, B.width, B.height] };
    }, [canvasShot.toString('base64'), png]);
    check(diff3.d < 0.02, 'PNG export matches canvas incl. tokens (diff ' + (diff3.d * 100).toFixed(3) + '%)', diff3.size);
  }

  // ---------- JSON round trip ----------
  console.log('json');
  await sel(ids['Brand Test']);
  const [dl] = await Promise.all([page.waitForEvent('download'), ev(() => Folio.exporter.saveFile())]);
  const saved = path.join(SHOTS, 'saved.folio.json');
  await dl.saveAs(saved);
  const json = JSON.parse(fs.readFileSync(saved, 'utf8'));
  check(json.brand && json.brand.id === brandId && json.brand.colors.find((c) => c.id === 'primary').value === '#16a34a', 'saved file has doc.brand');
  await ev(() => { Folio.store.newDoc(); });
  await page.waitForTimeout(100);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), ev(() => Folio.exporter.openFile())]);
  await fc.setFiles(saved);
  await page.waitForTimeout(400);
  const rt = await ev((cid) => {
    const d = Folio.store.doc;
    const card = d.nodes[cid];
    return { brand: d.brand && d.brand.id, active: Folio.brand.active() && Folio.brand.active().id, fill: card && card.style.fills[0].color, bg: card && getComputedStyle(Folio.render.el(card.id)).backgroundColor };
  }, ids.Card);
  check(rt.brand === brandId && rt.active === brandId, 'opened file keeps doc.brand', rt);
  check(rt.fill === 'var(--color-primary)' && rt.bg === 'rgb(22, 163, 74)', 'opened file renders tokens', rt);
  // undo/redo keeps brand in doc snapshots
  check(await ev(() => JSON.parse(Folio.store.history[Folio.store.historyIndex]).brand != null), 'history snapshot carries doc.brand');

  check(errors.length === 0, 'no page errors', errors);
  await browser.close();
  console.log(fail() ? `\n${fail()} FAILURE(S)` : '\nALL PASSED');
  process.exit(fail() ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
