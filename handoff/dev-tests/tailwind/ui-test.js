// Tailwind tab + Export menu in the real app. run: node .dev/tailwind/ui-test.js [base]  (serve the repo on :8191)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const base = process.argv[2] || 'http://localhost:8191';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (c || x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await page.goto(base + '/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  const ev = (fn, a) => page.evaluate(fn, a);
  const ab = await ev(() => { const id = Folio.store.doc.roots[0]; Folio.store.select([id]); Folio.codePanel.toggle(true); return id; });
  await page.click('.cp__tab[data-tab="tailwind"]');
  await page.waitForTimeout(100);
  const read = () => ev(() => ({ panes: [...document.querySelectorAll('.cp__pane')].map((p) => p.dataset.pane), theme: document.querySelector('[data-pane="theme"] .cp__code')?.textContent, md: document.querySelector('[data-pane="tw"] .cp__code')?.textContent, active: document.querySelector('.cp__tw-format .is-active')?.textContent }));
  let r = await read();
  ok(r.panes.join() === 'theme,tw' && r.theme.startsWith('@import "tailwindcss";') && /^<div class="relative /.test(r.md) && r.active === 'HTML', 'Tailwind tab: theme above HTML markup', r);
  await page.screenshot({ path: path.join(OUT, 'ui-tailwind-html.png') });
  await page.click('.cp__tw-format [data-tw-format="react"]');
  await page.waitForTimeout(50);
  r = await read();
  ok(r.active === 'React' && /^export default function /.test(r.md) && /className="/.test(r.md), 'React switch shows a component', r.md.slice(0, 80));
  // live update
  await ev((id) => { Folio.store.update(id, { name: 'Renamed board' }); Folio.store.commit('rename'); }, ab);
  await page.waitForTimeout(400);
  r = await read();
  ok(/function RenamedBoard\(\)/.test(r.md), 'updates live after an edit');
  await page.screenshot({ path: path.join(OUT, 'ui-tailwind-react.png') });
  // download from the panel
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-cp="download"]')]);
  ok(dl.suggestedFilename() === 'Renamed board.jsx' && /^\/\* Tailwind v4 theme[\s\S]*export default function RenamedBoard/.test(fs.readFileSync(await dl.path(), 'utf8')), 'Download → .jsx', dl.suggestedFilename());
  // the choice is remembered
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  await ev(() => Folio.store.select([Folio.store.doc.roots[0]]));
  await page.waitForTimeout(100);
  r = await read();
  ok(r.active === 'React' && r.panes.join() === 'theme,tw', 'tab + React choice remembered', r.active);
  // export menu
  await page.click('.tb-export');
  const items = await page.$$eval('.f-menu__label', (l) => l.map((x) => x.textContent));
  ok(items.includes('Tailwind (HTML)') && items.includes('Tailwind (React)'), 'Export menu has both Tailwind entries', items);
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('.f-menu__item:has-text("Tailwind (HTML)")')]);
  const html = fs.readFileSync(await dl.path(), 'utf8');
  ok(/\.tailwind\.html$/.test(dl.suggestedFilename()) && html.includes('@tailwindcss/browser@4.3.3') && html.includes('text/tailwindcss'), 'Tailwind (HTML) downloads the preview page', dl.suggestedFilename());
  await page.click('.tb-export');
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('.f-menu__item:has-text("Tailwind (React)")')]);
  ok(/\.jsx$/.test(dl.suggestedFilename()), 'Tailwind (React) downloads a .jsx', dl.suggestedFilename());
  ok(!errors.length, 'no page errors', errors);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
