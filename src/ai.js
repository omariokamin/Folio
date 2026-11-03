/*
 * ai.js — the in-app AI designer: a chat panel in the right sidebar.
 *
 *   Folio.ai.init()    build the Design / AI tabs and the chat panel (#ai-panel)
 *   Folio.ai.open()    switch to the AI tab and focus the prompt (also ⌘/Ctrl+K)
 *   Folio.ai.close()   switch back to the Design tab (the inspector)
 *
 * How it works, in short:
 *   1. You type a request. We prepend a description of the current document and
 *      selection (Folio.aiPrompt.contextFor()) and send it to Claude with the
 *      official Anthropic SDK (loaded on demand from a CDN), using YOUR API key.
 *   2. Claude answers with text and "tool calls" (create_nodes, update_nodes,
 *      screenshot…). We run each call with Folio.aiTools.execute(), which edits
 *      the canvas live, and send all the results back in one message.
 *   3. Repeat until Claude says it is done (max 40 steps). The whole run becomes
 *      one undo step.
 *
 * The API key never leaves this browser except in requests sent straight to
 * api.anthropic.com. Conversation history lives in memory until "New chat".
 */
window.Folio = window.Folio || {};

(function () {
  // ---------- constants (SPEC: "AI designer (v0.2)") ----------
  const SDK_URLS = [
    'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.137.0/+esm',
    'https://esm.sh/@anthropic-ai/sdk@0.137.0',
  ];
  const KEY_STORAGE = 'folio:ai:key';
  const SETTINGS_STORAGE = 'folio:ai:settings';
  const TAB_STORAGE = 'folio:ui:right-tab';
  const MAX_ITERATIONS = 40;
  const MAX_TOKENS = 64000;
  const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
  const MAX_IMAGE_EDGE = 1568;
  const MAX_ATTACHMENTS = 6;
  const MAX_IMAGE_B64 = 4.5 * 1024 * 1024; // stay safely under the API's 5 MB per image
  const KEYS_URL = 'https://console.anthropic.com/settings/keys';

  // Prices in $ per million tokens: input / output / cache read. Cache writes ≈ 1.25× input.
  const MODELS = [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', hint: 'Best designs', price: [4, 20, 0.2], fallbacks: true },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', hint: 'Faster, half the price', price: [2, 10, 0.2], fallbacks: true },
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5', hint: 'Quick edits, cheapest', price: [0.1, 0.5, 0.01], fallbacks: false },
  ];
  const EFFORTS = [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
  ];
  const DEFAULT_SETTINGS = { model: MODELS[0].id, effort: 'medium' };

  const QUICK_PROMPTS = [
    'Landing page hero for a specialty coffee brand',
    'Instagram post announcing a 30% off sale',
    'Pricing section with 3 tiers',
    'Mobile onboarding screen',
    'Make the selected design feel more premium',
  ];

  const TOOL_LABELS = {
    get_document: 'Reading the document',
    get_tree: 'Inspecting layers',
    create_nodes: 'Creating layers',
    update_nodes: 'Updating layers',
    delete_nodes: 'Deleting layers',
    move_nodes: 'Moving layers',
    screenshot: 'Taking a screenshot',
    get_brand: 'Reading the brand kit',
    set_brand: 'Updating the brand kit',
    list_components: 'Reading the components',
    create_component: 'Making a component',
    create_instances: 'Placing components',
    update_instances: 'Updating instances',
    add_starter_kit: 'Adding the starter kit',
    draft_logo: 'Drafting a logo',
    save_logo: 'Saving the logo',
  };

  const store = Folio.store;
  const h = (...a) => Folio.ui.h(...a);
  const icon = (name, size = 14) => Folio.icons.el(name, size);

  // ---------- safe storage ----------
  function storageGet(kind, key) {
    try {
      return window[kind].getItem(key);
    } catch (e) {
      return null;
    }
  }
  function storageSet(kind, key, value) {
    try {
      window[kind].setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }
  function storageDel(kind, key) {
    try {
      window[kind].removeItem(key);
    } catch (e) {}
  }

  function loadSettings() {
    let s = {};
    try {
      s = JSON.parse(storageGet('localStorage', SETTINGS_STORAGE) || '{}') || {};
    } catch (e) {}
    return {
      model: MODELS.some((m) => m.id === s.model) ? s.model : DEFAULT_SETTINGS.model,
      effort: EFFORTS.some((e) => e.id === s.effort) ? s.effort : DEFAULT_SETTINGS.effort,
    };
  }
  function saveSettings() {
    storageSet('localStorage', SETTINGS_STORAGE, JSON.stringify(settings));
  }

  function getKey() {
    return storageGet('localStorage', KEY_STORAGE) || storageGet('sessionStorage', KEY_STORAGE) || '';
  }
  function keyIsRemembered() {
    return !!storageGet('localStorage', KEY_STORAGE);
  }
  function saveKey(key, remember) {
    storageDel('localStorage', KEY_STORAGE);
    storageDel('sessionStorage', KEY_STORAGE);
    return storageSet(remember ? 'localStorage' : 'sessionStorage', KEY_STORAGE, key);
  }
  function forgetKey() {
    storageDel('localStorage', KEY_STORAGE);
    storageDel('sessionStorage', KEY_STORAGE);
    clientCache = null;
  }

  const modelInfo = (id) => MODELS.find((m) => m.id === id) || null;
  function modelLabel(id) {
    if (modelInfo(id)) return modelInfo(id).label;
    const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(String(id || ''));
    if (!m) return id ? String(id) : 'another model';
    return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + (m[3] ? '.' + m[3] : '');
  }

  // ---------- the SDK (loaded on first use) ----------
  let sdkPromise = null;
  function loadSdk() {
    if (!sdkPromise) {
      sdkPromise = (async () => {
        let lastErr = null;
        for (const url of SDK_URLS) {
          try {
            const mod = await import(url);
            if (mod && mod.default) return mod.default;
          } catch (e) {
            lastErr = e;
          }
        }
        const err = new Error('Could not load the Anthropic SDK' + (lastErr ? ': ' + lastErr.message : ''));
        err.sdkLoadFailed = true;
        throw err;
      })();
      sdkPromise.catch(() => (sdkPromise = null)); // allow a retry later
    }
    return sdkPromise;
  }

  let clientCache = null; // { key, client }
  function clientFor(Anthropic, apiKey) {
    if (!clientCache || clientCache.key !== apiKey) {
      clientCache = { key: apiKey, client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) };
    }
    return clientCache.client;
  }

  // ---------- state ----------
  let settings = loadSettings();
  const chat = {
    history: [], // Messages API turns — append-only until "New chat"
    busy: false,
    run: null,
    lastPrompt: '',
    attachments: [], // { media_type, data, url, name }
    costTotal: 0,
  };
  let changingKey = false;

  // DOM refs
  let panel, rightPanel, inspectorEl, tabsEl, tabDesign, tabAi;
  let headModelBtn, newChatBtn, settingsBtn, pop;
  let body, log, keyCard, composer, ctxRow, attachRow, textarea, sendBtn, attachBtn, fileInput, dropOverlay;

  // =====================================================================
  //  Tabs
  // =====================================================================
  function buildTabs() {
    tabsEl.replaceChildren();
    tabsEl.setAttribute('role', 'tablist');
    tabDesign = h('button', { class: 'ai-tab', role: 'tab', type: 'button', onClick: () => setTab('design') }, 'Design');
    tabAi = h(
      'button',
      { class: 'ai-tab', role: 'tab', type: 'button', title: 'AI designer (⌘K / Ctrl+K)', onClick: () => setTab('ai') },
      icon('sparkle', 13),
      'AI',
      h('i', { class: 'ai-tab__dot' })
    );
    tabsEl.append(tabDesign, tabAi);
  }

  function currentTab() {
    return panel && !panel.hidden ? 'ai' : 'design';
  }

  function setTab(tab, { remember = true } = {}) {
    const ai = tab === 'ai';
    if (panel) panel.hidden = !ai;
    if (inspectorEl) inspectorEl.hidden = ai;
    if (rightPanel) rightPanel.classList.toggle('is-ai', ai);
    tabDesign.classList.toggle('is-active', !ai);
    tabAi.classList.toggle('is-active', ai);
    tabDesign.setAttribute('aria-selected', String(!ai));
    tabAi.setAttribute('aria-selected', String(ai));
    if (remember) storageSet('localStorage', TAB_STORAGE, ai ? 'ai' : 'design');
    if (ai) {
      updateContextChip();
      scrollToEnd(true);
    } else {
      closePop();
      if (Folio.inspector && Folio.inspector.refresh) {
        try {
          Folio.inspector.refresh();
        } catch (e) {}
      }
    }
  }

  // =====================================================================
  //  Panel skeleton
  // =====================================================================
  function buildPanel() {
    panel.replaceChildren();
    panel.classList.add('ai');

    headModelBtn = h('button', { class: 'ai-head__model', type: 'button', title: 'Model & effort', onClick: togglePop });
    newChatBtn = h('button', { class: 'f-btn f-btn--ghost f-btn--icon ai-ibtn', type: 'button', title: 'New chat', onClick: newChat }, icon('plus'));
    settingsBtn = h('button', { class: 'f-btn f-btn--ghost f-btn--icon ai-ibtn', type: 'button', title: 'AI settings', onClick: togglePop }, icon('settings'));
    const head = h('div', { class: 'ai-head' }, h('div', { class: 'ai-head__title' }, 'AI designer'), headModelBtn, newChatBtn, settingsBtn);

    pop = h('div', { class: 'ai-pop', hidden: true, role: 'dialog', 'aria-label': 'AI settings' });

    log = h('div', { class: 'ai-log', 'aria-live': 'polite' });
    keyCard = h('div', { class: 'ai-keywrap' });
    body = h('div', { class: 'ai-body' }, keyCard, log);

    // composer
    ctxRow = h('div', { class: 'ai-ctx' });
    attachRow = h('div', { class: 'ai-attach', hidden: true });
    textarea = h('textarea', {
      class: 'ai-input',
      rows: 1,
      placeholder: 'Describe a design, or ask for changes…',
      spellcheck: true,
      'aria-label': 'Message Claude',
    });
    textarea.addEventListener('input', autoGrow);
    textarea.addEventListener('keydown', onTextareaKey);
    textarea.addEventListener('paste', onPaste);
    fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    fileInput.addEventListener('change', () => {
      addFiles([...fileInput.files]);
      fileInput.value = '';
    });
    attachBtn = h('button', { class: 'f-btn f-btn--ghost f-btn--icon ai-ibtn', type: 'button', title: 'Attach images (or paste / drop them)', onClick: () => fileInput.click() }, icon('image'));
    sendBtn = h('button', { class: 'ai-send', type: 'button', onClick: onSendClick });
    const actions = h('div', { class: 'ai-actions' }, attachBtn, h('span', { class: 'ai-actions__hint' }, '⏎ send · ⇧⏎ new line'), sendBtn);
    const box = h('div', { class: 'ai-box' }, attachRow, textarea, actions);
    composer = h('div', { class: 'ai-composer' }, ctxRow, box, fileInput);

    dropOverlay = h('div', { class: 'ai-drop', hidden: true }, icon('image', 22), h('div', {}, 'Drop images to attach'));

    panel.append(head, pop, body, composer, dropOverlay);

    // drag & drop images onto the panel
    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    panel.addEventListener('dragenter', (e) => {
      if (!hasFiles(e) || !getKey()) return;
      e.preventDefault();
      dragDepth++;
      dropOverlay.hidden = false;
    });
    panel.addEventListener('dragover', (e) => {
      if (!hasFiles(e) || !getKey()) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    panel.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) dropOverlay.hidden = true;
    });
    panel.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      dropOverlay.hidden = true;
      if (!chat.busy) addFiles([...e.dataTransfer.files]);
    });

    renderHead();
    renderComposerState();
    renderKeyState();
    renderEmptyState();
  }

  function renderHead() {
    const m = modelInfo(settings.model);
    headModelBtn.replaceChildren(h('span', {}, m.label), h('span', { class: 'ai-head__effort' }, settings.effort), icon('chevron-down', 12));
  }

  // =====================================================================
  //  API key card
  // =====================================================================
  function renderKeyState() {
    const hasKey = !!getKey();
    const showCard = !hasKey || changingKey;
    keyCard.hidden = !showCard;
    log.hidden = showCard;
    composer.hidden = showCard;
    newChatBtn.disabled = showCard || chat.busy;
    if (showCard) buildKeyCard(hasKey);
    else keyCard.replaceChildren();
  }

  function buildKeyCard(hasKey) {
    const input = h('input', {
      class: 'f-input ai-key__input',
      type: 'password',
      placeholder: 'sk-ant-…',
      autocomplete: 'off',
      spellcheck: false,
      'aria-label': 'Anthropic API key',
    });
    const remember = h('input', { type: 'checkbox', class: 'ai-check' });
    remember.checked = hasKey ? keyIsRemembered() : false;
    const warn = h('div', { class: 'ai-key__warn', hidden: true });
    const save = h('button', { class: 'f-btn f-btn--primary ai-key__save', type: 'button', disabled: true }, 'Save key');
    const doSave = () => {
      const key = input.value.trim().replace(/\s+/g, '');
      if (!key) return;
      if (!saveKey(key, remember.checked)) {
        warn.hidden = false;
        warn.textContent = 'This browser blocked storage, so the key could not be saved.';
        return;
      }
      clientCache = null;
      changingKey = false;
      renderKeyState();
      Folio.ui.toast(remember.checked ? 'API key saved on this device' : 'API key saved for this session', 'success');
      focusPrompt();
    };
    input.addEventListener('input', () => {
      const v = input.value.trim();
      save.disabled = !v;
      const looksOdd = v.length > 6 && !v.startsWith('sk-ant-');
      warn.hidden = !looksOdd;
      warn.textContent = looksOdd ? 'Anthropic keys usually start with “sk-ant-”. Double-check you copied the whole key.' : '';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSave();
      }
    });
    save.addEventListener('click', doSave);

    const link = h('a', { href: KEYS_URL, target: '_blank', rel: 'noopener noreferrer' }, 'console.anthropic.com → API keys');
    const readme = h('a', { href: 'README.md#use-with-claude-code-claude-subscription', target: '_blank', rel: 'noopener' }, 'Use with Claude Code');

    keyCard.replaceChildren(
      h(
        'div',
        { class: 'ai-key' },
        h('div', { class: 'ai-key__badge' }, icon('sparkle', 18)),
        h('div', { class: 'ai-key__title' }, hasKey ? 'Change your API key' : 'Connect Claude'),
        h(
          'p',
          {},
          'The AI designer is powered by Claude, made by Anthropic. To use it here you need an ',
          h('b', {}, 'Anthropic API key'),
          ' — a private code that lets Folio talk to Claude for you.'
        ),
        h(
          'ol',
          { class: 'ai-key__steps' },
          h('li', {}, 'Open ', link, ' and sign in (or sign up).'),
          h('li', {}, 'Click ', h('b', {}, 'Create Key'), ' and copy it.'),
          h('li', {}, 'Paste it below.')
        ),
        h('div', { class: 'ai-key__field' }, input, warn),
        h('label', { class: 'ai-key__remember' }, remember, h('span', {}, 'Remember on this device')),
        h('div', { class: 'ai-key__hint' }, 'If unticked, the key is forgotten when you close this tab.'),
        h('div', { class: 'ai-key__buttons' }, hasKey ? h('button', { class: 'f-btn', type: 'button', onClick: () => ((changingKey = false), renderKeyState()) }, 'Cancel') : null, save),
        h(
          'div',
          { class: 'ai-key__note' },
          h('div', {}, h('b', {}, 'Costs: '), 'usage is billed to your Anthropic account (pay as you go — a typical design request costs a few cents to a few dimes).'),
          h('div', {}, h('b', {}, 'Privacy: '), 'your key stays in this browser. Requests go directly from this page to Anthropic — never through a Folio server.')
        ),
        h('div', { class: 'ai-key__alt' }, 'Have a Claude Pro or Max subscription? You can skip the API key and let Claude Code design in Folio instead — see ', readme, ' in the README.')
      )
    );
    setTimeout(() => {
      if (currentTab() === 'ai') input.focus();
    }, 0);
  }

  // =====================================================================
  //  Settings popover
  // =====================================================================
  function togglePop(e) {
    if (e) e.stopPropagation();
    if (pop.hidden) openPop();
    else closePop();
  }
  function closePop() {
    if (pop) pop.hidden = true;
  }
  function openPop() {
    buildPop();
    pop.hidden = false;
  }

  function buildPop() {
    const select = h(
      'select',
      { class: 'f-select', 'aria-label': 'Model' },
      MODELS.map((m) => {
        const o = h('option', { value: m.id }, `${m.label} — ${m.hint}`);
        if (m.id === settings.model) o.selected = true;
        return o;
      })
    );
    const m = modelInfo(settings.model);
    const price = h('div', { class: 'ai-pop__hint' }, `$${m.price[0]} in · $${m.price[1]} out per million tokens`);
    select.addEventListener('change', () => {
      settings.model = select.value;
      saveSettings();
      renderHead();
      buildPop();
    });
    const seg = h(
      'div',
      { class: 'f-seg' },
      EFFORTS.map((ef) =>
        h(
          'button',
          {
            type: 'button',
            class: ef.id === settings.effort ? 'is-active' : '',
            onClick: () => {
              settings.effort = ef.id;
              saveSettings();
              renderHead();
              buildPop();
            },
          },
          ef.label
        )
      )
    );
    const hasKey = !!getKey();
    const keyRow = hasKey
      ? h(
          'div',
          { class: 'ai-pop__row' },
          h('span', { class: 'ai-pop__status' }, h('i', { class: 'ai-pop__ok' }), keyIsRemembered() ? 'Saved on this device' : 'Saved for this tab only'),
          h('button', { class: 'f-btn f-btn--ghost', type: 'button', onClick: () => (closePop(), (changingKey = true), renderKeyState()) }, 'Change'),
          h(
            'button',
            {
              class: 'f-btn f-btn--ghost f-btn--danger',
              type: 'button',
              disabled: chat.busy,
              onClick: () => {
                forgetKey();
                closePop();
                changingKey = false;
                renderKeyState();
                Folio.ui.toast('API key removed from this browser');
              },
            },
            'Forget'
          )
        )
      : h('div', { class: 'ai-pop__hint' }, 'No key saved yet.');

    pop.replaceChildren(
      h('div', { class: 'ai-pop__label' }, 'Model'),
      select,
      price,
      h('div', { class: 'ai-pop__label' }, 'Effort'),
      seg,
      h('div', { class: 'ai-pop__hint' }, 'Higher effort thinks longer: better results, more tokens.'),
      h('div', { class: 'ai-pop__label' }, 'API key'),
      keyRow,
      chat.costTotal > 0 ? h('div', { class: 'ai-pop__hint ai-pop__total' }, `This chat so far: ≈ ${fmtCost(chat.costTotal)}`) : null
    );
  }

  // =====================================================================
  //  Composer
  // =====================================================================
  function autoGrow() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px';
  }

  function onTextareaKey(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !e.altKey) {
      e.preventDefault();
      if (!chat.busy) send(textarea.value);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (chat.busy) stop();
      else textarea.blur();
    }
  }

  function onSendClick() {
    if (chat.busy) stop();
    else send(textarea.value);
  }

  function renderComposerState() {
    if (!composer) return;
    const busy = chat.busy;
    textarea.disabled = busy;
    attachBtn.disabled = busy;
    newChatBtn.disabled = busy || !getKey() || changingKey;
    panel.classList.toggle('is-busy', busy);
    sendBtn.replaceChildren(busy ? stopIcon() : icon('arrow-right', 15));
    sendBtn.classList.toggle('is-stop', busy);
    sendBtn.title = busy ? 'Stop (Esc)' : 'Send (Enter)';
    sendBtn.setAttribute('aria-label', busy ? 'Stop' : 'Send');
    panel.querySelectorAll('.ai-chip').forEach((c) => (c.disabled = busy));
    attachRow.querySelectorAll('.ai-thumb__x').forEach((c) => (c.disabled = busy));
    if (tabAi) tabAi.classList.toggle('is-busy', busy);
  }

  function stopIcon() {
    const t = document.createElement('template');
    t.innerHTML = '<svg class="f-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" stroke="none"/></svg>';
    return t.content.firstChild;
  }

  // context chip: what Claude will be editing
  let ctxRaf = 0;
  function scheduleContextChip() {
    if (!ctxRaf) ctxRaf = requestAnimationFrame(() => ((ctxRaf = 0), updateContextChip()));
  }
  function updateContextChip() {
    if (!ctxRow) return;
    const p = store.primary();
    const n = store.selection.length;
    if (p) {
      const name = p.name || p.type;
      ctxRow.replaceChildren(
        h(
          'div',
          { class: 'ai-ctxchip is-sel', title: 'Claude will focus on the selected layer' + (n > 1 ? 's' : '') },
          h('span', { class: 'ai-ctxchip__k' }, 'Editing:'),
          h('span', { class: 'ai-ctxchip__v' }, name),
          n > 1 ? h('span', { class: 'ai-ctxchip__n' }, `+${n - 1}`) : null,
          h('button', { class: 'ai-ctxchip__x', type: 'button', title: 'Clear selection (start a new design)', 'aria-label': 'Clear selection', onClick: () => store.select([]) }, icon('x', 11))
        )
      );
    } else {
      ctxRow.replaceChildren(h('div', { class: 'ai-ctxchip', title: 'Nothing selected — Claude will make a new artboard' }, icon('plus', 11), h('span', { class: 'ai-ctxchip__v' }, 'New design')));
    }
  }

  // ---------- image attachments ----------
  function onPaste(e) {
    const items = [...((e.clipboardData && e.clipboardData.items) || [])];
    const files = items.filter((it) => it.kind === 'file' && /^image\//.test(it.type)).map((it) => it.getAsFile()).filter(Boolean);
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  }

  async function addFiles(files) {
    files = files.filter((f) => f && /^image\//.test(f.type));
    if (!files.length) {
      Folio.ui.toast('Only images can be attached', 'error');
      return;
    }
    for (const f of files) {
      if (chat.attachments.length >= MAX_ATTACHMENTS) {
        Folio.ui.toast(`Up to ${MAX_ATTACHMENTS} images per message`, 'error');
        break;
      }
      try {
        chat.attachments.push(await prepareImage(f));
      } catch (e) {
        Folio.ui.toast(`Couldn't read “${f.name || 'image'}”`, 'error');
      }
      renderAttachments();
    }
    focusPrompt();
  }

  function loadImg(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image failed to load'));
      img.src = url;
    });
  }
  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  /** Resize to ≤ 1568 px on the long edge and turn into a base64 image block source. */
  async function prepareImage(file) {
    const objUrl = URL.createObjectURL(file);
    try {
      const img = await loadImg(objUrl);
      const w = img.naturalWidth || 1;
      const hh = img.naturalHeight || 1;
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(w, hh));
      const native = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type);
      let dataUrl = null;
      if (scale === 1 && native && file.size * 1.37 < MAX_IMAGE_B64) dataUrl = await readDataUrl(file);
      if (!dataUrl) {
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(hh * scale));
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        const ctx = c.getContext('2d');
        const asJpeg = file.type === 'image/jpeg';
        if (asJpeg) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cw, ch);
        }
        ctx.drawImage(img, 0, 0, cw, ch);
        dataUrl = asJpeg ? c.toDataURL('image/jpeg', 0.9) : c.toDataURL('image/png');
        if (dataUrl.length > MAX_IMAGE_B64) {
          ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cw, ch);
          dataUrl = c.toDataURL('image/jpeg', 0.85);
        }
      }
      const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
      if (!m) throw new Error('bad data url');
      return { media_type: m[1], data: m[2], url: dataUrl, name: file.name || 'image' };
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  }

  function renderAttachments() {
    attachRow.hidden = !chat.attachments.length;
    attachRow.replaceChildren(
      ...chat.attachments.map((a, i) =>
        h(
          'div',
          { class: 'ai-thumb', title: a.name },
          h('img', { src: a.url, alt: a.name }),
          h(
            'button',
            {
              class: 'ai-thumb__x',
              type: 'button',
              title: 'Remove',
              'aria-label': 'Remove image',
              onClick: () => {
                chat.attachments.splice(i, 1);
                renderAttachments();
              },
            },
            icon('x', 10)
          )
        )
      )
    );
  }

  // =====================================================================
  //  Transcript rendering
  // =====================================================================
  function isNearBottom() {
    return body.scrollHeight - body.scrollTop - body.clientHeight < 48;
  }
  function scrollToEnd(force) {
    if (!body) return;
    if (force || stick) body.scrollTop = body.scrollHeight;
  }
  let stick = true;

  function renderEmptyState() {
    if (chat.history.length || log.querySelector('.ai-msg, .ai-turn')) return;
    log.replaceChildren(
      h(
        'div',
        { class: 'ai-empty' },
        h('div', { class: 'ai-empty__badge' }, icon('sparkle', 20)),
        h('div', { class: 'ai-empty__title' }, 'Design with Claude'),
        h('div', { class: 'ai-empty__text' }, 'Describe what you want. Claude builds it on the canvas as real, editable layers — select something first to have it edited instead.'),
        h(
          'div',
          { class: 'ai-chips' },
          QUICK_PROMPTS.map((q) => h('button', { class: 'ai-chip', type: 'button', disabled: chat.busy, onClick: () => send(q) }, q))
        )
      )
    );
  }

  function clearEmptyState() {
    const e = log.querySelector('.ai-empty');
    if (e) e.remove();
  }

  function renderUserBubble(text, images) {
    clearEmptyState();
    const el = h(
      'div',
      { class: 'ai-msg ai-msg--user' },
      images.length ? h('div', { class: 'ai-msg__imgs' }, images.map((a) => h('img', { src: a.url, alt: a.name }))) : null,
      text ? h('div', { class: 'ai-msg__bubble' }, text) : null
    );
    log.appendChild(el);
    scrollToEnd(true);
  }

  // ---------- markdown-lite (safe DOM building, no innerHTML) ----------
  function inline(parent, text) {
    const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      const tok = m[0];
      if (tok[0] === '`') parent.appendChild(h('code', {}, tok.slice(1, -1)));
      else parent.appendChild(h('strong', {}, tok.slice(2, -2)));
      last = m.index + tok.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function renderMarkdown(el, src) {
    const frag = document.createDocumentFragment();
    let para = [];
    let list = null;
    let inCode = null;
    const flushPara = () => {
      if (!para.length) return;
      const p = h('p');
      para.forEach((line, i) => {
        if (i) p.appendChild(h('br'));
        inline(p, line);
      });
      frag.appendChild(p);
      para = [];
    };
    const flushList = () => {
      if (list) frag.appendChild(list);
      list = null;
    };
    String(src || '')
      .replace(/\r/g, '')
      .split('\n')
      .forEach((line) => {
        if (inCode) {
          if (/^\s*```/.test(line)) {
            frag.appendChild(h('pre', {}, inCode.join('\n')));
            inCode = null;
          } else inCode.push(line);
          return;
        }
        if (/^\s*```/.test(line)) {
          flushPara();
          flushList();
          inCode = [];
          return;
        }
        if (!line.trim()) {
          flushPara();
          flushList();
          return;
        }
        const li = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(line);
        if (li) {
          flushPara();
          const ordered = /\d/.test(li[1]);
          if (!list || (list.tagName === 'OL') !== ordered) {
            flushList();
            list = h(ordered ? 'ol' : 'ul');
          }
          const item = h('li');
          inline(item, li[2]);
          list.appendChild(item);
          return;
        }
        const hd = /^\s*#{1,6}\s+(.*)$/.exec(line);
        if (hd) {
          flushPara();
          flushList();
          const p = h('p', { class: 'ai-md-h' });
          inline(p, hd[1].replace(/\*\*/g, ''));
          frag.appendChild(p);
          return;
        }
        if (list) flushList();
        para.push(line);
      });
    if (inCode) frag.appendChild(h('pre', {}, inCode.join('\n')));
    flushPara();
    flushList();
    el.replaceChildren(frag);
  }

  // ---------- one assistant "turn" (a whole run, possibly many requests) ----------
  function createTurnView() {
    const el = h('div', { class: 'ai-turn' });
    clearEmptyState();
    log.appendChild(el);
    let blocks = {}; // stream index -> view piece (current request)
    let curText = null;
    let curThinking = null;
    const chips = {}; // tool_use id -> chip
    const dirty = new Set();
    let raf = 0;
    const pending = h('div', { class: 'ai-pending' }, h('i', { class: 'ai-spin' }), h('span', {}, 'Working…'));
    const showPending = () => {
      stick = isNearBottom();
      el.appendChild(pending); // (re)moves it to the end
      scrollToEnd();
    };
    const hidePending = () => pending.remove();

    const flush = () => {
      raf = 0;
      dirty.forEach((piece) => {
        if (piece.kind === 'text') renderMarkdown(piece.el, piece.text);
        else if (piece.kind === 'thinking') renderMarkdown(piece.bodyEl, piece.text);
      });
      dirty.clear();
      scrollToEnd();
    };
    const markDirty = (piece) => {
      dirty.add(piece);
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const add = (node) => {
      stick = isNearBottom();
      if (pending.parentNode) el.insertBefore(node, pending);
      else el.appendChild(node);
      scrollToEnd();
      return node;
    };

    function textPiece() {
      const piece = { kind: 'text', text: '', el: h('div', { class: 'ai-text' }) };
      add(piece.el);
      return piece;
    }

    function thinkingPiece() {
      const label = h('span', { class: 'ai-think__label' }, 'Thinking');
      const chevron = icon('chevron-right', 12);
      const head = h('button', { class: 'ai-think__head', type: 'button', 'aria-expanded': 'false' }, chevron, label, h('i', { class: 'ai-spin' }));
      const bodyEl = h('div', { class: 'ai-think__body', hidden: true });
      const wrap = h('div', { class: 'ai-think is-live' }, head, bodyEl);
      head.addEventListener('click', () => {
        if (!piece.text) return;
        bodyEl.hidden = !bodyEl.hidden;
        wrap.classList.toggle('is-open', !bodyEl.hidden);
        head.setAttribute('aria-expanded', String(!bodyEl.hidden));
      });
      const piece = { kind: 'thinking', text: '', el: wrap, bodyEl, label, started: Date.now(), done: false };
      add(wrap);
      return piece;
    }

    function finishThinking(piece) {
      if (!piece || piece.done) return;
      piece.done = true;
      const secs = Math.max(1, Math.round((Date.now() - piece.started) / 1000));
      piece.el.classList.remove('is-live');
      piece.label.textContent = `Thought for ${secs}s`;
      piece.el.classList.toggle('is-empty', !piece.text.trim());
      const spin = piece.el.querySelector('.ai-spin');
      if (spin) spin.remove();
    }

    function chipFor(block) {
      if (chips[block.id]) return chips[block.id];
      const status = h('span', { class: 'ai-tool__status' }, h('i', { class: 'ai-spin' }));
      const label = h('span', { class: 'ai-tool__label' }, (TOOL_LABELS[block.name] || block.name) + '…');
      const name = h('span', { class: 'ai-tool__name' }, block.name);
      const head = h('button', { class: 'ai-tool__head', type: 'button', 'aria-expanded': 'false' }, status, label, name);
      const details = h('div', { class: 'ai-tool__details', hidden: true });
      const wrap = h('div', { class: 'ai-tool is-pending' }, head, details);
      const chip = { el: wrap, block, state: 'pending', result: null };
      head.addEventListener('click', () => {
        details.hidden = !details.hidden;
        wrap.classList.toggle('is-open', !details.hidden);
        head.setAttribute('aria-expanded', String(!details.hidden));
        if (!details.hidden) buildToolDetails(details, chip);
      });
      chip.setState = (state, text) => {
        chip.state = state;
        wrap.classList.remove('is-pending', 'is-running', 'is-ok', 'is-error', 'is-cancelled');
        wrap.classList.add('is-' + state);
        if (state === 'ok') status.replaceChildren('✓');
        else if (state === 'error' || state === 'cancelled') status.replaceChildren('✕');
        else status.replaceChildren(h('i', { class: 'ai-spin' }));
        if (text != null) {
          label.textContent = text;
          head.title = text;
        }
        if (!details.hidden) buildToolDetails(details, chip);
      };
      chips[block.id] = chip;
      add(wrap);
      return chip;
    }

    return {
      el,
      beginRequest() {
        blocks = {};
        curText = null;
        curThinking = null;
        showPending();
      },
      showPending,
      startBlock(index, block) {
        if (!block) return;
        hidePending();
        if (block.type === 'text') {
          finishThinking(curThinking);
          curText = textPiece();
          blocks[index] = curText;
        } else if (block.type === 'thinking') {
          curThinking = thinkingPiece();
          blocks[index] = curThinking;
        } else if (block.type === 'tool_use') {
          finishThinking(curThinking);
          curText = null;
          blocks[index] = chipFor(block);
        } else if (block.type === 'fallback') {
          const from = block.from && block.from.model;
          const to = block.to && block.to.model;
          add(h('div', { class: 'ai-note ai-note--fallback' }, `${modelLabel(from)} declined this request, so ${modelLabel(to)} continued.`));
        }
      },
      stopBlock(index) {
        const piece = blocks[index];
        if (piece && piece.kind === 'thinking') finishThinking(piece);
      },
      appendText(delta) {
        if (!curText) curText = textPiece();
        stick = isNearBottom();
        curText.text += delta;
        markDirty(curText);
      },
      appendThinking(delta) {
        if (!curThinking) curThinking = thinkingPiece();
        curThinking.text += delta;
        markDirty(curThinking);
      },
      chipFor,
      note(text, kind) {
        hidePending();
        return add(h('div', { class: 'ai-note' + (kind ? ' ai-note--' + kind : '') }, text));
      },
      error(title, message, actions) {
        hidePending();
        return add(
          h(
            'div',
            { class: 'ai-err', role: 'alert' },
            h('div', { class: 'ai-err__title' }, title),
            message ? h('div', { class: 'ai-err__msg' }, message) : null,
            actions && actions.length ? h('div', { class: 'ai-err__actions' }, actions) : null
          )
        );
      },
      cost(usage) {
        if (!usage.requests) return;
        const parts = [`≈ ${fmtCost(usage.cost)}`, `${fmtTok(usage.input + usage.cacheRead + usage.cacheWrite)} in`, `${fmtTok(usage.output)} out`];
        const title =
          `Estimated from token usage (${usage.requests} request${usage.requests === 1 ? '' : 's'}):\n` +
          `• input ${usage.input.toLocaleString()}\n• cache write ${usage.cacheWrite.toLocaleString()}\n• cache read ${usage.cacheRead.toLocaleString()}\n• output ${usage.output.toLocaleString()}` +
          (usage.partial ? '\nA stopped or failed request is not included.' : '');
        add(h('div', { class: 'ai-cost', title }, parts.join(' · ')));
      },
      /** End of run: stop spinners, cancel chips that never ran, drop empty text. */
      finalize() {
        hidePending();
        if (raf) {
          cancelAnimationFrame(raf);
          flush();
        }
        Object.values(blocks).forEach((p) => p && p.kind === 'thinking' && finishThinking(p));
        if (curThinking) finishThinking(curThinking);
        Object.values(chips).forEach((c) => {
          if (c.state === 'pending' || c.state === 'running') c.setState('cancelled', `${TOOL_LABELS[c.block.name] || c.block.name} — cancelled`);
        });
        el.querySelectorAll('.ai-text').forEach((t) => {
          if (!t.textContent.trim()) t.remove();
        });
      },
    };
  }

  function truncate(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n) + `… (${(s.length - n).toLocaleString()} more characters)` : s;
  }
  function safeJson(v) {
    try {
      return JSON.stringify(
        v,
        (k, val) => (typeof val === 'string' && val.length > 300 && (k === 'data' || /^data:/.test(val)) ? val.slice(0, 40) + `…[${val.length} chars]` : val),
        2
      );
    } catch (e) {
      return String(v);
    }
  }

  function buildToolDetails(details, chip) {
    const parts = [h('div', { class: 'ai-tool__k' }, 'Input'), h('pre', {}, truncate(safeJson(chip.block.input), 2400))];
    const r = chip.result;
    if (r) {
      parts.push(h('div', { class: 'ai-tool__k' }, r.isError ? 'Error' : 'Result'));
      const content = r.content;
      if (Array.isArray(content)) {
        content.forEach((b) => {
          if (b && b.type === 'image' && b.source && b.source.data) {
            parts.push(h('img', { class: 'ai-tool__img', src: `data:${b.source.media_type || 'image/png'};base64,${b.source.data}`, alt: 'Screenshot' }));
          } else if (b && b.type === 'text') parts.push(h('pre', {}, truncate(b.text, 2400)));
          else parts.push(h('pre', {}, truncate(safeJson(b), 1200)));
        });
      } else parts.push(h('pre', {}, truncate(typeof content === 'string' ? content : safeJson(content), 2400)));
      const ids = (r.changedIds || []).filter((id) => store.get(id));
      if (ids.length) {
        parts.push(
          h(
            'button',
            {
              class: 'f-btn f-btn--ghost ai-tool__select',
              type: 'button',
              onClick: () => {
                store.select(ids);
                if (Folio.canvas && Folio.canvas.zoomToSelection) {
                  try {
                    Folio.canvas.zoomToSelection();
                  } catch (e) {}
                }
              },
            },
            `Select ${ids.length} changed layer${ids.length === 1 ? '' : 's'}`
          )
        );
      }
    } else if (chip.state === 'pending' || chip.state === 'running') {
      parts.push(h('div', { class: 'ai-tool__k' }, 'Running…'));
    }
    details.replaceChildren(...parts);
  }

  function fmtTok(n) {
    n = n || 0;
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k';
    return (n / 1e6).toFixed(2) + 'M';
  }
  function fmtCost(c) {
    if (!c) return '$0.00';
    if (c < 0.01) return '$' + c.toFixed(4);
    if (c < 1) return '$' + c.toFixed(3);
    return '$' + c.toFixed(2);
  }

  // =====================================================================
  //  The agent loop
  // =====================================================================
  function toolsReady() {
    return !!(Folio.aiPrompt && Folio.aiTools && typeof Folio.aiTools.execute === 'function' && Array.isArray(Folio.aiPrompt.tools));
  }

  function contextText() {
    try {
      return (Folio.aiPrompt && typeof Folio.aiPrompt.contextFor === 'function' && Folio.aiPrompt.contextFor()) || '';
    } catch (e) {
      console.error('[Folio AI] contextFor() failed', e);
      return '';
    }
  }

  /** Add user content at the end of the history. A trailing user turn that Claude
   *  never answered (error / stop / refusal) is extended rather than duplicated. */
  function appendUserContent(blocks) {
    const last = chat.history[chat.history.length - 1];
    if (last && last.role === 'user') last.content = [...last.content, ...blocks];
    else chat.history.push({ role: 'user', content: blocks });
  }

  function send(text) {
    text = String(text || '').trim();
    if (chat.busy) return;
    if (!text && !chat.attachments.length) return;
    if (!getKey()) {
      changingKey = false;
      renderKeyState();
      return;
    }
    if (!toolsReady()) {
      const view = createTurnView();
      view.error('The AI tools did not load', 'Folio could not find src/ai-prompt.js / src/ai-tools.js. Reload the page; if it keeps happening, check the browser console.');
      return;
    }
    const images = chat.attachments.slice();
    const userText = text || 'Use the attached image(s) as reference.';
    const content = [{ type: 'text', text: contextText() + '\n\n' + userText }];
    images.forEach((a) => content.push({ type: 'image', source: { type: 'base64', media_type: a.media_type, data: a.data } }));
    appendUserContent(content);
    renderUserBubble(text, images);

    chat.attachments = [];
    renderAttachments();
    textarea.value = '';
    autoGrow();
    chat.lastPrompt = userText;
    startRun(userText);
  }

  function buildParams() {
    const m = modelInfo(settings.model) || MODELS[0];
    const params = {
      model: m.id,
      max_tokens: MAX_TOKENS,
      system: Folio.aiPrompt.system,
      tools: Folio.aiPrompt.tools,
      messages: chat.history.slice(),
      output_config: { effort: settings.effort },
      thinking: { type: 'adaptive', display: 'summarized' },
      cache_control: { type: 'ephemeral' },
    };
    if (m.fallbacks) {
      params.betas = [FALLBACK_BETA];
      params.fallbacks = 'default';
    }
    return params;
  }

  function setBusy(b) {
    chat.busy = b;
    store.aiBusy = b;
    store.emit('ai:busy', b);
    renderComposerState();
  }

  function stop() {
    const run = chat.run;
    if (!run || run.stopped) return;
    run.stopped = true;
    if (run.stream) {
      try {
        run.stream.abort();
      } catch (e) {}
    }
  }

  function startRun(prompt) {
    // older Retry / Continue buttons no longer apply
    log.querySelectorAll('.ai-err__actions .is-retry').forEach((b) => (b.disabled = true));
    const run = {
      prompt,
      stopped: false,
      stream: null,
      Anthropic: null,
      view: createTurnView(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, requests: 0, partial: false },
      committed: false,
    };
    chat.run = run;
    setBusy(true);
    runLoop(run);
    return run;
  }

  /** Content to store as the assistant turn. Unchanged, except after a mid-output
   *  fallback: the API docs require omitting thinking / tool_use blocks that come
   *  before the final `fallback` block (the declined attempt's partial output). */
  function historyContent(content) {
    let lastFallback = -1;
    content.forEach((b, i) => {
      if (b && b.type === 'fallback') lastFallback = i;
    });
    if (lastFallback <= 0) return content;
    const drop = { thinking: 1, redacted_thinking: 1, tool_use: 1, server_tool_use: 1 };
    return content.filter((b, i) => i >= lastFallback || !drop[b.type]);
  }

  function addUsage(run, message) {
    const u = message.usage || {};
    const m = modelInfo(message.model) || modelInfo(settings.model) || MODELS[0];
    const input = u.input_tokens || 0;
    const output = u.output_tokens || 0;
    const cacheRead = u.cache_read_input_tokens || 0;
    const cacheWrite = u.cache_creation_input_tokens || 0;
    const [pi, po, pr] = m.price;
    const cost = (input * pi + output * po + cacheRead * pr + cacheWrite * pi * 1.25) / 1e6;
    Object.assign(run.usage, {
      input: run.usage.input + input,
      output: run.usage.output + output,
      cacheRead: run.usage.cacheRead + cacheRead,
      cacheWrite: run.usage.cacheWrite + cacheWrite,
      cost: run.usage.cost + cost,
      requests: run.usage.requests + 1,
    });
    chat.costTotal += cost;
  }

  function requestOnce(client, run) {
    const view = run.view;
    view.beginRequest();
    const stream = client.beta.messages.stream(buildParams());
    run.stream = stream;
    stream.on('streamEvent', (event) => {
      if (event.type === 'content_block_start') view.startBlock(event.index, event.content_block);
      else if (event.type === 'content_block_stop') view.stopBlock(event.index);
    });
    stream.on('text', (delta) => view.appendText(delta));
    stream.on('thinking', (delta) => view.appendThinking(delta));
    return stream.finalMessage();
  }

  function normalizeToolContent(content) {
    if (typeof content === 'string') return content || '(no output)';
    if (Array.isArray(content)) return content.length ? content : '(no output)';
    if (content == null) return '(no output)';
    return safeJson(content);
  }

  async function runTools(run, blocks) {
    const results = [];
    for (const b of blocks) {
      const chip = run.view.chipFor(b);
      chip.block = b; // the final block, with its fully parsed input
      if (run.stopped) {
        results.push({ type: 'tool_result', tool_use_id: b.id, content: 'Not run: the user pressed Stop.', is_error: true });
        chip.setState('cancelled', `${TOOL_LABELS[b.name] || b.name} — stopped`);
        continue;
      }
      chip.setState('running');
      let r;
      try {
        r = (await Folio.aiTools.execute(b.name, b.input)) || {};
      } catch (e) {
        console.error('[Folio AI] tool crashed', b.name, e);
        r = { content: `The ${b.name} tool crashed: ${e && e.message}`, isError: true, summary: 'Tool crashed' };
      }
      const tr = { type: 'tool_result', tool_use_id: b.id, content: normalizeToolContent(r.content) };
      if (r.isError) tr.is_error = true;
      results.push(tr);
      chip.result = r;
      chip.setState(r.isError ? 'error' : 'ok', r.summary || (r.isError ? 'Failed' : TOOL_LABELS[b.name] || b.name));
    }
    return results;
  }

  function toolUseBlocks(content) {
    let start = 0;
    content.forEach((b, i) => {
      if (b && b.type === 'fallback') start = i + 1;
    });
    return content.slice(start).filter((b) => b && b.type === 'tool_use');
  }

  async function runLoop(run) {
    const view = run.view;
    view.showPending();
    try {
      const Anthropic = await loadSdk();
      run.Anthropic = Anthropic;
      if (run.stopped) throw new Anthropic.APIUserAbortError();
      const client = clientFor(Anthropic, getKey());

      let finished = false;
      for (let i = 0; i < MAX_ITERATIONS && !finished; i++) {
        if (run.stopped) throw new Anthropic.APIUserAbortError();
        const message = await requestOnce(client, run);
        run.stream = null;
        addUsage(run, message);
        const reason = message.stop_reason;

        if (reason === 'refusal') {
          // Discard the declined (possibly partial) output; it is not added to the history.
          const d = message.stop_details || {};
          view.error(
            'Claude declined this request',
            d.explanation || 'The request was flagged by a safety system. Try rephrasing it, or start a new chat.',
            [h('button', { class: 'f-btn', type: 'button', onClick: newChat }, 'New chat')]
          );
          finished = true;
          break;
        }

        chat.history.push({ role: 'assistant', content: historyContent(message.content) });

        if (reason === 'end_turn') {
          finished = true;
        } else if (reason === 'pause_turn') {
          continue; // re-send so Claude can continue its turn
        } else if (reason === 'tool_use') {
          const blocks = toolUseBlocks(message.content);
          const results = await runTools(run, blocks);
          if (results.length) chat.history.push({ role: 'user', content: results });
          if (run.stopped) throw new Anthropic.APIUserAbortError();
          if (!results.length) finished = true;
        } else if (reason === 'max_tokens') {
          // Never run truncated tool input: answer each call with an error so the history stays valid.
          const blocks = toolUseBlocks(message.content);
          blocks.forEach((b) => run.view.chipFor(b).setState('error', 'Not run — the response was cut off'));
          if (blocks.length) {
            chat.history.push({
              role: 'user',
              content: blocks.map((b) => ({
                type: 'tool_result',
                tool_use_id: b.id,
                content: 'Not run: your response hit the max_tokens limit, so this tool input was cut off. Use smaller tool calls.',
                is_error: true,
              })),
            });
          }
          view.error(
            'The response was cut off',
            'Claude hit the maximum response length before finishing.' + (blocks.length ? ' Its last step was not run.' : ''),
            blocks.length ? [retryButton('Continue')] : []
          );
          finished = true;
        } else {
          view.note(`Claude stopped (${reason || 'unknown reason'}).`);
          finished = true;
        }
      }
      if (!finished) {
        view.error('Paused after 40 steps', 'Claude used the maximum number of steps for one message. Continue to let it keep going.', [retryButton('Continue')]);
      }
    } catch (err) {
      handleError(run, err);
    } finally {
      finishRun(run);
    }
  }

  function retryButton(label = 'Retry') {
    return h(
      'button',
      {
        class: 'f-btn is-retry',
        type: 'button',
        onClick: (e) => {
          if (chat.busy) return;
          e.currentTarget.disabled = true;
          const last = chat.history[chat.history.length - 1];
          if (!last || last.role !== 'user') return;
          startRun(chat.lastPrompt || 'retry');
        },
      },
      label
    );
  }

  function apiMessage(err) {
    const inner = err && err.error && err.error.error && err.error.error.message;
    return inner || (err && err.message) || String(err);
  }

  function handleError(run, err) {
    const view = run.view;
    const A = run.Anthropic;
    run.usage.partial = true;
    if (run.stopped || (A && err instanceof A.APIUserAbortError)) {
      view.note('Stopped.', 'stopped');
      return;
    }
    console.error('[Folio AI]', err);
    if (!A || (err && err.sdkLoadFailed)) {
      view.error("Couldn't load the Claude SDK", 'Folio loads Anthropic’s official SDK from a CDN (jsDelivr, with esm.sh as backup). Check your internet connection or ad/content blockers.', [retryButton()]);
    } else if (err instanceof A.AuthenticationError) {
      view.error('Your API key was rejected', 'Anthropic did not accept this key. Check that you copied all of it and that it is still active in the Anthropic Console.', [
        h('button', { class: 'f-btn f-btn--primary', type: 'button', onClick: () => ((changingKey = true), renderKeyState()) }, 'Change key'),
        retryButton(),
      ]);
    } else if (err instanceof A.RateLimitError) {
      view.error('Rate limit reached', 'Anthropic is limiting requests for your account right now. Wait a few seconds and retry. ' + apiMessage(err), [retryButton()]);
    } else if (err instanceof A.BadRequestError) {
      view.error('The request was rejected', apiMessage(err), [retryButton()]);
    } else if (err instanceof A.APIConnectionError) {
      view.error("Couldn't reach Anthropic", 'Check your internet connection and try again.', [retryButton()]);
    } else if (err instanceof A.APIError) {
      view.error(`Anthropic API error${err.status ? ' (' + err.status + ')' : ''}`, apiMessage(err), [retryButton()]);
    } else {
      view.error('Something went wrong', (err && err.message) || String(err), [retryButton()]);
    }
  }

  function finishRun(run) {
    run.stream = null;
    run.view.finalize();
    run.view.cost(run.usage);
    if (!run.committed) {
      run.committed = true;
      try {
        store.commit('AI: ' + String(run.prompt || '').slice(0, 40));
      } catch (e) {
        console.error('[Folio AI] commit failed', e);
      }
    }
    if (chat.run === run) chat.run = null;
    setBusy(false);
    if (pop && !pop.hidden) buildPop();
    const ae = document.activeElement;
    if (currentTab() === 'ai' && !(ae && ae.closest && ae.closest('#ai-panel .ai-pop, #ai-panel .ai-key'))) focusPrompt();
  }

  function newChat() {
    if (chat.busy) return;
    chat.history = [];
    chat.costTotal = 0;
    chat.attachments = [];
    chat.lastPrompt = '';
    renderAttachments();
    log.replaceChildren();
    renderEmptyState();
    closePop();
    focusPrompt();
  }

  // =====================================================================
  //  Keyboard: ⌘/Ctrl+K, Esc for the popover
  // =====================================================================
  function onKeyDown(e) {
    if (e.key === 'Escape' && pop && !pop.hidden) {
      e.preventDefault();
      e.stopPropagation();
      closePop();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.shiftKey || e.altKey) return;
    if (!(e.code === 'KeyK' || (e.key && e.key.toLowerCase() === 'k'))) return;
    const a = document.activeElement;
    if (Folio.ui.isTyping() && a !== textarea && !(a && a.classList && a.classList.contains('ai-key__input'))) return;
    if (store.editingTextId) return;
    e.preventDefault();
    open();
  }

  function focusPrompt() {
    if (!textarea || composer.hidden || textarea.disabled) return;
    textarea.focus({ preventScroll: true });
  }

  // =====================================================================
  //  Public API
  // =====================================================================
  function open() {
    if (!panel) return;
    setTab('ai');
    if (!getKey() || changingKey) {
      const k = keyCard.querySelector('.ai-key__input');
      if (k) k.focus();
    } else focusPrompt();
  }

  function close() {
    if (!panel) return;
    setTab('design');
  }

  function init() {
    panel = document.getElementById('ai-panel');
    tabsEl = document.getElementById('right-tabs');
    inspectorEl = document.getElementById('inspector');
    rightPanel = document.getElementById('right-panel');
    if (!panel || !tabsEl) return;
    store.aiBusy = false;
    buildTabs();
    buildPanel();
    updateContextChip();
    ['selection', 'change', 'doc'].forEach((evt) => store.on(evt, scheduleContextChip));
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', (e) => {
      if (pop && !pop.hidden && !pop.contains(e.target) && !headModelBtn.contains(e.target) && !settingsBtn.contains(e.target)) closePop();
    });
    body.addEventListener('scroll', () => (stick = isNearBottom()), { passive: true });
    const saved = storageGet('localStorage', TAB_STORAGE);
    setTab(saved === 'ai' ? 'ai' : 'design', { remember: false });
  }

  Folio.ai = {
    init,
    open,
    close,
    send: (text) => send(text),
    stop,
    newChat,
    isBusy: () => chat.busy,
    /** Read-only copy of the conversation (for debugging). */
    history: () => JSON.parse(JSON.stringify(chat.history)),
    models: MODELS.map((m) => ({ ...m })),
  };
})();
