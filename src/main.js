/*
 * main.js — starts Folio.
 *
 * 1. Load the autosaved document from this browser (or build the demo the first time).
 * 2. Start every panel, in order. A panel that fails (or is missing) never stops the others.
 * 3. Zoom the canvas so every artboard fits.
 */
window.Folio = window.Folio || {};

(function () {
  Folio.version = '0.3.0';

  const MODULES = ['brand', 'render', 'canvas', 'inspector', 'layers', 'brandPanel', 'toolbar', 'codePanel', 'shortcuts', 'ai', 'bridge'];

  function loadDocument() {
    const store = Folio.store;
    const saved = store.loadAutosave();
    if (saved && saved.nodes && Array.isArray(saved.roots) && saved.roots.length) {
      store.load(saved);
      return 'autosave';
    }
    if (Folio.demo) {
      Folio.demo.build();
      return 'demo';
    }
    store.newDoc();
    return 'empty';
  }

  function boot() {
    const store = Folio.store;
    let source = 'empty';
    try {
      source = loadDocument();
    } catch (e) {
      console.error('[Folio] could not load the document — starting empty', e);
      store.load(null);
    }

    MODULES.forEach((name) => {
      const mod = Folio[name];
      if (!mod || typeof mod.init !== 'function') {
        console.warn(`[Folio] module "${name}" is not available`);
        return;
      }
      try {
        mod.init();
      } catch (e) {
        console.error(`[Folio] ${name}.init() failed`, e);
      }
    });

    // Re-announce the loaded document so every panel shows it (some panels may only
    // render on events rather than in init()).
    ['doc', 'change', 'selection', 'history', 'tool'].forEach((evt) => store.emit(evt, evt === 'tool' ? store.tool : undefined));
    store.emit('viewport', store.viewport);

    const fit = () => {
      try {
        if (Folio.canvas && Folio.canvas.zoomToFit) Folio.canvas.zoomToFit();
      } catch (e) {
        console.error('[Folio] zoomToFit failed', e);
      }
    };
    requestAnimationFrame(fit);

    // Web fonts change text sizes (and so hug-sized frames) — re-fit once they arrive,
    // unless the person has already moved the view.
    if (document.fonts && document.fonts.ready) {
      let touched = false;
      const off = store.on('viewport', () => (touched = fitDone));
      let fitDone = false;
      requestAnimationFrame(() => requestAnimationFrame(() => (fitDone = true)));
      document.fonts.ready.then(() => {
        off();
        if (!touched) requestAnimationFrame(fit);
      });
    }

    if (source === 'autosave') store.emit('saved', true);
    document.documentElement.classList.add('folio-ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
