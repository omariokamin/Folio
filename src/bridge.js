/*
 * bridge.js — connects this Folio tab to Claude Code.
 *
 * When Claude Code runs Folio's MCP server (mcp/folio-mcp.js), that server also serves Folio at
 * http://localhost:4317 and opens it with a secret link (?bridge=<token>). This file:
 *   1. picks up the token (and removes it from the address bar),
 *   2. listens for tool calls from Claude Code (Server-Sent Events),
 *   3. runs them one at a time with Folio.aiTools.execute() — the same tools the in-app AI uses,
 *   4. posts the results back, and
 *   5. shows a small status pill in the bottom-left corner of the canvas.
 * Each burst of Claude's edits becomes one undo step.
 *
 * Opened from file:// or without a token, it does nothing at all.
 *   Folio.bridge.init()      called by main.js
 *   Folio.bridge.state       'off' | 'connecting' | 'connected' | 'busy' | 'disconnected' | 'replaced' | 'invalid'
 */
window.Folio = window.Folio || {};

(function () {
  const TOKEN_KEY = 'folio:bridge:token';
  const COMMIT_QUIET_MS = 1200;
  const WATCHDOG_MS = 40 * 1000; // the server pings every 15 s
  const READ_ONLY = new Set(['get_document', 'get_tree', 'screenshot', 'get_brand', 'list_components', 'export_code']);

  let token = null;
  let es = null;
  let state = 'off';
  let retryMs = 1000;
  let retryTimer = null;
  let watchdog = null;
  let pill = null;
  let lastSummary = '';
  let hadConnection = false;
  let tokenFromUrl = false;

  // calls run strictly one after another
  const queue = [];
  let running = false;

  // undo: one commit per burst of mutating calls
  let commitTimer = null;
  let burst = [];

  const isLocalhost = () =>
    location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

  function readToken() {
    let fromUrl = null;
    try {
      const url = new URL(location.href);
      fromUrl = url.searchParams.get('bridge');
      if (fromUrl !== null) {
        url.searchParams.delete('bridge');
        history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      }
    } catch (e) {
      /* ignore */
    }
    if (fromUrl && /^[a-f0-9]{16,128}$/i.test(fromUrl)) {
      try {
        localStorage.setItem(TOKEN_KEY, fromUrl);
      } catch (e) {
        /* private mode: keep it in memory only */
      }
      tokenFromUrl = true;
      return fromUrl;
    }
    if (!isLocalhost()) return null;
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (e) {
      return null;
    }
  }

  const q = () => 'token=' + encodeURIComponent(token);

  // ---------- status pill ----------
  function ensurePill() {
    if (pill) return pill;
    const vp = document.getElementById('canvas-viewport');
    if (!vp) return null;
    pill = document.createElement('div');
    pill.className = 'fb-pill';
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    pill.innerHTML =
      '<span class="fb-pill__dot"></span><span class="fb-pill__body"><span class="fb-pill__title"></span>' +
      '<span class="fb-pill__sub"></span></span>';
    pill.addEventListener('pointerdown', (e) => e.stopPropagation());
    pill.addEventListener('click', () => {
      if (state === 'disconnected' || state === 'replaced') connect(true);
    });
    vp.appendChild(pill);
    return pill;
  }

  const TEXT = {
    connecting: ['Connecting to Claude Code…', ''],
    connected: ['Claude Code connected', ''],
    busy: ['Claude is designing…', ''],
    disconnected: ['Claude Code disconnected', 'Reconnecting… (click to retry now)'],
    replaced: ['Claude Code is using another Folio tab', 'Click to use this tab instead'],
    invalid: ['Claude Code link expired', 'Ask Claude to open Folio again'],
  };

  function setState(next, sub) {
    state = next;
    Folio.bridge.state = next;
    const el = ensurePill();
    if (!el) return;
    // Before the first successful connection we stay quiet unless something is clearly wrong.
    const visible = next !== 'off' && !(next === 'connecting' && !hadConnection);
    el.hidden = !visible;
    el.dataset.state = next;
    const [title, defSub] = TEXT[next] || ['', ''];
    el.querySelector('.fb-pill__title').textContent = title;
    const s = sub != null ? sub : next === 'busy' ? lastSummary : defSub;
    const subEl = el.querySelector('.fb-pill__sub');
    subEl.textContent = s || '';
    subEl.hidden = !s;
    el.title =
      next === 'connected'
        ? 'Claude Code can edit this canvas. Ask it to design something in your terminal.'
        : next === 'disconnected'
        ? 'Folio lost its connection to Claude Code. It reconnects automatically while Claude Code is running.'
        : '';
    if (Folio.store) Folio.store.emit('bridge:state', next);
  }

  // ---------- connection ----------
  function clearTimers() {
    clearTimeout(retryTimer);
    clearTimeout(watchdog);
    retryTimer = watchdog = null;
  }

  function closeStream() {
    if (es) {
      es.onerror = null;
      es.close();
      es = null;
    }
  }

  function scheduleReconnect() {
    clearTimers();
    closeStream();
    setState('disconnected');
    retryTimer = setTimeout(() => connect(false), retryMs);
    retryMs = Math.min(retryMs * 2, 30000);
  }

  function kickWatchdog() {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      console.warn('[Folio bridge] no heartbeat from Claude Code — reconnecting');
      scheduleReconnect();
    }, WATCHDOG_MS);
  }

  async function connect(manual) {
    clearTimers();
    closeStream();
    if (manual) retryMs = 1000;
    if (!hadConnection || manual) setState('connecting', manual ? '' : undefined);
    // A quick status check tells "wrong token" (403) apart from "server not running".
    let status = 0;
    try {
      const r = await fetch('/bridge/status?' + q(), { cache: 'no-store' });
      status = r.status;
    } catch (e) {
      status = 0;
    }
    if (status === 403) {
      try {
        if (localStorage.getItem(TOKEN_KEY) === token) localStorage.removeItem(TOKEN_KEY);
      } catch (e) {
        /* ignore */
      }
      setState(hadConnection || tokenFromUrl ? 'invalid' : 'off');
      console.warn('[Folio bridge] the Claude Code link is no longer valid');
      return;
    }
    if (status === 0 || status >= 500) return scheduleReconnect();
    if (status !== 200) {
      // This page is not served by Folio's MCP server (e.g. another local web server).
      setState(hadConnection ? 'disconnected' : 'off', hadConnection ? 'Click to retry' : undefined);
      return;
    }

    es = new EventSource('/bridge/events?' + q());
    es.addEventListener('hello', () => {
      hadConnection = true;
      retryMs = 1000;
      kickWatchdog();
      setState(running || queue.length ? 'busy' : 'connected');
    });
    es.addEventListener('ping', kickWatchdog);
    es.addEventListener('call', (e) => {
      kickWatchdog();
      let call;
      try {
        call = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      if (!call || typeof call.id !== 'string') return;
      queue.push(call);
      run();
    });
    es.addEventListener('replaced', () => {
      clearTimers();
      closeStream();
      setState('replaced');
    });
    es.addEventListener('bye', () => scheduleReconnect());
    es.onerror = () => {
      if (state === 'replaced') return;
      scheduleReconnect();
    };
  }

  // ---------- running calls ----------
  async function execute(call) {
    const tools = Folio.aiTools;
    if (!tools || typeof tools.execute !== 'function') {
      return { content: 'Folio\'s AI tools (src/ai-tools.js) are not loaded in this tab. Ask the user to reload Folio.', isError: true, summary: 'Tools missing' };
    }
    try {
      const r = await withLiveFrames(() => tools.execute(call.name, call.input || {}));
      if (r && typeof r === 'object') return r;
      return { content: String(r == null ? 'Done.' : r), isError: false, summary: '' };
    } catch (e) {
      console.error('[Folio bridge] tool failed', call.name, e);
      return { content: `Error while running ${call.name}: ${(e && e.message) || e}`, isError: true, summary: 'Error' };
    }
  }

  function cleanResult(r) {
    let content = r.content;
    if (content == null) content = '';
    if (!Array.isArray(content) && typeof content !== 'string') {
      try {
        content = JSON.stringify(content);
      } catch (e) {
        content = String(content);
      }
    }
    return {
      content,
      isError: !!r.isError,
      summary: typeof r.summary === 'string' ? r.summary : '',
      changedIds: Array.isArray(r.changedIds) ? r.changedIds.filter((x) => typeof x === 'string') : [],
    };
  }

  async function post(id, result) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch('/bridge/result?' + q(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, result }),
        });
        if (r.ok || r.status === 409 || r.status === 403) return;
      } catch (e) {
        /* retry */
      }
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
    console.warn('[Folio bridge] could not send a result back to Claude Code');
  }

  async function run() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const call = queue.shift();
        clearTimeout(commitTimer);
        lastSummary = humanName(call.name);
        if (state === 'connected' || state === 'busy') setState('busy');
        const result = cleanResult(await execute(call));
        if (result.summary) lastSummary = result.summary;
        if (state === 'busy') setState('busy'); // show the summary right away
        const mutating = !READ_ONLY.has(call.name) && (!result.isError || result.changedIds.length);
        if (mutating) burst.push(result.summary || humanName(call.name));
        await post(call.id, result);
      }
    } finally {
      running = false;
      scheduleCommit();
    }
  }

  function humanName(name) {
    return (
      {
        get_document: 'Looking at the document',
        get_tree: 'Reading layers',
        create_nodes: 'Creating layers',
        update_nodes: 'Editing layers',
        delete_nodes: 'Deleting layers',
        move_nodes: 'Moving layers',
        screenshot: 'Taking a screenshot',
      }[name] || String(name).replace(/_/g, ' ')
    );
  }

  /*
   * Browsers pause requestAnimationFrame in hidden tabs, and on a Mac a browser window that is
   * completely covered by Terminal counts as hidden. Folio renders (and the screenshot tool waits)
   * on animation frames, so while a call runs in a hidden tab we briefly swap in a stand-in that
   * runs frame callbacks right away (MessageChannel tasks are not throttled like timers).
   */
  const SHIM_BASE = 1e9;
  let shimSeq = 0;
  const shimQueue = new Map();
  let shimPort = null;
  function shimFlush() {
    const due = Array.from(shimQueue.entries());
    shimQueue.clear();
    const now = performance.now();
    due.forEach(([, cb]) => {
      try {
        cb(now);
      } catch (e) {
        console.error(e);
      }
    });
  }
  function shimRaf(cb) {
    if (!shimPort) {
      const ch = new MessageChannel();
      ch.port1.onmessage = shimFlush;
      shimPort = ch.port2;
    }
    const id = SHIM_BASE + ++shimSeq;
    if (!shimQueue.size) shimPort.postMessage(0);
    shimQueue.set(id, cb);
    return id;
  }
  async function withLiveFrames(fn) {
    if (!document.hidden || typeof MessageChannel !== 'function') return fn();
    const realRaf = window.requestAnimationFrame;
    const realCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = shimRaf;
    window.cancelAnimationFrame = (id) => (id > SHIM_BASE ? shimQueue.delete(id) : realCancel.call(window, id));
    try {
      return await fn();
    } finally {
      // callbacks already queued on the stand-in still run (on its own MessageChannel)
      window.requestAnimationFrame = realRaf;
      window.cancelAnimationFrame = realCancel;
    }
  }

  function scheduleCommit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      if (running || queue.length) return; // more calls arrived; run() reschedules
      if (state === 'busy') setState('connected');
      if (!burst.length || !Folio.store) return;
      const label = burst[burst.length - 1] + (burst.length > 1 ? ` (+${burst.length - 1} more)` : '');
      burst = [];
      Folio.store.commit('Claude: ' + label);
    }, COMMIT_QUIET_MS);
  }

  function init() {
    if (Folio.bridge.started) return;
    Folio.bridge.started = true;
    if (location.protocol === 'file:') return;
    token = readToken();
    if (!token) return;
    connect(false);
    window.addEventListener('online', () => {
      if (state === 'disconnected') connect(true);
    });
  }

  Folio.bridge = {
    init,
    state: 'off',
    started: false,
    /** For debugging: Folio.bridge.reconnect() */
    reconnect: () => token && connect(true),
  };
})();
