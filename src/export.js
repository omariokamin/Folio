/*
 * export.js — turning designs into files and code.
 *
 *   Folio.exporter
 *     htmlFor(id)        -> HTML markup with class names (frames → div/nav/section…, text → p/h1/h2, images → img)
 *     cssFor(id)         -> the matching CSS (from Folio.css.nodeStyles — the same CSS the canvas uses)
 *     inlineHtmlFor(id)  -> HTML with every style inlined (style="…")
 *     pageFor(id)        -> a complete standalone .html document
 *     exportPng(id, scale), downloadPage(id), copyCode(id)
 *     pngDataUrl(id, {scale, maxSize}) -> Promise<data URL>  (no download; used by the AI screenshot tool)
 *     fontFaceCss(families, text, {exact}) -> Promise<@font-face CSS with inlined font files>
 *     saveFile(), openFile()  -> the document as .folio.json
 *
 *   Folio.codePanel     -> the "Code" drawer under the canvas (toggle(show?))
 */
window.Folio = window.Folio || {};

(function () {
  const store = Folio.store;
  const { h, toast } = Folio.ui;
  const icon = (name, size) => Folio.icons.el(name, size);

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

  function slugify(name) {
    let s = String(name || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '');
    if (/^[0-9]/.test(s)) s = 'l-' + s;
    return s;
  }

  function safeFilename(name) {
    return (
      String(name || 'Untitled')
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
        .trim() || 'Untitled'
    );
  }

  function download(filename, data, type) {
    const isDataUrl = typeof data === 'string' && data.startsWith('data:');
    const url = isDataUrl
      ? data
      : URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: type || 'text/plain' }));
    const a = h('a', { href: url, download: filename, style: { display: 'none' } });
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext !== false) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      /* fall through to the old-school way */
    }
    try {
      const ta = h('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  // ---------- which layer do we export? ----------
  /**
   * The primary selection if it is a frame, otherwise its artboard; with nothing selected the
   * first artboard. Returns null (and shows a toast unless opts.quiet) when there is nothing.
   */
  function targetId(opts = {}) {
    const p = store.primary();
    if (p) return p.type === 'frame' ? p.id : store.rootOf(p.id);
    const first = store.doc.roots.find((id) => store.get(id) && store.get(id).visible !== false) || store.doc.roots[0];
    if (first) return first;
    if (!opts.quiet) toast('Nothing to export yet — draw an artboard first.', 'error');
    return null;
  }

  // ---------- code generation ----------
  const SYSTEM_FONTS = ['system-ui', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New'];

  // ---------- brand kit tokens ----------
  // Layers link to the active brand through CSS variables (var(--color-primary), var(--font-heading),
  // var(--radius-md)) and logos through `brand-logo:<id>` srcs. Exports carry a :root block with the
  // variables a subtree uses (HTML + CSS, page) or resolve them to literals (inline HTML).
  const activeBrand = () => (Folio.brand && Folio.brand.active ? Folio.brand.active() : null);
  const VAR_RE = /var\(\s*(--(?:color|font|radius)-[\w-]+)\s*\)/g;

  /** Every brand variable name (e.g. '--color-primary') referenced anywhere in a subtree. */
  function varsUsed(id) {
    const out = new Set();
    [id, ...store.descendants(id)].forEach((i) => {
      const n = store.get(i);
      if (!n) return;
      const json = JSON.stringify([n.style, n.text]);
      for (const m of json.matchAll(VAR_RE)) out.add(m[1]);
    });
    return out;
  }

  /** The active brand's variables, limited to those used by the subtree (all of them when used is null). */
  function brandVars(id) {
    const b = activeBrand();
    if (!b || !Folio.brand.cssVars) return {};
    const all = Folio.brand.cssVars(b) || {};
    if (id == null) return all;
    const used = varsUsed(id);
    const out = {};
    Object.keys(all).forEach((k) => used.has(k) && (out[k] = all[k]));
    return out;
  }

  /** ":root { --color-primary: …; }" for the variables a subtree uses ('' when it uses none). */
  function rootBlockFor(id) {
    const vars = brandVars(id);
    const keys = Object.keys(vars);
    if (!keys.length) return '';
    return `:root {\n${keys.map((k) => `  ${k}: ${vars[k]};`).join('\n')}\n}`;
  }

  /** Replace brand var() references in a CSS value with literal values (for inline HTML). */
  function resolveVars(value, vars) {
    return String(value).replace(VAR_RE, (m, name) => (vars[name] != null ? String(vars[name]) : m));
  }

  /** `brand-logo:<id>` -> the logo's real src (data URL / URL). */
  function resolveSrc(src) {
    if (src && String(src).startsWith('brand-logo:')) return (Folio.brand && Folio.brand.resolveSrc && Folio.brand.resolveSrc(src)) || '';
    return src;
  }

  /** Walk the subtree once, giving every visible node a unique class name. */
  function plan(rootId) {
    const used = new Set();
    const list = [];
    const walk = (id, depth) => {
      const n = store.get(id);
      if (!n) return;
      if (depth > 0 && n.visible === false) return;
      const base = slugify(n.name) || n.type;
      let cls = base;
      let i = 2;
      while (used.has(cls)) cls = `${base}-${i++}`;
      used.add(cls);
      const item = { id, node: n, cls, depth, children: [] };
      list.push(item);
      if (n.type === 'frame') item.children = n.children.map((c) => walk(c, depth + 1)).filter(Boolean);
      return item;
    };
    const tree = walk(rootId, 0);
    return { tree, list };
  }

  function stylesOf(item) {
    if (item.depth > 0) return Folio.css.nodeStyles(item.node, { mode: 'export' });
    // The exported layer is treated as the page container (no parent → position: relative).
    // A "fill" size only means something inside its parent, so use the size it has on the canvas.
    let node = item.node;
    const sz = node.sizing || {};
    if (sz.w === 'fill' || sz.h === 'fill') {
      const el = Folio.render && Folio.render.el ? Folio.render.el(node.id) : null;
      node = Folio.util.clone(node);
      if (sz.w === 'fill') {
        node.sizing.w = 'fixed';
        if (el && el.offsetWidth) node.width = el.offsetWidth;
      }
      if (sz.h === 'fill') {
        node.sizing.h = 'hug';
      }
    }
    return Folio.css.nodeStyles(node, { mode: 'export', parent: null });
  }

  function tagFor(n, depth) {
    if (n.type === 'image') return 'img';
    if (n.type === 'text') {
      const size = (n.text && n.text.size) || 16;
      return size >= 40 ? 'h1' : size >= 28 ? 'h2' : 'p';
    }
    if (depth === 0 && store.isRoot(n.id)) return 'div';
    const name = String(n.name || '').trim();
    if (/^(nav|navbar|navigation|menu bar)\b/i.test(name)) return 'nav';
    if (/^header\b/i.test(name)) return 'header';
    if (/^footer\b/i.test(name)) return 'footer';
    if (/^(section|hero|features?)\b/i.test(name)) return 'section';
    return 'div';
  }

  /** Shared HTML printer. attrFor(item) returns the attribute string for the opening tag (text/imgEnd: JSX). */
  function printHtml(item, attrFor, indent = '', text = esc, imgEnd = '>') {
    const n = item.node;
    const tag = tagFor(n, item.depth);
    const attrs = attrFor(item);
    if (tag === 'img') {
      const src = resolveSrc((n.image && n.image.src) || '') || '';
      return `${indent}<img${attrs} src="${escAttr(src)}" alt="${escAttr(n.name || '')}"${imgEnd}`;
    }
    if (n.type === 'text') {
      const content = text((n.text && n.text.content) || '');
      return `${indent}<${tag}${attrs}>${content}</${tag}>`;
    }
    if (!item.children.length) return `${indent}<${tag}${attrs}></${tag}>`;
    const inner = item.children.map((c) => printHtml(c, attrFor, indent + '  ', text, imgEnd)).join('\n');
    return `${indent}<${tag}${attrs}>\n${inner}\n${indent}</${tag}>`;
  }

  function htmlFor(id, indent = '') {
    if (!store.get(id)) return '';
    const { tree } = plan(id);
    return printHtml(tree, (it) => ` class="${it.cls}"`, indent);
  }

  /** The CSS for a subtree; starts with a :root block of the brand variables it uses (if any). */
  function cssFor(id) {
    if (!store.get(id)) return '';
    const { list } = plan(id);
    const rules = list.map((it) => `.${it.cls} {\n${Folio.css.toCssBlock(stylesOf(it))}\n}`).join('\n\n');
    const root = rootBlockFor(id);
    return root ? `${root}\n\n${rules}` : rules;
  }

  /** HTML with inline styles. Brand variables are resolved to literal values (there is no :root here). */
  function inlineHtmlFor(id) {
    if (!store.get(id)) return '';
    const { tree } = plan(id);
    const vars = brandVars(id);
    const inline = (styles) => {
      const out = {};
      Object.keys(styles).forEach((k) => (out[k] = resolveVars(styles[k], vars)));
      return out;
    };
    return printHtml(tree, (it) => ` style="${escAttr(Folio.css.toCssText(inline(stylesOf(it))))}"`);
  }

  /** Font families used by text layers in a subtree (brand font tokens resolved to their family). */
  function fontsUsed(id) {
    const ids = [id, ...store.descendants(id)];
    const fams = ids
      .map((i) => store.get(i))
      .filter((n) => n && n.type === 'text' && n.text && n.text.font)
      .map((n) => (Folio.fonts && Folio.fonts.resolve ? Folio.fonts.resolve(n.text.font) : n.text.font));
    return [...new Set(fams)].filter((f) => f && !String(f).startsWith('var(') && !SYSTEM_FONTS.includes(f));
  }

  function fontLinks(id) {
    const href = Folio.fonts && Folio.fonts.googleHref(fontsUsed(id));
    if (!href) return '';
    return (
      '  <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
      '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
      `  <link rel="stylesheet" href="${escAttr(href)}">\n`
    );
  }

  const RESET = `*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  min-height: 100vh;
  display: flex;
  background: #e9e9ec;
  -webkit-font-smoothing: antialiased;
}
/* the artboard: centered when it fits, scrollable when it doesn't */
body > :first-child { margin: auto; flex-shrink: 0; }
h1, h2, h3, p { margin: 0; }
img { display: block; max-width: none; }`;

  function pageFor(id) {
    const n = store.get(id);
    if (!n) return '';
    const html = htmlFor(id, '  '); // (indenting line-by-line would add spaces inside multi-line text)
    const css = cssFor(id);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(n.name || 'Folio export')}</title>
${fontLinks(id)}  <style>
/* Exported from Folio — every layer is plain HTML + CSS */
${RESET}

${css}
  </style>
</head>
<body>
${html}
</body>
</html>
`;
  }

  /** HTML + CSS in one snippet (what "Copy code" puts on the clipboard). */
  function snippetFor(id) {
    return `<style>\n${cssFor(id)}\n</style>\n\n${htmlFor(id)}\n`;
  }

  // ---------- PNG ----------
  /**
   * The @font-face rules for the fonts in a layer, with the font files inlined as data URLs.
   * html-to-image needs this to draw text in the right font; it can't read Google's
   * cross-origin stylesheets itself. Only the subsets covering characters actually used are kept.
   */
  const fontCssCache = new Map();
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }
  function coversAny(rangeText, codes) {
    if (!rangeText) return true;
    const ranges = rangeText.split(',').map((r) => {
      const [a, b] = r.trim().replace(/^U\+/i, '').split('-');
      const lo = parseInt(a.replace(/\?/g, '0'), 16);
      const hi = b ? parseInt(b, 16) : parseInt(a.replace(/\?/g, 'F'), 16);
      return [lo, hi];
    });
    for (const c of codes) if (ranges.some(([lo, hi]) => c >= lo && c <= hi)) return true;
    return false;
  }
  function fontEmbedCss(id) {
    const text = [id, ...store.descendants(id)]
      .map((i) => store.get(i))
      .filter((n) => n && n.type === 'text' && n.text)
      .map((n) => n.text.content)
      .join('');
    return fontFaceCss(fontsUsed(id), text);
  }
  /**
   * Shared by PNG export and Folio.svg.embedFonts. opts.exact asks Google for fonts cut to exactly
   * the characters in `text` (tiny files, for SVG logos stored in the brand kit).
   */
  async function fontFaceCss(families, text, opts = {}) {
    let href = Folio.fonts && Folio.fonts.googleHref(families);
    if (!href || !window.fetch) return '';
    if (opts.exact) href += '&text=' + encodeURIComponent([...new Set(text)].join(''));
    const codes = new Set([...text].map((ch) => ch.codePointAt(0)));
    const key = href + '|' + [...codes].sort().join(',');
    if (fontCssCache.has(key)) return fontCssCache.get(key);
    const job = (async () => {
      const res = await fetch(href);
      if (!res.ok) throw new Error('font css ' + res.status);
      const css = await res.text();
      const faces = (css.match(/@font-face\s*\{[^}]*\}/g) || []).filter((f) => {
        const m = f.match(/unicode-range:\s*([^;}]+)/);
        return coversAny(m && m[1], codes);
      });
      const inlined = await Promise.all(
        faces.map(async (f) => {
          let out = f;
          for (const m of f.matchAll(/url\(([^)]+)\)/g)) {
            const url = m[1].replace(/['"]/g, '');
            const r = await fetch(url);
            if (!r.ok) throw new Error('font file ' + r.status);
            out = out.replace(m[0], `url(${await blobToDataUrl(await r.blob())})`);
          }
          return out;
        })
      );
      return inlined.join('\n');
    })();
    fontCssCache.set(key, job);
    try {
      return await job;
    } catch (e) {
      fontCssCache.delete(key);
      throw e;
    }
  }

  /** html-to-image options for one layer (shared by exportPng and pngDataUrl). */
  function pngOptions(el, n, pixelRatio) {
    const width = el.offsetWidth || Math.round(n.width);
    const height = el.offsetHeight || Math.round(n.height);
    return {
      pixelRatio,
      width,
      height,
      cacheBust: false,
      // a broken or blocked image would otherwise fail the whole export; draw a light grey pixel instead
      imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAIAAAOTk5wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==',
      // put the artboard at the origin of the image (right/bottom must be reset too, or the
      // computed "inset" of an artboard far out on the canvas pushes it out of frame)
      // (clipPath: an artboard on another page is clipped away on the canvas while it is exported)
      style: { left: '0px', top: '0px', right: 'auto', bottom: 'auto', transform: 'none', margin: '0px', clipPath: 'none' },
    };
  }

  /** Render with embedded web fonts, falling back to no fonts if that fails. */
  async function renderPng(lib, el, id, opts) {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    try {
      const css = await fontEmbedCss(id);
      if (css) opts.fontEmbedCSS = css;
    } catch (err) {
      console.warn('[Folio] could not embed web fonts for the PNG', err);
    }
    try {
      return await lib.toPng(el, opts);
    } catch (err) {
      console.warn('[Folio] PNG export with fonts failed, retrying without embedded fonts', err);
      return await lib.toPng(el, { ...opts, skipFonts: true });
    }
  }

  /**
   * A PNG of a layer as a data URL — no download, no toasts (used by the AI screenshot tool).
   * opts.scale: pixel ratio (default 1). opts.maxSize: cap for the longest side in px.
   * Rejects with an Error whose `code` is 'no-lib' | 'no-node' | 'no-element' | 'render'.
   */
  /** Lay out the layer's artboard while fn runs, even when it sits on another page. */
  const onCanvas = (id, fn) => (Folio.render && Folio.render.peek ? Folio.render.peek([id], fn) : fn());

  function pngDataUrl(id, opts = {}) {
    return onCanvas(id, () => pngDataUrlNow(id, opts));
  }
  async function pngDataUrlNow(id, opts = {}) {
    const fail = (code, msg) => Object.assign(new Error(msg), { code });
    const n = id && store.get(id);
    if (!n) throw fail('no-node', 'No layer with id ' + id);
    const lib = window.htmlToImage;
    if (!lib || !lib.toPng) throw fail('no-lib', 'The html-to-image library is not loaded (it comes from the internet).');
    if (Folio.render && Folio.render.sync) Folio.render.sync();
    const el = Folio.render && Folio.render.el ? Folio.render.el(id) : null;
    if (!el || !el.isConnected) throw fail('no-element', 'That layer is not on the canvas (is it hidden?).');
    let ratio = Number(opts.scale) > 0 ? Number(opts.scale) : 1;
    const o = pngOptions(el, n, ratio);
    const longest = Math.max(o.width, o.height, 1);
    if (Number(opts.maxSize) > 0) ratio = Math.min(ratio, Number(opts.maxSize) / longest);
    ratio = Math.min(ratio, 16000 / longest); // browsers refuse huge canvases
    o.pixelRatio = ratio;
    try {
      return await renderPng(lib, el, id, o);
    } catch (err) {
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { code: 'render' });
    }
  }

  async function exportPng(id, scale = 1) {
    id = id || targetId();
    if (!id) return;
    return onCanvas(id, () => exportPngNow(id, scale));
  }
  async function exportPngNow(id, scale) {
    const n = store.get(id);
    const lib = window.htmlToImage;
    if (!lib || !lib.toPng) {
      toast('PNG export needs the html-to-image library, which loads from the internet. Check your connection and reload.', 'error');
      return;
    }
    const el = Folio.render && Folio.render.el ? Folio.render.el(id) : null;
    if (!el) {
      toast('Could not find that layer on the canvas.', 'error');
      return;
    }
    const opts = pngOptions(el, n, scale);
    const name = safeFilename(n.name) + (scale !== 1 ? `@${scale}x` : '') + '.png';
    toast(`Exporting ${name}…`);
    try {
      const url = await renderPng(lib, el, id, opts);
      download(name, url);
      toast(`Exported ${name}`, 'success');
    } catch (err) {
      console.error('[Folio] PNG export failed', err);
      toast('PNG export failed — external images can block it. See the console for details.', 'error');
    }
  }

  // ---------- files ----------
  function saveFile() {
    download(safeFilename(store.doc.name) + '.folio.json', store.serialize(), 'application/json');
    toast('Saved ' + safeFilename(store.doc.name) + '.folio.json', 'success');
  }

  let fileInput = null;
  function openFile() {
    if (!fileInput) {
      fileInput = h('input', { type: 'file', accept: '.json,.folio.json,application/json', style: { display: 'none' } });
      fileInput.id = 'folio-open-file';
      fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => loadText(String(reader.result), f.name);
        reader.onerror = () => toast('Could not read that file.', 'error');
        reader.readAsText(f);
      });
      document.body.appendChild(fileInput);
    }
    fileInput.click();
  }

  /** Load a document from JSON text. Returns true on success. */
  function loadText(text, filename) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      toast('That file is not valid JSON.', 'error');
      return false;
    }
    if (doc && doc.doc && doc.doc.nodes) doc = doc.doc;
    if (!doc || typeof doc.nodes !== 'object' || !Array.isArray(doc.roots)) {
      toast('That file is not a Folio document.', 'error');
      return false;
    }
    doc.version = doc.version || 1;
    doc.name = doc.name || (filename ? filename.replace(/\.folio\.json$|\.json$/i, '') : 'Untitled');
    doc.roots = doc.roots.filter((id) => doc.nodes[id]);
    store.load(doc);
    store.scheduleSave();
    requestAnimationFrame(() => Folio.canvas && Folio.canvas.zoomToFit && Folio.canvas.zoomToFit());
    toast('Opened ' + (filename || doc.name), 'success');
    return true;
  }

  function downloadPage(id) {
    id = id || targetId();
    if (!id) return;
    const n = store.get(id);
    download(safeFilename(n.name) + '.html', pageFor(id), 'text/html');
    toast(`Exported ${safeFilename(n.name)}.html`, 'success');
  }

  /** Tailwind preview page (.html) or React component (.jsx, theme in a leading comment). */
  function downloadTailwind(id, react) {
    id = id || targetId();
    if (!id || !Folio.tailwind) return;
    const T = Folio.tailwind;
    const name = safeFilename(store.get(id).name) + (react ? '.jsx' : '.tailwind.html');
    const data = react ? `/* Tailwind v4 theme for your CSS:\n\n${T.themeFor(id)}\n*/\n\n${T.jsxFor(id)}` : T.pageFor(id);
    download(name, data, react ? 'text/javascript' : 'text/html');
    toast(`Exported ${name}`, 'success');
  }

  async function copyCode(id) {
    id = id || targetId();
    if (!id) return;
    const ok = await copyText(snippetFor(id));
    toast(ok ? 'HTML + CSS copied to the clipboard' : 'Could not access the clipboard', ok ? 'success' : 'error');
  }

  Folio.exporter = {
    targetId,
    slugify,
    htmlFor,
    cssFor,
    inlineHtmlFor,
    pageFor,
    snippetFor,
    fontsUsed,
    fontFaceCss,
    varsUsed,
    rootBlockFor,
    exportPng,
    pngDataUrl,
    downloadPage,
    downloadTailwind,
    copyCode,
    copyText,
    saveFile,
    openFile,
    loadText,
    download,
    // shared with tailwind.js
    esc,
    plan,
    stylesOf,
    printHtml,
    brandVars,
    fontLinks,
    RESET,
  };

  // =====================================================================
  // Code panel — a drawer under the canvas showing the code for the selection
  // =====================================================================

  // ----- lightweight syntax highlighting -----
  const span = (cls, s) => `<span class="hl-${cls}">${s}</span>`;

  /** Long data: URLs make the panel slow and unreadable — shorten them for display only. */
  function shorten(code) {
    return code.replace(/data:([a-z+\/.-]+)[;,][^"\s&]{120,}/gi, (m, type) => {
      const kb = (m.length / 1024).toFixed(1);
      return `data:${type}…(${kb} KB)`;
    });
  }

  function hlHtml(code) {
    return esc(code).replace(/(&lt;\/?)([a-zA-Z][\w-]*)([\s\S]*?)(\/?&gt;)/g, (m, open, tag, attrs, close) => {
      const a = attrs.replace(/([\w:-]+)(=)(&quot;[\s\S]*?&quot;|"[^"]*")/g, (mm, name, eq, val) => span('attr', name) + eq + span('str', val));
      return span('punct', open) + span('tag', tag) + a + span('punct', close);
    });
  }

  function hlCss(code) {
    return code
      .split('\n')
      .map((line) => {
        const e = esc(line);
        if (/^\s*\/\*/.test(line)) return span('comment', e);
        let m = e.match(/^(\s*)([\w-]+)(:\s)(.*?)(;?)$/);
        if (m && !/\{\s*$/.test(line)) return m[1] + span('prop', m[2]) + m[3] + hlValue(m[4]) + m[5];
        m = e.match(/^(\s*)(.+?)(\s*\{)$/);
        if (m) return m[1] + span('sel', m[2]) + m[3];
        return e;
      })
      .join('\n');
  }
  function hlValue(v) {
    return v.replace(/(#[0-9a-fA-F]{3,8}\b)|(-?\d*\.?\d+(?:px|%|em|rem|deg|vh|vw|s)?\b)/g, (m, hex, num) =>
      hex ? span('hex', hex) : span('num', num)
    );
  }

  function hlJson(code) {
    return esc(code).replace(
      /(&quot;|")((?:\\.|(?!\1)[^\\])*?)\1(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (m, q, body, colon, lit, num) => {
        if (q) return colon ? span('prop', q + body + q) + colon : span('str', q + body + q);
        if (lit) return span('lit', lit);
        return span('num', num);
      }
    );
  }

  const TABS = [
    { id: 'split', label: 'HTML + CSS' },
    { id: 'inline', label: 'Inline HTML' },
    { id: 'json', label: 'JSON' },
  ];

  const prefs = {
    get(k, d) {
      try {
        const v = localStorage.getItem('folio:pref:' + k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('folio:pref:' + k, JSON.stringify(v));
      } catch (e) {
        /* ignore */
      }
    },
  };

  const panel = {
    el: null,
    open: false,
    tab: 'split',
    timer: 0,
    subjectId: null,
    code: {},
  };

  function subject() {
    const p = store.primary();
    return p ? p.id : null;
  }

  function codeFor(id) {
    const tab = panel.tab;
    if (tab === 'split') return { html: htmlFor(id), css: cssFor(id) };
    if (tab === 'inline') return { inline: inlineHtmlFor(id) };
    return { json: JSON.stringify(store.toTree(id), null, 2) };
  }

  function pane(title, code, highlighter, key) {
    const pre = h('pre', { class: 'cp__code', tabindex: '0' });
    pre.innerHTML = highlighter(shorten(code)) || '';
    const copyBtn = h(
      'button',
      { type: 'button', class: 'f-btn f-btn--ghost cp__mini', title: 'Copy ' + title },
      icon('copy', 12),
      h('span', {}, 'Copy')
    );
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(code);
      toast(ok ? `${title} copied` : 'Could not access the clipboard', ok ? 'success' : 'error');
    });
    return h(
      'div',
      { class: 'cp__pane', dataset: { pane: key } },
      h('div', { class: 'cp__pane-head' }, h('span', {}, title), copyBtn),
      pre
    );
  }

  function renderPanel() {
    panel.timer = 0;
    if (!panel.open || !panel.el) return;
    const id = subject();
    panel.subjectId = id;
    const n = id && store.get(id);
    const subj = panel.el.querySelector('.cp__subject');
    const body = panel.el.querySelector('.cp__body');
    panel.el.querySelectorAll('.cp__tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === panel.tab));
    if (!n) {
      subj.textContent = 'Nothing selected';
      panel.code = {};
      body.replaceChildren(
        h('div', { class: 'cp__empty' }, 'Select a layer (or an artboard) to see its code. Every layer is real HTML + CSS.')
      );
      return;
    }
    const kind = store.isRoot(id) ? 'artboard' : n.type === 'frame' ? (n.layout && n.layout.mode === 'flex' ? 'auto layout frame' : 'frame') : n.type;
    const count = store.descendants(id).length;
    subj.textContent = '';
    subj.append(
      h('b', {}, n.name),
      h('span', {}, ` · ${kind}${count ? ` · ${count} layer${count === 1 ? '' : 's'} inside` : ''}`)
    );
    // keep scroll positions across live updates
    const scrolls = [...body.querySelectorAll('.cp__code')].map((p) => [p.scrollTop, p.scrollLeft]);
    panel.code = codeFor(id);
    let content;
    if (panel.tab === 'split') {
      content = h('div', { class: 'cp__split' }, pane('HTML', panel.code.html, hlHtml, 'html'), pane('CSS', panel.code.css, hlCss, 'css'));
    } else if (panel.tab === 'inline') {
      content = pane('Inline HTML', panel.code.inline, hlHtml, 'inline');
    } else {
      content = pane('JSON', panel.code.json, hlJson, 'json');
    }
    body.replaceChildren(content);
    body.querySelectorAll('.cp__code').forEach((p, i) => {
      if (scrolls[i]) [p.scrollTop, p.scrollLeft] = scrolls[i];
    });
  }

  function schedulePanel(delay = 150) {
    if (!panel.open) return;
    clearTimeout(panel.timer);
    panel.timer = setTimeout(renderPanel, delay);
  }

  function toggle(show) {
    if (!panel.el) return;
    const next = show === undefined ? !panel.open : !!show;
    panel.open = next;
    panel.el.hidden = !next;
    prefs.set('codeOpen', next);
    if (next) renderPanel();
    store.emit('code:visible', next);
  }

  function setTab(tab) {
    panel.tab = tab;
    prefs.set('codeTab', tab);
    renderPanel();
  }

  function currentFullText() {
    const id = panel.subjectId;
    if (!id) return '';
    if (panel.tab === 'split') return snippetFor(id);
    if (panel.tab === 'inline') return inlineHtmlFor(id) + '\n';
    return JSON.stringify(store.toTree(id), null, 2);
  }

  function downloadCurrent() {
    const id = panel.subjectId;
    const n = id && store.get(id);
    if (!n) return;
    const base = safeFilename(n.name);
    if (panel.tab === 'split') return downloadPage(id);
    if (panel.tab === 'inline') {
      const fonts = fontLinks(id);
      const doc = `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${esc(n.name)}</title>\n${fonts}  <style>\n${RESET}\n  </style>\n</head>\n<body>\n${inlineHtmlFor(id)}\n</body>\n</html>\n`;
      download(base + '.inline.html', doc, 'text/html');
      return toast(`Exported ${base}.inline.html`, 'success');
    }
    download(base + '.json', JSON.stringify(store.toTree(id), null, 2), 'application/json');
    toast(`Exported ${base}.json`, 'success');
  }

  function startResize(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panel.el.offsetHeight;
    const handle = e.currentTarget;
    handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
    document.body.classList.add('is-resizing-code');
    const move = (ev) => {
      const max = Math.max(160, window.innerHeight * 0.75);
      const hgt = Math.round(Math.max(120, Math.min(max, startH + (startY - ev.clientY))));
      panel.el.style.height = hgt + 'px';
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('is-resizing-code');
      prefs.set('codeH', panel.el.offsetHeight);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  function initPanel() {
    const el = document.getElementById('code-panel');
    if (!el) return;
    panel.el = el;
    panel.tab = TABS.some((t) => t.id === prefs.get('codeTab')) ? prefs.get('codeTab') : 'split';
    el.innerHTML = '';
    el.classList.add('cp');
    el.style.height = Math.max(120, Number(prefs.get('codeH', 260)) || 260) + 'px';

    const handle = h('div', { class: 'cp__resize', title: 'Drag to resize' });
    handle.addEventListener('pointerdown', startResize);

    const tabs = h(
      'div',
      { class: 'f-seg cp__tabs', role: 'tablist' },
      TABS.map((t) => {
        const b = h('button', { type: 'button', role: 'tab', class: 'cp__tab', dataset: { tab: t.id } }, t.label);
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => setTab(t.id));
        return b;
      })
    );
    const mk = (label, ic, fn, extra = {}) => {
      const b = h('button', { type: 'button', class: 'f-btn f-btn--ghost', ...extra }, icon(ic, 14), label ? h('span', {}, label) : null);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', fn);
      return b;
    };
    const copyBtn = mk('Copy', 'copy', async () => {
      const text = currentFullText();
      if (!text) return;
      const ok = await copyText(text);
      toast(ok ? 'Code copied to the clipboard' : 'Could not access the clipboard', ok ? 'success' : 'error');
    }, { dataset: { cp: 'copy' } });
    const dlBtn = mk('Download', 'download', downloadCurrent, { dataset: { cp: 'download' } });
    const closeBtn = mk('', 'x', () => toggle(false), { class: 'f-btn f-btn--ghost f-btn--icon', title: 'Close (' + (Folio.keys ? Folio.keys.fmt('mod+e') : 'Ctrl+E') + ')', dataset: { cp: 'close' } });

    const head = h(
      'div',
      { class: 'cp__head' },
      h('div', { class: 'cp__title' }, icon('code', 14), h('span', {}, 'Code'), h('span', { class: 'cp__subject' })),
      tabs,
      h('div', { class: 'cp__actions' }, copyBtn, dlBtn, closeBtn)
    );
    const body = h('div', { class: 'cp__body' });
    el.append(handle, head, body);

    store.on('change', () => schedulePanel(200));
    store.on('brand', () => schedulePanel(60));
    store.on('selection', () => schedulePanel(30));
    store.on('doc', () => schedulePanel(30));
    store.on('code:toggle', (v) => toggle(typeof v === 'boolean' ? v : undefined));

    toggle(!!prefs.get('codeOpen', false));
  }

  Folio.codePanel = {
    init: initPanel,
    toggle,
    refresh: renderPanel,
    setTab,
    isOpen: () => panel.open,
    highlight: { html: hlHtml, css: hlCss, json: hlJson },
  };
})();
