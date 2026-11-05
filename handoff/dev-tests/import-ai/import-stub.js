// Test stand-in for src/import.js (SPEC "HTML import (v0.7)") until the real importer lands.
window.Folio = window.Folio || {};
Folio.importer = {
  stub: true,
  async fromHtml(html, o = {}) {
    const store = Folio.store;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const el = o.selector ? doc.querySelector(o.selector) : doc.body;
    if (!el) throw new Error(`nothing matches ${o.selector}`);
    let count = 0;
    const conv = (e) => {
      const kids = [...e.children].filter((c) => !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(c.tagName));
      const name = (e.getAttribute('aria-label') || e.id || e.classList[0] || e.tagName.toLowerCase()).slice(0, 40);
      count++;
      if (!kids.length) {
        const t = e.textContent.trim();
        return t ? { type: 'text', name, sizing: { w: 'fill', h: 'hug' }, text: { content: t, size: /^H1$/.test(e.tagName) ? 48 : 16 } } : (count--, null);
      }
      return { type: 'frame', name, sizing: { w: 'fill', h: 'hug' }, layout: { mode: 'flex', direction: /nav|row|grid/.test(e.className) ? 'row' : 'column', gap: 16, padding: [8, 8, 8, 8] }, children: kids.map(conv).filter(Boolean) };
    };
    const body = conv(el);
    const tree = o.parentId ? body : { type: 'frame', name: o.name || doc.title || 'Imported page', width: o.width || 1440, height: 100, sizing: { w: 'fixed', h: 'hug' }, layout: { mode: 'flex', direction: 'column', gap: 0, padding: [0, 0, 0, 0] }, style: { fills: [{ type: 'solid', color: '#ffffff', visible: true }], clip: true }, children: body ? [body] : [] };
    const build = () => {
      if (!o.parentId) {
        let right = -120;
        store.doc.roots.forEach((id) => { const n = store.get(id); if (n) right = Math.max(right, n.x + n.width); });
        tree.x = right + 120; tree.y = 0;
      }
      return store.buildFromTree(tree, o.parentId || null);
    };
    const node = o.pageId && o.pageId !== store.currentPage().id ? store.withPage(o.pageId, build) : build();
    return { rootId: node.id, count: count + (o.parentId ? 0 : 1), warnings: ['stub importer: styles ignored'], skipped: { script: doc.querySelectorAll('script').length } };
  },
};
