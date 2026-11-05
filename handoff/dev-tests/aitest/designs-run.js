const { open, call } = require('./harness');
const D = require('./designs');

(async () => {
  const { browser, page, logs } = await open();
  const show = (label, r) => {
    let c = r.content;
    if (typeof c === 'string' && c.length > 700) c = c.slice(0, 700) + '…';
    console.log(`\n== ${label}: ${r.summary} isError=${r.isError} changed=${r.changedIds.length}\n`, typeof c === 'string' ? c : JSON.stringify(c));
  };
  const t0 = Date.now();
  const r1 = await call(page, 'create_nodes', D.landing1);
  show('landing1', r1);
  const ab = JSON.parse(r1.content).artboards[0].split(' ')[0];
  for (const [k, f] of [['features', D.features], ['stats', D.stats], ['pricing', D.pricing], ['footer', D.footer]]) show(k, await call(page, 'create_nodes', f(ab)));
  show('shot landing', await call(page, 'screenshot', { node_id: ab }, 'landing'));
  // section close-ups
  const doc = JSON.parse((await call(page, 'get_document', {})).content);
  console.log('\nget_document:', JSON.stringify(doc).slice(0, 1500));
  const secs = doc.artboards[0].children.map((s) => s.split(' ')[0]);
  for (let i = 0; i < secs.length; i++) await call(page, 'screenshot', { node_id: secs[i] }, 'landing-sec' + i);

  const r2 = await call(page, 'create_nodes', D.insta);
  show('insta', r2);
  const ig = JSON.parse(r2.content).artboards[0].split(' ')[0];
  show('shot insta', await call(page, 'screenshot', { node_id: ig }, 'insta'));
  console.log('\nviewport', await page.evaluate(() => Folio.store.viewport));
  await page.screenshot({ path: __dirname + '/out/app.png' });
  console.log('\ncontextFor:\n', (await page.evaluate(() => Folio.aiPrompt.contextFor())).slice(0, 1200));
  console.log('\nget_tree hero:', (await call(page, 'get_tree', { node_id: secs[1], depth: 2 })).content.slice(0, 1500));
  console.log('time', Date.now() - t0, 'ms');
  console.log(logs.filter((l) => /error|warn/i.test(l)).join('\n'));
  await browser.close();
})();
