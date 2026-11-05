const { open, call } = require('./harness');
(async () => {
  const { browser, page } = await open();
  // a classic beginner mistake: long text that hugs, in a hug frame, inside a fixed card
  const r = await call(page, 'create_nodes', { parent_id: null, nodes: [{ type: 'frame', name: 'Card', width: 400, height: 300, layout: { padding: 24, gap: 12, direction: 'row' }, children: [
    { type: 'text', name: 'Para', text: { content: 'This paragraph is long enough that it really should wrap onto several lines inside the card' } },
    { type: 'frame', name: 'Box', width: 600, height: 50, style: { fills: [{ type: 'solid', color: '#eee' }] } } ] }] });
  console.log(JSON.parse(r.content).layout);
  const ids = Object.keys(JSON.parse(r.content).created);
  const u = await call(page, 'update_nodes', { updates: [{ id: ids[1], patch: { sizing: { w: 'fill' } } }, { id: ids[2], patch: { width: 100 } }] });
  console.log(u.content);
  await browser.close();
})();
