/* Extra screenshots: demo doc, backwards arrow, navigate card. run: node .dev/prototype-ui/shots.js */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8475', '--bind', '127.0.0.1'], { cwd: path.join(__dirname, '..', '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8475/index.html');
  await p.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  await p.click('#right-tabs [data-tab="prototype"]');
  const r = await p.evaluate(() => {
    const s = Folio.store;
    const roots = s.doc.roots.slice();
    if (roots.length < 2) Folio.canvas.createArtboard && Folio.canvas.createArtboard({ name: 'Second', width: 1440, height: 900 });
    const rs = s.doc.roots.slice();
    const a = rs[0], z = rs[rs.length - 1];
    const kid = s.descendants(a).find((id) => /button/i.test(s.get(id).name)) || s.get(a).children[0];
    s.update(kid, { interactions: Folio.prototype.normalize(kid, [{ action: 'navigate', target: z, transition: { type: 'dissolve', duration: 250 } }]).interactions });
    const back = s.descendants(z)[0] || z;
    s.update(back, { interactions: Folio.prototype.normalize(back, [{ action: 'navigate', target: a }]).interactions });
    s.commit('wire');
    s.select([kid]);
    Folio.canvas.zoomToFit();
    return rs.length;
  });
  await new Promise((r) => setTimeout(r, 400));
  await p.screenshot({ path: path.join(__dirname, 'shot-demo.png') });
  console.log('roots', r, 'errors', errs);
  await b.close();
  srv.kill();
})();
