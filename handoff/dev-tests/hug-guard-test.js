// Instance roots must not collapse when the AI asks for "hug" on an axis the main has fixed.
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8123/index.html'); await p.waitForTimeout(800);
  const r = await p.evaluate(async () => {
    Folio.store.newDoc(); Folio.components.addStarterKit(); Folio.store.commit('kit');
    const ab = Folio.store.createNode('frame', { name: 'AB', width: 400, sizing: { w: 'fixed', h: 'hug' }, layout: { mode: 'flex' } }, null).id;
    const run = (n, i) => Folio.aiTools.execute(n, i);
    const btnComp = Folio.components.list().find((c) => c.name === 'Button' && c.variant.Size === 'L' && c.variant.Style === 'Primary');
    const res = await run('create_instances', { items: [{ component: btnComp.id, parent_id: ab, sizing: { w: 'fill', h: 'hug' } }] });
    Folio.components.flush();
    const inst = Folio.store.get(Folio.store.get(ab).children[0]);
    const placed = { h: inst.sizing.h, height: inst.height, warned: JSON.stringify(res.content).includes('kept height fixed') };
    const upd = await run('update_nodes', { updates: [{ id: inst.id, patch: { sizing: { h: 'hug' } } }] });
    const afterUpd = { h: Folio.store.get(inst.id).sizing.h, warned: JSON.stringify(upd.content).includes('kept height fixed') };
    await run('update_nodes', { updates: [{ id: inst.id, patch: { height: 60 } }] });
    const explicit = Folio.store.get(inst.id).height;
    const rendered = Folio.render.el(inst.id).getBoundingClientRect().height / Folio.store.viewport.zoom;
    return { placed, afterUpd, explicit, rendered, mainH: Folio.store.get(btnComp.mainId).height };
  });
  assert(r.placed.h === 'fixed' && r.placed.height === r.mainH, `placed button keeps fixed height ${r.mainH}`);
  assert(r.placed.warned, 'create_instances warns about the kept height');
  assert(r.afterUpd.h === 'fixed' && r.afterUpd.warned, 'update_nodes hug on instance root is kept fixed, with a warning');
  assert(r.explicit === 60 && Math.round(r.rendered) === 60, 'an explicit height still applies');
  await b.close();
})();
