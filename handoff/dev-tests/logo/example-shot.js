const { chromium } = require('playwright');
const svg = process.argv[2];
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost' } });
  const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 700, height: 300 } })).newPage();
  await p.setContent(`<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600&display=block" rel="stylesheet"><body style="margin:0;background:#fff"><div style="padding:20px;display:flex;gap:30px;align-items:end"><div style="outline:1px solid red;height:200px">${svg.replace('<svg', '<svg height="200"')}</div><div style="outline:1px solid red;height:32px">${svg.replace('<svg', '<svg height="32"')}</div><div style="height:16px">${svg.replace('<svg', '<svg height="16"')}</div></div>`);
  await p.evaluate(() => document.fonts.load('600 72px Fraunces'));
  await p.waitForTimeout(800);
  await p.screenshot({ path: __dirname + '/out/example.png' });
  await b.close();
})();
