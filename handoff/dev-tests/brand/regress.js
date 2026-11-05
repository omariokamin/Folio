/* Select every demo layer (with and without an active brand) and open each fill editor: no errors. */
const { open, check, fail } = require('./harness');
(async () => {
  const { browser, page, errors } = await open({ noFonts: true });
  for (const withBrand of [false, true]) {
    if (withBrand) await page.evaluate(() => { const B = Folio.brand; B.setActive(B.create(B.templates()[1] || B.templates()[0]).id); });
    const n = await page.evaluate(async () => {
      const ids = Object.keys(Folio.store.doc.nodes);
      const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
      for (const id of ids) {
        Folio.store.select(id);
        await raf();
        const sws = document.querySelectorAll('#inspector .ins-fill .ins-swatch');
        for (let i = 0; i < sws.length; i++) {
          document.querySelectorAll('#inspector .ins-fill .ins-swatch')[i].click();
          await raf();
        }
      }
      Folio.exporter.pageFor(Folio.store.doc.roots[0]);
      Folio.exporter.inlineHtmlFor(Folio.store.doc.roots[0]);
      return ids.length;
    });
    check(n > 20, `visited ${n} layers (brand: ${withBrand})`);
  }
  // undo/redo across brand linking
  await page.evaluate(() => {
    const id = Folio.store.doc.roots[0];
    Folio.store.update(id, { style: { fills: [{ type: 'solid', color: 'var(--color-primary)', visible: true }] } });
    Folio.store.commit('link');
    Folio.store.undo();
    Folio.store.redo();
  });
  check(errors.length === 0, 'no page errors', errors);
  await browser.close();
  process.exit(fail() ? 1 : 0);
})();
