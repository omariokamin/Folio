/* Folio without Folio.brand (feature detection) and with a brand module but no active brand. */
const { open, check, SHOTS, fail } = require('./harness');
const path = require('path');
(async () => {
  for (const mode of ['noBrandModule', 'noActiveBrand']) {
    console.log(mode);
    const { browser, page, errors } = await open({ noFonts: true, noBrand: mode === 'noBrandModule' });
    const ev = (fn, a) => page.evaluate(fn, a);
    const ids = await ev(() => {
      const s = Folio.store;
      const ab = s.buildFromTree({ type: 'frame', name: 'T', x: 0, y: 0, width: 300, height: 200, layout: { mode: 'flex', direction: 'column', gap: 8, padding: [16, 16, 16, 16] },
        style: { fills: [{ type: 'solid', color: 'var(--color-primary)' }], radius: 'var(--radius-md)' },
        children: [{ type: 'text', name: 'H', text: { content: 'Hi', font: 'var(--font-heading)', color: 'var(--color-text)' } }, { type: 'image', name: 'L', image: { src: 'brand-logo:l_x' } }] });
      s.commit('x');
      return { ab: ab.id, h: s.get(ab.id).children[0], l: s.get(ab.id).children[1] };
    });
    check(await ev(() => !!Folio.brand) === (mode !== 'noBrandModule'), 'Folio.brand presence as expected');
    await ev((id) => Folio.store.select(id), ids.ab);
    await page.waitForTimeout(100);
    const st = await ev(() => ({
      quick: document.querySelector('#inspector .ins-fill .ins-quick').className,
      name: document.querySelector('#inspector .ins-fill .ins-link__name').textContent,
      radRow: !!document.querySelector('#inspector .ins-rad-row'),
      radChip: (document.querySelector('#inspector .ins-link--radius .ins-link__name') || {}).textContent,
      bbtns: [...document.querySelectorAll('#inspector .ins-bbtn, #inspector .ins-qbrand')].filter((b) => getComputedStyle(b).display !== 'none').length,
    }));
    check(/is-linked/.test(st.quick) && st.name.startsWith('Primary'), 'token fill still shows linked chip', st);
    check(!st.radRow && st.bbtns === 0, 'no brand radius row / palette buttons without active brand', st);
    check(/^MD/.test(st.radChip || ''), 'radius chip shown', st.radChip);
    // + adds a plain fill immediately
    await page.click('#inspector .ins-sec[data-sec="fill"] .ins-sec__actions button[title="Add fill"]');
    await page.waitForTimeout(60);
    check(!(await page.isVisible('.ins-pop')) && (await ev((id) => Folio.store.get(id).style.fills.length, ids.ab)) === 2, '+ adds a fill directly');
    // detach works with nothing to resolve -> fallback
    await page.click('#inspector .ins-fill-item .ins-editor .ins-color .ins-detach').catch(() => {});
    await ev((id) => Folio.store.select(id), ids.h);
    await page.waitForTimeout(100);
    const t = await ev(() => document.querySelector('#inspector select.ins-font').selectedOptions[0].textContent);
    check(/not in brand/.test(t), 'unknown font token listed as custom', t);
    await ev((id) => Folio.store.select(id), ids.l);
    await page.waitForTimeout(100);
    const ex = await ev((id) => ({ css: Folio.exporter.cssFor(id), html: Folio.exporter.htmlFor(id), inline: Folio.exporter.inlineHtmlFor(id) }), ids.ab);
    check(!ex.css.startsWith(':root') && !/brand-logo:/.test(ex.html), 'exports without brand: no :root, logo src dropped', ex.html);
    await page.screenshot({ path: path.join(SHOTS, mode + '.png'), clip: { x: 1160, y: 40, width: 280, height: 860 } });
    check(errors.length === 0, 'no page errors', errors);
    await browser.close();
  }
  console.log(fail() ? `\n${fail()} FAILURE(S)` : '\nALL PASSED');
  process.exit(fail() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
