const steps1 = require('./steps1.js');
const pick = (r, p) => Object.keys(r.json.created).find((id) => r.json.created[id] === p);
module.exports = async (call, page) => {
  await steps1(call);
  const T = (name, content, t, extra = {}) => ({ type: 'text', name, ...extra, text: { content, ...t } });
  let r = await call('create_nodes', { parent_id: null, nodes: [{ type: 'frame', name: 'Northbank home', width: 1440, sizing: { h: 'hug' }, layout: { gap: 0 }, style: { fills: [{ type: 'solid', color: 'var(--color-background)' }] }, children: [
    { type: 'frame', name: 'Header', sizing: { w: 'fill' }, layout: { padding: [16, 64] } },
    { type: 'frame', name: 'Hero', sizing: { w: 'fill' }, layout: { direction: 'row', gap: 72, align: 'center', padding: [96, 80, 144, 80] }, children: [
      { type: 'frame', name: 'Copy', sizing: { w: 'fill' }, layout: { gap: 40 }, children: [
        T('Headline', 'Borrow tools like\nlibrary books', { font: 'var(--font-heading)', size: 88, weight: 600, lineHeight: 0.98, letterSpacing: -0.035, color: 'var(--color-text)' }, { sizing: { w: 'fill' } }),
        T('Supporting line', 'Northbank lends drills, ladders, sanders and 1,200 other tools to members in Govan for £30 a year.', { font: 'var(--font-body)', size: 21, lineHeight: 1.5, color: 'var(--color-muted)' }, { sizing: { w: 'fill' } }),
        { type: 'frame', name: 'Actions', layout: { direction: 'row', gap: 12, align: 'center' } },
      ] },
      { type: 'frame', name: 'Lending tag', width: 440, height: 520, layout: { mode: 'none' }, style: { rotation: -4 }, children: [
        { type: 'frame', name: 'Tag', x: 0, y: 0, width: 440, height: 520, layout: { gap: 20, padding: [112, 40, 40, 40] }, style: { fills: [{ type: 'solid', color: 'var(--color-surface)' }], radius: [24, 24, 12, 12], border: { width: 1, color: '#1d1f1a26' } }, children: [
          T('Number', 'Tool 0417', { font: 'var(--font-heading)', size: 64, weight: 600, letterSpacing: -0.03, lineHeight: 1, color: 'var(--color-text)' }),
          T('Item', 'Cordless drill, 18V, two batteries', { font: 'var(--font-body)', size: 20, color: 'var(--color-text)' }, { sizing: { w: 'fill' } }),
          { type: 'frame', name: 'Rule', sizing: { w: 'fill' }, height: 1, style: { fills: [{ type: 'solid', color: '#1d1f1a26' }] } },
          { type: 'frame', name: 'Rows', sizing: { w: 'fill' }, layout: { gap: 12 }, children: [
            ['Borrowed', 'Sat 9 Nov'], ['Due back', 'Sat 16 Nov'], ['Borrower', 'Member 2208'],
          ].map(([k, v]) => ({ type: 'frame', name: 'Row', sizing: { w: 'fill' }, layout: { direction: 'row', justify: 'space-between' }, children: [T('Key', k, { font: 'var(--font-body)', size: 16, color: 'var(--color-muted)' }), T('Value', v, { font: 'var(--font-body)', size: 16, weight: 500, color: 'var(--color-text)' })] })) },
        ] },
        { type: 'frame', name: 'Hole', x: 196, y: 36, width: 48, height: 48, style: { radius: 9999, fills: [{ type: 'solid', color: 'var(--color-background)' }], border: { width: 6, color: 'var(--color-accent)' } } },
      ] },
    ] },
    { type: 'frame', name: 'Shelves', sizing: { w: 'fill' }, layout: { gap: 48, padding: [0, 80, 160, 80] }, children: [
      T('Heading', 'On the shelves this week', { font: 'var(--font-heading)', size: 48, weight: 600, letterSpacing: -0.02, color: 'var(--color-text)' }),
      { type: 'frame', name: 'Cards', sizing: { w: 'fill' }, layout: { direction: 'row', gap: 24, align: 'stretch' } },
    ] },
    { type: 'frame', name: 'Membership', sizing: { w: 'fill' }, layout: { direction: 'row', gap: 64, align: 'flex-end', padding: [128, 80, 128, 80] }, style: { fills: [{ type: 'solid', color: 'var(--color-primary)' }] }, children: [
      T('Statement', '£30 a year.\nEvery tool on the shelf.', { font: 'var(--font-heading)', size: 72, weight: 600, lineHeight: 1, letterSpacing: -0.03, color: '#ffffff' }, { sizing: { w: 'fill' } }),
      { type: 'frame', name: 'Join', layout: { gap: 24 }, width: 380, children: [
        T('Detail', 'Pay what you can if £30 is a stretch. Members borrow up to five tools at a time, for a week each.', { font: 'var(--font-body)', size: 18, lineHeight: 1.55, color: '#ffffffd9' }, { sizing: { w: 'fill' } }),
        { type: 'frame', name: 'Join actions', layout: { direction: 'row' } },
      ] },
    ] },
    { type: 'frame', name: 'Visit', sizing: { w: 'fill' }, layout: { direction: 'row', gap: 80, padding: [144, 80, 160, 80] }, children: [
      { type: 'frame', name: 'Where', sizing: { w: 'fill' }, layout: { gap: 16 }, children: [
        T('Heading', 'Visit the library', { font: 'var(--font-heading)', size: 48, weight: 600, letterSpacing: -0.02, color: 'var(--color-text)' }),
        T('Address', 'Unit 4, Fairfield Yard, 12 Langlands Road, Govan, G51 3AA', { font: 'var(--font-body)', size: 18, lineHeight: 1.5, color: 'var(--color-muted)' }, { sizing: { w: 'fill' } }),
        { type: 'frame', name: 'Status', layout: { direction: 'row', padding: [8, 0, 0, 0] } },
      ] },
      { type: 'frame', name: 'Hours', width: 560, layout: { gap: 0 }, children: [
        ['Tuesday to Friday', '4pm to 8pm'], ['Saturday', '10am to 4pm'], ['Sunday', '12pm to 4pm'], ['Monday', 'Closed'],
      ].map(([d, h]) => ({ type: 'frame', name: 'Day', sizing: { w: 'fill' }, layout: { direction: 'row', justify: 'space-between', padding: [18, 0] }, style: { border: { width: 1, color: '#1d1f1a1f' } }, children: [T('Day', d, { font: 'var(--font-body)', size: 18, color: 'var(--color-text)' }), T('Time', h, { font: 'var(--font-body)', size: 18, weight: 500, color: 'var(--color-text)' })] })) },
    ] },
  ] }] });
  const ab = r.json.artboards[0].split(' ')[0];
  const made = r;
  const P = (p) => pick(made, 'Northbank home/' + p);
  r = await call('create_instances', { items: [
    { component: 'Nav bar', variant: { Layout: 'Desktop' }, parent_id: P('Header'), sizing: { w: 'fill' }, overrides: { 'Logo/Name': { text: { content: 'Northbank' } }, 'Links/Product': { text: { content: 'Shelves' } }, 'Links/Pricing': { text: { content: 'Membership' } }, 'Links/Customers': { text: { content: 'Visit' } }, 'Links/About': { visible: false }, 'Action/Button/Label': { text: { content: 'Become a member' } } } },
    { component: 'Button', variant: { Style: 'Primary', Size: 'L' }, parent_id: P('Hero/Copy/Actions'), overrides: { Label: { text: { content: 'Become a member' } } } },
    { component: 'Button', variant: { Style: 'Ghost', Size: 'L' }, parent_id: P('Hero/Copy/Actions'), overrides: { Label: { text: { content: 'Browse the catalogue' } } } },
    ...[['Drills and drivers', '34 on the shelf, from compact 12V drivers to an SDS hammer drill for masonry.', 'Reserve a drill'], ['Ladders and steps', 'Step stools, a 3.9m combination ladder and a tower for stairwells.', 'Reserve a ladder'], ['Garden', 'Hedge trimmers, a petrol tiller, loppers and a lawn scarifier for spring.', 'Reserve garden tools']].map(([t, b, a]) => ({ component: 'Card', parent_id: P('Shelves/Cards'), sizing: { w: 'fill', h: 'fill' }, overrides: { Media: { visible: false }, Title: { text: { content: t } }, Body: { text: { content: b } }, 'Actions/Button/Label': { text: { content: a } } } })),
    { component: 'Button', variant: { Style: 'Secondary', Size: 'L' }, parent_id: P('Membership/Join/Join actions'), overrides: { Label: { text: { content: 'Become a member' } } } },
    { component: 'Badge', variant: { Tone: 'Success' }, parent_id: P('Visit/Where/Status'), overrides: { Label: { text: { content: 'Open today until 8pm' } } } },
  ] });
  await call('screenshot', { node_id: ab }, 'mcp-page');
  await call('screenshot', { node_id: P('Hero') }, 'mcp-hero');
  // edit a main: card title size → every card instance follows
  const lc = await call('list_components', {});
  const card = lc.json.components.find((c) => c.name === 'Card');
  const tree = await call('get_tree', { node_id: card.main, depth: 1 });
  const title = tree.json.tree.children.find((c) => c.name === 'Title');
  await call('update_nodes', { updates: [{ id: title.id, patch: { text: { size: 22 } } }] });
  const t2 = await call('get_tree', { node_id: P('Shelves/Cards') });
  console.log('card instance title sizes after main edit:', JSON.stringify(t2.json.tree.children.map((c) => c.instance && c.childCount)));
  const inst = t2.json.tree.children[0].id;
  const it = await call('get_tree', { node_id: inst });
  console.log('first card instance title:', JSON.stringify(it.json.tree.children.find((c) => c.name === 'Title').text));
  await call('get_document', {});
  await call('screenshot', { node_id: P('Shelves') }, 'mcp-shelves');
  await call('screenshot', { node_id: ab }, 'mcp-page2');
};
