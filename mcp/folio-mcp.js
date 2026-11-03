#!/usr/bin/env node
/*
 * folio-mcp.js — lets Claude Code design on the Folio canvas.
 *
 *   Claude Code ──stdio MCP──► this file ──HTTP (127.0.0.1)──► a Folio browser tab (src/bridge.js)
 *
 * What it does:
 *   1. Speaks MCP (newline-delimited JSON-RPC 2.0) on stdin/stdout. stdout carries protocol
 *      messages ONLY; every log line goes to stderr.
 *   2. Reads Folio's tool definitions and design instructions from ../src/ai-prompt.js (run in a
 *      sandbox with a bare `window`), so Claude Code gets exactly the tools the in-app chat uses.
 *   3. Runs a small web server on http://localhost:4317 that serves the Folio app itself plus three
 *      bridge endpoints. The Folio tab listens for tool calls (Server-Sent Events), runs them on the
 *      canvas and posts the results back.
 *
 * Folio never sees Claude credentials: Claude Code makes every model call, this server only
 * relays tool calls on your own computer.
 *
 * Requirements: Node.js 18 or newer. No npm packages.
 * Environment:
 *   FOLIO_PORT=4317       preferred port (the next free one is used if it is busy)
 *   FOLIO_NO_BROWSER=1    never open a browser automatically (just print the URL)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Anything that tries to print to stdout must not corrupt the protocol stream.
console.log = console.info = console.debug = (...a) => console.error(...a);

const VERSION = '0.2.0';
const ROOT = path.resolve(__dirname, '..');
const PROMPT_FILE = path.join(ROOT, 'src', 'ai-prompt.js');
const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PORT = 4317;
const PORT_ATTEMPTS = 20;
const CALL_TIMEOUT_MS = 120 * 1000;
const CONNECT_WAIT_MS = 25 * 1000;
const BROWSER_OPEN_INTERVAL_MS = 60 * 1000;
const HEARTBEAT_MS = 15 * 1000;
const MAX_BODY_BYTES = 40 * 1024 * 1024; // screenshots can be a few MB of base64
const READ_ONLY_TOOLS = new Set(['get_document', 'get_tree', 'screenshot', 'get_brand']);
const NO_BROWSER = /^(1|true|yes)$/i.test(process.env.FOLIO_NO_BROWSER || '');

function log(...args) {
  process.stderr.write('[folio-mcp] ' + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n');
}

// ---------------------------------------------------------------------------
// Folio tool definitions (from src/ai-prompt.js)
// ---------------------------------------------------------------------------
let prompt = { ok: false, system: '', tools: [], error: 'not loaded yet' };

function loadPrompt() {
  try {
    const code = fs.readFileSync(PROMPT_FILE, 'utf8');
    const sandbox = {
      console: { log: log, info: log, warn: log, error: log, debug: () => {} },
      setTimeout,
      clearTimeout,
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: PROMPT_FILE, timeout: 5000 });
    const ap = sandbox.Folio && sandbox.Folio.aiPrompt;
    if (!ap) throw new Error('the file did not define window.Folio.aiPrompt');
    if (typeof ap.system !== 'string') throw new Error('Folio.aiPrompt.system is not a string');
    if (!Array.isArray(ap.tools)) throw new Error('Folio.aiPrompt.tools is not an array');
    const tools = [];
    for (const t of ap.tools) {
      if (!t || typeof t.name !== 'string') continue;
      if (t.name === 'open_folio') continue;
      // Plain JSON copy: drops anything vm-specific and anything non-serialisable.
      const schema = JSON.parse(JSON.stringify(t.input_schema || t.inputSchema || { type: 'object', properties: {} }));
      const def = { name: t.name, description: String(t.description || ''), inputSchema: schema };
      if (READ_ONLY_TOOLS.has(t.name)) def.annotations = { readOnlyHint: true };
      else if (t.name === 'delete_nodes') def.annotations = { destructiveHint: true };
      tools.push(def);
    }
    prompt = { ok: true, system: ap.system, tools, error: null };
    log(`loaded ${tools.length} Folio tools from src/ai-prompt.js`);
  } catch (e) {
    const why = e && e.code === 'ENOENT' ? `${PROMPT_FILE} was not found` : (e && e.message) || String(e);
    prompt = { ok: false, system: '', tools: [], error: why };
    log(`ERROR: could not load Folio's tool definitions from src/ai-prompt.js: ${why}`);
    log('Only the open_folio tool will be available until this is fixed (restart Claude Code afterwards).');
  }
}

const OPEN_FOLIO_TOOL = {
  name: 'open_folio',
  description:
    'Open the Folio design canvas in the user\'s default web browser (if no Folio tab is connected yet) ' +
    'and return its URL plus the connection status. Folio tools open it automatically, so you rarely need ' +
    'this — use it when the user asks to see Folio, or after a "No Folio tab connected" error.',
  inputSchema: {
    type: 'object',
    properties: {
      reopen: {
        type: 'boolean',
        description: 'Open a new browser tab even if a Folio tab is already connected (default false).',
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
};

function toolList() {
  if (!prompt.ok) loadPrompt(); // the file may have been fixed since start-up
  return [...prompt.tools, OPEN_FOLIO_TOOL];
}

function instructions() {
  const note = [
    '## Folio over Claude Code',
    'These tools drive a live Folio canvas in the user\'s web browser (served from this computer at ' +
      `${appUrl(false)}). The first Folio tool call opens the browser tab automatically and waits for it ` +
      'to connect; if it cannot, the error message contains the URL — ask the user to open it, then retry.',
    'Over Claude Code the user\'s messages do NOT start with a description of the document and selection: ' +
      'call get_document first (it lists the artboards and what the user has selected in Folio right now), ' +
      'and call it again when the user refers to "this" or "the selection". Use screenshot to check your work.',
    'The user watches every change live. Each burst of tool calls becomes one undo step in Folio ' +
      '(Cmd/Ctrl+Z in the Folio tab). Tool calls run one at a time, in order.',
  ].join('\n');
  if (!prompt.ok) {
    return (
      'Folio\'s design tools could not be loaded (src/ai-prompt.js: ' + prompt.error + '). Only open_folio ' +
      'works. Tell the user to check their Folio download, then restart Claude Code.\n\n' + note
    );
  }
  return prompt.system + '\n\n' + note;
}

// ---------------------------------------------------------------------------
// Token (~/.folio/bridge.json)
// ---------------------------------------------------------------------------
function loadToken() {
  const dir = path.join(os.homedir(), '.folio');
  const file = path.join(dir, 'bridge.json');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && typeof data.token === 'string' && /^[a-f0-9]{32,128}$/.test(data.token)) {
      try {
        fs.chmodSync(file, 0o600);
      } catch (e) {
        /* not supported (Windows) */
      }
      return data.token;
    }
  } catch (e) {
    /* missing or unreadable → create a new one */
  }
  const token = crypto.randomBytes(24).toString('hex');
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const body = JSON.stringify({ token, created: new Date().toISOString() }, null, 2) + '\n';
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    try {
      fs.chmodSync(tmp, 0o600);
    } catch (e) {
      /* Windows */
    }
    fs.renameSync(tmp, file);
    log(`created a new bridge token in ${file}`);
  } catch (e) {
    log(`could not save the bridge token to ${file} (${e.message}); using a temporary one for this session`);
  }
  return token;
}

const TOKEN = loadToken();
let port = 0;

function appUrl(withToken = true) {
  return `http://localhost:${port || DEFAULT_PORT}/` + (withToken ? `?bridge=${TOKEN}` : '');
}

function tokenOk(given) {
  if (typeof given !== 'string' || given.length !== TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(TOKEN));
}

// ---------------------------------------------------------------------------
// The connected Folio tab and the call queue
// ---------------------------------------------------------------------------
let tab = null; // { id, res, heartbeat, connectedAt }
let tabSeq = 0;
let callSeq = 0;
const queue = []; // calls waiting to be sent to a tab
let inFlight = null; // { id, name, input, resolve, timer, tabId }
let pumping = false;
const connectWaiters = new Set();
let lastBrowserOpen = 0;

function sseSend(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch (e) {
    return false;
  }
}

function attachTab(req, res) {
  if (tab) {
    sseSend(tab.res, 'replaced', { message: 'Claude Code is now connected to a newer Folio tab.' });
    dropTab(tab, 'The Folio tab was replaced by a newer Folio tab');
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.flushHeaders) res.flushHeaders();
  req.socket.setKeepAlive(true);
  req.socket.setTimeout(0);
  res.write('retry: 5000\n\n');
  const t = { id: ++tabSeq, res, connectedAt: Date.now(), heartbeat: null };
  t.heartbeat = setInterval(() => sseSend(res, 'ping', { t: Date.now() }), HEARTBEAT_MS);
  tab = t;
  sseSend(res, 'hello', { server: 'folio-mcp', version: VERSION, tab: t.id });
  const onGone = () => {
    if (tab === t) dropTab(t, 'The Folio tab was closed or reloaded');
  };
  req.on('close', onGone);
  res.on('error', onGone);
  log(`Folio tab #${t.id} connected`);
  connectWaiters.forEach((fn) => fn());
  pump();
}

function dropTab(t, reason) {
  clearInterval(t.heartbeat);
  try {
    t.res.end();
  } catch (e) {
    /* already closed */
  }
  if (tab === t) {
    tab = null;
    log(`Folio tab #${t.id} disconnected (${reason})`);
  }
  if (inFlight && inFlight.tabId === t.id) {
    finish(
      inFlight,
      errorResult(
        `${reason} while "${inFlight.name}" was running, so it may or may not have been applied. ` +
          'Call get_tree (or screenshot) to check the canvas before continuing. Folio reconnects ' +
          'automatically when the tab is open again.'
      )
    );
  }
}

function waitForTab(ms) {
  if (tab) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok) => {
      clearTimeout(timer);
      connectWaiters.delete(onConnect);
      resolve(ok);
    };
    const onConnect = () => done(true);
    const timer = setTimeout(() => done(!!tab), ms);
    connectWaiters.add(onConnect);
  });
}

function errorResult(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

function noTabMessage(lead) {
  return (
    (lead || 'No Folio tab is connected, so this tool could not run.') +
    ' Ask the user to open this address in their ' +
    `web browser (Chrome, Edge, Firefox or Safari) and keep the tab open:\n\n  ${appUrl(true)}\n\n` +
    'Then try again. If the page does not load, the Folio MCP server may have stopped — they can run /mcp ' +
    'in Claude Code to reconnect it.'
  );
}

function enqueue(name, input, rpcId) {
  return new Promise((resolve) => {
    queue.push({ id: 'c' + ++callSeq + '_' + crypto.randomBytes(4).toString('hex'), name, input, resolve, rpcId });
    pump();
  });
}

function finish(call, result) {
  if (call.done) return;
  call.done = true;
  clearTimeout(call.timer);
  if (inFlight === call) inFlight = null;
  call.resolve(result);
  setImmediate(pump);
}

async function pump() {
  if (pumping || inFlight || !queue.length) return;
  pumping = true;
  try {
    if (!tab) {
      maybeOpenBrowser();
      const ok = await waitForTab(CONNECT_WAIT_MS);
      if (!ok) {
        // Every waiting call gets the same plain-English instructions.
        const waiting = queue.splice(0);
        waiting.forEach((c) => finish(c, errorResult(noTabMessage())));
        return;
      }
    }
    const call = queue.shift();
    if (!call) return;
    call.tabId = tab.id;
    inFlight = call;
    call.timer = setTimeout(() => {
      finish(
        call,
        errorResult(
          `The Folio tab did not answer "${call.name}" within ${CALL_TIMEOUT_MS / 1000} seconds. The tab may be ` +
            'frozen or in the background; ask the user to check it. Call get_tree to see what was applied.'
        )
      );
    }, CALL_TIMEOUT_MS);
    if (!sseSend(tab.res, 'call', { id: call.id, name: call.name, input: call.input })) {
      dropTab(tab, 'The Folio tab connection broke');
    }
  } finally {
    pumping = false;
    if (!inFlight && queue.length) setImmediate(pump);
  }
}

function cancelQueued(rpcId) {
  const i = queue.findIndex((c) => c.rpcId === rpcId);
  if (i >= 0) {
    const [c] = queue.splice(i, 1);
    finish(c, errorResult('Cancelled.'));
    return true;
  }
  return false;
}

/** Folio / Anthropic-style tool result → MCP CallToolResult. */
function convertResult(r) {
  if (!r || typeof r !== 'object') return errorResult('The Folio tab returned an empty result.');
  const out = [];
  const add = (b) => {
    if (b == null) return;
    if (typeof b === 'string') return out.push({ type: 'text', text: b });
    if (b.type === 'text') return out.push({ type: 'text', text: String(b.text == null ? '' : b.text) });
    if (b.type === 'image' && b.source && b.source.type === 'base64' && typeof b.source.data === 'string') {
      return out.push({ type: 'image', data: b.source.data, mimeType: b.source.media_type || 'image/png' });
    }
    if (b.type === 'image' && typeof b.data === 'string') {
      return out.push({ type: 'image', data: b.data, mimeType: b.mimeType || 'image/png' });
    }
    out.push({ type: 'text', text: JSON.stringify(b) });
  };
  if (Array.isArray(r.content)) r.content.forEach(add);
  else if (r.content != null) add(r.content);
  if (!out.length) out.push({ type: 'text', text: String(r.summary || (r.isError ? 'Failed.' : 'Done.')) });
  return { content: out, isError: !!r.isError };
}

// ---------------------------------------------------------------------------
// Opening the browser
// ---------------------------------------------------------------------------
function openBrowser(url) {
  if (NO_BROWSER) {
    log(`FOLIO_NO_BROWSER is set — open ${url} yourself`);
    return;
  }
  let cmd;
  let args;
  const opts = { detached: true, stdio: 'ignore' };
  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url.replace(/&/g, '^&')];
    opts.windowsVerbatimArguments = true;
    opts.windowsHide = true;
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, opts);
    child.on('error', (e) => log(`could not open the browser (${e.message}) — open ${url} yourself`));
    child.unref();
    log(`opening ${url.replace(TOKEN, '<token>')} in the default browser`);
  } catch (e) {
    log(`could not open the browser (${e.message}) — open ${url} yourself`);
  }
}

function maybeOpenBrowser() {
  if (Date.now() - lastBrowserOpen < BROWSER_OPEN_INTERVAL_MS) return;
  lastBrowserOpen = Date.now();
  openBrowser(appUrl(true));
}

async function openFolioTool(input) {
  const reopen = !!(input && input.reopen);
  if (tab && !reopen) {
    return {
      content: [{ type: 'text', text: `Folio is open and connected. URL (for the user): ${appUrl(true)}` }],
      isError: false,
    };
  }
  lastBrowserOpen = Date.now();
  openBrowser(appUrl(true));
  const ok = await waitForTab(CONNECT_WAIT_MS);
  if (ok) {
    return {
      content: [{ type: 'text', text: `Folio is open and connected. URL (for the user): ${appUrl(true)}` }],
      isError: false,
    };
  }
  return errorResult(noTabMessage('Folio did not connect within ' + CONNECT_WAIT_MS / 1000 + ' seconds (the browser may not have opened).'));
}

// ---------------------------------------------------------------------------
// HTTP server: the Folio app + bridge endpoints
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};
// Only these top-level folders are served (never .git, .dev, mcp/, docs/, dotfiles…).
const SERVED_DIRS = new Set(['src', 'styles', 'assets', 'fonts', 'images', 'vendor', 'lib']);
let REAL_ROOT = ROOT;
try {
  REAL_ROOT = fs.realpathSync(ROOT);
} catch (e) {
  /* keep ROOT */
}

function baseHeaders(extra) {
  return Object.assign(
    {
      'X-Folio-MCP': VERSION,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    },
    extra || {}
  );
}

function send(res, status, body, type = 'text/plain; charset=utf-8', extra) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, baseHeaders(Object.assign({ 'Content-Type': type, 'Content-Length': buf.length }, extra)));
  res.end(buf);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');
}

function hostAllowed(req) {
  // Blocks DNS-rebinding: only requests addressed to this computer by name are accepted.
  const host = String(req.headers.host || '').toLowerCase();
  return host === `localhost:${port}` || host === `127.0.0.1:${port}` || host === `[::1]:${port}`;
}

function sameOriginOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // EventSource / same-origin GETs may omit it
  return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
}

function resolveStatic(pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (e) {
    return null;
  }
  if (rel.includes('\0') || rel.includes('\\')) return null;
  if (rel === '/' || rel === '/index.html') return path.join(ROOT, 'index.html');
  const parts = rel.split('/').filter(Boolean);
  if (parts.length < 2 || !SERVED_DIRS.has(parts[0])) return null;
  if (parts.some((p) => p === '..' || p.startsWith('.'))) return null;
  const file = path.resolve(ROOT, ...parts);
  if (!file.startsWith(ROOT + path.sep)) return null;
  return file;
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', undefined, { Allow: 'GET, HEAD' });
  if (pathname === '/favicon.ico') return send(res, 204, '');
  const file = resolveStatic(pathname);
  if (!file) return send(res, 404, 'Not found');
  fs.realpath(file, (err, real) => {
    if (err || !(real === REAL_ROOT || real.startsWith(REAL_ROOT + path.sep))) return send(res, 404, 'Not found');
    fs.stat(real, (err2, st) => {
      if (err2 || !st.isFile()) return send(res, 404, 'Not found');
      const type = MIME[path.extname(real).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, baseHeaders({ 'Content-Type': type, 'Content-Length': st.size }));
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
    });
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleBridge(req, res, url) {
  if (!tokenOk(url.searchParams.get('token'))) return sendJson(res, 403, { error: 'invalid token' });
  if (!sameOriginOk(req)) return sendJson(res, 403, { error: 'cross-origin requests are not allowed' });
  const route = url.pathname;
  if (route === '/bridge/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      app: 'folio-mcp',
      version: VERSION,
      port,
      connected: !!tab,
      busy: !!inFlight,
      queued: queue.length,
      toolsLoaded: prompt.ok,
    });
  }
  if (route === '/bridge/events' && req.method === 'GET') return attachTab(req, res);
  if (route === '/bridge/result' && req.method === 'POST') {
    let msg;
    try {
      msg = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      return sendJson(res, e.status || 400, { error: e.status ? 'result too large' : 'invalid JSON' });
    }
    if (!msg || typeof msg.id !== 'string') return sendJson(res, 400, { error: 'missing id' });
    if (!inFlight || inFlight.id !== msg.id) return sendJson(res, 409, { error: 'no such pending call (it may have timed out)' });
    finish(inFlight, convertResult(msg.result));
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (e) {
    return send(res, 400, 'Bad request');
  }
  if (!hostAllowed(req)) return send(res, 421, 'Folio only answers on localhost');
  if (url.pathname.startsWith('/bridge/')) {
    handleBridge(req, res, url).catch((e) => {
      log('bridge error:', e && e.message);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    });
    return;
  }
  serveStatic(req, res, url.pathname);
});
server.on('clientError', (e, socket) => socket.destroy());

/** Is something on this port another folio-mcp (vs. an unrelated program)? */
function probeFolio(p) {
  return new Promise((resolve) => {
    const r = http.get({ host: '127.0.0.1', port: p, path: '/bridge/status', timeout: 1500, headers: { Host: `localhost:${p}` } }, (res) => {
      resolve(!!res.headers['x-folio-mcp']);
      res.resume();
    });
    r.on('error', () => resolve(false));
    r.on('timeout', () => {
      r.destroy();
      resolve(false);
    });
  });
}

function listenOn(p) {
  return new Promise((resolve, reject) => {
    const onErr = (e) => {
      server.removeListener('listening', onOk);
      reject(e);
    };
    const onOk = () => {
      server.removeListener('error', onErr);
      resolve();
    };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(p, '127.0.0.1');
  });
}

async function startHttp() {
  const preferred = parseInt(process.env.FOLIO_PORT, 10);
  const first = preferred > 0 && preferred < 65536 ? preferred : DEFAULT_PORT;
  for (let p = first; p < first + PORT_ATTEMPTS && p < 65536; p++) {
    try {
      await listenOn(p);
      port = p;
      if (p !== first) log(`using port ${p} instead`);
      log(`Folio is served at http://localhost:${p}/ (bridge link: ${appUrl(true).replace(TOKEN, '<token>')})`);
      return;
    } catch (e) {
      if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') {
        log(`could not start the web server on port ${p}: ${e.message}`);
        continue;
      }
      const other = await probeFolio(p);
      log(
        other
          ? `port ${p} is already used by another Folio MCP server (another Claude Code window?) — trying ${p + 1}`
          : `port ${p} is busy (used by another program) — trying ${p + 1}`
      );
    }
  }
  log(`ERROR: no free port between ${first} and ${first + PORT_ATTEMPTS - 1}. Set FOLIO_PORT to a free port.`);
}

// ---------------------------------------------------------------------------
// MCP over stdio
// ---------------------------------------------------------------------------
let stdoutBroken = false;
function write(msg) {
  if (stdoutBroken) return;
  try {
    process.stdout.write(JSON.stringify(msg) + '\n');
  } catch (e) {
    stdoutBroken = true;
  }
}
process.stdout.on('error', () => {
  stdoutBroken = true;
  shutdown();
});

const rpcError = (id, code, message, data) => ({
  jsonrpc: '2.0',
  id: id === undefined ? null : id,
  error: data === undefined ? { code, message } : { code, message, data },
});
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const validId = (id) => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));

/** Handle one JSON-RPC message. Returns a response object, or null for notifications. */
async function handleMessage(msg) {
  if (!isObj(msg) || msg.jsonrpc !== '2.0') return rpcError(isObj(msg) && validId(msg.id) ? msg.id : null, -32600, 'Invalid Request');
  const hasId = 'id' in msg && msg.id !== null && msg.id !== undefined;
  if (typeof msg.method !== 'string') {
    if (('result' in msg || 'error' in msg) && hasId) return null; // a response to us — we never ask anything
    return rpcError(hasId ? msg.id : null, -32600, 'Invalid Request');
  }
  if (!hasId) {
    // Notifications never get a response.
    if (msg.method === 'notifications/cancelled' && isObj(msg.params)) cancelQueued(msg.params.requestId);
    return null;
  }
  if (!validId(msg.id)) return rpcError(null, -32600, 'Invalid Request: id must be a string or number');
  const { id, method } = msg;
  const params = msg.params === undefined ? {} : msg.params;
  if (!isObj(params)) return rpcError(id, -32602, 'Invalid params: params must be an object');

  switch (method) {
    case 'initialize': {
      if (typeof params.protocolVersion !== 'string') return rpcError(id, -32602, 'Invalid params: protocolVersion is required');
      const version = SUPPORTED_PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED_PROTOCOLS[0];
      if (!prompt.ok) loadPrompt();
      await httpReady; // so the instructions name the real port
      return rpcResult(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'folio', title: 'Folio', version: VERSION },
        instructions: instructions(),
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: toolList() });
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string' || !name) return rpcError(id, -32602, 'Invalid params: "name" (the tool name) is required');
      const args = params.arguments === undefined || params.arguments === null ? {} : params.arguments;
      if (!isObj(args)) return rpcError(id, -32602, 'Invalid params: "arguments" must be an object');
      await httpReady;
      if (!port) return rpcResult(id, errorResult('Folio\'s local web server could not start (no free port). Ask the user to close other programs using ports 4317–4336 or set FOLIO_PORT, then restart Claude Code.'));
      if (name === 'open_folio') return rpcResult(id, await openFolioTool(args));
      if (!prompt.ok) loadPrompt();
      if (!prompt.ok) {
        return rpcResult(
          id,
          errorResult(
            `Folio's design tools are unavailable because src/ai-prompt.js could not be loaded (${prompt.error}). ` +
              'Tell the user to check that their Folio folder is complete, then restart Claude Code.'
          )
        );
      }
      if (!prompt.tools.some((t) => t.name === name)) return rpcError(id, -32602, `Unknown tool: ${name}`);
      return rpcResult(id, await enqueue(name, args, id));
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

async function handleLine(line) {
  line = line.trim();
  if (!line) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    return write(rpcError(null, -32700, 'Parse error'));
  }
  try {
    if (Array.isArray(msg)) {
      if (!msg.length) return write(rpcError(null, -32600, 'Invalid Request'));
      const out = (await Promise.all(msg.map((m) => handleMessage(m)))).filter(Boolean);
      if (out.length) write(out);
      return;
    }
    const out = await handleMessage(msg);
    if (out) write(out);
  } catch (e) {
    log('internal error:', (e && e.stack) || String(e));
    if (isObj(msg) && validId(msg.id)) write(rpcError(msg.id, -32603, 'Internal error'));
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    handleLine(line);
  }
});
process.stdin.on('end', () => {
  if (buffer.trim()) handleLine(buffer);
  buffer = '';
  shutdown();
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (tab) {
    sseSend(tab.res, 'bye', { message: 'Claude Code closed the Folio connection.' });
    dropTab(tab, 'Claude Code closed the connection');
  }
  try {
    server.close();
    if (server.closeAllConnections) server.closeAllConnections();
  } catch (e) {
    /* not listening */
  }
  setTimeout(() => process.exit(0), 50);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (e) => log('unexpected error:', (e && e.stack) || String(e)));
process.on('unhandledRejection', (e) => log('unexpected error:', (e && e.stack) || String(e)));

loadPrompt();
const httpReady = startHttp();
