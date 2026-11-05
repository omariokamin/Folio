// MCP end-to-end for import_html / import_url: node .dev/import-ai/mcp-e2e.js
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '../..');
const HOME = '/tmp/claude-0/-home-user-folio/30d67173-e7fe-53a5-9734-b219c5d6bd04/scratchpad/mcphome-import';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const H2I = path.join(__dirname, '../aitest/vendor/package/dist/html-to-image.js');
const LANDING = fs.readFileSync(path.join(__dirname, 'landing.html'), 'utf8');
const REAL = fs.existsSync(path.join(ROOT, 'src/import.js'));
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); };

const site = http.createServer((req, res) => {
  if (req.url === '/r') { res.writeHead(302, { Location: '/landing' }); return res.end(); }
  if (req.url === '/landing') { res.writeHead(200, { 'Content-Type': 'text/html; charset=windows-1252' }); return res.end(Buffer.from(LANDING.replace('Tidewater Kayaks</title>', 'Tidewater Caf\xe9</title>'), 'latin1')); }
  if (req.url === '/spa') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><title>App</title><div id="root"></div><script src="/bundle.js"></script>'); }
  res.writeHead(404); res.end();
});

(async () => {
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const sitePort = site.address().port;
  const srv = spawn('node', [path.join(ROOT, 'mcp/folio-mcp.js')], { env: { ...process.env, HOME, FOLIO_PORT: '4392', FOLIO_NO_BROWSER: '1', FOLIO_ALLOW_LOCAL_FETCH: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiting = new Map();
  let nextId = 1;
  srv.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    }
  });
  const stderr = [];
  srv.stderr.on('data', (d) => stderr.push(String(d)));
  const rpc = (method, params) => new Promise((res) => { const id = nextId++; waiting.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  ok(init.result.instructions.includes('# Importing pages'), 'instructions include Importing pages');
  const list = await rpc('tools/list', {});
  const names = list.result.tools.map((t) => t.name);
  ok(names.slice(-3).join() === 'import_html,import_url,open_folio', 'tools/list order: ' + names.join(', '));
  ok((list.result.tools.find((t) => t.name === 'import_url').annotations || {}).openWorldHint === true, 'import_url openWorldHint');

  // refused before any tab is needed
  let t0 = Date.now();
  let r = await rpc('tools/call', { name: 'import_url', arguments: { url: 'http://169.254.169.254/latest/meta-data/' } });
  ok(r.result.isError && /local or private/.test(r.result.content[0].text) && Date.now() - t0 < 3000, 'metadata IP refused without a tab: ' + r.result.content[0].text.slice(0, 120));
  r = await rpc('tools/call', { name: 'import_url', arguments: { url: 'file:///etc/passwd' } });
  ok(r.result.isError && /only http/.test(r.result.content[0].text), 'file: refused');

  const token = JSON.parse(fs.readFileSync(path.join(HOME, '.folio/bridge.json'), 'utf8')).token;
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.route(/^https:\/\/(cdn\.jsdelivr\.net|esm\.sh)\//, (route) => {
    if (/html-to-image/.test(route.request().url())) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(H2I, 'utf8') });
    return route.abort();
  });
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPhfDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.route('https://tidewater.example/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG, headers: { 'Access-Control-Allow-Origin': '*' } }));
  if (!REAL) await page.route('**/src/import.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'import-stub.js'), 'utf8') }));
  console.log(REAL ? 'using the REAL src/import.js' : 'using the stub importer');
  await page.goto(`http://localhost:4392/?bridge=${token}`);
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  await page.evaluate(() => {
    localStorage.clear();
    Folio.store.newDoc();
    const real = Folio.importer.fromHtml;
    window.__opts = [];
    Folio.importer.fromHtml = (html, o) => (window.__opts.push(Object.assign({ len: html.length, head: html.slice(0, 400) }, o)), real.call(Folio.importer, html, o));
  });
  await new Promise((r) => setTimeout(r, 1500));
  const call = async (name, args, shot) => {
    const r = await rpc('tools/call', { name, arguments: args || {} });
    const res = r.result || {};
    const texts = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text);
    const img = (res.content || []).find((c) => c.type === 'image');
    if (img && shot) fs.writeFileSync(path.join(OUT, shot + '.png'), Buffer.from(img.data, 'base64'));
    let json = null;
    try { json = JSON.parse(texts[texts.length - 1]); } catch (e) {}
    console.log(`  → ${name}${res.isError ? ' ERROR' : ''}: ${texts.join(' | ').slice(0, 300).replace(/\n/g, ' ')}`);
    return { isError: !!res.isError, text: texts.join('\n'), json, img };
  };

  // --- import_html: pasted landing page
  r = await call('import_html', { html: LANDING, base_url: 'https://tidewater.example/' });
  ok(!r.isError && r.json && /^n_\w+ “Tidewater Kayaks” 1440×\d+$/.test(r.json.artboard), 'import_html artboard: ' + (r.json && r.json.artboard));
  ok(r.json && r.json.layers > 10 && r.json.outline && r.json.outline.children, 'layers + outline: ' + (r.json && r.json.layers));
  const depthOf = (n) => (n && n.children ? 1 + Math.max(0, ...n.children.map(depthOf)) : 0);
  ok(r.json && depthOf(r.json.outline) <= 3, 'outline depth ≤ 3: ' + depthOf(r.json && r.json.outline));
  ok(r.json && (!r.json.warnings || Array.isArray(r.json.warnings)) && /Screenshot n_/.test(r.json.next), 'next hint; warnings: ' + JSON.stringify(r.json && r.json.warnings));
  const board = r.json.artboard.split(' ')[0];
  let st = await page.evaluate(() => ({ sel: Folio.store.selection.slice(), opts: window.__opts[window.__opts.length - 1] }));
  ok(st.sel.length === 1 && st.sel[0] === board, 'artboard selected');
  ok(st.opts.width === 1440 && st.opts.baseUrl === 'https://tidewater.example/' && !st.opts.parentId, 'importer got width/baseUrl');
  r = await call('screenshot', { node_id: board }, 'import-html');
  ok(!r.isError && r.img, 'screenshot of import');

  // --- import_url: local page via redirect, windows-1252
  r = await call('import_url', { url: `http://127.0.0.1:${sitePort}/r`, width: 1280, selector: '#pricing' });
  ok(!r.isError && r.text.includes(`Fetched http://127.0.0.1:${sitePort}/landing`), 'import_url fetched note');
  st = await page.evaluate(() => window.__opts[window.__opts.length - 1]);
  ok(st.baseUrl === `http://127.0.0.1:${sitePort}/landing` && st.width === 1280 && st.selector === '#pricing', 'base_url = final URL, width + selector forwarded');
  ok(st.head.includes('Tidewater Café'), 'charset decoded before forwarding');
  const b2 = r.json && r.json.artboard && r.json.artboard.split(' ')[0];
  ok(b2 && b2 !== board, 'second artboard ' + (r.json && r.json.artboard));
  r = await call('import_url', { url: `http://127.0.0.1:${sitePort}/spa` });
  ok(!r.isError && r.json && /JavaScript/.test(r.json.nearlyEmpty || ''), 'script-built page flagged nearly empty');
  r = await call('import_url', { url: `http://127.0.0.1:${sitePort}/r`, selector: '#nope' });
  ok(r.isError, 'selector with no match → error');
  r = await call('import_url', { url: 'http://10.1.2.3/' });
  ok(r.isError && /local or private/.test(r.text), 'private refused');

  // --- import_html into a frame and onto another page
  const hero = await page.evaluate((b) => Folio.store.descendants(b).find((id) => Folio.store.get(id).name === 'hero'), board);
  r = await call('import_html', { html: '<div class="card"><h3>Gift card</h3><p>$50</p></div>', parent_id: hero || board });
  ok(!r.isError && r.json && r.json.layer && r.json.parent, 'import into a frame: ' + (r.json && r.json.layer));
  st = await page.evaluate(() => window.__opts[window.__opts.length - 1]);
  ok(st.width < 1440 && st.parentId, 'parent import laid out at the frame width: ' + st.width);
  r = await call('manage_pages', { action: 'create', name: 'Imports' });
  await call('manage_pages', { action: 'switch', page_id: 'Page 1' });
  r = await call('import_html', { html: '<h1>Elsewhere</h1>', name: 'Other page', page_id: 'Imports', width: 390 });
  ok(!r.isError && /page/.test(r.json && r.json.page), 'import onto another page: ' + (r.json && r.json.page));
  ok(await page.evaluate(() => Folio.store.currentPage().name === 'Page 1'), 'view stays on Page 1');

  // --- validation
  for (const [args, re] of [
    [{}, /needs "html"/],
    [{ html: '   ' }, /needs "html"/],
    [{ html: '<p>x</p>', width: 100 }, /320 to 2560/],
    [{ html: '<p>x</p>', width: 9999 }, /320 to 2560/],
    [{ html: '<p>x</p>', width: 'wide' }, /320 to 2560/],
    [{ html: '<p>x</p>', base_url: 'javascript:alert(1)' }, /base_url/],
    [{ html: '<p>x</p>', selector: '##' }, /not a valid CSS selector/],
    [{ html: '<p>x</p>', parent_id: 'n_nope' }, /No layer/],
    [{ html: '<p>x</p>', page_id: 'Nowhere' }, /No page/],
    [{ html: 'a'.repeat(3 * 1024 * 1024 + 1) }, /over the 3 MB limit/],
  ]) {
    r = await call('import_html', args);
    ok(r.isError && re.test(r.text), 'rejects ' + JSON.stringify(args).slice(0, 60));
  }
  const textNode = await page.evaluate((b) => Folio.store.descendants(b).find((id) => Folio.store.get(id).type === 'text'), board);
  r = await call('import_html', { html: '<p>x</p>', parent_id: textNode });
  ok(r.isError && /must be a frame/.test(r.text), 'text parent refused');

  // --- in-app chat: import_url explains itself
  const inApp = await page.evaluate(() => Folio.aiTools.execute('import_url', { url: 'https://example.com' }));
  ok(inApp.isError && /Claude Code/.test(inApp.content) && /import_html/.test(inApp.content), 'in-app import_url error: ' + inApp.content.slice(0, 100));

  // --- one undo step per burst
  await new Promise((r) => setTimeout(r, 1800));
  const label = await page.evaluate(() => { const s = Folio.store; return (s.history && s.history.length) || (s.undoStack && s.undoStack.length) || 'n/a'; });
  console.log('history entries:', label);
  await page.screenshot({ path: path.join(OUT, 'mcp-app.png') });
  await browser.close();
  srv.kill();
  site.close();
  if (process.env.SHOW_STDERR) console.log(stderr.join(''));
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('crash', e); process.exit(1); });
