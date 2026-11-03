/*
 * brand-panel.js — the "Brand" tab in the left panel.
 *
 *   Folio.brandPanel.init()      build the Layers / Brand / Components tabs and the brand kit panel (#brand-panel)
 *   Folio.brandPanel.show(tab)   'layers' | 'brand' | 'components' (#components-panel is components-panel.js)
 *   Folio.brandPanel.refresh()
 *
 * Everything here edits the document's ACTIVE brand through Folio.brand.update(...) (live), and
 * records one undo step with Folio.store.commit('Brand: …') when an edit finishes (change / blur /
 * click) — never on every keystroke.
 */
window.Folio = window.Folio || {};

(function () {
  const { h } = Folio.ui;
  const store = Folio.store;
  const B = () => Folio.brand;
  const icon = (name, size = 14) => Folio.icons.el(name, size);
  const toast = (m, k) => Folio.ui.toast(m, k);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  const TAB_KEY = 'folio:leftTab';
  const COLLAPSE_KEY = 'folio:brandPanel:collapsed';

  let leftPanel, tabsEl, layersEl, panel, tabLayers, tabBrand, tabComps, fileInput, logoInput;
  let dirty = true;
  let quiet = 0; // > 0 while the panel itself makes live edits (no full re-render)
  let raf = 0;

  // ---------- small helpers ----------
  function lsGet(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : v;
    } catch (e) {
      return d;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  }
  let collapsed = {};
  try {
    collapsed = JSON.parse(lsGet(COLLAPSE_KEY, '{}')) || {};
  } catch (e) {
    collapsed = {};
  }

  const commit = (label) => store.commit('Brand: ' + label);
  const activeBrand = () => (B() ? B().active() : null);
  function live(fn) {
    quiet++;
    try {
      return fn();
    } finally {
      quiet--;
    }
  }
  function debounce(fn, ms) {
    let t = 0;
    const d = (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
    d.flush = (...a) => {
      clearTimeout(t);
      fn(...a);
    };
    return d;
  }
  const hexOf = (v) => {
    const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(v || ''));
    return m ? '#' + m[1].toLowerCase() : '#000000';
  };
  const alphaOf = (v) => {
    const m = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(String(v || ''));
    return m ? m[1] : '';
  };
  const fontStack = (family) => (Folio.fonts ? Folio.fonts.stack(family) : family);
  function ensureFont(family) {
    if (Folio.fonts && Folio.fonts.ensure) Folio.fonts.ensure(family);
  }
  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const safeName = (s) => String(s || 'brand').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'brand';

  /** Replace `el`'s content with an input; Enter/blur commits, Esc cancels. */
  function inlineEdit(el, value, onDone) {
    const input = h('input', { class: 'f-input bp-inline', value: value || '', spellcheck: 'false' });
    const prev = Array.from(el.childNodes);
    el.replaceChildren(input);
    el.classList.add('is-editing');
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      el.classList.remove('is-editing');
      el.replaceChildren(...prev);
      if (ok && v && v !== value) onDone(v);
      else if (dirty) schedule();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  // ---------- popover menu (same look as .f-menu) ----------
  let pop = null;
  function closePop() {
    if (!pop) return;
    pop.el.remove();
    if (pop.anchor) pop.anchor.classList.remove('is-open');
    pop = null;
  }
  /** items: [{label, icon, action, checked, dots:[colours], hint, danger, disabled} | {sep} | {header}] */
  function openPop(anchor, items, { align = 'left', width } = {}) {
    const same = pop && pop.anchor === anchor;
    closePop();
    if (same) return;
    if (Folio.menu && Folio.menu.close) Folio.menu.close();
    const el = h('div', { class: 'f-menu bp-menu', role: 'menu', style: width ? { minWidth: width + 'px' } : null });
    items.filter(Boolean).forEach((it) => {
      if (it.sep) return el.appendChild(h('div', { class: 'f-menu__sep' }));
      if (it.header) return el.appendChild(h('div', { class: 'f-menu__head' }, it.header));
      const btn = h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          class: 'f-menu__item' + (it.danger ? ' bp-menu__danger' : ''),
          disabled: !!it.disabled,
        },
        it.dots
          ? h('span', { class: 'bp-dots' }, it.dots.map((c) => h('i', { style: { background: c } })))
          : h('span', { class: 'f-menu__ico' }, it.icon ? icon(it.icon, 14) : null),
        h('span', { class: 'f-menu__label' }, it.label),
        it.checked ? h('span', { class: 'bp-menu__check', 'aria-label': 'active' }, '✓') : it.hint ? h('span', { class: 'f-menu__kbd' }, it.hint) : null
      );
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closePop();
        if (it.action) it.action();
      });
      el.appendChild(btn);
    });
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    let x = align === 'right' ? r.right - mw : r.left;
    let y = r.bottom + 4;
    x = Math.max(4, Math.min(window.innerWidth - mw - 4, x));
    if (y + mh > window.innerHeight - 4) y = Math.max(4, window.innerHeight - mh - 4);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    anchor.classList.add('is-open');
    pop = { el, anchor };
  }
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (pop && !pop.el.contains(e.target) && !pop.anchor.contains(e.target)) closePop();
    },
    true
  );
  window.addEventListener(
    'keydown',
    (e) => {
      if (!pop) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closePop();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const items = [...pop.el.querySelectorAll('.f-menu__item:not([disabled])')];
        const i = items.indexOf(document.activeElement);
        const n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        if (items[n]) items[n].focus();
      }
    },
    true
  );
  window.addEventListener('resize', closePop);
  window.addEventListener('blur', closePop);

  // =====================================================================
  //  Tabs
  // =====================================================================
  function buildTabs() {
    tabsEl.replaceChildren();
    tabsEl.setAttribute('role', 'tablist');
    tabLayers = h('button', { type: 'button', class: 'bp-tab', role: 'tab', onClick: () => show('layers') }, icon('layers', 13), 'Layers');
    tabBrand = h('button', { type: 'button', class: 'bp-tab', role: 'tab', title: 'Brand kit: colours, fonts, logos, voice', onClick: () => show('brand') }, icon('drop', 13), 'Brand');
    tabComps = h('button', { type: 'button', class: 'bp-tab', role: 'tab', title: 'Components: reusable pieces you can drop into any design', onClick: () => show('components') }, icon('grid', 13), 'Components');
    tabsEl.append(tabLayers, tabBrand, tabComps);
  }

  function current() {
    const comps = document.getElementById('components-panel');
    return comps && !comps.hidden ? 'components' : panel && !panel.hidden ? 'brand' : 'layers';
  }

  function show(tab, { remember = true } = {}) {
    if (tab !== 'brand' && tab !== 'components') tab = 'layers';
    const brand = tab === 'brand';
    const comps = document.getElementById('components-panel');
    if (layersEl) layersEl.hidden = tab !== 'layers';
    if (panel) panel.hidden = !brand;
    if (comps) comps.hidden = tab !== 'components';
    if (leftPanel) leftPanel.classList.toggle('is-brand', brand);
    [[tabLayers, 'layers'], [tabBrand, 'brand'], [tabComps, 'components']].forEach(([t, name]) => {
      t.classList.toggle('is-active', tab === name);
      t.setAttribute('aria-selected', String(tab === name));
    });
    if (remember) lsSet(TAB_KEY, tab);
    if (leftPanel) leftPanel.scrollTop = 0;
    if (brand && dirty) render();
    if (tab === 'layers' && Folio.layers && Folio.layers.refresh) Folio.layers.refresh();
    if (tab === 'components' && Folio.componentsPanel && Folio.componentsPanel.refresh) Folio.componentsPanel.refresh();
  }

  // =====================================================================
  //  Rendering
  // =====================================================================
  function schedule() {
    dirty = true;
    if (!panel || panel.hidden || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  }

  /** True when the person is typing in one of the panel's fields (don't rebuild under them). */
  function typingInPanel() {
    const a = document.activeElement;
    return !!(a && panel.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'));
  }

  function render() {
    if (!panel) return;
    if (typingInPanel()) {
      dirty = true;
      return;
    }
    dirty = false;
    const b = activeBrand();
    const kids = [head(b)];
    if (!b) kids.push(emptyState());
    else kids.push(colorsSection(b), fontsSection(b), logosSection(b), voiceSection(b), styleSection(b));
    panel.replaceChildren(...kids);
  }

  function section(key, title, b, body, actions = []) {
    const isCollapsed = !!collapsed[key];
    const sec = h('section', { class: 'f-section bp-sec' + (isCollapsed ? ' is-collapsed' : ''), dataset: { sec: key } });
    const toggle = h(
      'button',
      {
        type: 'button',
        class: 'bp-sec__toggle',
        'aria-expanded': String(!isCollapsed),
        onClick: () => {
          collapsed[key] = !collapsed[key];
          lsSet(COLLAPSE_KEY, JSON.stringify(collapsed));
          sec.classList.toggle('is-collapsed', !!collapsed[key]);
          toggle.setAttribute('aria-expanded', String(!collapsed[key]));
        },
      },
      icon('chevron-down', 12),
      h('span', {}, title)
    );
    sec.append(h('div', { class: 'f-section__head bp-sec__head' }, toggle, h('span', { class: 'bp-sec__actions' }, actions)), h('div', { class: 'bp-sec__body' }, body));
    return sec;
  }

  const iconBtn = (name, title, onClick, extra = '') =>
    h('button', { type: 'button', class: 'f-btn f-btn--ghost f-btn--icon bp-ibtn ' + extra, title, 'aria-label': title, onClick }, icon(name, 14));

  // ---------- header: brand switcher + actions ----------
  function dotsOf(b) {
    const v = (id) => ((b.colors || []).find((c) => c.id === id) || {}).value;
    return ['primary', 'secondary', 'accent', 'background'].map(v).filter(Boolean);
  }

  function head(b) {
    const name = h('span', { class: 'bp-switch__name' }, b ? b.name : 'No brand');
    const sw = h(
      'button',
      { type: 'button', class: 'bp-switch', title: 'Switch brand', onClick: (e) => switcherMenu(e.currentTarget) },
      b ? h('span', { class: 'bp-dots' }, dotsOf(b).map((c) => h('i', { style: { background: c } }))) : h('span', { class: 'bp-dots is-empty' }, h('i'), h('i'), h('i')),
      name,
      icon('chevron-down', 12)
    );
    sw.addEventListener('dblclick', () => b && renameBrand(name));
    const more = iconBtn('more', 'Brand actions', (e) => actionsMenu(e.currentTarget, name));
    return h('div', { class: 'bp-head' }, sw, more);
  }

  function switcherMenu(anchor) {
    const lib = B().library();
    const a = activeBrand();
    const items = [{ header: lib.length ? 'Brands in this browser' : 'No brands yet' }];
    lib.forEach((b) =>
      items.push({ label: b.name, dots: dotsOf(b), checked: a && a.id === b.id, action: () => useBrand(b.id) })
    );
    items.push({ label: 'None', icon: 'x', checked: !a, action: () => useBrand(null) });
    items.push({ sep: true }, { label: 'New brand…', icon: 'plus', action: () => newMenu(anchor) });
    openPop(anchor, items, { width: 214 });
  }

  function newMenu(anchor) {
    requestAnimationFrame(() =>
      openPop(
        anchor,
        [
          { label: 'Blank brand', icon: 'plus', action: () => newBrand(null) },
          { header: 'From a template' },
          ...B().templates().map((t) => ({ label: t.name, dots: dotsOf(t), action: () => newBrand(t.templateId) })),
          { sep: true },
          { label: 'Import .json…', icon: 'upload', action: importBrand },
        ],
        { width: 214 }
      )
    );
  }

  function actionsMenu(anchor, nameEl) {
    const a = activeBrand();
    openPop(
      anchor,
      [
        { label: 'New blank brand', icon: 'plus', action: () => newBrand(null) },
        { label: 'New from template…', icon: 'grid', action: () => newMenu(anchor) },
        { sep: true },
        { label: 'Duplicate', icon: 'copy', disabled: !a, action: () => duplicateBrand() },
        { label: 'Rename', icon: 'text', disabled: !a, action: () => renameBrand(nameEl) },
        { label: 'Export .json', icon: 'download', disabled: !a, action: exportBrand },
        { label: 'Import .json…', icon: 'upload', action: importBrand },
        { sep: true },
        { label: 'Delete brand…', icon: 'trash', danger: true, disabled: !a, action: deleteBrand },
      ],
      { align: 'right', width: 200 }
    );
  }

  // ---------- brand-level actions ----------
  function useBrand(id) {
    const a = activeBrand();
    if ((a ? a.id : null) === id) return;
    if (id == null) {
      B().setActive(null);
      commit('remove brand from document');
      toast('This document no longer uses a brand (layers keep their current look).');
      return;
    }
    const b = B().setActive(id);
    if (!b) return;
    commit('switch to ' + b.name);
    toast('Switched to ' + b.name, 'success');
  }

  function newBrand(templateId) {
    const b = B().create(templateId || undefined);
    B().setActive(b.id);
    commit(templateId ? 'new ' + b.name : 'new brand');
    toast(templateId ? `Created “${b.name}” — click a colour to apply it to the selection` : 'New brand created — set its colours and fonts below', 'success');
    if (!templateId) requestAnimationFrame(() => {
      const n = panel.querySelector('.bp-switch__name');
      if (n) renameBrand(n);
    });
  }

  function duplicateBrand() {
    const a = activeBrand();
    if (!a) return;
    const c = B().duplicate(a.id);
    if (!c) return;
    B().setActive(c.id);
    commit('duplicate ' + a.name);
    toast(`Duplicated as “${c.name}”`, 'success');
  }

  function renameBrand(nameEl) {
    const a = activeBrand();
    if (!a || !nameEl) return;
    inlineEdit(nameEl, a.name, (v) => {
      B().update(a.id, { name: v });
      commit('rename brand');
    });
  }

  function exportBrand() {
    const a = activeBrand();
    if (!a) return;
    const json = B().exportJson(a.id);
    if (!json) return;
    download(safeName(a.name) + '.brand.json', json);
    toast(`Exported ${safeName(a.name)}.brand.json`, 'success');
  }

  function importBrand() {
    if (!fileInput) {
      fileInput = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
      fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!f) return;
        const r = new FileReader();
        r.onload = () => importText(String(r.result));
        r.onerror = () => toast('Could not read that file.', 'error');
        r.readAsText(f);
      });
      document.body.appendChild(fileInput);
    }
    fileInput.click();
  }

  function importText(text) {
    let list;
    try {
      list = B().importJson(text);
    } catch (e) {
      toast(e.message || 'That file is not a brand kit.', 'error');
      return null;
    }
    if (!activeBrand() && list[0]) {
      B().setActive(list[0].id);
      commit('import ' + list[0].name);
      toast(`Imported “${list[0].name}”`, 'success');
    } else {
      toast(list.length === 1 ? `Imported “${list[0].name}” — pick it from the brand menu` : `Imported ${list.length} brands`, 'success');
    }
    schedule();
    return list;
  }

  function deleteBrand() {
    const a = activeBrand();
    if (!a) return;
    const ok = window.confirm(`Delete the brand “${a.name}” from this browser?\n\nLayers that use it keep their current colours and fonts. You can undo this.`);
    if (!ok) return;
    B().remove(a.id);
    commit('delete ' + a.name);
    toast(`Deleted “${a.name}”`);
  }

  // ---------- empty state ----------
  function templateCard(t, onClick) {
    const cols = ['primary', 'secondary', 'accent', 'surface', 'background'].map((id) => (t.colors.find((c) => c.id === id) || {}).value);
    const hf = t.fonts.find((f) => f.id === 'heading');
    const bf = t.fonts.find((f) => f.id === 'body');
    ensureFont(hf.family);
    return h(
      'button',
      { type: 'button', class: 'bp-tpl', title: `${t.name}: ${t.blurb || ''}`, onClick },
      h('span', { class: 'bp-tpl__strip' }, cols.map((c) => h('i', { style: { background: c } }))),
      h('span', { class: 'bp-tpl__name', style: { fontFamily: fontStack(hf.family), fontWeight: String(hf.weight) } }, t.name),
      h('span', { class: 'bp-tpl__fonts' }, `${hf.family} · ${bf.family}`),
      t.blurb ? h('span', { class: 'bp-tpl__blurb', title: t.blurb }, t.blurb.split(' — ')[0]) : null
    );
  }

  function emptyState() {
    const lib = B().library();
    const wrap = h(
      'div',
      { class: 'bp-empty' },
      h('div', { class: 'bp-empty__icon' }, icon('drop', 20)),
      h('h3', { class: 'bp-empty__title' }, 'Give your designs a brand'),
      h(
        'p',
        { class: 'bp-empty__text' },
        'A brand kit keeps your colours, fonts, logos and tone of voice in one place. Layers link to it, so changing a brand colour updates every design at once — and switching brands re-skins the whole document.'
      )
    );
    if (lib.length) {
      wrap.append(h('div', { class: 'bp-empty__label' }, 'Your brands'));
      const list = h('div', { class: 'bp-lib' });
      lib.forEach((b) =>
        list.append(
          h(
            'button',
            { type: 'button', class: 'bp-lib__item', onClick: () => useBrand(b.id), title: 'Use ' + b.name + ' in this document' },
            h('span', { class: 'bp-dots' }, dotsOf(b).map((c) => h('i', { style: { background: c } }))),
            h('span', { class: 'bp-lib__name' }, b.name),
            icon('arrow-right', 12)
          )
        )
      );
      wrap.append(list);
    }
    wrap.append(h('div', { class: 'bp-empty__label' }, 'Start from a template'));
    const grid = h('div', { class: 'bp-tpls' });
    B()
      .templates()
      .forEach((t) => grid.append(templateCard(t, () => newBrand(t.templateId))));
    wrap.append(
      grid,
      h(
        'div',
        { class: 'bp-empty__row' },
        h('button', { type: 'button', class: 'f-btn', onClick: () => newBrand(null) }, icon('plus', 14), 'Blank brand'),
        h('button', { type: 'button', class: 'f-btn f-btn--ghost', onClick: importBrand }, icon('upload', 14), 'Import .json')
      ),
      h(
        'div',
        { class: 'bp-ask' },
        h('span', { class: 'bp-ask__icon' }, icon('sparkle', 14)),
        h(
          'span',
          {},
          h('b', {}, 'Ask Claude to make one. '),
          'In Claude Code or the ✦ AI tab, say: ',
          h('i', {}, '“Create a brand kit for my bakery”')
        )
      )
    );
    return wrap;
  }

  // =====================================================================
  //  Applying tokens to the selection
  // =====================================================================
  function selectedOrToast(msg) {
    const nodes = store.selectedNodes();
    if (!nodes.length) toast(msg || 'Select a layer on the canvas first.');
    return nodes;
  }

  function applyColor(c, alt) {
    const nodes = selectedOrToast(`Select a layer first, then click “${c.name}” to apply it.`);
    if (!nodes.length) return;
    const ref = B().colorRef(c.id);
    let count = 0;
    store.updateMany(
      nodes.map((n) => n.id),
      (n) => {
        if (n.type === 'text') {
          count++;
          return { text: { color: ref } };
        }
        if (alt) {
          count++;
          const bd = (n.style && n.style.border) || {};
          return { style: { border: { width: bd.width > 0 ? bd.width : 2, style: bd.style || 'solid', color: ref } } };
        }
        if (n.type === 'frame') {
          count++;
          const fills = clone((n.style && n.style.fills) || []);
          const i = fills.findIndex((f) => f && f.type === 'solid');
          if (i >= 0) fills[i] = { ...fills[i], color: ref, visible: true };
          else fills.push({ type: 'solid', color: ref, visible: true });
          return { style: { fills } };
        }
        return null;
      }
    );
    if (!count) return toast('Images can’t take a fill colour — ⌥/Alt-click the swatch to use it as a border.');
    commit(`apply ${c.name}${alt ? ' border' : ''}`);
  }

  /** Text layers in the selection; if none, every text layer inside the selected frames. */
  function textTargets() {
    const sel = store.selectedNodes();
    const texts = sel.filter((n) => n.type === 'text');
    if (texts.length) return texts;
    const out = [];
    sel.forEach((n) => store.descendants(n.id).forEach((id) => store.get(id).type === 'text' && out.push(store.get(id))));
    return out;
  }

  function applyFont(f) {
    if (!store.selection.length) return toast(`Select a text layer first, then click “Aa” to use the ${f.name} font.`);
    const targets = textTargets();
    if (!targets.length) return toast('No text layers in the selection.');
    store.updateMany(
      targets.map((n) => n.id),
      { text: { font: B().fontRef(f.id), weight: f.weight } }
    );
    commit(`apply ${f.name} font`);
    if (!store.selectedNodes().some((n) => n.type === 'text')) toast(`${f.name} font applied to ${targets.length} text layer${targets.length === 1 ? '' : 's'}`);
  }

  function applyRadius(k) {
    const nodes = selectedOrToast('Select a frame or image first, then click a corner style to apply it.').filter((n) => n.type !== 'text');
    if (!nodes.length) return;
    store.updateMany(
      nodes.map((n) => n.id),
      { style: { radius: B().radiusRef(k) } }
    );
    commit(`apply ${k} radius`);
  }

  function applyGradient(g) {
    const frames = store.selectedNodes().filter((n) => n.type === 'frame');
    if (!frames.length) return toast('Select one or more frames first, then click a gradient to add it as a fill.');
    store.updateMany(
      frames.map((n) => n.id),
      (n) => ({ style: { fills: [...clone((n.style && n.style.fills) || []), clone(g.fill)] } })
    );
    commit('add ' + g.name);
  }

  function insertLogo(logo) {
    const p = store.primary();
    let parent = null;
    if (p) parent = p.type === 'frame' ? p : store.get(store.rootOf(p.id));
    if (parent && parent.type !== 'frame') parent = null;
    const ar = logo.width > 0 && logo.height > 0 ? logo.width / logo.height : 2;
    let pw = 0;
    let ph = 0;
    if (parent) {
      let rect = null;
      try {
        rect = Folio.canvas && Folio.canvas.nodeRect ? Folio.canvas.nodeRect(parent.id) : null;
      } catch (e) {}
      pw = (rect && rect.width) || parent.width || 400;
      ph = (rect && rect.height) || parent.height || 300;
    }
    const maxW = parent ? Math.max(48, Math.min(240, pw * 0.4)) : 240;
    const maxH = parent ? Math.max(32, Math.min(160, ph * 0.3)) : 160;
    let w = Math.min(maxW, maxH * ar);
    let hgt = w / ar;
    w = Math.max(8, Math.round(w));
    hgt = Math.max(8, Math.round(hgt));
    const props = {
      name: logo.name || 'Logo',
      width: w,
      height: hgt,
      sizing: { w: 'fixed', h: 'fixed' },
      image: { src: B().logoRef(logo.id), fit: 'contain' },
      style: { fills: [] },
    };
    if (parent) {
      if (!(parent.layout && parent.layout.mode === 'flex')) {
        const pad = (parent.layout && parent.layout.padding) || [0, 0, 0, 0];
        props.x = Math.round(Math.max(0, (pw - w) / 2 - (pad[3] || 0)));
        props.y = Math.round(Math.max(0, (ph - hgt) / 2 - (pad[0] || 0)));
      }
    } else {
      const vp = document.getElementById('canvas-viewport');
      let pt = { x: 0, y: 0 };
      if (vp && Folio.canvas && Folio.canvas.screenToWorld) {
        const r = vp.getBoundingClientRect();
        pt = Folio.canvas.screenToWorld(r.width / 2, r.height / 2) || pt;
      }
      props.x = Math.round(pt.x - w / 2);
      props.y = Math.round(pt.y - hgt / 2);
    }
    const node = store.createNode('image', props, parent ? parent.id : null);
    store.select([node.id]);
    commit('insert ' + (logo.name || 'logo'));
  }

  // =====================================================================
  //  Sections
  // =====================================================================
  // ---------- colours ----------
  function colorsSection(b) {
    const list = h('div', { class: 'bp-colors' });
    b.colors.forEach((c) => list.append(colorRow(b, c)));
    const add = iconBtn('plus', 'Add a colour', () => {
      const c = B().addColor(b.id, { name: 'New colour', value: '#888888' });
      commit('add colour');
      requestAnimationFrame(() => {
        const row = panel.querySelector(`.bp-color[data-id="${c.id}"] .bp-color__name`);
        if (row) startRenameColor(b.id, c.id, row);
      });
    });
    return section(
      'colors',
      'Colours',
      b,
      [h('p', { class: 'f-hint bp-hint' }, 'Click a swatch to apply it to the selection · ⌥/Alt-click for a border'), list],
      [add]
    );
  }

  function startRenameColor(brandId, colorId, el) {
    const b = B().get(brandId);
    const c = b && b.colors.find((x) => x.id === colorId);
    if (!c) return;
    inlineEdit(el, c.name, (v) => {
      B().setColor(brandId, colorId, { name: v });
      commit('rename colour');
    });
  }

  function colorRow(b, c) {
    const fill = h('i', { style: { background: c.value } });
    const sw = h(
      'button',
      {
        type: 'button',
        class: 'f-swatch bp-color__sw',
        title: `Apply ${c.name} to the selection (⌥/Alt-click: border)`,
        onClick: (e) => applyColor(c, e.altKey),
      },
      fill
    );
    const nameEl = h('span', { class: 'bp-color__name', title: 'Double-click to rename' }, c.name);
    nameEl.addEventListener('dblclick', () => startRenameColor(b.id, c.id, nameEl));
    const meta = h(
      'div',
      { class: 'bp-color__meta' },
      nameEl,
      c.core ? h('span', { class: 'bp-color__role', title: (B().roles || {})[c.id] || '' }, c.id) : h('span', { class: 'bp-color__role is-custom' }, 'custom')
    );
    const hex = h('input', { class: 'f-input bp-color__hex', value: c.value, spellcheck: 'false', 'aria-label': c.name + ' colour value' });
    const pick = h('input', { type: 'color', class: 'bp-color__picker', value: hexOf(c.value), 'aria-label': 'Pick ' + c.name, title: 'Edit colour' });
    const setLive = (v) => {
      fill.style.background = v;
      live(() => B().setColor(b.id, c.id, { value: v }));
    };
    hex.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') hex.blur();
      if (e.key === 'Escape') {
        hex.value = c.value;
        hex.blur();
      }
    });
    hex.addEventListener('change', () => {
      const v = B().normColor(hex.value);
      if (!v) {
        toast('That isn’t a colour — try a hex code like #c2410c.', 'error');
        hex.value = (B().get(b.id).colors.find((x) => x.id === c.id) || c).value;
        return;
      }
      hex.value = v;
      pick.value = hexOf(v);
      setLive(v);
      commit('edit ' + c.name);
    });
    pick.addEventListener('input', () => {
      const v = pick.value + alphaOf((B().get(b.id).colors.find((x) => x.id === c.id) || c).value);
      hex.value = v;
      setLive(v);
    });
    pick.addEventListener('change', () => {
      commit('edit ' + c.name);
      if (dirty) schedule();
    });
    const pickWrap = h('label', { class: 'f-btn f-btn--ghost f-btn--icon bp-ibtn bp-color__pick', title: 'Edit colour' }, icon('drop', 14), pick);
    const del = c.core
      ? h('span', { class: 'bp-color__spacer', 'aria-hidden': 'true' })
      : iconBtn(
          'trash',
          'Delete colour (layers using it keep this colour)',
          () => {
            B().removeColor(b.id, c.id);
            commit('delete ' + c.name);
          },
          'bp-del'
        );
    return h('div', { class: 'bp-color', dataset: { id: c.id } }, sw, meta, hex, pickWrap, del);
  }

  // ---------- fonts ----------
  function familyOptions(current) {
    const list = (Folio.fonts && Folio.fonts.list) || [];
    const groups = {};
    list.forEach((f) => (groups[f.category] = groups[f.category] || []).push(f.family));
    const sel = h('select', { class: 'f-select bp-font__family', 'aria-label': 'Font family' });
    let found = false;
    Object.keys(groups).forEach((cat) => {
      const og = h('optgroup', { label: cat.charAt(0).toUpperCase() + cat.slice(1) });
      groups[cat].forEach((fam) => {
        const o = h('option', { value: fam }, fam);
        if (fam === current) {
          o.selected = true;
          found = true;
        }
        og.append(o);
      });
      sel.append(og);
    });
    if (!found && current) {
      const o = h('option', { value: current }, current + ' (custom)');
      o.selected = true;
      sel.prepend(o);
    }
    sel.append(h('option', { value: '__custom' }, 'Other Google font…'));
    return sel;
  }

  function nearestWeight(family, w) {
    const ws = Folio.fonts ? Folio.fonts.weightsOf(family) : [400, 700];
    return ws.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best), ws[0] || 400);
  }

  function fontsSection(b) {
    const list = h('div', { class: 'bp-fonts' });
    b.fonts.forEach((f) => list.append(fontCard(b, f)));
    const add = iconBtn('plus', 'Add a font', () => {
      const used = new Set(b.fonts.map((f) => f.family));
      const fam = ((Folio.fonts && Folio.fonts.list) || []).map((f) => f.family).find((x) => !used.has(x)) || 'Inter';
      B().addFont(b.id, { name: 'Accent', family: fam, weight: 400 });
      commit('add font');
    });
    return section('fonts', 'Fonts', b, [h('p', { class: 'f-hint bp-hint' }, 'Click “Aa” to use a font on the selected text'), list], [add]);
  }

  function fontCard(b, f) {
    ensureFont(f.family);
    const aa = h(
      'button',
      {
        type: 'button',
        class: 'bp-font__aa',
        title: `Use ${f.name} (${f.family} ${f.weight}) on the selected text`,
        style: { fontFamily: fontStack(f.family), fontWeight: String(f.weight) },
        onClick: () => applyFont(f),
      },
      'Aa'
    );
    const nameEl = h('span', { class: 'bp-font__name', title: 'Double-click to rename' }, f.name);
    nameEl.addEventListener('dblclick', () =>
      inlineEdit(nameEl, f.name, (v) => {
        B().setFont(b.id, f.id, { name: v });
        commit('rename font');
      })
    );
    const family = familyOptions(f.family);
    family.addEventListener('change', () => {
      let fam = family.value;
      if (fam === '__custom') {
        const typed = window.prompt('Type the exact name of a Google Font (for example “Rubik” or “Syne”):', '');
        fam = typed && typed.trim().replace(/["';{}<>]/g, '');
        if (!fam) {
          family.value = f.family;
          return;
        }
      }
      family.blur();
      B().setFont(b.id, f.id, { family: fam, weight: nearestWeight(fam, f.weight) });
      commit(`${f.name} font → ${fam}`);
    });
    const weights = Folio.fonts ? Folio.fonts.weightsOf(f.family) : [400, 700];
    const weight = h(
      'select',
      { class: 'f-select bp-font__weight', 'aria-label': 'Weight' },
      (weights.includes(f.weight) ? weights : [...weights, f.weight].sort((x, y) => x - y)).map((w) => {
        const o = h('option', { value: String(w) }, String(w));
        if (w === f.weight) o.selected = true;
        return o;
      })
    );
    weight.addEventListener('change', () => {
      weight.blur();
      B().setFont(b.id, f.id, { weight: Number(weight.value) });
      commit(`${f.name} weight`);
    });
    const del = f.core
      ? null
      : iconBtn(
          'trash',
          'Delete font (text using it keeps this font)',
          () => {
            B().removeFont(b.id, f.id);
            commit('delete font ' + f.name);
          },
          'bp-del'
        );
    return h(
      'div',
      { class: 'bp-font', dataset: { id: f.id } },
      aa,
      h(
        'div',
        { class: 'bp-font__main' },
        h('div', { class: 'bp-font__top' }, nameEl, f.core ? h('span', { class: 'bp-color__role' }, f.id) : null, del),
        h('div', { class: 'bp-font__row' }, family, weight)
      )
    );
  }

  // ---------- logos ----------
  function pickLogos(brandId) {
    if (!logoInput) {
      logoInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/svg+xml,image/webp,image/gif,.svg', multiple: true, style: { display: 'none' } });
      logoInput.addEventListener('change', () => {
        const files = Array.from(logoInput.files || []);
        logoInput.value = '';
        uploadLogos(logoInput._brandId, files);
      });
      document.body.appendChild(logoInput);
    }
    logoInput._brandId = brandId;
    logoInput.click();
  }

  async function uploadLogos(brandId, files) {
    files = (files || []).filter((f) => /^image\//.test(f.type) || /\.svg$/i.test(f.name));
    if (!files.length) return toast('Drop an image file (PNG, JPG, SVG, WebP or GIF).', 'error');
    let added = 0;
    for (const f of files) {
      try {
        await B().addLogo(brandId, f);
        added++;
      } catch (e) {
        toast(`${f.name}: ${e.message || 'could not add that logo'}`, 'error');
      }
    }
    if (added) {
      commit(added === 1 ? 'add logo' : `add ${added} logos`);
      toast(added === 1 ? 'Logo added — click it to place it on the canvas' : `${added} logos added`, 'success');
    }
    return added;
  }

  const VERSION_LABELS = { 'on-light': 'On light', 'on-dark': 'On dark', mono: 'Mono', symbol: 'Symbol' };
  const baseLogoName = (l) => String(l.name || 'Logo').replace(/\s+[—–-]\s+(on light|on dark|mono|symbol)$/i, '') || 'Logo';

  /** The sanitized SVG behind a logo, or null (raster / external / broken). */
  function logoSvg(l) {
    const text = Folio.svg && Folio.svg.decode(l.src);
    try {
      return text ? Folio.svg.sanitize(text).svg : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Add (or refresh, keeping ids so placed copies stay linked) the on-light / on-dark / mono versions of
   * `svg` in one group. `base` is an existing logo that becomes the group's on-light version.
   */
  function saveVersions(brandId, svg, name, base) {
    const S = Folio.svg;
    const group = (base && base.group) || 'g_' + Math.random().toString(36).slice(2, 8);
    const { width, height } = S.size(svg);
    const vs = S.versions(svg, B().get(brandId));
    const logos = B().get(brandId).logos;
    const fresh = {};
    const updated = logos.map((l) => {
      if (base && l.id === base.id) return { ...l, group, version: l.version || 'on-light' };
      if (base && l.group === group && vs[l.version] && l.version !== 'on-light') {
        fresh[l.version] = true;
        return { ...l, src: S.toDataUrl(vs[l.version]), width, height };
      }
      return l;
    });
    if (base) B().update(brandId, { logos: updated });
    Object.keys(vs).forEach((v) => {
      if (fresh[v] || (base && v === 'on-light')) return;
      B().addLogoSrc(brandId, { name: `${name} — ${VERSION_LABELS[v].toLowerCase()}`, src: S.toDataUrl(vs[v]), width, height, version: v, group });
    });
  }

  async function saveSelectionAsLogo(brandId) {
    const p = store.primary();
    if (!p || !Folio.svg) return toast('Select a frame, text or image on the canvas first, then save it as a logo.');
    const warnings = [];
    try {
      const raw = await Folio.svg.fromNode(p.id, warnings);
      const clean = Folio.svg.sanitize(raw);
      saveVersions(brandId, clean.svg, p.name || 'Logo');
      commit('save selection as logo');
      toast(`Saved “${p.name}” as a logo with light, dark and mono versions` + (warnings.length ? ' — ' + warnings[0] : ''), warnings.length ? undefined : 'success');
    } catch (e) {
      toast(e.message || 'Could not turn that layer into a logo.', 'error');
    }
  }

  function makeVersions(brandId, base) {
    const svg = logoSvg(base);
    if (!svg) return toast('Versions can be made from SVG logos only.', 'error');
    try {
      saveVersions(brandId, svg, baseLogoName(base), base);
      commit('make logo versions');
    } catch (e) {
      toast(e.message || 'Could not make versions of that logo.', 'error');
    }
  }

  function logoTile(b, l, label) {
    const nameEl = h('span', { class: 'bp-logo__name', title: label ? `${l.name} · double-click to rename` : 'Double-click to rename' }, label || l.name);
    nameEl.addEventListener('dblclick', () =>
      inlineEdit(nameEl, l.name, (v) => {
        B().update(b.id, { logos: B().get(b.id).logos.map((x) => (x.id === l.id ? { ...x, name: v } : x)) });
        commit('rename logo');
      })
    );
    const canVersion = !label && !l.group && Folio.svg && Folio.svg.decode(l.src);
    return h(
      'div',
      { class: 'bp-logo', dataset: { id: l.id, version: l.version || '' } },
      h(
        'button',
        { type: 'button', class: 'bp-logo__thumb' + (l.version === 'on-dark' ? ' is-dark' : ''), title: `Place “${l.name}” on the canvas`, onClick: () => insertLogo(l) },
        h('img', { src: l.src, alt: l.name, draggable: 'false' })
      ),
      nameEl,
      canVersion ? iconBtn('layers', 'Make versions (on dark, mono)', () => makeVersions(b.id, l), 'bp-del bp-logo__ver') : null,
      iconBtn(
        'x',
        'Delete logo (placed copies keep the image)',
        () => {
          B().removeLogo(b.id, l.id);
          commit('delete logo');
        },
        'bp-del bp-logo__del'
      )
    );
  }

  function logosSection(b) {
    const grid = h('div', { class: 'bp-logos' });
    const groups = new Map();
    b.logos.forEach((l) => {
      const k = l.group || l.id;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(l);
    });
    groups.forEach((list, k) => {
      if (list.length === 1 && !list[0].group) return grid.append(logoTile(b, list[0]));
      const order = Object.keys(VERSION_LABELS);
      list.sort((x, y) => order.indexOf(x.version) - order.indexOf(y.version));
      const base = list.find((l) => l.version === 'on-light') || list[0];
      grid.append(
        h(
          'div',
          { class: 'bp-logo-group', dataset: { group: k } },
          h(
            'div',
            { class: 'bp-logo-group__head' },
            h('span', { class: 'bp-logo-group__name', title: baseLogoName(base) }, baseLogoName(base)),
            Folio.svg && Folio.svg.decode(base.src)
              ? h('button', { type: 'button', class: 'f-btn f-btn--ghost bp-logo-group__make', title: 'Rebuild the on-dark and mono versions from the on-light one', onClick: () => makeVersions(b.id, base) }, 'Make versions')
              : null
          ),
          h('div', { class: 'bp-logo-group__tiles' }, list.map((l) => logoTile(b, l, VERSION_LABELS[l.version] || l.name)))
        )
      );
    });
    const drop = h(
      'button',
      { type: 'button', class: 'bp-drop' + (b.logos.length ? ' is-small' : ''), onClick: () => pickLogos(b.id) },
      icon('upload', 16),
      h('span', {}, b.logos.length ? 'Add logo' : 'Drop a logo here or click to upload'),
      b.logos.length ? null : h('span', { class: 'bp-drop__hint' }, 'PNG, JPG, WebP or SVG · up to 1.5 MB')
    );
    if (b.logos.length) grid.append(drop);
    const save = h('button', { type: 'button', class: 'f-btn bp-logo-save', title: 'Turn the selected frame, text or image into an SVG logo with light, dark and mono versions', onClick: () => saveSelectionAsLogo(b.id) }, icon('plus', 13), h('span', {}, 'Save selection as logo'));
    const body = [b.logos.length ? grid : drop, save];
    const sec = section('logos', 'Logos', b, body, [iconBtn('upload', 'Upload logo', () => pickLogos(b.id))]);
    let depth = 0;
    sec.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      depth++;
      sec.classList.add('is-drop');
    });
    sec.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    sec.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) sec.classList.remove('is-drop');
    });
    sec.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      sec.classList.remove('is-drop');
      uploadLogos(b.id, Array.from((e.dataTransfer && e.dataTransfer.files) || []));
    });
    return sec;
  }

  // ---------- voice ----------
  function voiceSection(b) {
    const v = b.voice || {};
    const fields = [];
    const pushChanged = (key, read) => {
      const save = debounce(() => live(() => B().update(b.id, { voice: { [key]: read() } })), 400);
      return {
        onInput: () => save(),
        onChange: () => {
          save.flush();
          commit('edit voice');
        },
      };
    };
    const field = (key, label, { rows = 0, placeholder = '' } = {}) => {
      const attrs = { class: 'f-input bp-voice__input', placeholder, spellcheck: 'true', 'aria-label': label };
      const el = rows ? h('textarea', { ...attrs, rows: String(rows) }, v[key] || '') : h('input', { ...attrs, value: v[key] || '' });
      const ev = pushChanged(key, () => el.value);
      el.addEventListener('input', ev.onInput);
      el.addEventListener('change', ev.onChange);
      fields.push(h('label', { class: 'bp-field' }, h('span', { class: 'f-label' }, label), el));
    };
    field('tagline', 'Tagline', { placeholder: 'e.g. Baked this morning, loved all day.' });
    field('description', 'What the brand does', { rows: 3, placeholder: 'One or two sentences about the business.' });
    field('audience', 'Audience', { rows: 2, placeholder: 'Who you are talking to.' });

    // tone: comma list → chips
    const chips = h('div', { class: 'bp-chips' });
    const tone = h('input', { class: 'f-input bp-voice__input', value: (v.tone || []).join(', '), placeholder: 'warm, playful, confident', 'aria-label': 'Tone' });
    const parse = () => tone.value.split(',').map((s) => s.trim()).filter(Boolean);
    const drawChips = (list) =>
      chips.replaceChildren(
        ...list.map((t, i) =>
          h(
            'span',
            { class: 'bp-chip' },
            t,
            h(
              'button',
              {
                type: 'button',
                class: 'bp-chip__x',
                'aria-label': 'Remove ' + t,
                onClick: () => {
                  const next = parse().filter((_, j) => j !== i);
                  tone.value = next.join(', ');
                  drawChips(next);
                  B().update(b.id, { voice: { tone: next } });
                  commit('edit tone');
                },
              },
              '×'
            )
          )
        )
      );
    drawChips(v.tone || []);
    const saveTone = debounce(() => live(() => B().update(b.id, { voice: { tone: parse() } })), 400);
    tone.addEventListener('input', () => {
      drawChips(parse());
      saveTone();
    });
    tone.addEventListener('change', () => {
      saveTone.flush();
      commit('edit tone');
    });
    fields.push(h('label', { class: 'bp-field' }, h('span', { class: 'f-label' }, 'Tone of voice'), tone, chips));

    field('useWords', 'Words to use', { rows: 2, placeholder: 'fresh, handmade, golden' });
    field('avoidWords', 'Words to avoid', { rows: 2, placeholder: 'cheap, processed' });
    field('sampleCopy', 'Sample copy', { rows: 4, placeholder: 'A short paragraph that sounds like the brand.' });
    return section('voice', 'Voice', b, [h('p', { class: 'f-hint bp-hint' }, 'Claude reads this when it writes copy for this brand.'), ...fields]);
  }

  // ---------- style ----------
  function seg(options, value, onPick) {
    return h(
      'div',
      { class: 'f-seg bp-seg' },
      options.map(([val, label]) =>
        h('button', { type: 'button', class: val === value ? 'is-active' : '', 'aria-pressed': String(val === value), onClick: () => val !== value && onPick(val) }, label)
      )
    );
  }

  function styleSection(b) {
    const s = b.style;
    const radiusRow = h(
      'div',
      { class: 'bp-radius' },
      ['sm', 'md', 'lg'].map((k) => {
        const input = h('input', { class: 'f-input', type: 'number', min: '0', max: '999', value: String(s.radius[k]), 'aria-label': `Radius ${k}` });
        const prev = h('button', {
          type: 'button',
          class: 'bp-radius__prev',
          title: `Apply the ${k.toUpperCase()} corner radius to the selection`,
          style: { borderTopLeftRadius: Math.min(14, s.radius[k]) + 'px' },
          onClick: () => applyRadius(k),
        });
        const save = (doCommit) => {
          const n = Math.max(0, Math.min(999, Math.round(Number(input.value) || 0)));
          prev.style.borderTopLeftRadius = Math.min(14, n) + 'px';
          live(() => B().update(b.id, { style: { radius: { [k]: n } } }));
          if (doCommit) commit(`radius ${k}`);
        };
        input.addEventListener('input', () => save(false));
        input.addEventListener('change', () => save(true));
        input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
        return h('div', { class: 'bp-radius__item' }, prev, h('div', { class: 'f-num' }, h('span', {}, k.charAt(0).toUpperCase()), input));
      })
    );
    const setStyle = (key, label) => (val) => {
      B().update(b.id, { style: { [key]: val } });
      commit(`${label} ${val}`);
    };
    const grads = h('div', { class: 'bp-grads' });
    (s.gradients || []).forEach((g, i) => {
      const css = Folio.css ? Folio.css.fillsToCss([B().resolveDeep(g.fill, b)]) : {};
      const tile = h('button', { type: 'button', class: 'bp-grad__tile', title: `Add “${g.name}” as a fill to the selected frames` });
      Object.keys(css).forEach((k) => tile.style.setProperty(k, css[k]));
      tile.addEventListener('click', () => applyGradient(g));
      const nameEl = h('span', { class: 'bp-grad__name', title: 'Double-click to rename' }, g.name);
      nameEl.addEventListener('dblclick', () =>
        inlineEdit(nameEl, g.name, (v) => {
          const list = clone(B().get(b.id).style.gradients);
          list[i].name = v;
          B().update(b.id, { style: { gradients: list } });
          commit('rename gradient');
        })
      );
      grads.append(
        h(
          'div',
          { class: 'bp-grad' },
          tile,
          nameEl,
          iconBtn(
            'x',
            'Delete preset',
            () => {
              const list = clone(B().get(b.id).style.gradients).filter((_, j) => j !== i);
              B().update(b.id, { style: { gradients: list } });
              commit('delete gradient');
            },
            'bp-del bp-grad__del'
          )
        )
      );
    });
    const saveFill = h(
      'button',
      {
        type: 'button',
        class: 'f-btn f-btn--ghost bp-savefill',
        onClick: () => {
          const p = store.primary();
          const fills = ((p && p.style && p.style.fills) || []).filter((f) => f && f.visible !== false);
          const top = fills[fills.length - 1];
          if (!top) return toast('Select a layer with a fill (a gradient, say), then save it here.');
          const names = { solid: 'Colour', linear: 'Linear', radial: 'Radial', conic: 'Conic', mesh: 'Mesh', image: 'Image', noise: 'Grain' };
          const list = clone(B().get(b.id).style.gradients || []);
          list.push({ name: `${names[top.type] || 'Fill'} ${list.length + 1}`, fill: clone(top) });
          B().update(b.id, { style: { gradients: list } });
          commit('save fill preset');
          toast('Saved as a brand preset', 'success');
        },
      },
      icon('plus', 14),
      'Save selected fill'
    );
    return section('style', 'Style', b, [
      h('div', { class: 'bp-field' }, h('span', { class: 'f-label' }, 'Corner radius'), radiusRow),
      h('div', { class: 'bp-field' }, h('span', { class: 'f-label' }, 'Buttons'), seg([['pill', 'Pill'], ['rounded', 'Rounded'], ['square', 'Square']], s.button, setStyle('button', 'buttons'))),
      h('div', { class: 'bp-field' }, h('span', { class: 'f-label' }, 'Spacing'), seg([['compact', 'Compact'], ['comfortable', 'Comfy'], ['airy', 'Airy']], s.density, setStyle('density', 'spacing'))),
      h('div', { class: 'bp-field' }, h('span', { class: 'f-label' }, 'Shadows'), seg([['none', 'None'], ['soft', 'Soft'], ['bold', 'Bold']], s.shadow, setStyle('shadow', 'shadows'))),
      h(
        'div',
        { class: 'bp-field' },
        h('span', { class: 'f-label' }, 'Gradients & fills'),
        s.gradients.length ? grads : h('p', { class: 'f-hint' }, 'No presets yet.'),
        saveFill
      ),
    ]);
  }

  // =====================================================================
  //  init
  // =====================================================================
  function init() {
    leftPanel = document.getElementById('left-panel');
    tabsEl = document.getElementById('left-tabs');
    layersEl = document.getElementById('layers');
    panel = document.getElementById('brand-panel');
    if (!panel || !tabsEl || !Folio.brand) return;
    panel.classList.add('bp');
    panel.setAttribute('role', 'tabpanel');
    buildTabs();
    // re-render after the person leaves a field we skipped rebuilding under
    panel.addEventListener('focusout', () =>
      setTimeout(() => {
        if (dirty && !typingInPanel()) schedule();
      }, 0)
    );
    store.on('brand', () => {
      if (!quiet) schedule();
      else dirty = true;
    });
    store.on('doc', schedule);
    store.on('history', (label) => label === undefined && schedule());
    const saved = lsGet(TAB_KEY, 'layers');
    show(saved, { remember: false });
    render();
  }

  Folio.brandPanel = {
    init,
    show,
    current,
    refresh: render,
    // exposed for tests / other panels
    applyColor: (id, alt) => {
      const b = activeBrand();
      const c = b && b.colors.find((x) => x.id === id);
      if (c) applyColor(c, alt);
    },
    applyFont: (id) => {
      const b = activeBrand();
      const f = b && b.fonts.find((x) => x.id === id);
      if (f) applyFont(f);
    },
    insertLogo: (id) => {
      const b = activeBrand();
      const l = b && b.logos.find((x) => x.id === id);
      if (l) insertLogo(l);
    },
    importText,
    uploadLogos,
    saveSelectionAsLogo: () => activeBrand() && saveSelectionAsLogo(activeBrand().id),
    makeVersions: (logoId) => {
      const b = activeBrand();
      const l = b && b.logos.find((x) => x.id === logoId);
      if (l) makeVersions(b.id, l);
    },
  };
})();
