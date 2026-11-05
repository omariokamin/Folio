const { chromium } = require('playwright');
const { spawn } = require('child_process');
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8474', '--bind', '127.0.0.1'], { cwd: __dirname + '/../..', stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', (e) => console.log('ERR', e));
  await p.goto('http://127.0.0.1:8474/index.html');
  await p.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  const id = await p.evaluate(() => { const s = Folio.store; s.newDoc(); const a = s.buildFromTree({ type: 'frame', name: 'A', x: 0, y: 0, width: 300, height: 300, children: [{ type: 'frame', name: 'B', width: 50, height: 50 }] }); s.buildFromTree({ type: 'frame', name: 'P', x: 400, y: 0, width: 300, height: 300 }); s.commit('x'); const c = s.get(a.id).children[0]; s.select([c]); return c; });
  await p.click('#right-tabs [data-tab="prototype"]');
  await new Promise((r) => setTimeout(r, 200));
  console.log(await p.evaluate(() => { const g = Folio.overlay.guides; const hd = document.querySelector('.pp-handle'); return JSON.stringify({ tool: Folio.store.tool, edit: Folio.store.editingTextId, move: g.move, hide: g.hideHandles, marquee: g.marquee, disp: hd.style.display, t: hd.style.transform, n: document.querySelectorAll('.pp-handle').length }); }));
  await b.close(); srv.kill();
})();
