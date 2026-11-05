module.exports = async (call) => {
  await call('set_brand', { create: true, patch: { name: 'Northbank Tool Library', colors: { primary: '#2b5d3a', secondary: '#1d1f1a', accent: '#f2c230', background: '#efece4', surface: '#e4e0d4', text: '#1d1f1a', muted: '#5b5a52', success: '#2f7a4a', danger: '#b3261e' }, fonts: { heading: { family: 'Archivo', weight: 600 }, body: 'DM Sans' }, voice: { tone: ['plain-spoken', 'neighbourly'] }, style: { button: 'square', density: 'comfortable', shadow: 'none' } } });
  const kit = await call('add_starter_kit', {});
  require('fs').writeFileSync(__dirname + '/out/mcp-kit.json', JSON.stringify(kit.json, null, 1));
  await call('screenshot', { node_id: kit.json.artboard.split(' ')[0] }, 'mcp-kit');
};
