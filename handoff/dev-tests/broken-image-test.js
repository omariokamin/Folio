// A screenshot of an artboard with a broken image must still succeed.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route('https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js', (r) => r.fulfill({ path: __dirname + '/aitest/vendor/package/dist/html-to-image.js', contentType: 'text/javascript' }));
  await p.goto('http://localhost:8123/index.html'); await p.waitForTimeout(800);
  const r = await p.evaluate(async () => {
    Folio.store.newDoc();
    const ab = Folio.store.buildFromTree({ type: 'frame', name: 'AB', width: 300, height: 200, children: [{ type: 'image', width: 100, height: 100, image: { src: 'http://localhost:1/missing.png' } }] });
    try { const url = await Folio.exporter.pngDataUrl(ab.id, { scale: 1 }); return url.startsWith('data:image/png') ? 'ok' : 'bad'; } catch (e) { return 'threw: ' + e.message; }
  });
  console.log(r === 'ok' ? 'ok   screenshot survives a broken image' : 'FAIL ' + r); process.exitCode = r === 'ok' ? 0 : 1;
  await b.close();
})();
