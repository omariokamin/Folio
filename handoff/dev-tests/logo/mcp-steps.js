const KILN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 2 146 64"><text x="0" y="64" font-family="Fraunces" font-weight="600" font-size="72" letter-spacing="-1" fill="#111111">Kıln</text><path d="M59 22v-7a8 8 0 0 1 16 0v7z" fill="#111111"/></svg>';
const MONO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><path d="M0 80V36a40 40 0 0 1 80 0v44H62V36a22 22 0 0 0-44 0v44z" fill="#111111"/></svg>';
module.exports = async (call, page) => {
  const a = await call('draft_logo', { name: 'Kiln arch wordmark', svg: KILN, concept: 'The dot of the i is the arched mouth of a kiln.' });
  const b = await call('draft_logo', { name: 'Arch monogram', svg: MONO, concept: 'One thick arch, the kiln door, as a standalone mark.' });
  const board = a.json.artboard.split(' ')[0];
  await call('screenshot', { node_id: board }, 'mcp-concepts');
  const s = await call('save_logo', { node_id: a.json.image, name: 'Kiln', symbol_svg: MONO });
  const logos = s.json.logos;
  const p = await call('create_nodes', { parent_id: null, nodes: [{ type: 'frame', name: 'Header', width: 800, height: 120, layout: { direction: 'row', align: 'center', justify: 'space-between', padding: [0, 40] }, style: { fills: [{ type: 'solid', color: '#1b1a18' }] }, children: [{ type: 'image', name: 'Logo', height: 40, image: { src: logos['on-dark'], fit: 'contain' } }, { type: 'image', name: 'Symbol', height: 40, image: { src: logos.symbol, fit: 'contain' } }] }] });
  await call('screenshot', { node_id: p.json.artboards[0].split(' ')[0] }, 'mcp-header');
  const g = await call('get_brand', {});
  console.log('brand logos:', JSON.stringify(g.json.brand.logos.map((l) => l.name)));
  await new Promise((r) => setTimeout(r, 1800));
  console.log('undo stack labels:', await page.evaluate(() => (Folio.store.history || Folio.store._history || []).length || JSON.stringify(Object.keys(Folio.store).filter((k) => /hist|undo/i.test(k)))));
};
