const { open, SHOTS } = require('./harness');
const path = require('path');
(async () => {
  const { browser, page } = await open({ noFonts: true });
  const ev = (fn, a) => page.evaluate(fn, a);
  const ids = await ev(() => {
    const B = Folio.brand; const b = B.create(B.templates()[0]); B.setActive(b.id);
    const s = Folio.store;
    const ab = s.buildFromTree({ type: 'frame', name: 'Card', x: 0, y: 0, width: 300, height: 200,
      style: { fills: [{ type: 'solid', color: '#3366ff80' }], shadows: [{ x: 0, y: 4, blur: 16, spread: 0, color: '#00000026', visible: true }], border: { width: 1, color: '#e5e5e5', style: 'solid' } } });
    s.select(ab.id);
    return { ab: ab.id, brand: b };
  });
  console.log(JSON.stringify(ids.brand).slice(0, 1500));
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOTS, 'literal-all.png'), clip: { x: 1160, y: 40, width: 280, height: 860 } });
  await page.hover('#inspector .ins-sec[data-sec="shadows"] .ins-color');
  await page.screenshot({ path: path.join(SHOTS, 'shadow-hover.png'), clip: { x: 1160, y: 500, width: 280, height: 400 } });
  await page.click('#inspector .ins-sec[data-sec="border"] .ins-bbtn');
  await page.waitForTimeout(80);
  await page.screenshot({ path: path.join(SHOTS, 'popover-full.png') });
  await page.keyboard.press('Escape');
  await page.click('#inspector .ins-sec[data-sec="fill"] .ins-sec__actions button[title="Add fill"]');
  await page.waitForTimeout(80);
  await page.screenshot({ path: path.join(SHOTS, 'fillmenu-full.png') });
  await browser.close();
})();
