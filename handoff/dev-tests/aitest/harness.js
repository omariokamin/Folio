// Shared Playwright harness: loads the real index.html with html-to-image served locally.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const H2I = path.join(__dirname, 'vendor/package/dist/html-to-image.js');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

async function open({ width = 1600, height = 1000 } = {}) {
  const launch = { headless: true };
  if (process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' };
  const browser = await chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.route(/^https:\/\/(cdn\.jsdelivr\.net|esm\.sh)\//, (route) => {
    if (/html-to-image@[\d.]+\/dist\/html-to-image\.js/.test(route.request().url()))
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(H2I, 'utf8') });
    return route.abort();
  });
  await page.goto('http://localhost:8111/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready') && window.Folio && Folio.aiTools);
  // start from an empty document
  await page.evaluate(() => Folio.store.newDoc());
  return { browser, page, logs };
}

/** Call a tool in the page; returns the result (image data written to out/<name>.png). */
async function call(page, name, input, shotName) {
  const res = await page.evaluate(async ([n, i]) => Folio.aiTools.execute(n, i), [name, input]);
  if (Array.isArray(res.content)) {
    const img = res.content.find((b) => b.type === 'image');
    if (img && shotName) fs.writeFileSync(path.join(OUT, shotName + '.png'), Buffer.from(img.source.data, 'base64'));
    res.content = res.content.map((b) => (b.type === 'image' ? { type: 'image', bytes: b.source.data.length } : b));
  }
  return res;
}

module.exports = { open, call, OUT };
