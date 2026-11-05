// screenshot of the toolbar + playing the demo. run: node .dev/prototype/demo-shot.js
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await p.goto('http://127.0.0.1:8237/index.html');
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  await p.screenshot({ path: path.join(__dirname, 'out/toolbar.png'), clip: { x: 700, y: 0, width: 580, height: 60 } });
  await p.evaluate(() => Folio.prototype.play());
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(__dirname, 'out/demo-play.png') });
  const f = await (await p.$('#play-root iframe')).contentFrame();
  console.log(await f.evaluate(() => ({ sh: document.getElementById('fp-stage').scrollHeight, ch: document.getElementById('fp-stage').clientHeight, t: document.querySelector('.fp-screen').style.transform })));
  console.log('errors', errs);
  await b.close();
})();
