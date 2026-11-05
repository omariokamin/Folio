/* Playwright test for src/ai.js — run: node .dev/ai-test.js [--real]
 * Serves the real @anthropic-ai/sdk@0.137.0 (bundled ESM) for the CDN URL and mocks the Messages API with SSE. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '/tmp/claude-0/-home-user-folio/30d67173-e7fe-53a5-9734-b219c5d6bd04/scratchpad';
const SDK = fs.readFileSync(path.join(SCRATCH, 'anthropic-sdk.mjs'), 'utf8');
const H2I = fs.readFileSync(path.join(SCRATCH, 'sdk/node_modules/html-to-image/dist/html-to-image.js'), 'utf8');
const SHOTS = path.join(SCRATCH, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const URL = 'http://localhost:8112/index.html';
const REAL = process.argv.includes('--real');

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok  ', msg);
  else {
    failures++;
    console.log('  FAIL', msg);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- SSE builder ----------
function chunks(s, n = 3) {
  const out = [];
  const size = Math.max(1, Math.ceil(s.length / n));
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}
let msgCounter = 0;
function sseMessage({ model = 'claude-opus-5-5', blocks = [], stop_reason = 'end_turn', stop_details = null, usage = {} }) {
  const ev = [];
  const u = { input_tokens: 1200, output_tokens: 1, cache_creation_input_tokens: 9000, cache_read_input_tokens: 0, ...usage };
  ev.push({ type: 'message_start', message: { id: 'msg_' + ++msgCounter, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { ...u, output_tokens: 1 } } });
  blocks.forEach((b, index) => {
    if (b.type === 'thinking') {
      ev.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      chunks(b.thinking).forEach((t) => ev.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: t } }));
      ev.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: b.signature || 'sig_' + index } });
    } else if (b.type === 'text') {
      ev.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      chunks(b.text, b.parts || 4).forEach((t) => ev.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: t } }));
    } else if (b.type === 'tool_use') {
      ev.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      const json = b.rawJson != null ? b.rawJson : JSON.stringify(b.input);
      chunks(json, 3).forEach((p) => ev.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: p } }));
    } else if (b.type === 'fallback') {
      ev.push({ type: 'content_block_start', index, content_block: { type: 'fallback', from: b.from, to: b.to } });
    }
    ev.push({ type: 'content_block_stop', index });
  });
  ev.push({ type: 'message_delta', delta: { stop_reason, stop_sequence: null, stop_details }, usage: { output_tokens: u.output_tokens > 1 ? u.output_tokens : 350, input_tokens: u.input_tokens, cache_creation_input_tokens: u.cache_creation_input_tokens, cache_read_input_tokens: u.cache_read_input_tokens } });
  ev.push({ type: 'message_stop' });
  return ev.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

// ---------- mock API ----------
const queue = []; // items: { sse } | { status, body, headers }
const requests = []; // { body, headers }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-expose-headers': '*' };

async function installRoutes(page) {
  await page.route('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.137.0/+esm', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', headers: CORS, body: SDK }));
  await page.route('https://esm.sh/**', (r) => r.abort());
  await page.route('https://cdn.jsdelivr.net/npm/html-to-image**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: H2I }));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await page.route('https://api.anthropic.com/v1/messages*', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    requests.push({ body: req.postDataJSON(), headers: req.headers() });
    let item = queue.shift();
    if (item && item.make) item = { ...item, sse: await item.make() };
    if (!item) return route.fulfill({ status: 500, headers: CORS, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'mock queue empty' } }) });
    if (item.delay) await sleep(item.delay);
    if (item.sse != null) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream', 'request-id': 'req_mock' }, body: item.sse });
    return route.fulfill({ status: item.status, headers: { ...CORS, 'content-type': 'application/json', 'x-should-retry': 'false', ...(item.headers || {}) }, body: JSON.stringify(item.body) });
  });
}

const CREATE_INPUT = { parent_id: null, nodes: [{ type: 'frame', name: 'Hero', width: 1440, height: 900, layout: { mode: 'flex', direction: 'column', gap: 24, padding: [96, 80, 96, 80] }, children: [{ type: 'text', name: 'Headline', text: { content: 'Brewed slow.', size: 96, font: 'Fraunces' } }] }] };
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function installStubs(page, { keepRealPrompt = false, keepRealTools = false } = {}) {
  await page.evaluate(
    ({ TINY_PNG, keepRealPrompt, keepRealTools }) => {
      if (!keepRealPrompt || !Folio.aiPrompt) {
        Folio.aiPrompt = {
          system: 'You are Folio’s designer. (stub system prompt)',
          tools: ['get_document', 'get_tree', 'create_nodes', 'update_nodes', 'delete_nodes', 'move_nodes', 'screenshot'].map((name) => ({
            name,
            description: 'stub ' + name,
            input_schema: { type: 'object', properties: {} },
          })),
          contextFor: () => 'Document: stub. Selection: ' + (Folio.store.selection.join(',') || 'none'),
        };
      }
      if (!keepRealTools || !Folio.aiTools) {
        window.__toolCalls = [];
        Folio.aiTools = {
          async execute(name, input) {
            window.__toolCalls.push({ name, input });
            await new Promise((r) => setTimeout(r, 120));
            if (name === 'create_nodes') {
              const n = Folio.store.buildFromTree({ type: 'frame', name: input.name || 'Hero', x: 3000, y: 0, width: 1440, height: 900, children: [{ type: 'text', text: { content: 'Brewed slow.' } }] });
              return { content: 'Created 2 layers. Root id: ' + n.id, isError: false, summary: 'Created 2 layers in “' + n.name + '”', changedIds: [n.id] };
            }
            if (name === 'screenshot') return { content: [{ type: 'text', text: 'Screenshot of Hero' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: TINY_PNG } }], isError: false, summary: 'Captured “Hero”', changedIds: [] };
            if (name === 'update_nodes') return { content: 'Unknown id n_nope', isError: true, summary: 'Update failed: unknown id', changedIds: [] };
            return { content: 'ok', isError: false, summary: 'Done', changedIds: [] };
          },
        };
      }
      // spies
      window.__commits = [];
      const origCommit = Folio.store.commit.bind(Folio.store);
      if (!Folio.store.__spied) {
        Folio.store.__spied = true;
        Folio.store.commit = (label) => {
          window.__commits.push(label);
          return origCommit(label);
        };
        window.__busy = [];
        Folio.store.on('ai:busy', (b) => window.__busy.push(b));
      }
    },
    { TINY_PNG, keepRealPrompt, keepRealTools }
  );
}

async function slowFetchInit(page) {
  await page.addInitScript(() => {
    window.__slow = 0;
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await real(input, init);
      const url = typeof input === 'string' ? input : input.url;
      if (!window.__slow || !String(url).includes('api.anthropic.com') || !res.body) return res;
      const delay = window.__slow;
      const reader = res.body.getReader();
      const signal = init && init.signal;
      let buf = new Uint8Array(0);
      const body = new ReadableStream({
        async pull(ctrl) {
          if (!buf.length) {
            const { value, done } = await reader.read();
            if (done) return ctrl.close();
            buf = value;
          }
          await new Promise((r) => setTimeout(r, delay));
          if (signal && signal.aborted) return ctrl.error(new DOMException('aborted', 'AbortError'));
          ctrl.enqueue(buf.slice(0, 60));
          buf = buf.slice(60);
        },
      });
      return new Response(body, { status: res.status, headers: res.headers });
    };
  });
}

const lastBody = () => requests[requests.length - 1].body;
const state = (page) => page.evaluate(() => ({ busy: Folio.store.aiBusy, aiBusy: Folio.ai.isBusy(), commits: window.__commits.slice(), busyEvents: window.__busy.slice(), history: Folio.ai.history() }));
async function waitIdle(page, timeout = 15000) {
  await page.waitForFunction(() => !Folio.ai.isBusy(), null, { timeout });
}
async function sendPrompt(page, text) {
  await page.fill('#ai-panel .ai-input', text);
  await page.press('#ai-panel .ai-input', 'Enter');
}
async function shot(page, name) {
  await page.locator('#right-panel').screenshot({ path: path.join(SHOTS, name + '.png') });
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  await installRoutes(page);
  await slowFetchInit(page);
  await page.goto(URL);
  await page.waitForFunction(() => window.Folio && Folio.ai && document.querySelector('#right-tabs .ai-tab'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.Folio && Folio.ai && document.querySelector('#right-tabs .ai-tab'));
  await installStubs(page, { keepRealPrompt: REAL, keepRealTools: REAL });
  const hasRealTools = await page.evaluate(() => !!(Folio.aiTools && !window.__toolCalls));

  console.log('\n# Tabs + ⌘K');
  check(await page.isVisible('#inspector'), 'Design tab shows inspector by default');
  check(await page.isHidden('#ai-panel'), 'AI panel hidden by default');
  await shot(page, '01-design-tab');
  await page.click('#canvas-viewport', { position: { x: 30, y: 30 } });
  await page.keyboard.press('Control+k');
  check(await page.isVisible('#ai-panel'), 'Ctrl+K opens AI panel');
  check(await page.isHidden('#inspector'), 'inspector hidden on AI tab');
  check(await page.evaluate(() => document.activeElement.classList.contains('ai-key__input')), 'no key → key input focused');
  await shot(page, '02-key-card');

  console.log('\n# Key setup');
  check(await page.isVisible('text=console.anthropic.com'), 'key card links to console');
  check(await page.evaluate(() => !!document.querySelector('.ai-key a[href="https://console.anthropic.com/settings/keys"]')), 'link href is exact');
  await page.fill('.ai-key__input', 'sk-ant-test-123');
  await page.check('.ai-key__remember input');
  await page.click('.ai-key__save');
  check(await page.evaluate(() => localStorage.getItem('folio:ai:key') === 'sk-ant-test-123'), 'remembered key stored in localStorage');
  check(await page.isVisible('#ai-panel .ai-input'), 'composer visible after saving key');
  check(await page.evaluate(() => document.activeElement.classList.contains('ai-input')), 'prompt focused after save');
  await page.click('#canvas-viewport', { position: { x: 30, y: 30 } });
  await page.evaluate(() => Folio.store.select([]));
  await page.waitForTimeout(100);
  check((await page.textContent('.ai-ctx')).includes('New design'), 'context chip says New design without selection');
  await shot(page, '03-empty-chat');

  console.log('\n# 3-iteration tool loop');
  queue.push({
    sse: sseMessage({
      blocks: [
        { type: 'thinking', thinking: 'The user wants a coffee hero. I will plan a warm palette with **cream** and espresso tones.' },
        { type: 'text', text: "I'll design a warm, editorial hero for the coffee brand." },
        { type: 'tool_use', id: 'toolu_01', name: 'create_nodes', input: CREATE_INPUT },
      ],
      stop_reason: 'tool_use',
    }),
    delay: 300,
  });
  queue.push({
    make: async () => {
      const rootId = await page.evaluate(() => Folio.store.doc.roots[Folio.store.doc.roots.length - 1]);
      return sseMessage({ blocks: [{ type: 'tool_use', id: 'toolu_02', name: 'screenshot', input: { node_id: rootId } }], stop_reason: 'tool_use', usage: { cache_read_input_tokens: 9000, cache_creation_input_tokens: 400 } });
    },
  });
  queue.push({
    sse: sseMessage({
      blocks: [
        { type: 'thinking', thinking: 'Looks balanced.' },
        { type: 'text', text: 'Done! The hero uses **Fraunces** for the headline and `#3b2416` for text.\n\n- Warm cream background\n- Big serif headline\n- Two buttons', parts: 8 },
      ],
      stop_reason: 'end_turn',
      usage: { cache_read_input_tokens: 9400, cache_creation_input_tokens: 300 },
    }),
  });
  const reqStart = requests.length;
  const ctx = await page.evaluate(() => Folio.aiPrompt.contextFor());
  await page.click('.ai-chip >> text=Landing page hero');
  await page.waitForTimeout(150);
  const midState = await state(page);
  check(midState.busy === true && midState.aiBusy === true, 'store.aiBusy true while running');
  check(await page.isDisabled('#ai-panel .ai-input'), 'composer textarea disabled while busy');
  check(await page.isVisible('.ai-send.is-stop'), 'Send button turned into Stop');
  await shot(page, '04-running');
  await waitIdle(page);
  await page.waitForTimeout(100);
  const s1 = await state(page);
  const reqs = requests.slice(reqStart);
  check(reqs.length === 3, `3 requests sent (got ${reqs.length})`);
  const b0 = reqs[0].body;
  const promptTools = await page.evaluate(() => Folio.aiPrompt.tools);
  const promptSystem = await page.evaluate(() => Folio.aiPrompt.system);
  check(b0.model === 'claude-opus-5-5', 'model = claude-opus-5-5');
  check(b0.max_tokens === 64000, 'max_tokens 64000');
  check(JSON.stringify(b0.output_config) === JSON.stringify({ effort: 'medium' }), 'output_config.effort medium');
  check(JSON.stringify(b0.thinking) === JSON.stringify({ type: 'adaptive', display: 'summarized' }), 'thinking adaptive summarized');
  check(JSON.stringify(b0.cache_control) === JSON.stringify({ type: 'ephemeral' }), 'top-level cache_control ephemeral');
  check(b0.fallbacks === 'default', "fallbacks: 'default'");
  check(!('betas' in b0), 'betas not in body (sent as header)');
  check(String(reqs[0].headers['anthropic-beta'] || '').includes('server-side-fallback-2026-07-01'), 'anthropic-beta header has server-side-fallback-2026-07-01');
  check(reqs[0].headers['x-api-key'] === 'sk-ant-test-123', 'x-api-key header');
  check(reqs[0].headers['anthropic-dangerous-direct-browser-access'] === 'true', 'dangerous-direct-browser-access header');
  check(b0.stream === true, 'stream: true');
  check(['temperature', 'top_p', 'top_k', 'tool_choice', 'budget_tokens'].every((k) => !(k in b0)), 'no temperature/top_p/top_k/tool_choice/budget_tokens');
  check(JSON.stringify(b0.tools) === JSON.stringify(promptTools), 'tools = Folio.aiPrompt.tools');
  check(b0.system === promptSystem, 'system = Folio.aiPrompt.system');
  check(reqs.every((r) => JSON.stringify(r.body.tools) === JSON.stringify(b0.tools) && r.body.system === b0.system), 'system/tools byte-stable across requests');
  check(b0.messages.length === 1 && b0.messages[0].role === 'user', 'first request has one user message');
  check(b0.messages[0].content[0].type === 'text' && b0.messages[0].content[0].text === ctx + '\n\nLanding page hero for a specialty coffee brand', 'user text = contextFor() + \\n\\n + prompt');
  const b1 = reqs[1].body;
  check(JSON.stringify(b1.messages.slice(0, 1)) === JSON.stringify(b0.messages), 'request 2 starts with request 1 messages (append-only)');
  check(b1.messages.length === 3 && b1.messages[1].role === 'assistant' && b1.messages[2].role === 'user', 'request 2 = [user, assistant, user]');
  const a1 = b1.messages[1].content;
  check(a1.map((c) => c.type).join(',') === 'thinking,text,tool_use', 'assistant content unchanged (thinking,text,tool_use)');
  check(a1[0].signature === 'sig_0' && a1[0].thinking.startsWith('The user wants'), 'thinking block kept with signature');
  check(JSON.stringify(a1[2].input) === JSON.stringify(CREATE_INPUT), 'tool_use input parsed');
  const tr1 = b1.messages[2].content;
  check(tr1.length === 1 && tr1[0].type === 'tool_result' && tr1[0].tool_use_id === 'toolu_01' && !tr1[0].is_error, 'tool_result for create_nodes');
  const b2 = reqs[2].body;
  check(JSON.stringify(b2.messages.slice(0, 3)) === JSON.stringify(b1.messages), 'request 3 starts with request 2 messages (append-only)');
  const tr2 = b2.messages[4].content;
  if (!REAL) check(tr2[0].tool_use_id === 'toolu_02' && Array.isArray(tr2[0].content) && tr2[0].content[1].type === 'image', 'screenshot tool_result has image block');
  else check(tr2[0].tool_use_id === 'toolu_02', 'screenshot tool_result returned');
  check(s1.commits.length === 1 && s1.commits[0] === 'AI: ' + 'Landing page hero for a specialty coffee brand'.slice(0, 40), `one commit with label (got ${JSON.stringify(s1.commits)})`);
  check(JSON.stringify(s1.busyEvents) === '[true,false]', 'ai:busy emitted true then false');
  check(s1.busy === false, 'store.aiBusy false after run');
  check(s1.history.length === 6 && s1.history[5].role === 'assistant', 'history has 6 turns ending with assistant');
  if (!hasRealTools || !REAL) {
    const calls = await page.evaluate(() => window.__toolCalls);
    check(calls.map((c) => c.name).join(',') === 'create_nodes,screenshot', 'aiTools.execute called for create_nodes, screenshot');
  }
  if (!REAL) {
    check((await page.locator('.ai-tool.is-ok').count()) === 2, '2 tool chips with ✓');
    check((await page.textContent('.ai-tool.is-ok >> nth=0')).includes('Created 2 layers'), 'chip shows summary');
  } else {
    const chipTexts = await page.locator('.ai-tool').allTextContents();
    console.log('       real chips:', JSON.stringify(chipTexts));
    check((await page.locator('.ai-tool.is-ok').count()) >= 1, 'real create_nodes chip ✓');
    console.log('       real tool_result 1:', JSON.stringify(tr1[0].content).slice(0, 300));
    console.log('       real tool_result 2:', JSON.stringify(tr2[0].content).slice(0, 300));
  }
  check((await page.locator('.ai-think').count()) === 2, '2 thinking rows');
  const strong = await page.locator('.ai-turn .ai-text strong').allTextContents();
  check(strong.includes('Fraunces'), 'markdown bold rendered');
  check((await page.locator('.ai-turn .ai-text code').allTextContents()).includes('#3b2416'), 'markdown code rendered');
  check((await page.locator('.ai-turn .ai-text li').count()) === 3, 'markdown list rendered');
  const costText = await page.textContent('.ai-cost');
  check(/^≈ \$[0-9.]+ · /.test(costText), 'cost line shown: ' + costText);
  // expected cost: 3 req * (1200 in*4 + 350 out*20) + cw (9000+400+300)*5 + cr (9000+9400)*0.2, per 1e6
  const exp = (3 * (1200 * 4 + 350 * 20) + (9000 + 400 + 300) * 4 * 1.25 + (9000 + 9400) * 0.2) / 1e6;
  check(costText.includes('$' + exp.toFixed(3)), `cost matches price table (${exp.toFixed(4)})`);
  await page.click('.ai-think >> nth=0 >> .ai-think__head');
  await page.click('.ai-tool >> nth=1 >> .ai-tool__head');
  await page.waitForTimeout(100);
  if (!REAL) check(await page.isVisible('.ai-tool__img'), 'expanded screenshot chip shows image');
  await shot(page, '05-done-expanded');
  await page.click('.ai-tool >> nth=1 >> .ai-tool__head');
  await page.click('.ai-think >> nth=0 >> .ai-think__head');

  console.log('\n# follow-up with image attachment (append-only)');
  const bigPng = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 3000;
    c.height = 1200;
    const x = c.getContext('2d');
    x.fillStyle = '#c96';
    x.fillRect(0, 0, 3000, 1200);
    x.fillStyle = '#222';
    x.fillRect(200, 200, 800, 400);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.setInputFiles('#ai-panel input[type=file]', { name: 'ref.png', mimeType: 'image/png', buffer: Buffer.from(bigPng, 'base64') });
  await page.waitForSelector('.ai-thumb');
  await shot(page, '06-attachment');
  const histBefore = (await state(page)).history;
  queue.push({ sse: sseMessage({ blocks: [{ type: 'text', text: 'Got the reference — matching that palette.' }] }) });
  await page.evaluate(() => Folio.store.select([Folio.store.doc.roots[0]]));
  await page.waitForTimeout(50);
  check((await page.textContent('.ai-ctx')).includes('Editing:'), 'context chip shows Editing: <name> with selection');
  await sendPrompt(page, 'Match this reference');
  await waitIdle(page);
  const b3 = lastBody();
  check(JSON.stringify(b3.messages.slice(0, histBefore.length)) === JSON.stringify(histBefore), 'follow-up request keeps full history prefix');
  const um = b3.messages[histBefore.length];
  check(um.role === 'user' && um.content[0].type === 'text' && um.content[0].text.endsWith('\n\nMatch this reference'), 'new user message text');
  check(um.content[1] && um.content[1].type === 'image' && um.content[1].source.type === 'base64' && um.content[1].source.media_type === 'image/png', 'image block attached after text');
  const dims = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, um.content[1].source.data);
  check(dims[0] === 1568 && dims[1] === 627, 'image resized to max 1568px: ' + dims.join('×'));
  check((await state(page)).commits.length === 2, 'second run committed once');
  // clear selection via chip ✕
  await page.click('.ai-ctxchip__x');
  check(await page.evaluate(() => Folio.store.selection.length === 0), 'context chip ✕ clears selection');

  console.log('\n# settings: Sonnet high, then Haiku');
  await page.click('.ai-head__model');
  await shot(page, '07-settings');
  await page.selectOption('.ai-pop select', 'claude-sonnet-5-5');
  await page.click('.ai-pop .f-seg button >> text=High');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('folio:ai:settings')).model === 'claude-sonnet-5-5'), 'settings persisted');
  await page.keyboard.press('Escape');
  check(await page.isHidden('.ai-pop'), 'Esc closes popover');
  queue.push({ sse: sseMessage({ model: 'claude-sonnet-5-5', blocks: [{ type: 'text', text: 'Sonnet here.' }] }) });
  await sendPrompt(page, 'hi sonnet');
  await waitIdle(page);
  let r = requests[requests.length - 1];
  check(r.body.model === 'claude-sonnet-5-5' && r.body.output_config.effort === 'high' && r.body.fallbacks === 'default' && String(r.headers['anthropic-beta']).includes('server-side-fallback-2026-07-01'), 'Sonnet: model, effort high, fallbacks on');
  await page.click('.ai-head__model');
  await page.selectOption('.ai-pop select', 'claude-haiku-5-5');
  await page.click('.ai-pop .f-seg button >> text=Low');
  await page.click('.ai-head__title');
  queue.push({ sse: sseMessage({ model: 'claude-haiku-5-5', blocks: [{ type: 'text', text: 'Haiku here.' }] }) });
  await sendPrompt(page, 'hi haiku');
  await waitIdle(page);
  r = requests[requests.length - 1];
  check(r.body.model === 'claude-haiku-5-5' && r.body.output_config.effort === 'low' && !('fallbacks' in r.body) && !String(r.headers['anthropic-beta'] || '').includes('server-side-fallback'), 'Haiku: no fallbacks / beta');
  await page.click('.ai-head__model');
  await page.selectOption('.ai-pop select', 'claude-opus-5-5');
  await page.click('.ai-pop .f-seg button >> text=Medium');
  await page.click('.ai-head__title');

  console.log('\n# New chat');
  await page.click('.ai-head button[title="New chat"]');
  check((await page.locator('.ai-turn').count()) === 0 && (await page.isVisible('.ai-empty')), 'New chat clears transcript');
  check((await state(page)).history.length === 0, 'New chat clears history');

  console.log('\n# 401');
  queue.push({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
  let c0 = (await state(page)).commits.length;
  await sendPrompt(page, 'Pricing section with 3 tiers');
  await waitIdle(page);
  check(await page.isVisible('.ai-err >> text=Your API key was rejected'), '401 → "Your API key was rejected"');
  check((await state(page)).commits.length === c0 + 1, 'error run committed once');
  check((await state(page)).busy === false, 'not busy after error');
  await shot(page, '08-auth-error');
  queue.push({ sse: sseMessage({ blocks: [{ type: 'text', text: 'Retried fine.' }] }) });
  const nBefore = requests.length;
  await page.click('.ai-err .is-retry');
  await waitIdle(page);
  check(requests.length === nBefore + 1 && lastBody().messages.length === 1, 'Retry resends the same single user message');
  check(await page.isVisible('text=Retried fine.'), 'retry succeeded');
  check(await page.isDisabled('.ai-err .is-retry'), 'old Retry disabled');

  console.log('\n# 429');
  queue.push({ status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit' } } });
  await sendPrompt(page, 'again');
  await waitIdle(page);
  check(await page.isVisible('.ai-err >> text=Rate limit reached'), '429 → Rate limit card');
  const h429 = (await state(page)).history;
  check(h429[h429.length - 1].role === 'user', 'history tail is the unanswered user turn');

  console.log('\n# follow-up after error merges into unanswered user turn');
  queue.push({ sse: sseMessage({ blocks: [{ type: 'text', text: 'ok.' }] }) });
  await sendPrompt(page, 'third try');
  await waitIdle(page);
  const bm = lastBody().messages;
  check(bm.every((m, i) => i === 0 || m.role !== bm[i - 1].role), 'no consecutive same-role turns');
  check(bm[bm.length - 1].content.length === 2, 'unanswered turn extended with new text');

  console.log('\n# 400 + 500');
  queue.push({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'messages: bad thing' } } });
  await sendPrompt(page, 'bad');
  await waitIdle(page);
  check(await page.isVisible('.ai-err >> text=The request was rejected'), '400 → request rejected card');
  check(await page.isVisible('.ai-err >> text=messages: bad thing'), '400 shows API message');

  console.log('\n# refusal');
  await page.click('.ai-head button[title="New chat"]');
  queue.push({ sse: sseMessage({ blocks: [{ type: 'text', text: 'Partial out' }], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'This request was declined by a safety classifier.' } }) });
  await sendPrompt(page, 'do something refused');
  await waitIdle(page);
  check(await page.isVisible('.ai-err >> text=This request was declined by a safety classifier.'), 'refusal shows stop_details.explanation');
  const hr = (await state(page)).history;
  check(hr.length === 1 && hr[0].role === 'user', 'refused output not added to history');
  await shot(page, '09-refusal');

  console.log('\n# max_tokens with truncated tool input');
  await page.click('.ai-head button[title="New chat"]');
  if (!REAL) await page.evaluate(() => (window.__toolCalls.length = 0));
  queue.push({ sse: sseMessage({ blocks: [{ type: 'text', text: 'Building…' }, { type: 'tool_use', id: 'toolu_trunc', name: 'create_nodes', rawJson: '{"name":"Hero","tree":{"type":"fra' }], stop_reason: 'max_tokens' }) });
  await sendPrompt(page, 'big design');
  await waitIdle(page);
  check(await page.isVisible('.ai-err >> text=The response was cut off'), 'max_tokens → error card');
  if (!REAL) check((await page.evaluate(() => window.__toolCalls.length)) === 0, 'truncated tool NOT executed');
  check(await page.isVisible('.ai-tool.is-error'), 'truncated tool chip marked ✕');
  const hm = (await state(page)).history;
  check(hm.length === 3 && hm[2].content[0].type === 'tool_result' && hm[2].content[0].is_error === true && hm[2].content[0].tool_use_id === 'toolu_trunc', 'is_error tool_result appended for truncated call');
  queue.push({ sse: sseMessage({ blocks: [{ type: 'text', text: 'Continuing with smaller calls.' }] }) });
  await page.click('.ai-err .is-retry');
  await waitIdle(page);
  check(lastBody().messages.length === 3, 'Continue sends history ending with the error tool_result');
  await shot(page, '10-max-tokens');

  console.log('\n# fallback block + tool error chip');
  await page.click('.ai-head button[title="New chat"]');
  queue.push({
    sse: sseMessage({
      model: 'claude-opus-5-5',
      blocks: [{ type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } }, { type: 'text', text: 'Trying an update.' }, { type: 'tool_use', id: 'toolu_u', name: 'update_nodes', input: { updates: [{ id: 'n_nope' }] } }],
      stop_reason: 'tool_use',
    }),
  });
  queue.push({ sse: sseMessage({ model: 'claude-opus-5', blocks: [{ type: 'text', text: 'Fixed it.' }] }) });
  await sendPrompt(page, 'tweak');
  await waitIdle(page);
  check(await page.isVisible('.ai-note--fallback'), 'fallback note shown');
  const fb = lastBody().messages[1].content;
  check(fb[0].type === 'fallback', 'fallback block kept in history');
  const tre = lastBody().messages[2].content[0];
  if (!REAL) check(tre.is_error === true && tre.content === 'Unknown id n_nope', 'tool error → is_error tool_result');
  if (!REAL) check(await page.isVisible('.ai-tool.is-error >> text=Update failed'), 'error chip shows ✕ + summary');
  await shot(page, '11-fallback');

  console.log('\n# Stop mid-stream');
  await page.click('.ai-head button[title="New chat"]');
  c0 = (await state(page)).commits.length;
  queue.push({ sse: sseMessage({ blocks: [{ type: 'thinking', thinking: 'Considering the layout options at length. '.repeat(3) }, { type: 'text', text: 'Here is a long answer that keeps streaming for quite a while so we can stop it. '.repeat(6), parts: 30 }] }) });
  await page.evaluate(() => (window.__slow = 40));
  await sendPrompt(page, 'Mobile onboarding screen');
  await page.waitForFunction(() => (document.querySelector('.ai-turn:last-child .ai-text') || {}).textContent?.length > 20, null, { timeout: 15000 });
  await shot(page, '12-streaming');
  check(await page.evaluate(() => Folio.store.aiBusy === true), 'busy during stream');
  await page.click('.ai-send.is-stop');
  await waitIdle(page, 5000);
  await page.evaluate(() => (window.__slow = 0));
  check(await page.isVisible('.ai-note--stopped'), 'Stopped note shown');
  const hs = await state(page);
  check(hs.commits.length === c0 + 1, 'stopped run committed once');
  check(hs.history.length === 1 && hs.history[0].role === 'user', 'partial streamed answer not added to history');
  check(!(await page.isDisabled('#ai-panel .ai-input')), 'composer re-enabled after stop');
  await shot(page, '13-stopped');

  console.log('\n# Stop between tool calls');
  if (REAL) await page.evaluate(() => { const ex = Folio.aiTools.execute.bind(Folio.aiTools); Folio.aiTools.execute = async (n, i) => (await new Promise((r) => setTimeout(r, 300)), ex(n, i)); });
  await page.click('.ai-head button[title="New chat"]');
  queue.push({ sse: sseMessage({ blocks: [{ type: 'tool_use', id: 't_a', name: 'create_nodes', input: { name: 'A' } }, { type: 'tool_use', id: 't_b', name: 'get_tree', input: {} }], stop_reason: 'tool_use' }) });
  const nReq = requests.length;
  await sendPrompt(page, 'two tools');
  await page.waitForSelector('.ai-tool.is-running', { timeout: 5000 });
  await page.click('.ai-send.is-stop');
  await waitIdle(page, 5000);
  const ht = (await state(page)).history;
  check(requests.length === nReq + 1, 'no further request after Stop');
  check(ht.length === 3 && ht[2].content.length === 2 && ht[2].content[1].is_error === true, 'all tool_results in ONE message; un-run tool marked is_error');

  console.log('\n# 40-iteration cap');
  await page.click('.ai-head button[title="New chat"]');
  for (let i = 0; i < 41; i++) queue.push({ sse: sseMessage({ blocks: [{ type: 'tool_use', id: 'loop_' + i, name: 'get_document', input: {} }], stop_reason: 'tool_use' }) });
  const capStart = requests.length;
  await sendPrompt(page, 'loop forever');
  await waitIdle(page, 60000);
  check(requests.length - capStart === 40, `stopped after 40 requests (got ${requests.length - capStart})`);
  check(await page.isVisible('.ai-err >> text=Paused after 40 steps'), 'cap card shown');
  queue.length = 0;

  console.log('\n# ⌘K while typing elsewhere / tab persistence');
  await page.click('.ai-tab >> text=Design');
  await page.evaluate(() => Folio.store.select([Folio.store.doc.roots[0]]));
  await page.waitForTimeout(100);
  const inp = page.locator('#inspector input').first();
  await inp.focus();
  await page.keyboard.press('Control+k');
  check(await page.isHidden('#ai-panel'), 'Ctrl+K ignored while typing in inspector');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Control+k');
  check(await page.isVisible('#ai-panel'), 'Ctrl+K opens AI from canvas');
  check(await page.evaluate(() => document.activeElement.classList.contains('ai-input')), 'prompt focused');
  await page.keyboard.press('Control+z'); // other shortcuts must still not be hijacked by us (typing → ignored by shortcuts)
  await page.reload();
  await page.waitForFunction(() => window.Folio && Folio.ai && document.querySelector('#right-tabs .ai-tab'));
  check(await page.isVisible('#ai-panel'), 'AI tab remembered after reload');
  check(await page.isVisible('#ai-panel .ai-input'), 'key remembered after reload');

  console.log('\n# Forget key + session-only key');
  await page.click('.ai-head button[title="AI settings"]');
  await page.click('.ai-pop button >> text=Forget');
  check(await page.evaluate(() => !localStorage.getItem('folio:ai:key') && !sessionStorage.getItem('folio:ai:key')), 'Forget removes key');
  check(await page.isVisible('.ai-key'), 'key card back');
  await page.fill('.ai-key__input', 'sk-ant-session');
  await page.press('.ai-key__input', 'Enter');
  check(await page.evaluate(() => !localStorage.getItem('folio:ai:key') && sessionStorage.getItem('folio:ai:key') === 'sk-ant-session'), 'unticked → sessionStorage');

  console.log('\n# Design tab still works');
  await page.click('.ai-tab >> text=Design');
  check(await page.isVisible('#inspector'), 'inspector visible again');
  await shot(page, '14-design-again');

  const relevantErrors = consoleErrors.filter((e) => !/Folio AI|Failed to load resource|ERR_FAILED|fonts\.gstatic|inlining remote css|reading CSS rules/.test(e));
  check(relevantErrors.length === 0, 'no unexpected console errors' + (relevantErrors.length ? ': ' + relevantErrors.join(' | ') : ''));

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
