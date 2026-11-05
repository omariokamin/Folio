const { open, call } = require('./harness');

(async () => {
  const { browser, page, logs } = await open();
  const r1 = await call(page, 'get_document', {});
  console.log('get_document', r1);
  const r2 = await call(page, 'create_nodes', {
    parent_id: null,
    nodes: [{ type: 'frame', name: 'Test', width: 600, height: 400, layout: { gap: 16, padding: 40 }, children: [{ type: 'text', text: { content: 'Hello', size: 48, weight: 700 } }] }],
  });
  console.log('create', JSON.stringify(r2, null, 1));
  const id = Object.keys(JSON.parse(r2.content).created)[0];
  const r3 = await call(page, 'screenshot', { node_id: id }, 'smoke');
  console.log('shot', r3);
  console.log(await page.evaluate(() => Folio.aiPrompt.contextFor()));
  console.log(logs.filter((l) => /error|warn/i.test(l)).join('\n'));
  await browser.close();
})();
