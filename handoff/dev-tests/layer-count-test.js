// The Design panel's "N artboards · M layers" line counts the current page only.
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8123';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto(base + '/index.html'); await p.waitForTimeout(800);
  const txt = await p.evaluate(async () => {
    const s = Folio.store; s.newDoc();
    s.buildFromTree({ type: 'frame', name: 'A', width: 200, height: 200, children: [{ type: 'text' }, { type: 'text' }, { type: 'frame' }] });
    const p2 = s.addPage('Two'); s.withPage(p2.id, () => s.buildFromTree({ type: 'frame', name: 'B', children: [{ type: 'text' }] }));
    s.commit('setup'); s.select([]); await new Promise((r) => setTimeout(r, 300));
    const read = () => document.querySelector('.ins-doc-meta').textContent.trim();
    const first = read(); s.switchPage(p2.id); s.select([]); await new Promise((r) => setTimeout(r, 300));
    return [first, read()];
  });
  const ok = txt[0] === '1 artboard · 4 layers' && txt[1] === '1 artboard · 2 layers';
  console.log(ok ? 'ok   layer count follows the current page' : 'FAIL ' + JSON.stringify(txt)); process.exitCode = ok ? 0 : 1;
  await b.close();
})();
