const { open, call } = require('./harness');
(async () => {
  const { browser, page } = await open();
  const ex = await page.evaluate(() => JSON.parse(Folio.aiPrompt.system.split('flex column\n\n')[1]));
  const r = await call(page, 'create_nodes', { parent_id: null, nodes: [{ type: 'frame', name: 'Ledgerly', width: 1440, sizing: { h: 'hug' }, style: { fills: [{ type: 'solid', color: '#fafaf7' }] }, children: [ex] }] });
  console.log(r.summary, JSON.parse(r.content).warnings, JSON.parse(r.content).layout);
  const id = Object.keys(JSON.parse(r.content).created)[0];
  console.log((await call(page, 'screenshot', { node_id: id }, 'example')).content[0]);
  await browser.close();
})();
