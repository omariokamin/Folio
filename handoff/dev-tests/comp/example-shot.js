const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');
const w = {}; vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/ai-prompt.js'), 'utf8'), vm.createContext({ window: w }));
const sys = w.Folio.aiPrompt.system; const EX = JSON.parse(sys.slice(sys.lastIndexOf('\n{') + 1));
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.route(/^https:\/\/(cdn\.jsdelivr\.net|esm\.sh)\//, (r) => /html-to-image/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(__dirname, '../aitest/vendor/package/dist/html-to-image.js'), 'utf8') }) : r.abort());
  await page.goto('http://localhost:8133/index.html'); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  await page.evaluate(() => Folio.store.newDoc());
  const res = await page.evaluate(async (ex) => { const r = await Folio.aiTools.execute('create_nodes', { parent_id: null, nodes: [{ type: 'frame', name: 'Page', width: 1440, sizing: { h: 'hug' }, children: [ex] }] }); const id = JSON.parse(r.content).artboards[0].split(' ')[0]; const s = await Folio.aiTools.execute('screenshot', { node_id: id }); return { r: r.content.slice(-400), img: s.content[1].source.data }; }, EX);
  console.log(res.r); fs.writeFileSync(path.join(__dirname, 'out/example.png'), Buffer.from(res.img, 'base64')); await b.close();
})();
