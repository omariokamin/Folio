// export_code (v0.10): prompt stability, MCP tools/list, and calls through the bridge. node .dev/export-code/mcp-e2e.js
const { spawn, execSync } = require('child_process');
const { chromium } = require('playwright');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '../..');
const HOME = '/tmp/claude-0/-home-user-folio/30d67173-e7fe-53a5-9734-b219c5d6bd04/scratchpad/mcphome-export';
const TW = fs.existsSync(path.join(ROOT, 'src/tailwind.js'));
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); };

function loadPrompt(code) {
  const sb = { console, setTimeout, clearTimeout };
  sb.window = sb.self = sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb);
  return JSON.parse(JSON.stringify({ system: sb.Folio.aiPrompt.system, tools: sb.Folio.aiPrompt.tools }));
}

(async () => {
  // --- prompt: everything before export_code is byte-identical to the committed version
  const before = loadPrompt(execSync('git show HEAD:src/ai-prompt.js', { cwd: ROOT, encoding: 'utf8' }));
  const after = loadPrompt(fs.readFileSync(path.join(ROOT, 'src/ai-prompt.js'), 'utf8'));
  ok(JSON.stringify(after.tools.slice(0, -1)) === JSON.stringify(before.tools), 'tool list prefix unchanged');
  ok(after.tools[after.tools.length - 1].name === 'export_code', 'export_code is last');
  ok(/export_code in the matching format/.test(after.system) && !/export_code/.test(before.system), 'guide line in the system prompt');

  // --- MCP server over stdio
  fs.mkdirSync(HOME, { recursive: true });
  const srv = spawn('node', [path.join(ROOT, 'mcp/folio-mcp.js')], { env: { ...process.env, HOME, FOLIO_PORT: '4393', FOLIO_NO_BROWSER: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
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
  ok(/export_code/.test(init.result.instructions), 'instructions mention export_code');
  const list = await rpc('tools/list', {});
  const names = list.result.tools.map((t) => t.name);
  ok(names.slice(-3).join() === 'import_url,export_code,open_folio', 'tools/list order: ' + names.slice(-4).join(', '));
  const def = list.result.tools.find((t) => t.name === 'export_code');
  ok(def && (def.annotations || {}).readOnlyHint === true, 'export_code readOnlyHint');
  ok(def && JSON.stringify(def.inputSchema.properties.format.enum) === '["html-css","tailwind-html","tailwind-react"]', 'format enum');

  // --- the tab
  const token = JSON.parse(fs.readFileSync(path.join(HOME, '.folio/bridge.json'), 'utf8')).token;
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(cdn\.jsdelivr\.net|esm\.sh|fonts\.)/, (route) => route.abort());
  console.log(TW ? 'src/tailwind.js present: testing all formats' : 'src/tailwind.js MISSING: testing html-css only');
  await page.goto(`http://localhost:4393/?bridge=${token}`);
  await page.waitForFunction(() => document.documentElement.classList.contains('folio-ready'));
  const ids = await page.evaluate(() => {
    localStorage.clear();
    Folio.demo.build();
    const s = Folio.store;
    const [landing, insta] = s.doc.roots.slice();
    const p = s.addPage('Elsewhere');
    s.moveToPage([insta], p.id); // a board on a page the user is not viewing
    s.commit();
    return { landing, insta, hist: s.historyIndex, page: s.currentPage().id };
  });
  await new Promise((r) => setTimeout(r, 1500));
  const call = async (name, args) => {
    const r = await rpc('tools/call', { name, arguments: args || {} });
    const res = r.result || {};
    const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    console.log(`  → ${name}${res.isError ? ' ERROR' : ''}: ${text.slice(0, 160).replace(/\n/g, ' ')}`);
    return { isError: !!res.isError, text };
  };
  const docBefore = await page.evaluate(() => JSON.stringify(Folio.store.doc));

  let r = await call('export_code', { node_id: ids.landing, format: 'html-css' });
  ok(!r.isError && /^HTML \+ CSS for “/.test(r.text), 'html-css header');
  ok(/```css\n[\s\S]*\{[\s\S]*```\n\n```html\n<div class="[\w-]+">/.test(r.text), 'html-css: css block then html block');
  const ref = await page.evaluate((id) => ({ html: Folio.exporter.htmlFor(id), css: Folio.exporter.cssFor(id) }), ids.landing);
  ok(r.text.includes(ref.html) && r.text.includes(ref.css), 'html-css matches Folio.exporter output exactly');

  r = await call('export_code', { node_id: ids.insta, format: 'html-css' });
  ok(!r.isError && /<div class="/.test(r.text), 'works for a board on another page');
  ok(await page.evaluate((p) => Folio.store.currentPage().id === p, ids.page), 'view did not switch pages');

  if (TW) {
    r = await call('export_code', { node_id: ids.landing, format: 'tailwind-html' });
    ok(!r.isError && /^```css\n@import "tailwindcss";/m.test(r.text) && /```html\n<\w+ class="/.test(r.text), 'tailwind-html: theme + class markup');
    const tw = await page.evaluate((id) => ({ html: Folio.tailwind.htmlFor(id), jsx: Folio.tailwind.jsxFor(id), theme: Folio.tailwind.themeFor(id) }), ids.landing);
    ok(r.text.includes(tw.html) && r.text.includes(tw.theme), 'tailwind-html matches Folio.tailwind output');
    r = await call('export_code', { node_id: ids.landing, format: 'tailwind-react' });
    ok(!r.isError && /```jsx\n[\s\S]*export default function [A-Z]\w*\(\)/.test(r.text) && /className="/.test(r.text), 'tailwind-react: component with className');
    ok(r.text.includes(tw.jsx), 'tailwind-react matches Folio.tailwind.jsxFor');
    r = await call('export_code', { node_id: ids.insta, format: 'tailwind-react' });
    ok(!r.isError && /export default function/.test(r.text), 'tailwind-react on another page');
  } else {
    r = await call('export_code', { node_id: ids.landing, format: 'tailwind-html' });
    ok(r.isError && /not available/.test(r.text), 'tailwind without tailwind.js → clear error');
  }

  ok(docBefore === (await page.evaluate(() => JSON.stringify(Folio.store.doc))), 'document unchanged by the exports');

  // --- big embedded images are left out, small ones kept
  const big = 'data:image/png;base64,' + 'A'.repeat(9000);
  const small = 'data:image/png;base64,' + 'B'.repeat(200);
  const img = await page.evaluate(([big, small]) => {
    const s = Folio.store;
    const n = s.buildFromTree({ type: 'frame', name: 'Pics', width: 200, height: 100, children: [{ type: 'image', name: 'Big', image: { src: big } }, { type: 'image', name: 'Small', image: { src: small } }] });
    return n.id;
  }, [big, small]);
  r = await call('export_code', { node_id: img, format: 'html-css' });
  ok(!r.isError && !r.text.includes(big) && /9 KB embedded image left out/.test(r.text) && r.text.includes(small) && /1 embedded image was too big/.test(r.text), 'data URLs: big cut, small kept');
  await page.evaluate((id) => Folio.store.remove ? Folio.store.remove(id) : null, img);

  // --- validation
  r = await call('export_code', { node_id: 'n_nope', format: 'html-css' });
  ok(r.isError && /No layer with id/.test(r.text), 'unknown id refused');
  r = await call('export_code', { node_id: ids.landing, format: 'vue' });
  ok(r.isError && /format must be one of/.test(r.text), 'unknown format refused');
  r = await call('export_code', { node_id: ids.landing });
  ok(r.isError && /format must be one of/.test(r.text), 'missing format refused');

  // --- read-only: no document change from the exports, no undo step from the bridge
  await new Promise((r) => setTimeout(r, 2000));
  const st = await page.evaluate(() => ({ hist: Folio.store.historyIndex }));
  ok(st.hist === ids.hist, `no undo step added (history ${ids.hist} → ${st.hist})`);

  // --- in-app path + label
  const inApp = await page.evaluate((id) => Folio.aiTools.execute('export_code', { node_id: id, format: 'html-css' }), ids.landing);
  ok(!inApp.isError && typeof inApp.content === 'string' && inApp.changedIds.length === 0, 'in-app execute returns text, no changes');
  ok(await page.evaluate(() => Folio.aiTools.names.includes('export_code')), 'aiTools.names has export_code');
  ok(errors.length === 0, 'no page errors ' + errors.join(' | '));

  await browser.close();
  srv.kill();
  if (process.env.SHOW_STDERR) console.log(stderr.join(''));
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('crash', e); process.exit(1); });
