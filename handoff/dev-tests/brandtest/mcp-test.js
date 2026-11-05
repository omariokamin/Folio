// End-to-end: Claude Code ⇄ mcp/folio-mcp.js ⇄ Folio tab (Playwright), brand tools. Run: node .dev/brandtest/mcp-test.js
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const H2I = path.join(__dirname, '../aitest/vendor/package/dist/html-to-image.js');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-mcp-home-'));
const PORT = 4398;

let failures = 0;
const check = (cond, msg, extra) => {
  if (cond) console.log('  ok  ', msg);
  else {
    failures++;
    console.log('  FAIL', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : '');
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn('node', [path.join(ROOT, 'mcp/folio-mcp.js')], { env: { ...process.env, HOME, FOLIO_PORT: String(PORT), FOLIO_NO_BROWSER: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
srv.stderr.on('data', (d) => (stderr += d));
let buf = '';
const pending = new Map();
let nonJson = 0;
srv.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (e) {
      nonJson++;
      continue;
    }
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      p(msg);
    }
  }
});
let nextId = 1;
function rpc(method, params, timeout = 60000) {
  const id = nextId++;
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout ' + method)), timeout);
    pending.set(id, (m) => {
      clearTimeout(t);
      res(m);
    });
  });
}
const tool = async (name, args) => {
  const m = await rpc('tools/call', { name, arguments: args }, 90000);
  return m.result;
};
const textOf = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

(async () => {
  let browser;
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    check(init.result && /# Brand kits/.test(init.result.instructions), 'initialize: instructions contain the Brand kits section');
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const list = await rpc('tools/list', {});
    const names = list.result.tools.map((t) => t.name);
    console.log('    tools:', names.join(', '));
    check(names.includes('get_brand') && names.includes('set_brand'), 'tools/list includes get_brand and set_brand');
    const gb = list.result.tools.find((t) => t.name === 'get_brand');
    check(gb.annotations && gb.annotations.readOnlyHint, 'get_brand is annotated read-only');
    check(list.result.tools.find((t) => t.name === 'set_brand').inputSchema.required.includes('patch'), 'set_brand inputSchema copied');

    const cfg = JSON.parse(fs.readFileSync(path.join(HOME, '.folio/bridge.json'), 'utf8'));
    check(/^[a-f0-9]{16,}$/i.test(cfg.token), 'token in ~/.folio/bridge.json');
    const launch = { headless: true };
    if (process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' };
    browser = await chromium.launch(launch);
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
    const logs = [];
    page.on('pageerror', (e) => logs.push(e.message));
    await page.route(/^https:\/\/(cdn\.jsdelivr\.net|esm\.sh)\//, (route) =>
      /html-to-image/.test(route.request().url()) ? route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(H2I, 'utf8') }) : route.abort()
    );
    await page.goto(`http://localhost:${PORT}/?bridge=${cfg.token}`);
    await page.waitForFunction(() => window.Folio && Folio.bridge && Folio.brand && document.documentElement.classList.contains('folio-ready'), null, { timeout: 30000 });
    await page.evaluate(() => {
      localStorage.removeItem('folio:brands:v1');
      Folio.store.newDoc();
    });
    await sleep(1500);

    let r = await tool('get_brand', {});
    check(!r.isError && /No brand kit is active/.test(textOf(r)), 'get_brand over MCP (no kit)', textOf(r));
    r = await tool('set_brand', {
      create: true,
      template: 'Crumb Bakery',
      patch: { name: 'Crumb & Co', colors: [{ id: 'primary', value: '#b45309' }], voice: { tagline: 'Warm bread, warm hearts.' } },
    });
    const sb = JSON.parse(textOf(r));
    console.log('    set_brand:', JSON.stringify(sb).slice(0, 400));
    check(!r.isError && sb.active && sb.created, 'set_brand create over MCP');
    r = await tool('create_nodes', {
      parent_id: null,
      nodes: [
        {
          type: 'frame',
          name: 'Post / MCP',
          width: 1080,
          height: 1080,
          layout: { gap: 32, padding: 96, justify: 'center' },
          style: { fills: [{ type: 'solid', color: 'var(--color-background)' }] },
          children: [
            { type: 'text', name: 'Tagline', sizing: { w: 'fill' }, text: { content: 'Warm bread,\nwarm hearts.', font: 'var(--font-heading)', size: 140, lineHeight: 1, color: 'var(--color-primary)' } },
            {
              type: 'frame',
              name: 'Button',
              layout: { direction: 'row', padding: [24, 40] },
              style: { radius: 9999, fills: [{ type: 'solid', color: 'var(--color-secondary)' }] },
              children: [{ type: 'text', name: 'Label', text: { content: 'Visit the bakery', font: 'var(--font-body)', size: 34, weight: 600, color: 'var(--color-background)' } }],
            },
          ],
        },
      ],
    });
    const cn = JSON.parse(textOf(r));
    check(!r.isError && Object.keys(cn.created).length === 4, 'create_nodes with tokens over MCP', cn);
    const boardId = Object.keys(cn.created)[0];
    r = await tool('screenshot', { node_id: boardId });
    const img = (r.content || []).find((c) => c.type === 'image');
    check(img && img.mimeType === 'image/png', 'screenshot over MCP returns a PNG');
    if (img) fs.writeFileSync(path.join(OUT, 'mcp-post.png'), Buffer.from(img.data, 'base64'));
    r = await tool('set_brand', { patch: { colors: { primary: '#15803d' } } });
    check(!r.isError && /#b45309 → #15803d/.test(textOf(r)), 'set_brand edit over MCP', textOf(r));
    r = await tool('screenshot', { node_id: boardId });
    const img2 = (r.content || []).find((c) => c.type === 'image');
    if (img2) fs.writeFileSync(path.join(OUT, 'mcp-post-green.png'), Buffer.from(img2.data, 'base64'));
    const color = await page.evaluate((id) => {
      const n = Object.values(Folio.store.doc.nodes).find((x) => x.name === 'Tagline');
      return getComputedStyle(Folio.render.el(n.id)).color;
    }, boardId);
    check(color === 'rgb(21, 128, 61)', 'tagline re-coloured green in the tab', color);
    r = await tool('get_document', {});
    check(/primary=#15803d/.test(textOf(r)), 'get_document over MCP shows the brand brief');
    r = await tool('set_brand', { patch: { logos: [{ name: 'x', src: 'data:image/svg+xml,<svg/>' }] } });
    check(r.isError, 'data: logo refused over MCP');
    await sleep(1800); // bridge commits after 1.2 s of quiet
    const undo = await page.evaluate(() => ({ idx: Folio.store.historyIndex, can: Folio.store.canUndo() }));
    check(undo.can, 'bridge committed the burst (undo available)', undo);
    check(!logs.length, 'no page errors', logs);
    check(nonJson === 0, 'stdout carried only JSON-RPC');
  } catch (e) {
    failures++;
    console.error(e);
    console.error(stderr.slice(-2000));
  } finally {
    if (browser) await browser.close();
    srv.stdin.end();
    setTimeout(() => srv.kill(), 300);
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
  setTimeout(() => process.exit(failures ? 1 : 0), 500);
})();
