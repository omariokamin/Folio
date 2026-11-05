const { open } = require('./harness');
(async () => {
  const { browser, page } = await open({ noFonts: true });
  const r = await page.evaluate(() => {
    const B = Folio.brand; const b = B.create(B.templates()[0]); B.setActive(b.id);
    const s = Folio.store;
    const ab = s.buildFromTree({ type: 'frame', name: 'M', x: 0, y: 0, width: 100, height: 100, style: { fills: [{ type: 'mesh', base: '#ffffff', spread: 60, points: [{ color: '#22d3ee', x: 1, y: 1 }, { color: '#22d3ee', x: 1, y: 1 }, { color: '#22d3ee', x: 1, y: 1 }, { color: '#22d3ee', x: 1, y: 1 }] }] } });
    s.select(ab.id);
    return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelector('#inspector .ins-fill .ins-swatch').click();
      requestAnimationFrame(() => {
        const c = document.querySelectorAll('#inspector .ins-editor .ins-prop .ins-color')[1];
        const w = (e) => e && Math.round(e.getBoundingClientRect().width);
        const q = document.querySelector('#inspector .ins-fill .ins-quick');
        res({ row: w(c.parentNode), label: w(c.parentNode.firstChild), color: w(c), sw: w(c.children[0]), hexwrap: w(c.children[1]), alpha: w(c.children[2]), hexPad: getComputedStyle(c.querySelector('.ins-hex')).paddingLeft, sec: w(document.querySelector('#inspector .ins-sec')), ed: w(document.querySelector('#inspector .ins-editor')) });
      });
    })));
  });
  console.log(r);
  await browser.close();
})();
