// Shared Playwright setup for the SVG tests. Needs `python3 -m http.server 8141` in the repo root.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const H2I = fs.readFileSync(path.join(__dirname, '../aitest/vendor/package/dist/html-to-image.js'), 'utf8');

async function open(opts = {}) {
  const launch = { headless: true };
  if (process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' };
  const browser = await chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const logs = [];
  const evil = [];
  page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  page.on('dialog', (d) => { logs.push('[dialog] ' + d.message()); d.dismiss(); });
  await page.route(/^https:\/\/cdn\.jsdelivr\.net\//, (r) =>
    /html-to-image@1\.11\.11/.test(r.request().url()) ? r.fulfill({ body: H2I, contentType: 'application/javascript' }) : r.abort()
  );
  await page.route(/evil\.test/, (r) => { evil.push(r.request().url()); r.fulfill({ status: 200, body: '' }); });
  if (opts.noFonts) await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('http://localhost:8141/index.html');
  if (!opts.keepStorage) {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  }
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready') && window.Folio && Folio.svg && Folio.brand);
  return { browser, context, page, logs, evil };
}

let failures = 0;
const check = (cond, msg, extra) => {
  if (cond) console.log('  ok  ', msg);
  else {
    failures++;
    console.log('  FAIL', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 800) : '');
  }
};
module.exports = { open, check, failures: () => failures };
