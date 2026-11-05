// set_interactions (v0.11): prompt stability vs origin/main + MCP tools/list. node .dev/prototype-ai/mcp-test.js
const { spawn, execSync } = require('child_process');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '../..');
const HOME = '/tmp/claude-0/-home-user-folio/30d67173-e7fe-53a5-9734-b219c5d6bd04/scratchpad/mcphome-proto';
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
  const oldSrc = execSync('git show origin/main:src/ai-prompt.js', { cwd: ROOT, encoding: 'utf8' });
  const newSrc = fs.readFileSync(path.join(ROOT, 'src/ai-prompt.js'), 'utf8');
  const before = loadPrompt(oldSrc);
  const after = loadPrompt(newSrc);
  ok(after.tools.length === before.tools.length + 1, `one tool added (${before.tools.length} → ${after.tools.length})`);
  ok(JSON.stringify(after.tools.slice(0, -1)) === JSON.stringify(before.tools), 'earlier tool defs identical (JSON)');
  // source text of the old tool array (up to its closing "  ];") is a verbatim prefix in the new file
  const a = oldSrc.indexOf('const tools = ['), b = oldSrc.indexOf('\n  ];', a);
  ok(a > 0 && b > a && newSrc.includes(oldSrc.slice(a, b)), 'earlier tool defs identical (source bytes)');
  ok(after.tools[after.tools.length - 1].name === 'set_interactions', 'set_interactions is last');
  const i = after.system.indexOf('# Prototypes'), j = after.system.indexOf('# Building designs in code'), k = after.system.indexOf('# Workflow');
  ok(i > j && i < k && !/set_interactions/.test(before.system), '# Prototypes guide between Building designs in code and Workflow');
  ok(/Play \(▶\)/.test(after.system) && /State=Hover/.test(after.system) && /don't take interactions/.test(after.system), 'guide covers play, hover, create/update note');

  fs.mkdirSync(HOME, { recursive: true });
  const srv = spawn('node', [path.join(ROOT, 'mcp/folio-mcp.js')], { env: { ...process.env, HOME, FOLIO_PORT: '4417', FOLIO_NO_BROWSER: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiting = new Map();
  let nextId = 1;
  srv.stdout.on('data', (d) => {
    buf += d;
    let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, n); buf = buf.slice(n + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    }
  });
  const rpc = (method, params) => new Promise((res) => { const id = nextId++; waiting.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  ok(/set_interactions/.test(init.result.instructions), 'instructions mention set_interactions');
  const list = await rpc('tools/list', {});
  const tools = list.result.tools;
  const names = tools.map((t) => t.name);
  ok(names.slice(-2).join() === 'set_interactions,open_folio', 'tools/list ends: ' + names.slice(-3).join(', '));
  const def = tools.find((t) => t.name === 'set_interactions');
  ok(def && !(def.annotations || {}).readOnlyHint, 'set_interactions is not read-only');
  ok(def && JSON.stringify(def.inputSchema.required) === '["node_id"]', 'schema requires node_id');
  // MCP defs for earlier tools match origin/main's converted the same way
  const oldMcp = before.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema }));
  const newMcp = tools.slice(0, oldMcp.length).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  ok(JSON.stringify(newMcp) === JSON.stringify(oldMcp), 'MCP tools/list prefix identical to origin/main');
  srv.kill();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
