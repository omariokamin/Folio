const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost' } });
  const p = await (await b.newContext({ ignoreHTTPSErrors: true })).newPage();
  await p.setContent(`<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600&display=block" rel="stylesheet"><svg id="s" width="400" height="120" viewBox="0 0 400 120"><text id="t" x="0" y="64" font-family="Fraunces" font-weight="600" font-size="72" letter-spacing="-1">${process.argv[2]}</text></svg>`);
  await p.evaluate(() => document.fonts.load('600 72px Fraunces'));
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => { const t = document.getElementById('t'); const n = t.getNumberOfChars(); const out = []; for (let i = 0; i < n; i++) { const e = t.getExtentOfChar(i); out.push([t.textContent[i], +e.x.toFixed(1), +e.width.toFixed(1)]); } const bb = t.getBBox(); return { out, bb: [bb.x, bb.y, bb.width, bb.height].map((v) => +v.toFixed(1)), font: document.fonts.check('600 72px Fraunces') }; });
  console.log(JSON.stringify(r));
  await b.close();
})();
