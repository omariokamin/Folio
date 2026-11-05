const { open, call } = require('./harness');
const D = require('./designs');
(async () => {
  const { browser, page } = await open();
  const r1 = await call(page, 'create_nodes', D.landing1);
  const ab = JSON.parse(r1.content).artboards[0].split(' ')[0];
  const vp1 = await page.evaluate(() => ({ ...Folio.store.viewport }));
  const f = await call(page, 'create_nodes', D.features(ab));
  const vp2 = await page.evaluate(() => ({ ...Folio.store.viewport }));
  console.log('follow-fit after section added:', vp1.zoom.toFixed(3), '->', vp2.zoom.toFixed(3), 'layout issues:', JSON.parse(f.content).layout);
  // user pans → no more refits
  await page.evaluate(() => Folio.store.setViewport({ x: 10, y: 10 }));
  await call(page, 'create_nodes', D.stats(ab));
  const vp3 = await page.evaluate(() => ({ ...Folio.store.viewport }));
  console.log('after user pan, viewport kept:', vp3.x === 10 && vp3.y === 10);
  // small edit doesn't move the view
  await call(page, 'update_nodes', { updates: [{ id: ab, patch: { name: 'Pulse landing' } }] });
  const vp4 = await page.evaluate(() => ({ ...Folio.store.viewport }));
  console.log('small edit keeps viewport:', vp4.x === 10 && vp4.y === 10);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate((id) => Folio.exporter.exportPng(id, 1), ab)]);
  console.log('exportPng download:', dl.suggestedFilename());
  const url = await page.evaluate(async (id) => (await Folio.exporter.pngDataUrl(id, { maxSize: 500 })).length, ab);
  console.log('pngDataUrl length', url);
  const dims = await page.evaluate(async (id) => { const u = await Folio.exporter.pngDataUrl(id, { maxSize: 500 }); const im = new Image(); im.src = u; await im.decode(); return [im.width, im.height]; }, ab);
  console.log('pngDataUrl maxSize 500 dims', dims);
  await browser.close();
})();
