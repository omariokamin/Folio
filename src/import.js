/*
 * import.js — HTML (+CSS) → editable Folio layers with auto layout (SPEC "HTML import (v0.7)").
 *
 *   Folio.importer.fromHtml(html, opts)  -> Promise<{ rootId, count, warnings, skipped }>  (never commits)
 *   Folio.importer.open()                -> the File → Import HTML… modal
 *   Folio.importer.pasteHtml(html, o)    -> import clipboard HTML into the selected frame (or a new artboard); commits
 *
 * The HTML is untrusted. It is sanitised, rendered in an <iframe sandbox="allow-same-origin"> (no
 * allow-scripts, so nothing in it ever runs), measured with getComputedStyle + getBoundingClientRect,
 * and rebuilt from those measurements. None of it is ever inserted into Folio's own document.
 */
window.Folio = window.Folio || {};

(function () {
  const MAX_BYTES = 3 * 1024 * 1024;
  const MAX_LAYERS = 3000;
  const TIMEOUT = 8000;
  const TOL = 2; // px: differences this small count as "the same"

  // =====================================================================
  // 1. Sanitise (defence in depth — the sandbox already blocks scripts)
  // =====================================================================
  const DROP = 'script,noscript,meta[http-equiv],base,frameset,audio,applet,portal,animate,set,animateMotion,animateTransform,link:not([rel~="stylesheet" i])';
  const EMBED = 'iframe,frame,object,embed,video,canvas';
  const BAD_URL = /^(javascript|vbscript|data:text\/html|data:application)/i;

  /** Re-parse until stable: serialising and re-parsing can turn inert markup live (mutation XSS). */
  function sanitize(html, baseUrl) {
    let out = clean(html, baseUrl);
    for (let i = 0; i < 4; i++) {
      const again = clean(out.markup, baseUrl);
      if (again.markup === out.markup) return out;
      out = { ...again, title: out.title };
    }
    throw new Error('That HTML could not be made safe to import.');
  }

  function clean(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll(DROP).forEach((el) => el.remove());
    // embeds become same-size placeholders so the layout around them holds
    doc.querySelectorAll(EMBED).forEach((el) => {
      const d = doc.createElement('div');
      const tag = el.localName;
      d.setAttribute('data-folio-embed', tag);
      if (tag === 'video' && el.getAttribute('poster')) d.setAttribute('data-folio-poster', el.getAttribute('poster'));
      ['class', 'id', 'aria-label'].forEach((a) => el.hasAttribute(a) && d.setAttribute(a, el.getAttribute(a)));
      const dim = (a, dflt) => {
        const v = String(el.getAttribute(a) || '').trim();
        return /^\d+(\.\d+)?$/.test(v) ? v + 'px' : /^\d+(\.\d+)?%$/.test(v) ? v : dflt;
      };
      d.setAttribute('style', `display:inline-block;width:${dim('width', '300px')};height:${dim('height', '150px')};` + (el.getAttribute('style') || ''));
      el.replaceWith(d);
    });
    doc.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((a) => {
        const n = a.name.toLowerCase();
        const v = a.value.replace(/[\u0000-\u0020\u007f]+/g, '');
        if (n.startsWith('on') || ['srcdoc', 'action', 'formaction', 'ping', 'autofocus', 'loading', 'http-equiv', 'autoplay', 'manifest'].includes(n) || BAD_URL.test(v))
          el.removeAttribute(a.name);
      });
    });
    const head = doc.head || doc.documentElement.insertBefore(doc.createElement('head'), doc.body);
    // CSS animations jump to their end state, so "fade in" elements are measured visible
    const st = doc.querySelector('style[data-folio]') || doc.createElement('style');
    st.setAttribute('data-folio', '');
    st.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition:none!important;scroll-behavior:auto!important}';
    if (!st.isConnected) head.appendChild(st);
    if (baseUrl && /^https?:\/\//i.test(baseUrl)) {
      const b = doc.createElement('base');
      b.setAttribute('href', baseUrl);
      head.insertBefore(b, head.firstChild);
    }
    return { markup: '<!doctype html>\n' + doc.documentElement.outerHTML, title: (doc.title || '').trim() };
  }

  // =====================================================================
  // 2. Render in a sandboxed iframe
  // =====================================================================
  function render(markup, width) {
    return new Promise((resolve) => {
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-same-origin'); // NO allow-scripts: nothing in the page can run
      f.setAttribute('aria-hidden', 'true');
      f.tabIndex = -1;
      f.style.cssText = `position:fixed;left:${-width - 20000}px;top:0;width:${width}px;height:900px;border:0;visibility:hidden;pointer-events:none;`;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(f);
      };
      const timer = setTimeout(finish, TIMEOUT);
      f.addEventListener('load', () => {
        const d = f.contentDocument;
        const ready = d && d.fonts && d.fonts.ready ? d.fonts.ready : Promise.resolve();
        ready.then(finish, finish);
      });
      f.srcdoc = markup;
      document.body.appendChild(f);
    });
  }

  // =====================================================================
  // 3. CSS value parsing
  // =====================================================================
  const num = (v) => parseFloat(v) || 0;
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  const up = (v) => Math.ceil(v * 10 - 0.01) / 10; // widths round up: a box 0.05px too narrow wraps its text

  /** Split on a separator that is not inside parentheses. */
  function splitTop(s, sep = ',') {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const ch of String(s)) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
        if (cur.trim()) out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  let ctx2d = null;
  /** A computed colour → '#rrggbb' / '#rrggbbaa', or null when fully transparent. */
  function color(c) {
    c = String(c || '').trim();
    let m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
    if (!m) {
      if (!c || c === 'transparent') return null;
      ctx2d = ctx2d || document.createElement('canvas').getContext('2d');
      ctx2d.fillStyle = '#000';
      ctx2d.fillStyle = c;
      const v = ctx2d.fillStyle;
      if (v[0] === '#') return v;
      m = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
      if (!m) return c; // some other colour space: CSS strings are valid fills too
    }
    let a = m[4] == null ? 1 : m[4].endsWith('%') ? num(m[4]) / 100 : num(m[4]);
    if (a <= 0.003) return null;
    const hx = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
    return '#' + hx(+m[1]) + hx(+m[2]) + hx(+m[3]) + (a < 0.998 ? hx(a * 255) : '');
  }

  const COLOR_TOKEN = /^(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+\([^)]*\)|transparent|[a-z]+)/i;

  /** box-shadow / text-shadow → Folio shadows. */
  function shadows(v, text) {
    if (!v || v === 'none') return [];
    return splitTop(v).map((s) => {
      const inset = /\binset\b/.test(s);
      s = s.replace(/\binset\b/, '').trim();
      let col = '#00000040';
      const cm = s.match(/(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}|color\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\))/i);
      if (cm) {
        col = color(cm[1]) || '#00000000';
        s = s.replace(cm[1], ' ');
      }
      const n = (s.match(/-?[\d.]+px|-?[\d.]+(?=\s|$)/g) || []).map(num);
      const sh = { x: n[0] || 0, y: n[1] || 0, blur: n[2] || 0, spread: text ? 0 : n[3] || 0, color: col, inset, visible: true };
      return sh;
    }).filter((s) => s.color !== '#00000000');
  }

  /** "45deg" / "to top right" → degrees (CSS convention). */
  function angleOf(tok, w, h) {
    const m = tok.match(/^(-?[\d.]+)(deg|turn|rad|grad)$/);
    if (m) return r1({ deg: 1, turn: 360, rad: 180 / Math.PI, grad: 0.9 }[m[2]] * num(m[1]));
    const t = tok.replace(/^to\s+/, '').split(/\s+/).sort().join(' ');
    const c = (Math.atan2(h || 1, w || 1) * 180) / Math.PI;
    return { top: 0, right: 90, bottom: 180, left: 270, 'right top': c, 'bottom right': 180 - c, 'bottom left': 180 + c, 'left top': 360 - c }[t] ?? 180;
  }

  /** Gradient colour stops → [{color, pos}] (positions in %; missing ones spread evenly). */
  function stopsOf(args, len) {
    const out = [];
    args.forEach((a) => {
      const cm = a.match(COLOR_TOKEN);
      if (!cm || /^-?[\d.]/.test(a)) return; // colour hint
      const c = color(cm[1]) || '#00000000';
      const pos = (a.slice(cm[1].length).match(/-?[\d.]+(%|px|deg|turn)?/g) || []).map((p) =>
        p.endsWith('%') ? num(p) : p.endsWith('deg') ? (num(p) / 360) * 100 : p.endsWith('turn') ? num(p) * 100 : (num(p) / (len || 1)) * 100
      );
      if (!pos.length) out.push({ color: c, pos: null });
      pos.forEach((p) => out.push({ color: c, pos: p }));
    });
    if (!out.length) return out;
    if (out[0].pos == null) out[0].pos = 0;
    if (out[out.length - 1].pos == null) out[out.length - 1].pos = 100;
    for (let i = 1; i < out.length; i++) {
      if (out[i].pos != null) continue;
      let j = i;
      while (out[j].pos == null) j++;
      const a = out[i - 1].pos;
      const step = (out[j].pos - a) / (j - i + 1);
      for (let k = i; k < j; k++) out[k].pos = a + step * (k - i + 1);
    }
    return out.map((s) => ({ color: s.color, pos: r1(s.pos) }));
  }

  /** "at 30% 20%" / "at left top" / "at 40px 10px" → percentages. */
  function positionOf(s, w, h) {
    const m = s.match(/\bat\s+(.+)$/);
    if (!m) return { x: 50, y: 50 };
    const kw = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };
    const p = m[1].trim().split(/\s+/);
    const one = (t, size) => (t in kw ? kw[t] : t.endsWith('%') ? num(t) : (num(t) / (size || 1)) * 100);
    if (p.length === 1) return /top|bottom/.test(p[0]) ? { x: 50, y: one(p[0], h) } : { x: one(p[0], w), y: 50 };
    if (/top|bottom/.test(p[0]) || /left|right/.test(p[1])) p.reverse();
    return { x: r1(one(p[0], w)), y: r1(one(p[1], h)) };
  }

  /** background-* → Folio fills (bottom first). */
  function fillsOf(cs, w, h, ctx) {
    const fills = [];
    const bg = color(cs.backgroundColor);
    const layers = cs.backgroundImage && cs.backgroundImage !== 'none' ? splitTop(cs.backgroundImage) : [];
    const sizes = splitTop(cs.backgroundSize || '');
    const repeats = splitTop(cs.backgroundRepeat || '');
    const parsed = layers.map((L, i) => {
      const g = L.match(/^(repeating-)?(linear|radial|conic)-gradient\(([\s\S]*)\)$/);
      if (g) {
        const args = splitTop(g[3]);
        const first = args[0] || '';
        if (g[2] === 'linear') {
          const hasDir = /^(-?[\d.]+(deg|turn|rad|grad)|to\s)/.test(first);
          const angle = hasDir ? angleOf(first, w, h) : 180;
          const rad = (angle * Math.PI) / 180;
          const stops = stopsOf(hasDir ? args.slice(1) : args, Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)));
          if (stops.length && stops.every((s) => s.color === stops[0].color)) return { type: 'solid', color: stops[0].color, visible: true };
          return { type: 'linear', angle, stops, visible: true };
        }
        if (g[2] === 'radial') {
          const hasShape = !COLOR_TOKEN.test(first) || /^(circle|ellipse|closest|farthest|at\s)/.test(first);
          const pos = hasShape ? positionOf(first, w, h) : { x: 50, y: 50 };
          return { type: 'radial', cx: pos.x, cy: pos.y, stops: stopsOf(hasShape ? args.slice(1) : args, Math.max(w, h)), visible: true };
        }
        const hasFrom = /^(from|at)\s/.test(first);
        const am = first.match(/from\s+(-?[\d.]+\w+)/);
        return { type: 'conic', angle: am ? angleOf(am[1], w, h) : 0, stops: stopsOf(hasFrom ? args.slice(1) : args, 360), visible: true };
      }
      const u = L.match(/^url\(\s*(['"]?)([\s\S]*?)\1\s*\)$/);
      if (u) {
        const src = u[2];
        if (/feTurbulence/i.test(decodeURIComponent(src.replace(/%(?![0-9a-f]{2})/gi, '%25')))) {
          const om = decodeURIComponent(src.replace(/%(?![0-9a-f]{2})/gi, '%25')).match(/opacity=['"]([\d.]+)/);
          return { type: 'noise', opacity: om ? num(om[1]) : 0.15, visible: true };
        }
        const safe = imageSrc(src, ctx);
        if (!safe) return null;
        const size = sizes[i] || 'auto';
        const rep = repeats[i] || 'repeat';
        const fit = /cover|contain/.test(size) ? size.match(/cover|contain/)[0] : size === '100% 100%' ? 'fill' : !/no-repeat/.test(rep) && /^auto|px/.test(size) ? 'tile' : 'cover';
        return { type: 'image', src: safe, fit, visible: true };
      }
      ctx.skip('unsupported background');
      return null;
    });
    // Folio's mesh fill (and the common CSS idiom it is): soft radial blobs fading to transparent over a base
    const radial = parsed.filter((f) => f && f.type === 'radial');
    const blob = (f) => f.stops.length === 2 && f.stops[0].pos === 0 && /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(f.stops[0].color) && f.stops[1].color.length === 9 && f.stops[1].color.endsWith('00');
    if (radial.length >= 2 && radial.length === parsed.length - 1 && radial.every(blob) && parsed[parsed.length - 1] && parsed[parsed.length - 1].type === 'solid') {
      const base = parsed[parsed.length - 1].color;
      if (bg) fills.push({ type: 'solid', color: bg, visible: true });
      fills.push({ type: 'mesh', base, spread: radial[0].stops[1].pos, points: radial.map((f) => ({ color: f.stops[0].color, x: f.cx, y: f.cy })), visible: true });
      return fills;
    }
    if (bg) fills.push({ type: 'solid', color: bg, visible: true });
    parsed.filter(Boolean).reverse().forEach((f) => fills.push(f)); // CSS: first layer on top; Folio: last on top
    return fills;
  }

  /** A safe image URL (http(s), or a raster data URL; SVG data goes through Folio.svg.sanitize), or ''. */
  function imageSrc(src, ctx) {
    src = String(src || '').trim();
    if (/^https?:\/\//i.test(src) || /^blob:/i.test(src)) return /^blob:/i.test(src) ? '' : src;
    if (/^data:image\/svg\+xml/i.test(src)) {
      try {
        const text = Folio.svg.decode(src);
        return text ? Folio.svg.toDataUrl(Folio.svg.sanitize(text).svg) : '';
      } catch (e) {
        ctx.skip('unreadable SVG');
        return '';
      }
    }
    if (/^data:image\/(png|jpe?g|gif|webp|avif|bmp)[;,]/i.test(src)) return src;
    return '';
  }

  // =====================================================================
  // 4. Conversion: DOM → Folio tree
  // =====================================================================
  const REPLACED = new Set(['img', 'svg', 'picture', 'input', 'textarea', 'select', 'button', 'video', 'canvas', 'iframe', 'object', 'embed', 'math', 'hr', 'progress', 'meter']);
  const GENERIC_FONTS = { 'sans-serif': 'Arial', 'system-ui': 'system-ui', '-apple-system': 'system-ui', blinkmacsystemfont: 'system-ui', 'ui-sans-serif': 'system-ui', 'segoe ui': 'system-ui', serif: 'Georgia', 'ui-serif': 'Georgia', monospace: 'Courier New', 'ui-monospace': 'Courier New', cursive: 'Caveat' };
  const TAG_NAMES = { header: 'Header', nav: 'Nav', footer: 'Footer', main: 'Main', section: 'Section', article: 'Article', aside: 'Aside', ul: 'List', ol: 'List', li: 'Item', a: 'Link', button: 'Button', form: 'Form', figure: 'Figure', figcaption: 'Caption', blockquote: 'Quote', table: 'Table', tr: 'Row', td: 'Cell', th: 'Cell', label: 'Label', h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading', p: 'Paragraph', img: 'Image', svg: 'Icon', input: 'Input', textarea: 'Text area', select: 'Select', hr: 'Divider', body: 'Page' };
  // utility / hashed class names make poor layer names
  const UTILITY = /^-?(p|m|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|w|h|min-w|max-w|min-h|max-h|size|gap|space|text|font|bg|border|rounded|shadow|flex|grid|col-span|row-span|grid-cols|items|justify|self|place|order|z|top|left|right|bottom|inset|leading|tracking|opacity|overflow|ring|transition|duration|ease|basis|grow|shrink|object|aspect|cursor|select|whitespace|fill|stroke|divide|backdrop|blur|translate|rotate|scale|origin|from|via|to|decoration|line-clamp|columns|js|is|has)-|^(flex|grid|block|inline|inline-block|inline-flex|hidden|relative|absolute|fixed|sticky|truncate|uppercase|lowercase|capitalize|italic|underline|antialiased|rounded|shadow|border|ring|transition|grow|shrink|mx-auto|sr-only|clearfix)$|[:[\]/.]|^(css|sc|jsx|svelte|emotion|chakra|mui|tw)-|^_|^[A-Za-z]{2,4}[0-9][A-Za-z0-9]{3,}$/;

  function nameFor(el, fallbackText) {
    const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria && tidy(aria)) return tidy(aria);
    if (el.id && !UTILITY.test(el.id)) return tidy(el.id);
    let cls = [...(el.classList || [])].find((c) => !UTILITY.test(c));
    if (cls) {
      cls = cls.replace(/-\d+$/, ''); // Folio's exporter numbers duplicate names ("card-2")
      const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const content = tidy(fallbackText);
      if (content && (/^l-/.test(cls) || slug(content).startsWith(cls))) return content.slice(0, 30).trim();
      const pretty = cls.replace(/[-_]+/g, ' ').trim();
      return tidy(pretty.charAt(0).toUpperCase() + pretty.slice(1));
    }
    if (el.localName === 'img' && el.getAttribute('alt')) return tidy(el.getAttribute('alt'));
    if (fallbackText && tidy(fallbackText)) return tidy(fallbackText).slice(0, 30).trim();
    return TAG_NAMES[el.localName] || (el.localName === 'div' || el.localName === 'span' ? 'Frame' : el.localName.charAt(0).toUpperCase() + el.localName.slice(1));
  }
  const genericName = (n) => /^(Frame|Group|Item|Text)$/.test(n);

  /** True when a family renders: a web font the page loaded, a Folio (Google) font, or installed locally. */
  const fontCache = new Map();
  function fontAvailable(f, doc) {
    if (GENERIC_FONTS[f.toLowerCase()] || (Folio.fonts && Folio.fonts.list.some((x) => x.family.toLowerCase() === f.toLowerCase()))) return true;
    if (doc.fonts && [...doc.fonts].some((ff) => ff.status === 'loaded' && ff.family.replace(/^['"]|['"]$/g, '').toLowerCase() === f.toLowerCase())) return true;
    if (!fontCache.has(f)) {
      ctx2d = ctx2d || document.createElement('canvas').getContext('2d');
      const w = (font) => ((ctx2d.font = font), ctx2d.measureText('mmmmmmmmmmlli1WQ@').width);
      fontCache.set(f, ['monospace', 'serif'].some((g) => w(`32px "${f}", ${g}`) !== w('32px ' + g)));
    }
    return fontCache.get(f);
  }

  function fontOf(cs, ctx) {
    const fams = splitTop(cs.fontFamily).map((f) => f.replace(/^['"]|['"]$/g, '').trim());
    const f = fams.find((x) => fontAvailable(x, ctx.doc)) || fams[0] || 'system-ui';
    const fam = GENERIC_FONTS[f.toLowerCase()] || f;
    ctx.fonts.add(fam);
    return fam;
  }

  function create(ctx) {
    const { win, doc } = ctx;
    const css = (el, pseudo) => win.getComputedStyle(el, pseudo);

    // ---------- measurement helpers ----------
    const rectOf = (r) => ({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
    const union = (rs) => ({ x0: Math.min(...rs.map((r) => r.x0)), y0: Math.min(...rs.map((r) => r.y0)), x1: Math.max(...rs.map((r) => r.x1)), y1: Math.max(...rs.map((r) => r.y1)) });
    const W = (r) => r.x1 - r.x0;
    const H = (r) => r.y1 - r.y0;
    const sides = (cs, p) => ['Top', 'Right', 'Bottom', 'Left'].map((s) => num(cs[p + s + (p === 'border' ? 'Width' : '')]));

    function isInlineText(el, cs) {
      if (REPLACED.has(el.localName) || el.hasAttribute('data-folio-embed')) return false;
      if (el.localName === 'br' || el.localName === 'wbr') return true;
      if (cs.display !== 'inline' || cs.position === 'absolute' || cs.position === 'fixed') return false;
      for (const c of el.childNodes) {
        if (c.nodeType !== 1) continue;
        const ccs = css(c);
        if (ccs.display === 'none') continue;
        if (!isInlineText(c, ccs)) return false;
      }
      return true;
    }

    /** Text of a run, whitespace collapsed the way CSS does it. */
    function textOf(nodes) {
      let out = '';
      const walk = (n) => {
        if (n.nodeType === 3) {
          const ws = css(n.parentElement).whiteSpace;
          let t = n.data;
          if (/^(normal|nowrap)$/.test(ws)) t = t.replace(/[ \t\n\r\f]+/g, ' ');
          else if (ws === 'pre-line') t = t.replace(/[ \t]+/g, ' ');
          out += t;
        } else if (n.nodeType === 1) {
          if (n.localName === 'br') out += '\n';
          else if (css(n).display !== 'none') n.childNodes.forEach(walk);
        }
      };
      nodes.forEach(walk);
      return out.replace(/ *\n */g, '\n').replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '');
    }

    /** Glyph rectangles of a run, plus how many lines it takes. */
    function textRects(nodes) {
      const rects = [];
      const range = doc.createRange();
      const walk = (n) => {
        if (n.nodeType === 3 && n.data.trim()) {
          range.selectNodeContents(n);
          [...range.getClientRects()].forEach((r) => r.width > 0 && rects.push(rectOf(r)));
        } else if (n.nodeType === 1) n.childNodes.forEach(walk);
      };
      nodes.forEach(walk);
      if (!rects.length) return null;
      const sorted = rects.slice().sort((a, b) => a.y0 - b.y0);
      const lines = [];
      sorted.forEach((r) => {
        const last = lines[lines.length - 1];
        if (last && r.y0 < last.y1 - 2 && r.y1 > last.y0 + 2) Object.assign(last, union([last, r]));
        else lines.push({ ...r });
      });
      return { box: union(rects), lines };
    }

    /** The element whose style the text of a run has: descend while one element holds all of it. */
    function styleHost(nodes, el) {
      const solid = (n) => (n.nodeType === 3 ? n.data.trim() : n.nodeType === 1 && n.localName !== 'br' && (n.textContent || '').trim());
      let list = nodes.filter(solid);
      let host = el;
      while (list.length === 1 && list[0].nodeType === 1) {
        host = list[0];
        list = [...host.childNodes].filter(solid);
      }
      return host;
    }

    function mixedStyles(nodes, cs) {
      const key = (s) => [s.fontWeight, s.fontStyle, s.color, s.fontSize, s.fontFamily, s.textDecorationLine].join('|');
      const base = key(cs);
      let mixed = false;
      const walk = (n) => {
        if (mixed || n.nodeType !== 1) return;
        if (n.localName !== 'br' && key(css(n)) !== base && (n.textContent || '').trim()) mixed = true;
        n.childNodes.forEach(walk);
      };
      nodes.forEach(walk);
      return mixed;
    }

    function textProps(cs, content) {
      const size = num(cs.fontSize) || 16;
      const lh = cs.lineHeight === 'normal' ? null : num(cs.lineHeight);
      const dec = String(cs.textDecorationLine || '');
      const align = { start: 'left', left: 'left', '-webkit-left': 'left', end: 'right', right: 'right', '-webkit-right': 'right', center: 'center', '-webkit-center': 'center', justify: 'justify' }[cs.textAlign] || 'left';
      return {
        content,
        font: fontOf(cs, ctx),
        size: r2(size),
        weight: Math.round(num(cs.fontWeight) || 400),
        lineHeight: lh ? r2(lh / size) : 1.2,
        letterSpacing: cs.letterSpacing === 'normal' ? 0 : r2(num(cs.letterSpacing) / size),
        color: color(cs.color) || '#00000000',
        align,
        transform: /^(uppercase|lowercase|capitalize)$/.test(cs.textTransform) ? cs.textTransform : 'none',
        italic: /italic|oblique/.test(cs.fontStyle),
        decoration: /underline/.test(dec) ? 'underline' : /line-through/.test(dec) ? 'line-through' : 'none',
      };
    }

    /** One text layer for a run of text (+ inline elements). r = its box; tr = glyph measurements. */
    function textLayer(nodes, cs, r, name, tr, opts = {}) {
      let content = textOf(nodes);
      if (opts.bullet) content = opts.bullet + content;
      const t = textProps(cs, content);
      const size = t.size;
      const lhPx = cs.lineHeight === 'normal' ? (tr.lines[0] ? H(tr.lines[0]) : size * 1.2) : num(cs.lineHeight);
      if (cs.lineHeight === 'normal') t.lineHeight = r2(lhPx / size);
      if (mixedStyles(nodes, cs)) ctx.warn('Mixed text styles inside one paragraph (bold words, links…) were flattened to one style.');
      const lines = tr.lines.length;
      const node = {
        type: 'text',
        name: name || t.content.slice(0, 30) || 'Text',
        width: up(W(r)),
        height: r1(H(r)),
        sizing: { w: 'fixed', h: 'fixed' },
        text: t,
        style: { shadows: shadows(cs.textShadow, true) },
      };
      return {
        node,
        r,
        text: true,
        wraps: lines > 1,
        hugW: lines === 1 && Math.abs(W(r) - W(tr.box)) <= TOL,
        hugH: Math.abs(H(r) - lines * lhPx) <= TOL + 1,
      };
    }

    /** Box styles shared by frames and images. fb = the Folio border width (0 when emulated). */
    function boxStyle(el, cs, r) {
      const w = W(r);
      const h = H(r);
      const bw = sides(cs, 'border');
      const bc = ['Top', 'Right', 'Bottom', 'Left'].map((s) => color(cs['border' + s + 'Color']));
      const bs = ['Top', 'Right', 'Bottom', 'Left'].map((s) => cs['border' + s + 'Style']);
      const vis = bw.map((v, i) => v > 0 && bc[i] && !/none|hidden/.test(bs[i]));
      const style = { fills: [], radius: 0, border: { width: 0, color: '#000000', style: 'solid' }, shadows: [], opacity: 1, blur: 0, backdropBlur: 0, blend: 'normal', clip: false, rotation: 0 };
      let fb = 0;
      const ins = [];
      if (vis.every(Boolean) && bw.every((v) => v === bw[0]) && bc.every((c) => c === bc[0]) && bs.every((s) => s === bs[0])) {
        fb = bw[0];
        style.border = { width: r1(fb), color: bc[0], style: /dashed|dotted/.test(bs[0]) ? bs[0] : 'solid' };
      } else if (vis.some(Boolean)) {
        // one-sided borders (a header's bottom line…) become inset shadows on those sides
        const dir = [[0, 1], [-1, 0], [0, -1], [1, 0]];
        vis.forEach((v, i) => v && ins.push({ x: dir[i][0] * bw[i], y: dir[i][1] * bw[i], blur: 0, spread: 0, color: bc[i], inset: true, visible: true }));
      }
      const corners = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((c) => {
        const v = String(cs['border' + c + 'Radius'] || '0').split(/\s+/)[0];
        return r1(v.endsWith('%') ? (num(v) / 100) * Math.min(w, h) : num(v));
      });
      style.radius = corners.every((c) => c === corners[0]) ? corners[0] : corners;
      style.shadows = ins.concat(shadows(cs.boxShadow));
      const op = num(cs.opacity);
      style.opacity = cs.opacity === '' ? 1 : r2(op);
      const fm = String(cs.filter).match(/blur\(([\d.]+)px\)/);
      if (fm) style.blur = num(fm[1]);
      const bm = String(cs.backdropFilter || cs.webkitBackdropFilter || '').match(/blur\(([\d.]+)px\)/);
      if (bm) style.backdropBlur = num(bm[1]);
      if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') style.blend = cs.mixBlendMode;
      style.clip = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
      return { style, fb };
    }

    /** Rotation from a transform matrix; layout size from offsetWidth/Height. */
    function geometry(el, cs) {
      const br = el.getBoundingClientRect();
      let r = rectOf(br);
      let rotation = 0;
      const m = String(cs.transform).match(/^matrix\(([^)]+)\)$/);
      if (m) {
        const [a, b] = m[1].split(',').map(Number);
        const deg = (Math.atan2(b, a) * 180) / Math.PI;
        if (Math.abs(deg) > 0.5 && el.offsetWidth) {
          rotation = r1(deg);
          const cx = (r.x0 + r.x1) / 2;
          const cy = (r.y0 + r.y1) / 2;
          r = { x0: cx - el.offsetWidth / 2, x1: cx + el.offsetWidth / 2, y0: cy - el.offsetHeight / 2, y1: cy + el.offsetHeight / 2 };
        }
      }
      return { r, rotation };
    }

    const visual = (st) =>
      st.fills.length || st.border.width || st.shadows.length || st.opacity < 1 || st.blur || st.backdropBlur || st.blend !== 'normal' || st.clip || st.rotation;

    // ---------- items of an element: child elements and runs of text ----------
    function itemsOf(el) {
      const out = [];
      let run = null;
      const flush = () => {
        const solid = run ? run.filter((n) => (n.nodeType === 3 ? n.data.trim() : (n.textContent || '').trim())) : [];
        // a row of spaced inline elements (nav links with margins/padding) stays separate layers
        const boxy = (n) => {
          const c = css(n);
          return num(c.marginLeft) || num(c.marginRight) || num(c.paddingLeft) || num(c.paddingRight) || color(c.backgroundColor) || num(c.borderLeftWidth);
        };
        if (solid.length > 1 && solid.every((n) => n.nodeType === 1 && n.localName !== 'br') && solid.some(boxy)) solid.forEach((n) => out.push({ el: n, cs: css(n) }));
        else if (solid.length) out.push({ run });
        run = null;
      };
      const visit = (parent) => {
        for (const n of parent.childNodes) {
          if (n.nodeType === 3) {
            (run = run || []).push(n);
            continue;
          }
          if (n.nodeType !== 1) continue;
          const cs = css(n);
          if (cs.display === 'none') continue;
          if (cs.display === 'contents') {
            flush();
            visit(n);
            flush();
            continue;
          }
          if (isInlineText(n, cs)) {
            (run = run || []).push(n);
            continue;
          }
          flush();
          out.push({ el: n, cs });
        }
      };
      visit(el);
      flush();
      return out;
    }

    // ---------- the element converter ----------
    function convert(el, cs, parentFlex) {
      if (ctx.full()) return null;
      const tag = el.localName;
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return ctx.skip('hidden'), null;
      const { r, rotation } = geometry(el, cs);
      if (W(r) < 0.5 && H(r) < 0.5) return ctx.skip('empty'), null;
      if ((W(r) <= 1 && H(r) <= 1 && cs.overflow !== 'visible') || /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip) || /inset\(50%\)/.test(cs.clipPath)) return ctx.skip('visually hidden'), null;
      if (num(cs.opacity) === 0) {
        if (!el.children.length) return ctx.skip('hidden'), null;
        ctx.warn('Some parts were invisible until a script would show them; they were imported visible.');
        cs = { ...cssObj(cs), opacity: '1' };
      }
      ['::before', '::after'].forEach((p) => {
        const c = css(el, p).content;
        if (c && c !== 'none' && c !== 'normal') ctx.skip('::before/::after decoration');
      });
      const margins = sides(cs, 'margin');
      const meta = {
        abs: cs.position === 'absolute' || cs.position === 'fixed',
        z: cs.zIndex === 'auto' ? 0 : num(cs.zIndex),
        grow: parentFlex ? num(cs.flexGrow) : 0,
        m: margins,
        rotation,
      };
      let k;
      if (tag === 'img' || tag === 'picture') k = imageLayer(tag === 'picture' ? el.querySelector('img') : el, el, cs, r);
      else if (tag === 'svg') k = svgLayer(el, cs, r);
      else if (el.hasAttribute('data-folio-embed')) k = embedLayer(el, cs, r);
      else if (/^(input|textarea|select)$/.test(tag)) k = fieldLayer(el, cs, r);
      else k = frameLayer(el, cs, r, parentFlex);
      if (!k) return null;
      Object.assign(k, meta);
      if (rotation) k.node.style = Object.assign(k.node.style || {}, { rotation });
      return k;
    }
    const cssObj = (cs) => {
      const o = {};
      for (let i = 0; i < cs.length; i++) o[cs[i].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = cs.getPropertyValue(cs[i]);
      ['display', 'position', 'visibility', 'overflow', 'overflowX', 'overflowY', 'flexGrow', 'zIndex'].forEach((p) => (o[p] = cs[p]));
      return o;
    };

    function imageLayer(img, el, cs, r) {
      if (!img) return null;
      const src = imageSrc(img.currentSrc || img.src, ctx);
      if (!src) return ctx.skip('image without a usable src'), null;
      const { style } = boxStyle(el, cs, r);
      const fit = { cover: 'cover', contain: 'contain', fill: 'fill', none: 'contain', 'scale-down': 'contain' }[css(img).objectFit] || 'fill';
      ctx.count++;
      return { node: { type: 'image', name: nameFor(img), width: up(W(r)), height: r1(H(r)), sizing: { w: 'fixed', h: 'fixed' }, image: { src, fit }, style } , r };
    }

    function svgLayer(el, cs, r) {
      const clone = el.cloneNode(true);
      // bake CSS paints into attributes, so the icon looks the same inside an <img>
      const live = [el, ...el.querySelectorAll('*')];
      const copies = [clone, ...clone.querySelectorAll('*')];
      const cur = color(cs.color) || '#000000';
      live.forEach((n, i) => {
        const c = copies[i];
        if (!c || !c.setAttribute) return;
        const s = css(n);
        if (s.display === 'none') return c.remove();
        ['fill', 'stroke'].forEach((p) => {
          const v = s[p];
          if (!v) return;
          if (/^url\(/.test(v)) return c.setAttribute(p, v.replace(/url\(\s*["']?[^#"')]*(#[^"')]+)["']?\s*\)/, 'url($1)'));
          c.setAttribute(p, v === 'none' ? 'none' : color(v) || 'none');
        });
        if (s.strokeWidth && s.stroke !== 'none') c.setAttribute('stroke-width', num(s.strokeWidth));
        if (s.opacity !== '1') c.setAttribute('opacity', s.opacity);
      });
      clone.setAttribute('width', r1(W(r)));
      clone.setAttribute('height', r1(H(r)));
      if (!clone.getAttribute('viewBox') && el.viewBox && el.viewBox.baseVal && el.viewBox.baseVal.width) {
        const v = el.viewBox.baseVal;
        clone.setAttribute('viewBox', `${v.x} ${v.y} ${v.width} ${v.height}`);
      }
      const markup = new XMLSerializer().serializeToString(clone).replace(/currentColor/gi, cur);
      let svg;
      try {
        svg = Folio.svg.sanitize(markup).svg;
      } catch (e) {
        ctx.skip('SVG that could not be read');
        return null;
      }
      const { style } = boxStyle(el, cs, r);
      ctx.count++;
      return { node: { type: 'image', name: nameFor(el), width: up(W(r)), height: r1(H(r)), sizing: { w: 'fixed', h: 'fixed' }, image: { src: Folio.svg.toDataUrl(svg), fit: 'contain' }, style }, r };
    }

    function embedLayer(el, cs, r) {
      const kind = el.getAttribute('data-folio-embed');
      const { style } = boxStyle(el, cs, r);
      let poster = '';
      try {
        poster = el.getAttribute('data-folio-poster') ? imageSrc(new URL(el.getAttribute('data-folio-poster'), doc.baseURI).href, ctx) : '';
      } catch (e) {
        /* bad URL: no poster */
      }
      style.fills = style.fills.length ? style.fills : [{ type: 'solid', color: kind === 'video' ? '#000000' : '#e5e5ea', visible: true }];
      if (poster) style.fills.push({ type: 'image', src: poster, fit: 'cover', visible: true });
      ctx.skip(kind === 'video' ? 'video (placeholder)' : kind === 'canvas' ? 'canvas (placeholder)' : 'embedded frame (placeholder)');
      ctx.count++;
      const name = { video: 'Video', canvas: 'Canvas' }[kind] || 'Embed';
      return { node: { type: 'frame', name, width: up(W(r)), height: r1(H(r)), sizing: { w: 'fixed', h: 'fixed' }, layout: { mode: 'flex', direction: 'column', padding: [0, 0, 0, 0] }, style }, r };
    }

    function fieldLayer(el, cs, r) {
      const type = (el.getAttribute('type') || '').toLowerCase();
      let label = '';
      let tcs = cs;
      if (el.localName === 'select') label = (el.selectedOptions && el.selectedOptions[0] && el.selectedOptions[0].textContent) || '';
      else if (/^(checkbox|radio|range|color|file|hidden)$/.test(type)) label = '';
      else {
        label = el.value || '';
        if (!label && el.getAttribute('placeholder')) {
          label = el.getAttribute('placeholder');
          tcs = { ...cssObj(cs), color: css(el, '::placeholder').color };
        }
      }
      const { style, fb } = boxStyle(el, cs, r);
      const pad = sides(cs, 'padding').map((p, i) => r1(p + sides(cs, 'border')[i] - fb));
      ctx.count++;
      const node = { type: 'frame', name: nameFor(el), width: up(W(r)), height: r1(H(r)), sizing: { w: 'fixed', h: 'fixed' }, layout: { mode: 'flex', direction: 'row', gap: 0, justify: 'flex-start', align: 'center', padding: pad }, style, children: [] };
      if (label.trim()) {
        const t = textProps(tcs, label.replace(/\s+/g, ' ').trim());
        node.children.push({ type: 'text', name: label.trim().slice(0, 30), sizing: { w: 'fill', h: 'hug' }, width: 100, height: 20, text: t });
        ctx.count++;
      }
      return { node, r };
    }

    // ---------- frames ----------
    function frameLayer(el, cs, r, parentFlex, opts = {}) {
      const items = itemsOf(el);
      const { style, fb } = boxStyle(el, cs, r);
      const bw = sides(cs, 'border');
      const cssPad = sides(cs, 'padding').map((p, i) => p + bw[i] - fb); // emulated borders count as padding
      const isFlex = /flex/.test(cs.display);
      const isGrid = /grid/.test(cs.display);

      // a text-only element without a box of its own is just a text layer
      const onlyRun = items.length === 1 && items[0].run;
      if (onlyRun && !opts.frame && !visual(style) && cssPad.every((p) => p < 0.5)) {
        const tr = textRects(items[0].run);
        if (!tr) return ctx.skip('empty'), null;
        ctx.count++;
        const bullet = cs.display === 'list-item' && !/none/.test(cs.listStyleType) && cs.listStyleImage === 'none' ? (/decimal/.test(cs.listStyleType) ? [...el.parentElement.children].indexOf(el) + 1 + '. ' : '• ') : '';
        return textLayer(items[0].run, css(styleHost(items[0].run, el)), r, nameFor(el, textOf(items[0].run)), tr, { bullet });
      }

      if (ctx.full()) return null;
      ctx.count++;
      const node = {
        type: 'frame',
        name: opts.name || nameFor(el),
        width: up(W(r)),
        height: r1(H(r)),
        sizing: { w: 'fixed', h: 'fixed' },
        style,
        children: [],
      };
      style.fills = fillsOf(cs, W(r), H(r), ctx);

      // the children
      const kids = [];
      items.forEach((it) => {
        if (it.run) {
          const tr = textRects(it.run);
          if (!tr || ctx.full()) return;
          const tcs = css(styleHost(it.run, el));
          const lh = tcs.lineHeight === 'normal' ? H(tr.lines[0]) : num(tcs.lineHeight);
          const first = tr.lines[0];
          const last = tr.lines[tr.lines.length - 1];
          const rr = { x0: tr.box.x0, x1: tr.box.x1, y0: (first.y0 + first.y1) / 2 - lh / 2, y1: (last.y0 + last.y1) / 2 + lh / 2 };
          ctx.count++;
          const k = textLayer(it.run, tcs, rr, null, tr);
          k.hugW = tr.lines.length === 1;
          k.hugH = true;
          k.anon = !isFlex && !isGrid;
          k.m = [0, 0, 0, 0];
          kids.push(k);
          return;
        }
        const k = convert(it.el, it.cs, isFlex);
        if (k) kids.push(k);
      });

      const box = { x0: r.x0 + fb, y0: r.y0 + fb, x1: r.x1 - fb, y1: r.y1 - fb }; // padding box
      const cb = { x0: box.x0 + cssPad[3], y0: box.y0 + cssPad[0], x1: box.x1 - cssPad[1], y1: box.y1 - cssPad[2] };
      const flow = kids.filter((k) => !k.abs);
      const abs = kids.filter((k) => k.abs);
      const hint = {
        flex: isFlex,
        grid: isGrid,
        dir: isFlex ? (/column/.test(cs.flexDirection) ? 'column' : 'row') : null,
        wrap: isFlex && cs.flexWrap !== 'nowrap',
        gap: isFlex || isGrid ? (/column/.test(cs.flexDirection) ? num(cs.rowGap) : num(cs.columnGap)) : 0,
        justify: cs.justifyContent,
        align: cs.alignItems,
        textAlign: cs.textAlign,
      };
      const L = layoutFlow(flow, cb, hint, 0);
      const padding = cssPad.map((p, i) => r1(Math.max(0, p + L.pad[i])));

      if (abs.length || !L.ok) {
        // freeform: absolutely positioned children keep their measured place
        const place = (k) => {
          k.node.x = r1(k.r.x0 - box.x0);
          k.node.y = r1(k.r.y0 - box.y0);
          k.node.sizing = { w: k.hugW && !k.wraps ? 'hug' : 'fixed', h: k.hugH ? 'hug' : 'fixed' };
          return k.node;
        };
        const free = L.ok ? abs : kids;
        const behind = free.filter((k) => k.z < 0).sort((a, b) => a.z - b.z).map(place);
        const front = free.filter((k) => k.z >= 0).sort((a, b) => a.z - b.z).map(place);
        let inner = [];
        if (L.ok && flow.length) {
          ctx.count++;
          inner = [{ type: 'frame', name: 'Content', x: 0, y: 0, width: up(W(box)), height: r1(H(box)), sizing: { w: 'fill', h: 'fill' }, style: { fills: [] }, layout: { ...L.layout, padding }, children: L.children }];
        }
        if (!L.ok) ctx.warn('Overlapping layers were placed freely (no auto layout) where they overlap.');
        node.layout = { mode: 'none', direction: 'column', padding: [0, 0, 0, 0] };
        node.children = [...behind, ...inner, ...front];
        return { node, r, hugW: false, hugH: false, fluid: false, wraps: false };
      }

      node.layout = { ...L.layout, padding };
      node.children = L.children;
      const k = { node, r, fluid: L.fluid, hugW: !L.fluid && (L.dir === 'row' ? L.hugMain : L.hugCross), hugH: L.dir === 'row' ? L.hugCross : L.hugMain };
      if (!flow.length) k.hugW = k.hugH = false; // an empty box keeps its size

      // collapse pure wrappers into their only child
      if (!opts.frame && flow.length === 1 && !visual(style) && padding.every((p) => p < 0.5)) {
        const c = flow[0];
        const same = Math.abs(c.r.x0 - r.x0) <= 1 && Math.abs(c.r.x1 - r.x1) <= 1 && Math.abs(c.r.y0 - r.y0) <= 1 && Math.abs(c.r.y1 - r.y1) <= 1;
        if (same && L.children.length === 1) {
          ctx.count--;
          if (genericName(c.node.name) && !genericName(node.name)) c.node.name = node.name;
          return c;
        }
      }
      return k;
    }

    /**
     * Lay out in-flow children inside the content box cb. Returns the Folio layout, the child nodes (with
     * sizing decided), extra padding [t,r,b,l] on top of the CSS padding, and whether the box can hug.
     */
    function layoutFlow(kids, cb, hint, depth) {
      const res = { ok: true, layout: { mode: 'flex', direction: 'column', wrap: false, gap: 0, justify: 'flex-start', align: 'flex-start' }, children: [], pad: [0, 0, 0, 0], hugMain: true, hugCross: false, fluid: false, dir: 'column' };
      if (!kids.length) return res;
      const noOverlap = (list, a0, a1) => list.every((k, i) => i === 0 || k.r[a0] >= list[i - 1].r[a1] - TOL);
      const byX = kids.slice().sort((a, b) => a.r.x0 - b.r.x0);
      const byY = kids.slice().sort((a, b) => a.r.y0 - b.r.y0);
      const rowOk = noOverlap(byX, 'x0', 'x1');
      const colOk = noOverlap(byY, 'y0', 'y1');
      let dir = hint.dir;
      let wrap = false;
      let lines = null;
      if (dir === 'row' && !rowOk) dir = null;
      if (dir === 'column' && !colOk) dir = null;
      if (hint.wrap && dir === 'row') dir = null; // re-detect lines below
      if (!dir) {
        if (kids.length === 1) dir = hint.dir || 'column';
        else if (colOk && !(hint.dir === 'row' && rowOk)) dir = 'column';
        else if (rowOk) dir = 'row';
        else {
          // several lines of items side by side: a wrapping row
          lines = [];
          byY.forEach((k) => {
            const line = lines.find((l) => k.r.y0 < l.y1 - TOL && k.r.y1 > l.y0 + TOL);
            if (line) {
              line.items.push(k);
              line.y0 = Math.min(line.y0, k.r.y0);
              line.y1 = Math.max(line.y1, k.r.y1);
            } else lines.push({ items: [k], y0: k.r.y0, y1: k.r.y1 });
          });
          lines.forEach((l) => l.items.sort((a, b) => a.r.x0 - b.r.x0));
          const okLines = lines.every((l) => noOverlap(l.items, 'x0', 'x1')) && lines.every((l, i) => i === 0 || l.y0 >= lines[i - 1].y1 - TOL);
          if (!okLines) return { ...res, ok: false };
          dir = 'row';
          wrap = true;
        }
      }
      res.dir = dir;
      const row = dir === 'row';
      const [m0, m1, c0, c1] = row ? ['x0', 'x1', 'y0', 'y1'] : ['y0', 'y1', 'x0', 'x1'];
      const [mi0, mi1] = row ? [3, 1] : [0, 2]; // margin indexes along the main axis
      const pi = row ? [3, 1, 0, 2] : [0, 2, 3, 1]; // padding indexes: main start, main end, cross start, cross end
      let seq = wrap ? lines.flatMap((l) => l.items) : (row ? byX : byY);
      const justifyCss = /space-(between|around|evenly)/.test(hint.justify) ? 'space-between' : /center/.test(hint.justify) ? 'center' : /end|right/.test(hint.justify) ? 'flex-end' : 'flex-start';

      // ---- main axis: gaps, spacers, groups ----
      let items = seq;
      let gap = 0;
      let justify = 'flex-start';
      if (wrap) {
        const g = lines.flatMap((l) => l.items.slice(1).map((k, i) => k.r.x0 - l.items[i].r.x1));
        gap = g.length ? median(g) : hint.gap;
        const lg = lines.slice(1).map((l, i) => l.y0 - lines[i].y1);
        if (lg.length && Math.abs(median(lg) - gap) > TOL) ctx.warn('Grid row and column gaps differ; Folio uses one gap for both.');
        if (hint.grid) ctx.warn('CSS grid was approximated with a wrapping auto layout row.');
        const L0 = lines[0].items[0].r.x0 - cb.x0;
        const T0 = cb.x1 - lines[0].items[lines[0].items.length - 1].r.x1;
        justify = Math.abs(L0 - T0) <= TOL && L0 > TOL ? 'center' : T0 <= TOL && L0 > TOL ? 'flex-end' : 'flex-start';
        res.hugMain = false;
      } else {
        const gaps = seq.slice(1).map((k, i) => k.r[m0] - seq[i].r[m1]);
        const lead = seq[0].r[m0] - cb[m0];
        const trail = cb[m1] - seq[seq.length - 1].r[m1];
        const flexLike = hint.flex && dir === hint.dir;
        if (flexLike && justifyCss === 'space-between' && seq.length > 1) {
          justify = 'space-between';
          gap = Math.max(0, hint.gap);
          res.pad[pi[0]] = Math.max(0, lead);
          res.pad[pi[1]] = Math.max(0, trail);
          res.hugMain = false;
        } else if (flexLike && justifyCss !== 'flex-start' && gaps.every((g) => Math.abs(g - (gaps[0] || 0)) <= TOL)) {
          justify = justifyCss;
          gap = Math.max(0, gaps.length ? median(gaps) : 0);
          res.hugMain = lead <= TOL && trail <= TOL;
        } else {
          const centered = !hint.flex && row && /center/.test(hint.textAlign) && Math.abs(lead - trail) <= TOL && lead > TOL;
          justify = centered ? 'center' : 'flex-start';
          if (!centered) res.pad[pi[0]] = Math.max(0, lead);
          const last = seq[seq.length - 1];
          res.hugMain = !centered && trail <= Math.max(0, last.m[mi1]) + TOL;
          if (res.hugMain) res.pad[pi[1]] = Math.max(0, trail);
          // auto margins in a flex row (logo … links): a Spacer that fills
          const base = flexLike ? hint.gap : null;
          const spacerAt = new Set();
          if (base != null && trail <= TOL) gaps.forEach((g, i) => g - base > 4 && seq[i].m[mi1] + seq[i + 1].m[mi0] >= g - base - TOL && spacerAt.add(i));
          const g2 = gaps.map((g, i) => (spacerAt.has(i) ? base : g));
          const st = stack(seq, g2, row, cb, depth);
          items = st.items;
          gap = st.gap;
          if (spacerAt.size) {
            // re-insert spacers between the original neighbours (they are top-level items after stacking)
            const out = [];
            items.forEach((it, j) => {
              out.push(it);
              const lastKid = it.members ? it.members[it.members.length - 1] : it;
              const idx = seq.indexOf(lastKid);
              if (spacerAt.has(idx) && j < items.length - 1) {
                ctx.count++;
                out.push({ spacer: true, node: { type: 'frame', name: 'Spacer', width: 1, height: 1, style: { fills: [] }, layout: { mode: 'flex', direction: row ? 'row' : 'column', padding: [0, 0, 0, 0] }, sizing: { w: row ? 'fill' : 'hug', h: row ? 'hug' : 'fill' } } });
              }
            });
            items = out;
          }
        }
      }

      // ---- cross axis: alignment ----
      const classify = (k) => {
        if (k.anon && !row) return 'full';
        const s = k.r[c0] - cb[c0];
        const e = cb[c1] - k.r[c1];
        if (s <= 1 && e <= 1) return 'full';
        if (s <= 1) return 'flex-start';
        if (e <= 1) return 'flex-end';
        if (Math.abs(s - e) <= TOL) return 'center';
        return 'other';
      };
      const real = items.filter((k) => !k.spacer);
      const cls = real.map(classify);
      const votes = {};
      cls.forEach((c) => c !== 'full' && c !== 'other' && (votes[c] = (votes[c] || 0) + 1));
      const cssAlign = /center/.test(hint.align) ? 'center' : /end/.test(hint.align) ? 'flex-end' : 'flex-start';
      let align = Object.keys(votes).sort((a, b) => votes[b] - votes[a] || (b === cssAlign) - (a === cssAlign))[0] || cssAlign;
      if (wrap) align = 'flex-start';

      // ---- children: sizing (+ a wrapper for the odd one out) ----
      const ax = row ? ['w', 'h'] : ['h', 'w'];
      // in a row, a full-height child with its own size (no hug) is stretched only when a sibling sets the height
      const definer = real.some((k, i) => cls[i] === 'full' && (row ? k.hugH : k.hugW));
      res.children = items.map((k, i) => {
        if (k.spacer) return k.node;
        const c = wrap ? 'flex-start' : classify(k);
        const hugM = row ? k.hugW : k.hugH;
        const hugC = row ? k.hugH : k.hugW;
        const sz = {};
        sz[ax[0]] = hint.flex && k.grow > 0 && !wrap ? 'fill' : hugM ? 'hug' : 'fixed';
        sz[ax[1]] = c === 'full' ? (hugC && !k.anon ? 'hug' : row && !definer ? 'fixed' : 'fill') : hugC ? 'hug' : 'fixed';
        if (k.text && sz.w === 'hug' && k.wraps) sz.w = 'fixed';
        k.node.sizing = sz;
        if (wrap) k.node.width = Math.floor(W(k.r) * 10) / 10; // rounding up could push the last item to the next line
        // this box can hug its cross axis when a child with its own (non-fill) size spans it
        if ((sz[ax[1]] !== 'fill' || (k.anon && !k.wraps)) && k.r[c0] - cb[c0] + cb[c1] - k.r[c1] <= TOL) res.hugCross = true;
        if (sz[ax[0]] === 'fill') res.hugMain = false; // a child that grows needs a box that doesn't hug
        if ((k.wraps && sz.w === 'fill') || (k.fluid && sz.w !== 'fixed')) res.fluid = true;
        if (c === 'full' || c === align) return k.node;
        // misaligned: a transparent wrapper that fills the cross axis and aligns this one child
        ctx.count++;
        const pad = [0, 0, 0, 0];
        let a = c;
        if (c === 'other') {
          a = 'flex-start';
          pad[pi[2]] = r1(k.r[c0] - cb[c0]);
        }
        const wsz = {};
        wsz[ax[0]] = 'hug';
        wsz[ax[1]] = 'fill';
        return { type: 'frame', name: k.node.name, width: up(row ? W(k.r) : W(cb)), height: r1(row ? H(cb) : H(k.r)), sizing: wsz, style: { fills: [] }, layout: { mode: 'flex', direction: dir, wrap: false, gap: 0, justify: 'flex-start', align: a, padding: pad }, children: [k.node] };
      });
      res.layout = { mode: 'flex', direction: dir, wrap: wrap || (!!hint.wrap && row), gap: r1(Math.max(0, gap)), justify, align };
      return res;
    }

    const median = (a) => {
      const s = a.slice().sort((x, y) => x - y);
      return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
    };

    /** Unequal gaps → nested groups (the biggest gap separates groups), like a designer would nest auto layouts. */
    function stack(seq, gaps, row, cb, depth) {
      if (seq.length < 2) return { items: seq, gap: 0 };
      const max = Math.max(...gaps);
      const min = Math.min(...gaps);
      if (max - min <= TOL) return { items: seq, gap: Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) };
      if (depth >= 3 || ctx.full()) {
        ctx.warn('Some uneven spacing was evened out.');
        return { items: seq, gap: min };
      }
      const groups = [[seq[0]]];
      gaps.forEach((g, i) => (g >= max - TOL ? groups.push([seq[i + 1]]) : groups[groups.length - 1].push(seq[i + 1])));
      const items = groups.map((g) => {
        if (g.length === 1) return g[0];
        ctx.count++;
        const u = union(g.map((k) => k.r));
        const gcb = row ? { x0: u.x0, x1: u.x1, y0: cb.y0, y1: cb.y1 } : { x0: cb.x0, x1: cb.x1, y0: u.y0, y1: u.y1 };
        const L = layoutFlow(g, gcb, { dir: row ? 'row' : 'column' }, depth + 1);
        const node = { type: 'frame', name: 'Group', width: up(W(gcb)), height: r1(H(gcb)), style: { fills: [] }, layout: { ...L.layout, padding: L.pad.map(r1) }, children: L.children, sizing: { w: 'fixed', h: 'fixed' } };
        return { node, r: gcb, members: g, hugW: row ? true : !L.fluid && L.hugCross, hugH: row ? L.hugCross : true, fluid: L.fluid, m: [0, 0, 0, 0], text: false };
      });
      return { items, gap: max };
    }

    return { convert, frameLayer, rectOf, layoutFlow, itemsOf, W, H, sides };
  }

  /** Remove measurement data, keeping plain Folio trees. */
  const strip = (n) => {
    if (n.children) n.children.forEach(strip);
    return n;
  };

  // =====================================================================
  // 5. Public API
  // =====================================================================
  async function fromHtml(html, opts = {}) {
    const store = Folio.store;
    if (typeof html !== 'string' || !html.trim()) throw new Error('No HTML was given.');
    const bytes = new Blob([html]).size;
    if (bytes > MAX_BYTES) throw new Error(`That HTML is too large (${(bytes / 1048576).toFixed(1)} MB; the limit is 3 MB).`);
    const width = Math.max(100, Math.min(4000, Math.round(Number(opts.width) || 1440)));
    const parent = opts.parentId ? store.get(opts.parentId) : null;
    if (opts.parentId && (!parent || parent.type !== 'frame')) throw new Error('parent_id must be an existing frame.');
    if (opts.pageId && !store.page(opts.pageId)) throw new Error('Unknown page "' + opts.pageId + '".');

    const { markup, title } = sanitize(html, opts.baseUrl);
    const frame = await render(markup, width);
    const warnings = new Set();
    const skipped = {};
    const ctx = {
      win: frame.contentWindow,
      doc: frame.contentDocument,
      count: 0,
      fonts: new Set(),
      warn: (m) => warnings.add(m),
      skip: (why) => (skipped[why] = (skipped[why] || 0) + 1),
      full() {
        if (this.count < MAX_LAYERS) return false;
        warnings.add(`Stopped at ${MAX_LAYERS.toLocaleString('en-US')} layers; the rest of the page was left out.`);
        return true;
      },
    };
    let k;
    try {
      const { doc, win } = ctx;
      if (!doc || !doc.body) throw new Error('The HTML could not be rendered.');
      const C = create(ctx);
      let el = doc.body;
      if (opts.selector) {
        try {
          el = doc.querySelector(opts.selector);
        } catch (e) {
          throw new Error('That selector is not valid CSS: ' + opts.selector);
        }
        if (!el) throw new Error('Nothing in the HTML matches the selector ' + opts.selector + '.');
      }
      const cs = win.getComputedStyle(el);
      const isBody = el === doc.body;
      let r = C.rectOf(el.getBoundingClientRect());
      if (isBody) {
        // the artboard is the whole viewport: body margins become padding
        const m = C.sides(cs, 'margin');
        r = { x0: 0, y0: 0, x1: width, y1: Math.max(r.y1 + m[2], 1) };
        const proxy = bodyProxy(cs, win.getComputedStyle(doc.documentElement), m, C.sides(cs, 'padding'), C.sides(cs, 'border'), el.getBoundingClientRect(), width);
        k = C.frameLayer(el, proxy, r, false, { frame: true, name: opts.name || title || 'Imported page' });
      } else {
        k = C.frameLayer(el, cs, r, false, { frame: true, name: opts.name || title || 'Imported page' });
      }
      if (!k) throw new Error('Nothing visible to import.');
      // the artboard: fixed width, hug height (freeform artboards keep their measured height)
      const root = k.node;
      root.sizing = { w: 'fixed', h: root.layout.mode === 'flex' && k.hugH ? 'hug' : 'fixed' };
      if (!parent) {
        if (!root.style.fills.length) {
          // a transparent element keeps the colour it was drawn on
          let a = el.parentElement;
          let bg = null;
          while (a && !bg) {
            bg = color(win.getComputedStyle(a).backgroundColor);
            a = a.parentElement;
          }
          root.style.fills = [{ type: 'solid', color: bg || '#ffffff', visible: true }];
        }
        root.style.clip = true;
      }
    } finally {
      frame.remove();
    }

    const tree = strip(k.node);
    ctx.fonts.forEach((f) => Folio.fonts && Folio.fonts.ensure(f));
    const build = () => {
      if (parent) {
        if (parent.layout && parent.layout.mode !== 'flex') {
          tree.x = Math.round(Number(opts.x) || 0);
          tree.y = Math.round(Number(opts.y) || 0);
        }
        return store.buildFromTree(tree, parent.id);
      }
      const spot = Number.isFinite(opts.x) && Number.isFinite(opts.y) ? { x: opts.x, y: opts.y } : nextSpot();
      tree.x = Math.round(spot.x);
      tree.y = Math.round(spot.y);
      return store.buildFromTree(tree, null);
    };
    const node = opts.pageId && !parent ? store.withPage(opts.pageId, build) : build();
    const count = 1 + store.descendants(node.id).length;
    return { rootId: node.id, count, warnings: [...warnings], skipped };
  }

  /**
   * The body as the artboard: a computed-style stand-in whose padding includes the body's margin, and
   * whose background is the canvas background (html's when it has one, else body's — as CSS paints it).
   */
  function bodyProxy(cs, htmlCs, m, pad, bw, br, width) {
    const p = {};
    for (let i = 0; i < cs.length; i++) p[cs[i].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = cs.getPropertyValue(cs[i]);
    ['display', 'position', 'visibility', 'overflow', 'overflowX', 'overflowY', 'flexGrow', 'zIndex', 'textAlign', 'alignItems', 'justifyContent', 'flexDirection', 'flexWrap', 'rowGap', 'columnGap'].forEach((k) => (p[k] = cs[k]));
    const right = width - br.right;
    p.paddingTop = br.top + pad[0] + bw[0] + 'px'; // (the body's top margin may collapse with its first child's)
    p.paddingRight = Math.max(0, right) + pad[1] + bw[1] + 'px';
    p.paddingBottom = m[2] + pad[2] + bw[2] + 'px';
    p.paddingLeft = br.left + pad[3] + bw[3] + 'px';
    ['Top', 'Right', 'Bottom', 'Left'].forEach((s) => (p['border' + s + 'Width'] = '0px'));
    p.boxShadow = 'none';
    p.overflow = p.overflowX = p.overflowY = 'visible';
    p.borderTopLeftRadius = p.borderTopRightRadius = p.borderBottomLeftRadius = p.borderBottomRightRadius = '0px';
    const htmlBg = color(htmlCs.backgroundColor) || (htmlCs.backgroundImage && htmlCs.backgroundImage !== 'none');
    if (htmlBg) {
      p.backgroundColor = htmlCs.backgroundColor;
      p.backgroundImage = htmlCs.backgroundImage;
      p.backgroundSize = htmlCs.backgroundSize;
      p.backgroundRepeat = htmlCs.backgroundRepeat;
    }
    p.opacity = '1';
    p.filter = 'none';
    return p;
  }

  /** Right of the artboards on the current (or bound) page, top-aligned with the first. */
  function nextSpot() {
    const store = Folio.store;
    const roots = store.doc.roots.filter((id) => store.get(id));
    if (!roots.length) return { x: 0, y: 0 };
    const rect = (id) => {
      const r = Folio.canvas && Folio.canvas.nodeRect && Folio.canvas.nodeRect(id);
      const n = store.get(id);
      return r && r.width ? r : { x: n.x, y: n.y, width: n.width, height: n.height };
    };
    const rs = roots.map(rect);
    return { x: Math.max(...rs.map((r) => r.x + r.width)) + 120, y: rs[0].y };
  }

  // =====================================================================
  // 6. UI: commit once, select, zoom; the modal; clipboard paste
  // =====================================================================
  const { h, toast } = Folio.ui;

  function summary(res) {
    const skipped = Object.entries(res.skipped).map(([why, n]) => `${n} × ${why}`);
    return { text: `Imported ${res.count.toLocaleString('en-US')} layer${res.count === 1 ? '' : 's'}.`, notes: [...res.warnings, ...(skipped.length ? ['Left out: ' + skipped.join(', ') + '.'] : [])] };
  }

  /** Import, commit one undo step, select (and zoom to a new artboard). */
  async function run(html, opts, label) {
    const store = Folio.store;
    const res = await fromHtml(html, opts);
    store.select([res.rootId]);
    store.commit(label || 'Import HTML');
    if (!opts.parentId && Folio.canvas && Folio.canvas.zoomToFit) requestAnimationFrame(() => Folio.canvas.zoomToFit([res.rootId]));
    return res;
  }

  /** Clipboard HTML → layers in the selected frame (or a new artboard). */
  async function pasteHtml(html, o = {}) {
    const store = Folio.store;
    if (!html && o.text && /<[a-z!][\s\S]*>/i.test(o.text)) html = o.text;
    if (!html && navigator.clipboard && navigator.clipboard.read) {
      try {
        for (const item of await navigator.clipboard.read()) {
          if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
          if (html) break;
        }
      } catch (e) {
        /* no permission: fall through */
      }
    }
    if (!html) return toast('The clipboard has no HTML to import. Copy part of a web page, or use File → Import HTML…'), null;
    const p = store.primary();
    let parentId = p ? (p.type === 'frame' ? p.id : p.parent) : null;
    const KP = Folio.componentsPanel;
    if (parentId && ((KP && KP.inInstance && KP.inInstance(parentId)) || store.get(parentId).instance)) parentId = null;
    let width = 1440;
    if (parentId) {
      const pn = store.get(parentId);
      const el = Folio.render && Folio.render.el && Folio.render.el(parentId);
      const pad = (pn.layout && pn.layout.padding) || [0, 0, 0, 0];
      width = Math.max(100, Math.round((el ? el.clientWidth : pn.width) - pad[1] - pad[3]));
    }
    toast('Importing…');
    try {
      const res = await run(html, { parentId, width, name: 'Pasted HTML' }, 'Paste HTML');
      const s = summary(res);
      toast(s.text + (s.notes.length ? ' ' + s.notes[0] : ''), 'success');
      return res;
    } catch (e) {
      toast(e.message || 'Could not import that HTML.', 'error');
      return null;
    }
  }

  // ---------- the modal ----------
  let modal = null;
  const WIDTHS = [
    ['Desktop', 1440],
    ['Laptop', 1280],
    ['Tablet', 768],
    ['Mobile', 390],
  ];

  function close() {
    if (!modal) return;
    modal.remove();
    modal = null;
  }

  function open() {
    if (modal) return;
    let width = 1440;
    let fileName = '';
    const code = h('textarea', { class: 'f-input im-code', spellcheck: false, placeholder: '<!doctype html>\n<html>…paste HTML (with its <style>) here…</html>', 'aria-label': 'HTML code' });
    const base = h('input', { class: 'f-input', type: 'url', placeholder: 'https://example.com/ (optional, for relative images and styles)', 'aria-label': 'Base URL' });
    const seg = h(
      'div',
      { class: 'f-seg', role: 'group', 'aria-label': 'Width' },
      WIDTHS.map(([label, w]) => {
        const b = h('button', { type: 'button', class: w === width ? 'is-active' : '', 'aria-pressed': String(w === width), title: w + ' px' }, `${label} ${w}`);
        b.addEventListener('click', () => {
          width = w;
          [...seg.children].forEach((c) => {
            c.classList.toggle('is-active', c === b);
            c.setAttribute('aria-pressed', String(c === b));
          });
        });
        return b;
      })
    );
    const status = h('div', { class: 'im-status f-hint', role: 'status', 'aria-live': 'polite' });
    const file = h('input', { type: 'file', accept: '.html,.htm,text/html', style: { display: 'none' } });
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      if (f.size > MAX_BYTES) return (status.textContent = 'That file is larger than 3 MB.');
      f.text().then((t) => {
        code.value = t;
        fileName = f.name.replace(/\.html?$/i, '');
        status.textContent = `Loaded ${f.name}. Press Import.`;
      });
    });
    const openBtn = h('button', { type: 'button', class: 'f-btn' }, Folio.icons.el('folder', 14), h('span', {}, 'Open .html file'));
    openBtn.addEventListener('click', () => file.click());
    const go = h('button', { type: 'button', class: 'f-btn f-btn--primary' }, 'Import');
    const x = h('button', { type: 'button', class: 'f-btn f-btn--ghost f-btn--icon', 'aria-label': 'Close' }, Folio.icons.el('x', 14));
    x.addEventListener('click', close);
    go.addEventListener('click', async () => {
      if (!code.value.trim()) return (status.textContent = 'Paste some HTML first, or open an .html file.'), code.focus();
      go.disabled = true;
      status.textContent = 'Importing… (rendering the page, waiting for fonts and images)';
      try {
        const res = await run(code.value, { width, baseUrl: base.value.trim() || undefined, name: fileName || undefined });
        const s = summary(res);
        if (!s.notes.length) {
          close();
          return toast(s.text, 'success');
        }
        status.replaceChildren(h('strong', {}, s.text), h('ul', { class: 'im-notes' }, s.notes.map((n) => h('li', {}, n))));
        go.textContent = 'Import again';
      } catch (e) {
        status.textContent = e.message || 'Could not import that HTML.';
      } finally {
        go.disabled = false;
      }
    });
    modal = h(
      'div',
      { class: 'f-modal-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Import HTML' },
      h(
        'div',
        { class: 'f-modal im-modal' },
        h('div', { class: 'f-modal__head' }, h('h2', {}, 'Import HTML'), x),
        h(
          'div',
          { class: 'f-modal__body im-body' },
          h('p', { class: 'f-hint' }, 'Paste a page or a snippet (HTML with its CSS). It becomes editable layers with auto layout. Scripts never run, so pages built by JavaScript may come in nearly empty.'),
          code,
          h('div', { class: 'im-row' }, openBtn, file),
          h('label', { class: 'f-label' }, 'Width'),
          seg,
          h('label', { class: 'f-label' }, 'Base URL'),
          base,
          status
        ),
        h('div', { class: 'f-modal__foot im-foot' }, h('button', { type: 'button', class: 'f-btn f-btn--ghost', onclick: close }, 'Cancel'), go)
      )
    );
    modal.addEventListener('pointerdown', (e) => e.target === modal && close());
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go.click();
    });
    document.body.appendChild(modal);
    code.focus();
  }

  function init() {}

  Folio.importer = { init, fromHtml, open, close, pasteHtml, sanitize: (html, base) => sanitize(html, base).markup };
})();
