// Import test harness: node .dev/import/<test>.js  (serve /home/user/folio on :8161)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const H2I = '/home/user/folio/.dev/aitest/vendor/package/dist/html-to-image.js';
let failures = 0;
const ok = (c, msg, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined ? ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400) : '')); if (!c) failures++; };

async function open({ width = 1600, height = 1000, perms = [] } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  if (perms.length) await ctx.grantPermissions(perms, { origin: 'http://localhost:8161' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::|Failed to load resource|inlining remote css|remote stylesheet|CSS rules|Error while reading/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await page.route('https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(H2I, 'utf8') }));
  await page.route(/^https?:\/\/(?!localhost)(?!cdn\.jsdelivr\.net\/npm\/html-to-image)/, (r) => r.abort());
  await page.goto('http://localhost:8161/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  await page.waitForTimeout(200);
  return { browser, ctx, page, errors };
}

// in-page helpers
const PAGE_HELPERS = `
window.__png = (id) => Folio.exporter.pngDataUrl(id, { scale: 1 });
window.__load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
window.__diff = async (a, b) => {
  const [A, B] = await Promise.all([__load(a), __load(b)]);
  const w = Math.max(A.width, B.width), h = Math.min(A.height, B.height); // (a page shorter than the viewport is padded by the browser)
  const get = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
  const da = get(A), db = get(B);
  let bad = 0;
  const c = document.createElement('canvas'); c.width = w * 3; c.height = h; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, w * 3, h); x.drawImage(A, 0, 0); x.drawImage(B, w, 0);
  const dv = x.createImageData(w, h);
  for (let i = 0; i < da.length; i += 4) {
    const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    const isBad = d > 60; if (isBad) bad++;
    dv.data[i] = isBad ? 255 : 255; dv.data[i + 1] = isBad ? 0 : 255; dv.data[i + 2] = isBad ? 0 : 255; dv.data[i + 3] = 255;
  }
  x.putImageData(dv, w * 2, 0);
  return { pct: Math.round((bad / (w * h)) * 10000) / 100, a: [A.width, A.height], b: [B.width, B.height], side: c.toDataURL('image/png') };
};
window.__outline = (id, depth = 0, max = 4) => {
  const n = Folio.store.get(id); if (!n) return '';
  const L = { fixed: 'X', hug: 'H', fill: 'F' }; const sz = n.sizing ? L[n.sizing.w] + '/' + L[n.sizing.h] : '';
  const lay = n.type === 'frame' ? (n.layout.mode === 'flex' ? n.layout.direction[0] + (n.layout.wrap ? 'w' : '') + ' g' + n.layout.gap + ' p[' + n.layout.padding + '] ' + n.layout.justify.replace('flex-', '') + '/' + n.layout.align.replace('flex-', '') : 'free') : '';
  const t = n.type === 'text' ? ' "' + n.text.content.slice(0, 40).replace(/\\n/g, '⏎') + '"' : '';
  let s = '  '.repeat(depth) + n.type[0] + ' ' + n.name + ' ' + Math.round(n.width) + 'x' + Math.round(n.height) + ' ' + sz + ' ' + lay + t + '\\n';
  if (depth < max) n.children.forEach((c) => (s += __outline(c, depth + 1, max)));
  return s;
};`;

async function helpers(page) { await page.evaluate(PAGE_HELPERS); }
function savePng(name, dataUrl) { fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(dataUrl.split(',')[1], 'base64')); }

/** Reference: the HTML rendered in its own page (scripts off), full-page screenshot as data URL. */
async function reference(browser, html, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: false });
  const p = await ctx.newPage();
  await p.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await p.setContent(html, { waitUntil: 'load' });
  const buf = await p.screenshot({ fullPage: true });
  await ctx.close();
  return 'data:image/png;base64,' + buf.toString('base64');
}

module.exports = { open, ok, helpers, savePng, reference, OUT, fails: () => failures };
