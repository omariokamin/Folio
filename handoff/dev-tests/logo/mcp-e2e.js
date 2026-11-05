// End-to-end: spawn the MCP server, connect a Playwright tab via ?bridge=, drive tools over JSON-RPC.
// node .dev/comp/mcp-e2e.js <steps.js>   (steps module exports async (call, save) => {})
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HOME = '/tmp/claude-0/-home-user-folio/30d67173-e7fe-53a5-9734-b219c5d6bd04/scratchpad/mcphome-logo';
const OUT = path.join(__dirname, 'out');
const H2I = path.join(__dirname, '../aitest/vendor/package/dist/html-to-image.js');
const steps = require(path.resolve(process.argv[2]));

(async () => {
  const srv = spawn('node', [path.join(__dirname, '../../mcp/folio-mcp.js')], { env: { ...process.env, HOME, FOLIO_PORT: '4394', FOLIO_NO_BROWSER: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
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
  const instr = init.result.instructions;
  console.log('initialize ok; instructions', instr.length, 'chars; includes Logo design:', instr.includes('# Logo design'));
  const list = await rpc('tools/list', {});
  console.log('tools/list:', list.result.tools.map((t) => t.name).join(', '));
  await new Promise((r) => setTimeout(r, 500));
  const token = JSON.parse(fs.readFileSync(path.join(HOME, '.folio/bridge.json'), 'utf8')).token;
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.route(/^https:\/\/(cdn\.jsdelivr\.net|esm\.sh)\//, (route) => {
    if (/html-to-image/.test(route.request().url())) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(H2I, 'utf8') });
    return route.abort();
  });
  await page.goto(`http://localhost:4394/?bridge=${token}`);
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  await page.evaluate(() => { localStorage.clear(); Folio.store.newDoc(); });
  await new Promise((r) => setTimeout(r, 1500));
  const call = async (name, args, shot) => {
    const r = await rpc('tools/call', { name, arguments: args || {} });
    const res = r.result || {};
    const texts = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    const img = (res.content || []).find((c) => c.type === 'image');
    if (img && shot) fs.writeFileSync(path.join(OUT, shot + '.png'), Buffer.from(img.data, 'base64'));
    let json = null;
    try { json = JSON.parse(texts); } catch (e) {}
    console.log(`→ ${name}${res.isError ? ' ERROR' : ''}: ${texts.slice(0, 500).replace(/\n/g, ' ')}`);
    return { isError: !!res.isError, text: texts, json };
  };
  try {
    await steps(call, page);
  } catch (e) {
    console.log('steps failed', e);
  }
  await page.screenshot({ path: path.join(OUT, 'mcp-app.png') });
  await browser.close();
  srv.kill();
  if (process.env.SHOW_STDERR) console.log(stderr.join(''));
})();
