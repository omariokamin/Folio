/* Shared Playwright harness for the brand-kit integration tests. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = '/home/user/folio';
const URL = 'http://localhost:8122/index.html';
const H2I = fs.readFileSync(path.join(ROOT, '.dev/aitest/vendor/package/dist/html-to-image.js'), 'utf8');
const STUB = fs.readFileSync(path.join(ROOT, '.dev/brand/brand-stub.js'), 'utf8');
const SHOTS = path.join(ROOT, '.dev/brand/shots');
const useStub = !fs.existsSync(path.join(ROOT, 'src/brand.js')) || process.argv.includes('--stub');

let failures = 0;
function check(cond, msg, extra) {
  if (cond) console.log('  ok  ', msg);
  else {
    failures++;
    console.log('  FAIL', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : '');
  }
}

async function open(opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|Error inlining remote css file|Error loading remote stylesheet|Error while reading CSS rules/.test(m.text()) && errors.push(m.text()));
  await page.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\/html-to-image/, (r) => r.fulfill({ body: H2I, contentType: 'application/javascript' }));
  if (opts.noFonts) await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  if (useStub) await page.route(/\/src\/brand\.js$/, (r) => r.fulfill({ body: STUB, contentType: 'application/javascript' }));
  if (opts.noBrand) await page.route(/\/src\/brand(-panel)?\.js$/, (r) => r.fulfill({ body: '', contentType: 'application/javascript' }));
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('__keep')) localStorage.clear();
    } catch (e) {}
  });
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  await page.waitForTimeout(300);
  return { browser, ctx, page, errors };
}

module.exports = { open, check, SHOTS, ROOT, useStub, fail: () => failures };
