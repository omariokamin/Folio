const { open, call } = require('./harness');
(async () => {
  const { browser, page } = await open();
  const r = await call(page, 'create_nodes', { parent_id: null, nodes: [{ type: 'frame', name: 'BG', width: 300, height: 200, children: [{ type: 'text', text: { content: 'bg tab' } }] }] });
  const id = Object.keys(JSON.parse(r.content).created)[0];
  // simulate a background tab: rAF never fires
  const res = await page.evaluate(async (id) => { window.requestAnimationFrame = () => 0; const t = performance.now(); const r = await Folio.aiTools.execute('screenshot', { node_id: id }); return [r.isError, Math.round(performance.now() - t)]; }, id);
  console.log('screenshot without rAF:', res);
  await browser.close();
})();
