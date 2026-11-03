/*
 * ui.js — tiny shared UI helpers used by every panel.
 *   Folio.ui.toast(message, kind)      kind: 'info' | 'success' | 'error'
 *   Folio.ui.h(tag, attrs, ...children) create a DOM element quickly
 *   Folio.ui.isTyping()                true when focus is in an input/textarea/contenteditable
 */
window.Folio = window.Folio || {};

(function () {
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    children.flat().forEach((c) => {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }

  function toast(message, kind = 'info') {
    const root = document.getElementById('toast-root');
    if (!root) return console.log('[Folio]', message);
    const el = h('div', { class: `f-toast f-toast--${kind}` }, message);
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    setTimeout(() => {
      el.classList.remove('is-in');
      setTimeout(() => el.remove(), 250);
    }, 2600);
  }

  function isTyping() {
    const a = document.activeElement;
    if (!a) return false;
    return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable;
  }

  Folio.ui = { h, toast, isTyping };
})();
